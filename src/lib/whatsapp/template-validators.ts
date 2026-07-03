/**
 * Pure validators for message templates, run BEFORE the Meta submit
 * call so a misconfigured template fails at save time (with a specific
 * field-level error) rather than at the Meta API boundary (where the
 * error is a generic 400 + opaque rejection_reason hours later).
 *
 * Every validator throws `Error(message)` — callers catch and surface
 * to the UI. Caps follow Meta's published limits for the Cloud API
 * template surface (v21.0):
 *   https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 *
 * Per-element button validation lives here rather than as a JSONB CHECK
 * because Postgres CHECK constraints can't contain subqueries, and
 * generic CHECK violations don't give users an actionable error
 * ("button #3 has no `text`" beats "constraint violated").
 */

import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from '@/types';

export const TEMPLATE_LIMITS = {
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
  buttonTextMaxLength: 25,
  maxButtonsTotal: 10,
  maxUrlButtons: 2,
  maxPhoneButtons: 1,
  maxCopyCodeButtons: 1,
  /** Meta: lowercase a-z, digits, underscore. Up to 512 chars. */
  nameRegex: /^[a-z0-9_]{1,512}$/,
} as const;

export interface TemplatePayload {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_type?: MessageTemplate['header_type'];
  header_content?: string;
  header_media_url?: string;
  header_handle?: string;
  parameter_format?:
        'POSITIONAL'
        | 'NAMED';
  body_text: string;
  footer_text?: string;
  buttons?: TemplateButton[];
  sample_values?: TemplateSampleValues;
}

export function validateTemplateName(name: string): void {
  if (!name) throw new Error('Template name is required.');
  if (!TEMPLATE_LIMITS.nameRegex.test(name)) {
    throw new Error(
      'Template name must use only lowercase letters, digits, and underscores (1-512 chars).',
    );
  }
}

/**
 * Extract sorted, deduplicated variables from a string.
 * Works for both Positional: `[1, 2, 4]` and Named: `['customer_name']`.
 */
export function extractVariables(text: string): string[] {
  // Matches digits (positional) or lowercase/underscores (named)
  const matches = text.matchAll(/\{\{([a-z_]+|\d+)\}\}/g);
  const set = new Set<string>();
  for (const m of matches) {
    set.add(m[1]);
  }
  
  // Sort numeric variables properly, leave named variables as is
  return [...set].sort((a, b) => {
    const numA = Number(a);
    const numB = Number(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });
}

// Alias for backward compatibility with prior imports that expect 'extractVariableIndices'
export const extractVariableIndices = extractVariables as any;

/**
 * Meta requires positional variables to be contiguous (1, 2, 3).
 * Named variables just need to follow the lowercase/underscore regex.
 * A template cannot mix format types.
 */
function assertValidVariables(variables: string[], where: string): void {
  if (variables.length === 0) return;

  const isPositional = variables.every((v) => /^\d+$/.test(v));
  const isNamed = variables.every((v) => /^[a-z_]+$/.test(v));

  if (!isPositional && !isNamed) {
    throw new Error(
      `${where} variables must be exclusively positional (e.g., {{1}}, {{2}}) or exclusively named (e.g., {{first_name}}) — cannot mix formats.`,
    );
  }

  if (isPositional) {
    const nums = variables.map(Number).sort((a, b) => a - b);
    for (let i = 0; i < nums.length; i++) {
      if (nums[i] !== i + 1) {
        throw new Error(
          `${where} variables must be contiguous starting at {{1}} — found ${nums
            .map((n) => `{{${n}}}`)
            .join(', ')}.`,
        );
      }
    }
  }
}

export function validateBody(bodyText: string): string[] {
  if (!bodyText.trim()) throw new Error('Body text is required.');
  if (bodyText.length > TEMPLATE_LIMITS.bodyMaxLength) {
    throw new Error(
      `Body text exceeds ${TEMPLATE_LIMITS.bodyMaxLength} chars (got ${bodyText.length}).`,
    );
  }
  const variables = extractVariables(bodyText);
  assertValidVariables(variables, 'Body');
  return variables;
}

export function validateFooter(footerText: string | undefined): void {
  if (!footerText) return;
  if (footerText.length > TEMPLATE_LIMITS.footerMaxLength) {
    throw new Error(
      `Footer text exceeds ${TEMPLATE_LIMITS.footerMaxLength} chars (got ${footerText.length}).`,
    );
  }
  if (extractVariables(footerText).length > 0) {
    throw new Error('Footer text cannot contain {{N}} variables (Meta rule).');
  }
}

export interface HeaderValidationResult {
  /** number of placeholders in a TEXT header — 0 or 1. */
  variableCount: number;
}

export function validateHeader(
  payload: Pick<
    TemplatePayload,
    'header_type' | 'header_content' | 'header_media_url' | 'header_handle'
  >,
): HeaderValidationResult {
  const { header_type, header_content, header_media_url, header_handle } = payload;
  if (!header_type) return { variableCount: 0 };

  if (header_type === 'text') {
    if (!header_content || !header_content.trim()) {
      throw new Error('Text header requires header_content.');
    }
    if (header_content.length > TEMPLATE_LIMITS.headerTextMaxLength) {
      throw new Error(
        `Header text exceeds ${TEMPLATE_LIMITS.headerTextMaxLength} chars (got ${header_content.length}).`,
      );
    }
    
    const variables = extractVariables(header_content);
    if (variables.length > 1) {
      throw new Error(
        `Text header supports at most one variable — found ${variables.length} (Meta rule).`,
      );
    }
    if (variables.length === 1) {
      const v = variables[0];
      if (v !== '1' && !/^[a-z_]+$/.test(v)) {
        throw new Error('Text header variable must be {{1}} or a valid named variable (lowercase letters and underscores).');
      }
    }
    return { variableCount: variables.length };
  }

  // image / video / document need either a public URL or a Resumable
  // Upload handle. Either one — Meta accepts both example forms.
  if (!header_media_url && !header_handle) {
    throw new Error(
      `${header_type} header requires either a public sample URL (header_media_url) or a Resumable Upload handle (header_handle).`,
    );
  }
  if (header_media_url) {
    try {
      const u = new URL(header_media_url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error('header_media_url must use http(s) scheme.');
      }
    } catch {
      throw new Error('header_media_url must be a valid URL.');
    }
  }
  return { variableCount: 0 };
}

function countButtonsByType(
  buttons: TemplateButton[],
): Record<TemplateButton['type'], number> {
  const counts: Record<TemplateButton['type'], number> = {
    QUICK_REPLY: 0,
    URL: 0,
    PHONE_NUMBER: 0,
    COPY_CODE: 0,
  };
  for (const b of buttons) counts[b.type]++;
  return counts;
}

export function validateButtons(buttons: TemplateButton[] | undefined): void {
  if (!buttons || buttons.length === 0) return;
  if (buttons.length > TEMPLATE_LIMITS.maxButtonsTotal) {
    throw new Error(
      `Templates can have at most ${TEMPLATE_LIMITS.maxButtonsTotal} buttons (got ${buttons.length}).`,
    );
  }

  const counts = countButtonsByType(buttons);
  if (counts.URL > TEMPLATE_LIMITS.maxUrlButtons) {
    throw new Error(
      `At most ${TEMPLATE_LIMITS.maxUrlButtons} URL buttons allowed (got ${counts.URL}).`,
    );
  }
  if (counts.PHONE_NUMBER > TEMPLATE_LIMITS.maxPhoneButtons) {
    throw new Error(
      `At most ${TEMPLATE_LIMITS.maxPhoneButtons} PHONE_NUMBER button allowed (got ${counts.PHONE_NUMBER}).`,
    );
  }
  if (counts.COPY_CODE > TEMPLATE_LIMITS.maxCopyCodeButtons) {
    throw new Error(
      `At most ${TEMPLATE_LIMITS.maxCopyCodeButtons} COPY_CODE button allowed (got ${counts.COPY_CODE}).`,
    );
  }

  // Meta rule: QUICK_REPLY buttons must be contiguous — they can't be
  // interleaved with CTA buttons. Easiest check: walk the array; once
  // we leave the QUICK_REPLY block, we must not see another.
  let sawNonQR = false;
  for (const b of buttons) {
    if (b.type === 'QUICK_REPLY') {
      if (sawNonQR) {
        throw new Error(
          'QUICK_REPLY buttons cannot be interleaved with URL / PHONE_NUMBER / COPY_CODE buttons — group them at the start.',
        );
      }
    } else {
      sawNonQR = true;
    }
  }

  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b.text?.trim()) {
      throw new Error(`Button #${i + 1} (${b.type}) is missing text.`);
    }
    if (b.text.length > TEMPLATE_LIMITS.buttonTextMaxLength) {
      throw new Error(
        `Button #${i + 1} text exceeds ${TEMPLATE_LIMITS.buttonTextMaxLength} chars.`,
      );
    }
    switch (b.type) {
      case 'URL': {
        if (!b.url?.trim()) {
          throw new Error(`URL button #${i + 1} is missing url.`);
        }
        try {
          new URL(b.url);
        } catch {
          throw new Error(`URL button #${i + 1} has an invalid url.`);
        }
        
        const urlVars = extractVariables(b.url);
        if (urlVars.length > 1) {
          throw new Error(
            `URL button #${i + 1} can have at most one variable (Meta rule).`,
          );
        }
        if (urlVars.length === 1) {
          const v = urlVars[0];
          if (v !== '1' && !/^[a-z_]+$/.test(v)) {
            throw new Error(
              `URL button #${i + 1} variable must be {{1}} or a valid named variable.`,
            );
          }
          if (!b.example?.trim()) {
            throw new Error(
              `URL button #${i + 1} uses a variable — Meta requires an example value.`,
            );
          }
        }
        break;
      }
      case 'PHONE_NUMBER':
        if (!b.phone_number?.trim()) {
          throw new Error(
            `PHONE_NUMBER button #${i + 1} is missing phone_number.`,
          );
        }
        break;
      case 'COPY_CODE':
        if (!b.example?.trim()) {
          throw new Error(
            `COPY_CODE button #${i + 1} is missing example value.`,
          );
        }
        break;
    }
  }
}

/**
 * Sample values must be supplied 1:1 with the variables in the body
 * (and header, if it has one). Meta uses these for human review.
 */
export function validateSampleValues(
  payload: TemplatePayload,
  bodyVarCount: number,
  headerVarCount: number,
): void {
  const samples = payload.sample_values ?? {};
  
  // Safely extract length and values whether passed as an Array (positional) or Dictionary (named)
  const getSampleValues = (val: any): string[] => {
    if (Array.isArray(val)) return val.map(String);
    if (val && typeof val === 'object') return Object.values(val).map(String);
    return [];
  };

  const bodySamples = getSampleValues(samples.body);
  const headerSamples = getSampleValues(samples.header);

  if (bodySamples.length !== bodyVarCount) {
    throw new Error(
      `Body has ${bodyVarCount} variable(s) — supply exactly ${bodyVarCount} sample value(s) (got ${bodySamples.length}).`,
    );
  }
  if (headerSamples.length !== headerVarCount) {
    throw new Error(
      `Header has ${headerVarCount} variable(s) — supply exactly ${headerVarCount} sample value(s) (got ${headerSamples.length}).`,
    );
  }
  
  for (let i = 0; i < bodySamples.length; i++) {
    if (!bodySamples[i] || !bodySamples[i].trim()) {
      throw new Error(`Body sample value is missing or empty.`);
    }
  }
  for (let i = 0; i < headerSamples.length; i++) {
    if (!headerSamples[i] || !headerSamples[i].trim()) {
      throw new Error(`Header sample value is missing or empty.`);
    }
  }
}
export function extractNamedVariables(text: string): string[] {
  const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

  const vars: string[] = [];

  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    vars.push(match[1]);
  }

  return [...new Set(vars)];
}

/**
 * Run every validator. Throws on the first failure with a specific,
 * field-level message. Returns the variable counts so callers can
 * reuse them when building the Meta components payload.
 */
export function validateTemplatePayload(payload: TemplatePayload): {
  bodyVarCount: number;
  headerVarCount: number;
} {
  validateTemplateName(payload.name);
  if (!payload.language?.trim()) {
    throw new Error('Language is required.');
  }
  const bodyVars = validateBody(payload.body_text);
  validateFooter(payload.footer_text);
  const headerResult = validateHeader(payload);
  validateButtons(payload.buttons);
  validateSampleValues(payload, bodyVars.length, headerResult.variableCount);
  
  return {
    bodyVarCount: bodyVars.length,
    headerVarCount: headerResult.variableCount,
  };
}