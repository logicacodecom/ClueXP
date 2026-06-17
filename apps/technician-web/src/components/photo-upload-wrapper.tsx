"use client";

import { PhotoUpload } from "@/components/photo-upload";
import { useState } from "react";

interface PhotoUploadWrapperProps {
  currentPhotoUrl?: string | null;
  photoStatus?: "pending" | "approved" | "rejected" | null;
}

export function PhotoUploadWrapper({ currentPhotoUrl, photoStatus }: PhotoUploadWrapperProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setMessage(null);
    
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/photo", {
        method: "POST",
        body: formData
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.detail || "Failed to upload photo");
      }

      setMessage(body.message || "Photo uploaded successfully. Pending review.");
      
      // In a real app, we'd refresh the profile data here
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Failed to upload photo");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Are you sure you want to remove your photo?")) return;
    
    // Remove endpoint would be implemented here when backend is ready
    setMessage("Photo removal not yet enabled.");
  };

  return (
    <PhotoUpload
      currentPhotoUrl={currentPhotoUrl || undefined}
      photoStatus={photoStatus || undefined}
      onUpload={handleUpload}
      onRemove={handleRemove}
      disabled={isUploading}
    />
  );
}
