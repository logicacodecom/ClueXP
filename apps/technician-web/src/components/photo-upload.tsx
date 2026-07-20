"use client";

import { CloudUpload, Image as ImageIcon, X } from "lucide-react";
import { useState } from "react";

interface PhotoUploadProps {
  currentPhotoUrl?: string | null;
  photoStatus?: "pending" | "approved" | "rejected" | null;
  onUpload?: (file: File) => void | Promise<void>;
  onRemove?: () => void;
  disabled?: boolean;
}

export function PhotoUpload({
  currentPhotoUrl,
  photoStatus,
  onUpload,
  onRemove,
  disabled = false
}: PhotoUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      void handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    if (!onUpload) {
      setMessage("Photo upload not yet enabled.");
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      await onUpload(file);
      setMessage("Photo updated.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Failed to upload photo.");
    } finally {
      setUploading(false);
    }
  };

  const getStatusColor = () => {
    switch (photoStatus) {
      case "approved":
      case "pending":
        return "border-success ring-2 ring-success/25";
      case "rejected":
        return "border-danger ring-2 ring-danger/25";
      default:
        return "border-border";
    }
  };

  const getStatusLabel = () => {
    switch (photoStatus) {
      case "approved":
      case "pending":
        return { text: "Photo added", color: "text-success bg-success/10" };
      case "rejected":
        return { text: "Photo needs replacement", color: "text-danger bg-danger/10" };
      default:
        return { text: "No photo", color: "text-muted bg-card-strong" };
    }
  };

  const statusLabel = getStatusLabel();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className={`flex size-16 items-center justify-center rounded-full bg-card font-bold text-2xl ${getStatusColor()} transition-all`}>
          {currentPhotoUrl ? (
            <img src={currentPhotoUrl} alt="Profile" className="size-full rounded-full object-cover" />
          ) : (
            <ImageIcon className="size-8 text-muted" />
          )}
        </div>
        <div className="min-w-0">
          <div className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${statusLabel.color}`}>
            {statusLabel.text}
          </div>
          {photoStatus === "rejected" && (
            <p className="mt-1 text-xs text-danger">Please upload a new photo to continue</p>
          )}
        </div>
      </div>

      <div
        className={`relative flex min-h-[120px] flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all ${
          dragActive ? "border-primary bg-primary/5" : "border-border bg-card"
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted">Uploading...</p>
          </div>
        ) : (
          <>
            <CloudUpload className="mb-2 size-8 text-muted" />
            <p className="text-center text-sm text-muted">
              {currentPhotoUrl ? "Tap or drag to replace photo" : "Tap or drag to upload photo"}
            </p>
            <p className="mt-1 text-xs text-muted">PNG, JPG up to 5MB</p>
          </>
        )}
        <input
          type="file"
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={handleFileChange}
          disabled={disabled || uploading}
          accept="image/png,image/jpeg,image/jpg"
        />
      </div>

      {message && (
        <p className="text-sm text-muted" role="status">
          {message}
        </p>
      )}

      {currentPhotoUrl && onRemove && !uploading && (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-2 text-sm font-bold text-muted hover:bg-card-strong"
          onClick={onRemove}
          disabled={disabled}
        >
          <X className="size-4" />Remove photo
        </button>
      )}
    </div>
  );
}
