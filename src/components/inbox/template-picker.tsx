"use client";

import { useEffect, useMemo, useState} from "react";

import { createClient } from "@/lib/supabase/client";

import type { MessageTemplate } from "@/types";

import MediaUploadDialog, {
  type UploadResult,
} from "@/components/whatsapp/MediaUploadDialog";

import {
  uploadToStorage,
  uploadToMeta,
} from "@/lib/whatsapp/media-upload";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Badge } from "@/components/ui/badge";

import {
  ArrowLeft,
  ChevronRight,
  LayoutTemplate,
  Loader2,
  Image as ImageIcon,
  Video,
  FileText,
  Upload,
} from "lucide-react";

import { extractVariables } from "@/lib/whatsapp/template-validators";

export interface TemplateSendValues {
  body: Record<string, string>;

  headerText?: string;

  headerMediaUrl?: string;

  headerMediaId?: string;

  buttonParams?: Record<number, string>;
}

interface TemplatePickerProps {
  open: boolean;

  onOpenChange: (open: boolean) => void;

  onSelect: (
    template: MessageTemplate,
    values: TemplateSendValues,
  ) => void;
}

function renderBodyPreview(
  body: string,
  params: Record<string, string>,
): string {
  return body.replace(
    /\{\{([a-z_]+|\d+)\}\}/g,
    (_, name) => {
      const value = params[name];

      return value?.trim()
        ? value
        : `{{${name}}}`;
    },
  );
}

interface UrlButtonSlot {
  index: number;

  text: string;

  url: string;

  urlVar: string;
}

function collectVariableSlots(
  template: MessageTemplate,
): {
  bodyVars: string[];

  headerVar: string | null;

  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractVariables(
    template.body_text || "",
  );

  const headerVars =
    template.header_type === "text" &&
    template.header_content
      ? extractVariables(
          template.header_content,
        )
      : [];

  const headerVar =
    headerVars.length > 0
      ? headerVars[0]
      : null;

  const urlButtonSlots: UrlButtonSlot[] =
    [];

  (template.buttons ?? []).forEach(
    (button, index) => {
      if (
        button.type === "URL" &&
        button.url
      ) {
        const vars = extractVariables(
          button.url,
        );

        if (vars.length > 0) {
          urlButtonSlots.push({
            index,
            text: button.text,
            url: button.url,
            urlVar: vars[0],
          });
        }
      }
    },
  );

  return {
    bodyVars,
    headerVar,
    urlButtonSlots,
  };
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
}: TemplatePickerProps) {
  const [templates, setTemplates] =
    useState<MessageTemplate[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [selected, setSelected] =
    useState<MessageTemplate | null>(
      null,
    );

  const [params, setParams] =
    useState<Record<string, string>>(
      {},
    );

  const [headerText, setHeaderText] =
    useState("");

  const [buttonParams, setButtonParams] =
    useState<Record<number, string>>(
      {},
    );

  const [accountId, setAccountId] =
    useState("");

  const [headerMediaUrl, setHeaderMediaUrl] =
    useState("");

  const [headerMediaId, setHeaderMediaId] =
    useState("");

  const [
    mediaDialogOpen,
    setMediaDialogOpen,
  ] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    (async () => {
      setLoading(true);

      const supabase =
        createClient();

      const {
        data: { user },
      } =
        await supabase.auth.getUser();

      if (!user) {
        setTemplates([]);
        setLoading(false);
        return;
      }

      const { data: profile } =
        await supabase
          .from("profiles")
          .select("account_id")
          .eq("user_id", user.id)
          .single();

      if (profile?.account_id) {
        setAccountId(
          profile.account_id,
        );
      }

      const {
        data,
        error,
      } = await supabase
        .from("message_templates")
        .select("*")
        .eq("status", "APPROVED")
        .order("created_at", {
          ascending: false,
        });

      if (cancelled) return;

      if (error) {
        console.error(error);
        setTemplates([]);
      } else {
        setTemplates(
          (data as MessageTemplate[]) ??
            [],
        );
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);
  function resetSelection() {
  setSelected(null);

  setParams({});

  setHeaderText("");

  setButtonParams({});

  setHeaderMediaUrl("");

  setHeaderMediaId("");

  setMediaDialogOpen(false);
}

function handleOpenChange(next: boolean) {
  if (!next) {
    resetSelection();
  }

  onOpenChange(next);
}

function pickTemplate(template: MessageTemplate) {
  const slots = collectVariableSlots(template);

  const noInputsNeeded =
    slots.bodyVars.length === 0 &&
    slots.headerVar === null &&
    slots.urlButtonSlots.length === 0 &&
    template.header_type !== "image" &&
    template.header_type !== "video" &&
    template.header_type !== "document";

  if (noInputsNeeded) {
    onSelect(template, {
      body: {},
    });

    handleOpenChange(false);

    return;
  }

  setSelected(template);
  setHeaderMediaUrl(template.header_media_url ?? "");
setHeaderMediaId(template.header_media_id ?? "");

  const values: Record<string, string> = {};

  slots.bodyVars.forEach((v) => {
    values[v] = "";
  });

  setParams(values);

  setHeaderText("");

  setButtonParams({});

}

async function handleUploadToStorage(
  file: File,
) {
  const result =
    await uploadToStorage(
      file,
      accountId,
    );

  return result.publicUrl;
}
async function handleMediaComplete(
  result: UploadResult,
) {
  if (result.headerMediaUrl) {
    setHeaderMediaUrl(result.headerMediaUrl);
  }

  if (result.headerMediaId) {
    setHeaderMediaId(result.headerMediaId);
  }

  if (!selected) return;

  const supabase = createClient();

  const { error } = await supabase
    .from("message_templates")
    .update({
      header_media_url:
        result.headerMediaUrl ?? null,
      header_media_id:
        result.headerMediaId ?? null,
    })
    .eq("id", selected.id);

  if (error) {
    console.error(error);
    throw error;
  }
}
async function handleUploadToMeta(file: File) {
  const result = await uploadToMeta(file);
  return result.mediaId;
}

function confirm() {
  if (!selected) return;

  const values: TemplateSendValues = {
    body: params,
  };

  if (headerText.trim()) {
    values.headerText =
      headerText.trim();
  }

  if (headerMediaUrl) {
    values.headerMediaUrl =
      headerMediaUrl;
  }

  if (headerMediaId) {
    values.headerMediaId =
      headerMediaId;
  }

  if (
    Object.keys(buttonParams).length >
    0
  ) {
    values.buttonParams =
      Object.fromEntries(
        Object.entries(
          buttonParams,
        ).map(([k, v]) => [
          Number(k),
          v.trim(),
        ]),
      );
  }

  onSelect(selected, values);

  handleOpenChange(false);
}

const slots = useMemo(
  () =>
    selected
      ? collectVariableSlots(
          selected,
        )
      : null,
  [selected],
);

const requiresMedia =
  !!selected &&
  (
    selected.header_type ===
      "image" ||
    selected.header_type ===
      "video" ||
    selected.header_type ===
      "document"
  );

const canConfirm =
  !!selected &&
  !!slots &&
  slots.bodyVars.every(
    (v) =>
      (params[v] ?? "")
        .trim()
        .length > 0,
  ) &&
  (!slots.headerVar ||
    headerText.trim().length >
      0) &&
  slots.urlButtonSlots.every(
    (slot) =>
      (
        buttonParams[
          slot.index
        ] ?? ""
      )
        .trim()
        .length > 0,
  ) &&
  (
    !requiresMedia ||
    !!headerMediaId ||
    !!headerMediaUrl
  );
  return (
  <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            {selected ? selected.name : "Send template"}
          </DialogTitle>

          <DialogDescription>
            {selected
              ? "Fill the required variables before sending."
              : "Choose an approved WhatsApp template."}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border p-6 text-center">
                <p>No approved templates.</p>
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTemplate(t)}
                  className="w-full rounded-md border p-3 text-left hover:border-primary"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">
                          {t.name}
                        </p>

                        <Badge>
                          {t.category}
                        </Badge>

                        {t.language && (
                          <span className="text-xs text-muted-foreground uppercase">
                            {t.language}
                          </span>
                        )}
                      </div>

                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {t.body_text}
                      </p>
                    </div>

                    <ChevronRight className="h-4 w-4" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">

            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground mb-2">
                Preview
              </p>

              <p className="whitespace-pre-wrap text-sm">
                {renderBodyPreview(
                  selected.body_text,
                  params,
                )}
              </p>

              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {selected.footer_text}
                </p>
              )}
            </div>

            {requiresMedia && (
              <div className="space-y-2">

                <Label>
                  Header Media
                </Label>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setMediaDialogOpen(true)
                  }
                >
                  <Upload className="mr-2 h-4 w-4" />

                  Upload Header Media
                </Button>

                {(headerMediaUrl ||
                  headerMediaId) && (
                  <div className="rounded-md border p-3">

                    <div className="flex items-center gap-2">

                      {selected.header_type ===
                        "image" && (
                        <ImageIcon className="h-4 w-4" />
                      )}

                      {selected.header_type ===
                        "video" && (
                        <Video className="h-4 w-4" />
                      )}

                      {selected.header_type ===
                        "document" && (
                        <FileText className="h-4 w-4" />
                      )}

                      <span className="text-sm text-green-600">
                        Media uploaded successfully
                      </span>

                    </div>
                  </div>
                )}
              </div>
            )}

            {slots?.headerVar && (
              <div className="space-y-1">
                <Label>
                  Header
                </Label>

                <Input
                  value={headerText}
                  onChange={(e) =>
                    setHeaderText(
                      e.target.value,
                    )
                  }
                />
              </div>
            )}

            {slots?.bodyVars.map((v) => (
              <div
                key={v}
                className="space-y-1"
              >
                <Label>
                  {`Body {{${v}}}`}
                </Label>

                <Input
                  value={params[v] ?? ""}
                  onChange={(e) =>
                    setParams((prev) => ({
                      ...prev,
                      [v]:
                        e.target.value,
                    }))
                  }
                />
              </div>
            ))}

            {slots?.urlButtonSlots.map(
              (slot) => (
                <div
                  key={slot.index}
                  className="space-y-1"
                >
                  <Label>
                    {slot.text}
                  </Label>

                  <Input
                    value={
                      buttonParams[
                        slot.index
                      ] ?? ""
                    }
                    onChange={(e) =>
                      setButtonParams(
                        (prev) => ({
                          ...prev,
                          [slot.index]:
                            e.target
                              .value,
                        }),
                      )
                    }
                  />
                </div>
              ),
            )}
          </div>
        )}

        <DialogFooter>

          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={
                  resetSelection
                }
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>

              <Button
                disabled={!canConfirm}
                onClick={confirm}
              >
                Send Template
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                handleOpenChange(false)
              }
            >
              Cancel
            </Button>
          )}

        </DialogFooter>
      </DialogContent>
    </Dialog>

    {selected &&
      requiresMedia && (
        <MediaUploadDialog
          open={mediaDialogOpen}
          mediaType={
            selected.header_type as
              | "image"
              | "video"
              | "document"
          }
          onOpenChange={
            setMediaDialogOpen
          }
          onUploadToStorage={
            handleUploadToStorage
          }
          onUploadToMeta={
            handleUploadToMeta
          }
          onComplete={
            handleMediaComplete
          }
        />
      )}
  </>
);
}