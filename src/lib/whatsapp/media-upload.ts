import { createClient } from "@/lib/supabase/client";

export interface UploadToStorageResult {
  path: string;
  publicUrl: string;
  fileName: string;
  mediaType: string;
  fileSize: number;
}

export interface UploadToMetaResult {
  mediaId: string;
}

function getFileExtension(file: File): string {
  const ext = file.name.split(".").pop();
  return ext ? ext.toLowerCase() : "";
}

function generateFileName(
  accountId: string,
  file: File,
): string {
  const extension = getFileExtension(file);

  return `${accountId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

export function isVideo(file: File): boolean {
  return file.type.startsWith("video/");
}

export function isDocument(file: File): boolean {
  return (
    file.type.includes("pdf") ||
    file.type.includes("word") ||
    file.type.includes("excel") ||
    file.type.includes("sheet") ||
    file.type.includes("presentation") ||
    file.type.includes("powerpoint") ||
    file.type.includes("text")
  );
}

/**
 * Upload file to Supabase Storage.
 */
export async function uploadToStorage(
  file: File,
  accountId: string,
): Promise<UploadToStorageResult> {
  const supabase = createClient();

  const fileName = generateFileName(accountId, file);

  const { error } = await supabase.storage
    .from("template_media")
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage
    .from("template_media")
    .getPublicUrl(fileName);

  if (!data.publicUrl) {
    throw new Error("Failed to generate public URL.");
  }

  return {
    path: fileName,
    publicUrl: data.publicUrl,
    fileName: file.name,
    mediaType: file.type,
    fileSize: file.size,
  };
}

/**
 * Upload media to WhatsApp Cloud API.
 */
export async function uploadToMeta(
  file: File,
): Promise<UploadToMetaResult> {
  const formData = new FormData();

  formData.append("file", file);

  const response = await fetch(
    "/api/whatsapp/media/upload",
    {
      method: "POST",
      body: formData,
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    console.error("META RESPONSE:", data);

    throw new Error(
      data?.error?.message ??
      data?.error ??
      data?.message ??
      `Meta API error ${response.status}`,
    );
  }

  return {
    mediaId: data.mediaId,
  };
}
/**
 * Delete a file from Supabase Storage.
 */
export async function deleteStorageMedia(
  path: string,
): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.storage
    .from("template_media")
    .remove([path]);

  if (error) {
    throw error;
  }
}

/**
 * Delete media from WhatsApp Cloud API.
 */
export async function deleteMetaMedia(
  mediaId: string,
): Promise<void> {
  const response = await fetch(
    `/api/whatsapp/media/${mediaId}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    const payload = await response
      .json()
      .catch(() => ({}));

    throw new Error(
      payload?.error ??
      payload?.message ??
      "Failed to delete WhatsApp media.",
    );
  }
}

/**
 * Returns a public URL for a storage object.
 */
export function getPublicMediaUrl(
  path: string,
): string {
  const supabase = createClient();

  const { data } = supabase.storage
    .from("template_media")
    .getPublicUrl(path);

  return data.publicUrl;
}

/**
 * Returns the generic media type.
 */
export function getMediaType(
  mimeType: string,
): "image" | "video" | "document" {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return "document";
}

/**
 * Returns whether the file type is supported.
 */
export function isSupportedMedia(
  file: File,
): boolean {
  return (
    isImage(file) ||
    isVideo(file) ||
    isDocument(file)
  );
}