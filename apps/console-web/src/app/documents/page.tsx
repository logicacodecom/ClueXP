"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@cluexp/console-ui";
import { Check, FileCheck2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface Document {
  id: string;
  owner_type: string;
  owner_name?: string | null;
  document_type: string;
  document_number?: string | null;
  jurisdiction?: string | null;
  expires_at?: string | null;
  status: string;
}

interface TechnicianPhoto {
  technician_id: string;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  photo_url: string;
  photo_status: "pending" | "approved" | "rejected" | "none";
  status?: string | null;
  vetting_status?: string | null;
}

interface TechnicianDocument {
  id: string;
  technician_id: string;
  technician_name?: string | null;
  document_type: string;
  document_number?: string | null;
  status: string;
  expiration_date?: string | null;
  uploaded_at?: string | null;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [photos, setPhotos] = useState<TechnicianPhoto[]>([]);
  const [techDocs, setTechDocs] = useState<TechnicianDocument[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const [documentsResponse, photosResponse, techDocsResponse] = await Promise.all([
      fetch("/api/documents", { cache: "no-store" }),
      fetch("/api/technician-photos", { cache: "no-store" }),
      fetch("/api/technician-documents", { cache: "no-store" })
    ]);
    const documentsBody = await documentsResponse.json().catch(() => ({}));
    const photosBody = await photosResponse.json().catch(() => ({}));
    const techDocsBody = await techDocsResponse.json().catch(() => ({}));
    if (!documentsResponse.ok) throw new Error(documentsBody.detail || "Unable to load documents");
    if (!photosResponse.ok) throw new Error(photosBody.detail || "Unable to load technician photos");
    if (!techDocsResponse.ok) throw new Error(techDocsBody.detail || "Unable to load technician documents");
    setDocuments(documentsBody.documents ?? []);
    setPhotos(photosBody.photos ?? []);
    setTechDocs(techDocsBody.documents ?? []);
  }, []);
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [refresh]);

  async function decide(document: Document, status: "verified" | "rejected") {
    setBusy(document.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(document.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to review document");
      await refresh();
      setMessage(status === "verified" ? "Document verified." : "Document rejected.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to review document");
    } finally {
      setBusy(null);
    }
  }

  async function decidePhoto(photo: TechnicianPhoto, status: "approved" | "rejected") {
    setBusy(`photo:${photo.technician_id}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/technician-photos/${encodeURIComponent(photo.technician_id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to review technician photo");
      await refresh();
      setMessage(status === "approved" ? "Technician photo approved." : "Technician photo rejected.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to review technician photo");
    } finally {
      setBusy(null);
    }
  }

  async function openDocument(document: Document) {
    setMessage(null);
    const response = await fetch(`/api/documents/${encodeURIComponent(document.id)}/download`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.detail || "Unable to open document");
      return;
    }
    window.open(body.download_url, "_blank", "noopener,noreferrer");
  }

  async function decideTechDoc(doc: TechnicianDocument, status: "approved" | "rejected") {
    setBusy(`techdoc:${doc.id}`);
    setMessage(null);
    try {
      const rejected_reason =
        status === "rejected" ? window.prompt("Reason for rejection (optional):") || undefined : undefined;
      const response = await fetch(`/api/technician-documents/${encodeURIComponent(doc.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, rejected_reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to review technician document");
      await refresh();
      setMessage(status === "approved" ? "Technician document approved." : "Technician document rejected.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to review technician document");
    } finally {
      setBusy(null);
    }
  }

  async function openTechDoc(doc: TechnicianDocument) {
    setMessage(null);
    const response = await fetch(`/api/technician-documents/${encodeURIComponent(doc.id)}/download`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.detail || "Unable to open document");
      return;
    }
    window.open(body.download_url, "_blank", "noopener,noreferrer");
  }

  return (
    <AppFrame>
      <div className="space-y-6">
        <header><div className="text-xs font-semibold uppercase text-muted-foreground">Network governance</div><h1 className="mt-2 text-3xl font-semibold">Compliance review</h1><p className="mt-2 text-sm text-muted-foreground">Verify organization and technician documents before dispatch eligibility changes.</p></header>
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
        <Card>
          <CardHeader><CardTitle>Pending technician photos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {photos.length === 0 ? <p className="text-sm text-muted-foreground">No technician headshots awaiting review.</p> : photos.map((photo) => {
              const isBusy = busy === `photo:${photo.technician_id}`;
              return (
                <div className="flex flex-wrap items-center gap-4 rounded-md border border-border p-4" key={photo.technician_id}>
                  <img
                    alt={`${photo.display_name || "Technician"} headshot`}
                    className="size-16 rounded-full border border-border object-cover"
                    src={photo.photo_url}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{photo.display_name || "Technician"}</div>
                    <div className="text-sm text-muted-foreground">{photo.email || photo.phone || photo.technician_id}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Global: {photo.status || "unknown"} · Vetting: {photo.vetting_status || "unknown"}
                    </div>
                  </div>
                  <Badge variant="warn">pending photo</Badge>
                  <Button disabled={isBusy} variant="outline" onClick={() => void decidePhoto(photo, "rejected")}><X className="size-4" />Reject</Button>
                  <Button disabled={isBusy} onClick={() => void decidePhoto(photo, "approved")}><Check className="size-4" />Approve</Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Pending technician documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {techDocs.length === 0 ? <p className="text-sm text-muted-foreground">No technician documents awaiting review.</p> : techDocs.map((doc) => {
              const isBusy = busy === `techdoc:${doc.id}`;
              return (
                <div className="flex flex-wrap items-center gap-4 rounded-md border border-border p-4" key={doc.id}>
                  <FileCheck2 className="size-5 text-primary" />
                  <div className="min-w-0 flex-1"><div className="font-medium">{doc.technician_name || doc.technician_id}</div><div className="text-sm text-muted-foreground">{doc.document_type.replaceAll("_", " ")}{doc.document_number ? ` · ${doc.document_number}` : ""}{doc.expiration_date ? ` · expires ${doc.expiration_date}` : ""}</div></div>
                  <Badge variant="warn">pending review</Badge>
                  <Button disabled={isBusy} variant="outline" onClick={() => void openTechDoc(doc)}>Open file</Button>
                  <Button disabled={isBusy} variant="outline" onClick={() => void decideTechDoc(doc, "rejected")}><X className="size-4" />Reject</Button>
                  <Button disabled={isBusy} onClick={() => void decideTechDoc(doc, "approved")}><Check className="size-4" />Approve</Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Pending documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents awaiting review.</p> : documents.map((document) => (
              <div className="flex flex-wrap items-center gap-4 rounded-md border border-border p-4" key={document.id}>
                <FileCheck2 className="size-5 text-primary" />
                <div className="min-w-0 flex-1"><div className="font-medium">{document.owner_name || document.owner_type}</div><div className="text-sm text-muted-foreground">{document.document_type.replaceAll("_", " ")}{document.expires_at ? ` · expires ${document.expires_at}` : ""}</div></div>
                <Badge variant="warn">pending review</Badge>
                <Button disabled={busy === document.id} variant="outline" onClick={() => void openDocument(document)}>Open file</Button>
                <Button disabled={busy === document.id} variant="outline" onClick={() => void decide(document, "rejected")}><X className="size-4" />Reject</Button>
                <Button disabled={busy === document.id} onClick={() => void decide(document, "verified")}><Check className="size-4" />Verify</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
