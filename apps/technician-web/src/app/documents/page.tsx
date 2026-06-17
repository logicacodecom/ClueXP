"use client";

import { AppFrame, EmptyState, Screen, Section, icons } from "@/components/mobile";
import { Upload } from "lucide-react";

export default function DocumentsPage() {
  const documents = [
    { id: "doc1", name: "Driver's License", type: "ID", status: "approved", uploadedAt: "2024-01-15" },
    { id: "doc2", name: "Proof of Insurance", type: "Insurance", status: "pending", uploadedAt: "2024-03-20" },
  ];

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
                        <h3 className="font-bold">{doc.name}</h3>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-700">
                          {doc.type}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted">Uploaded {doc.uploadedAt}</div>
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
                        {doc.status}
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
              <Upload className="mb-3 size-8 text-muted" />
              <p className="text-sm font-bold text-muted">Tap or drag documents here</p>
              <p className="mt-1 text-xs text-muted">PDF, JPG, PNG up to 10MB</p>
              <div className="mt-4 flex gap-2">
                <button type="button" className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
                  Choose files
                </button>
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
