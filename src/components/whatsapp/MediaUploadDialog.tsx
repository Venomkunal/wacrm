"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import {
  Upload,
  Image as ImageIcon,
  Video,
  FileText,
  Loader2,
  X,
} from "lucide-react";

import Image from "next/image";

export type UploadMethod = "storage" | "meta";

export interface UploadResult {
  headerMediaUrl?: string;
  headerMediaId?: string;
}

interface MediaUploadDialogProps {
  open: boolean;
  mediaType: "image" | "video" | "document";
  onOpenChange: (open: boolean) => void;

  /**
   * Upload to your own storage.
   * Return a public URL.
   */
  onUploadToStorage: (file: File) => Promise<string>;

  /**
   * Upload to Meta.
   * Return media id.
   */
  onUploadToMeta: (file: File) => Promise<string>;

  onComplete: (result: UploadResult) => void;
}

export default function MediaUploadDialog({
  open,
  mediaType,
  onOpenChange,
  onUploadToStorage,
  onUploadToMeta,
  onComplete,
}: MediaUploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [method, setMethod] =
    useState<UploadMethod>("storage");

  const [file, setFile] =
    useState<File | null>(null);

  const [preview, setPreview] =
    useState<string>();

  const [uploading, setUploading] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }

    if (mediaType !== "image") return;

    const url = URL.createObjectURL(file);

    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [file, mediaType]);
  const acceptedTypes =
  mediaType === "image"
    ? "image/*"
    : mediaType === "video"
      ? "video/*"
      : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";

function validateFile(file: File): string | null {
  if (mediaType === "image") {
    if (!file.type.startsWith("image/")) {
      return "Please select an image.";
    }

    if (file.size > 5 * 1024 * 1024) {
      return "Image must be smaller than 5MB.";
    }
  }

  if (mediaType === "video") {
    if (!file.type.startsWith("video/")) {
      return "Please select a video.";
    }

    if (file.size > 16 * 1024 * 1024) {
      return "Video must be smaller than 16MB.";
    }
  }

  if (mediaType === "document") {
    if (file.size > 100 * 1024 * 1024) {
      return "Document must be smaller than 100MB.";
    }
  }

  return null;
}

function handleFile(file: File) {
  const validation = validateFile(file);

  if (validation) {
    setError(validation);
    return;
  }

  setError("");
  setFile(file);
}

function onFileChange(
  e: React.ChangeEvent<HTMLInputElement>,
) {
  const selected = e.target.files?.[0];

  if (!selected) return;

  handleFile(selected);
}

function onDrop(
  e: React.DragEvent<HTMLDivElement>,
) {
  e.preventDefault();

  const dropped = e.dataTransfer.files?.[0];

  if (!dropped) return;

  handleFile(dropped);
}

function removeFile() {
  setFile(null);
  setPreview(undefined);

  if (inputRef.current) {
    inputRef.current.value = "";
  }
}
async function handleUpload() {
  if (!file) {
    setError("Please select a file.");
    return;
  }

  setUploading(true);
  setError("");

  try {
    if (method === "storage") {
      const url = await onUploadToStorage(file);

      onComplete({
        headerMediaUrl: url,
      });
    } else {
      const mediaId = await onUploadToMeta(file);

      onComplete({
        headerMediaId: mediaId,
      });
    }

    onOpenChange(false);
  } catch (err) {
    console.error(err);

    setError(
      err instanceof Error
        ? err.message
        : "Upload failed.",
    );
  } finally {
    setUploading(false);
  }
}
useEffect(() => {
  if (!open) {
    setFile(null);
    setPreview(undefined);
    setError("");
    setUploading(false);
    setMethod("storage");

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }
}, [open]);
return (
  <Dialog
  open={open}
  onOpenChange={(next) => {
    if (uploading) return;
    onOpenChange(next);
  }}
>
    <DialogContent className="sm:max-w-lg">

      <DialogHeader>
        <DialogTitle>
  Upload {mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}
</DialogTitle>

        <DialogDescription>
          Choose how you would like to upload this media for this WhatsApp template.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">

        <div>

          <Label className="mb-3 block">
            Upload Method
          </Label>

          <RadioGroup
            value={method}
            disabled={uploading}
            onValueChange={(v) =>
              setMethod(v as UploadMethod)
            }
          >

            <div className="flex items-center gap-2">

              <RadioGroupItem
                value="storage"
                id="storage"
              />

              <Label htmlFor="storage">
                Upload to My Storage
              </Label>

            </div>

            <div className="flex items-center gap-2">

              <RadioGroupItem
                value="meta"
                id="meta"
              />

              <Label htmlFor="meta">
                Upload to WhatsApp (Meta)
              </Label>

            </div>

          </RadioGroup>

        </div>

        <input
          ref={inputRef}
          hidden
          type="file"
          accept={acceptedTypes}
          onChange={onFileChange}
        />

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => {   if (!uploading) {     inputRef.current?.click();   } }}
          className="cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition hover:border-primary"
        >

          <Upload className="mx-auto mb-3 h-10 w-10" />

          <p className="font-medium">
            Click or Drag & Drop
          </p>

          <p className="text-sm text-muted-foreground">

            {mediaType === "image"
              ? "PNG, JPG, WEBP (max 5MB)"
              : mediaType === "video"
                ? "MP4 (max 16MB)"
                : "PDF / DOC / XLS (max 100MB)"}

          </p>

        </div>

        {error && (
          <p className="text-sm text-red-500">
            {error}
          </p>
        )}

        {file && (

          <div className="rounded-md border p-3">

            <div className="flex items-center justify-between">

              <div className="flex items-center gap-3">

                {mediaType === "image" && (
                  <ImageIcon className="h-5 w-5" />
                )}

                {mediaType === "video" && (
                  <Video className="h-5 w-5" />
                )}

                {mediaType === "document" && (
                  <FileText className="h-5 w-5" />
                )}

                <div>

                  <p className="font-medium">
                    {file.name}
                  </p>

                  <p className="text-xs text-muted-foreground">

                    {(file.size / 1024 / 1024).toFixed(2)} MB

                  </p>

                </div>

              </div>

              <Button   type="button"
                size="icon"
                variant="ghost"
                onClick={removeFile}
              >
                <X className="h-4 w-4" />
              </Button>

            </div>

            {preview && (

             <Image
  src={preview}
  alt="Preview"
  width={500}
  height={300}
  className="mt-4 rounded-lg object-cover"
/>

            )}

          </div>

        )}

      </div>
            <DialogFooter>
        <Button   type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={uploading}
        >
          Cancel
        </Button>

        <Button   type="button"
          onClick={handleUpload}
          disabled={!file || uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </>
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
}