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

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/documents", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || "Unable to load documents");
    setDocuments(body.documents ?? []);
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

  return (
    <AppFrame>
      <div className="space-y-6">
        <header><div className="text-xs font-semibold uppercase text-muted-foreground">Network governance</div><h1 className="mt-2 text-3xl font-semibold">Compliance review</h1><p className="mt-2 text-sm text-muted-foreground">Verify organization and technician documents before dispatch eligibility changes.</p></header>
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
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
