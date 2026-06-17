"use client";

import { AppFrame, EmptyState, Screen, Section, icons } from "@/components/mobile";
import { Upload } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type TechnicianDocument = {
  id: string;
  document_type: string;
  document_number?: string | null;
  status: "pending_review" | "approved" | "rejected";
  uploaded_at?: string | null;
  reviewed_at?: string | null;
  expiration_date?: string | null;
  rejected_reason?: string | null;
};

function humanizeType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<TechnicianDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchDocuments();
  }, []);

  async function fetchDocuments() {
    try {
      const response = await fetch("/api/documents");
      const data = await response.json();
      if (response.ok && data.documents) {
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      alert("Invalid file type. Use JPG, PNG, WebP, or PDF.");
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      alert("File too large. Max 10MB.");
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("document_type", "driver_license"); // Simplified - in production, prompt user to select type

      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Failed to upload document");
      }

      // Refresh documents list
      await fetchDocuments();
      alert("Document uploaded successfully!");
    } catch (error) {
      console.error("Upload failed:", error);
      alert((error as Error).message || "Failed to upload document");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <AppFrame title="Documents">
        <Screen>
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mb-3 animate-spin rounded-full border-4 border-border border-t-primary mx-auto w-8 h-8" />
              <p className="text-sm text-muted">Loading documents...</p>
            </div>
          </div>
        </Screen>
      </AppFrame>
    );
  }

  return (
    <AppFrame title="Documents">
      <Screen>
        <Section title="Compliance documents">
          <p className="mb-3 text-sm text-muted">
            Upload required documents to remain eligible for jobs. All documents are reviewed before becoming active.
          </p>

          {documents.length === 0 ? (
            <EmptyState
              title="No documents uploaded"
              icon={icons.FileCheck2}
              text="You haven't uploaded any documents yet. Upload required documents to continue working."
            />
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold">{humanizeType(doc.document_type)}</h3>
                        {doc.document_number && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-700">
                            {doc.document_number}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted">Uploaded {formatDate(doc.uploaded_at)}</div>
                      {doc.status === "rejected" && doc.rejected_reason && (
                        <div className="mt-1 text-xs text-red-600">
                          Rejected: {doc.rejected_reason}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          doc.status === "approved"
                            ? "bg-green-100 text-green-800"
                            : doc.status === "rejected"
                              ? "bg-red-100 text-red-800"
                              : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {doc.status === "pending_review" ? "Pending" : doc.status}
                      </div>
                      <button type="button" className="text-xs font-bold text-primary">
                        View
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Add document">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card py-8">
              <Upload className={`mb-3 size-8 ${uploading ? "animate-spin text-muted" : "text-muted"}`} />
              <p className="text-sm font-bold text-muted">
                {uploading ? "Uploading..." : "Tap or drag documents here"}
              </p>
              <p className="mt-1 text-xs text-muted">PDF, JPG, PNG up to 10MB</p>
              <div className="mt-4 flex gap-2">
                <label className="cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
                  Choose files
                  <input
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={handleUpload}
                    disabled={uploading}
                  />
                </label>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Document requirements">
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-xl bg-card p-3">
              <div className="mt-0.5 rounded-full bg-primary/10 p-1.5">
                <icons.CheckCircle2 className="size-4 text-primary" />
              </div>
              <div>
                <h4 className="font-bold">Valid government-issued ID</h4>
                <p className="text-sm text-muted">Driver's license, passport, or state ID</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-card p-3">
              <div className="mt-0.5 rounded-full bg-primary/10 p-1.5">
                <icons.CheckCircle2 className="size-4 text-primary" />
              </div>
              <div>
                <h4 className="font-bold">Proof of insurance</h4>
                <p className="text-sm text-muted">Current insurance policy showing coverage</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-card p-3">
              <div className="mt-0.5 rounded-full bg-primary/10 p-1.5">
                <icons.CheckCircle2 className="size-4 text-primary" />
              </div>
              <div>
                <h4 className="font-bold">Background check</h4>
                <p className="text-sm text-muted">Completed automatically during onboarding</p>
              </div>
            </div>
          </div>
        </Section>
      </Screen>
    </AppFrame>
  );
}
