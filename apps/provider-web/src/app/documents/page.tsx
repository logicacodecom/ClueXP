"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { FileCheck2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface Workspace {
  organization: { id: string };
  technicians: Array<{ id: string; display_name: string }>;
  documents: Array<{ id: string; owner_type: string; document_type: string; status: string; expires_at?: string | null }>;
}

export default function DocumentsPage() {
  const [workspace, setWorkspace] = useState<Workspace>({ organization: { id: "" }, technicians: [], documents: [] });
  const [form, setForm] = useState({ owner_type: "organization", owner_id: "", document_type: "business_license", document_number: "", expires_at: "" });
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || "Unable to load documents");
    setWorkspace(body);
  }, []);
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [refresh]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const intentResponse = await fetch("/api/documents/upload-intent", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, content_type: file.type, size: file.size })
      });
      const intent = await intentResponse.json().catch(() => ({}));
      if (!intentResponse.ok) throw new Error(intent.detail || "Unable to prepare upload");
      const upload = await fetch(intent.upload_url, { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!upload.ok) throw new Error("Document upload failed");
      const response = await fetch("/api/documents", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          owner_id: form.owner_type === "organization" ? workspace.organization.id : form.owner_id,
          document_number: form.document_number || null,
          expires_at: form.expires_at || null,
          storage_bucket: intent.bucket,
          storage_path: intent.path
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to record document");
      setFile(null);
      setMessage("Document submitted for review.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to upload document");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppFrame>
      <div className="space-y-6">
        <header><div className="text-xs font-semibold uppercase text-muted-foreground">Compliance</div><h1 className="mt-2 text-3xl font-semibold">Documents</h1><p className="mt-2 text-sm text-muted-foreground">Submit organization and technician credentials that control dispatch eligibility.</p></header>
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="size-5 text-primary" />Submit document</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <select className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" value={form.owner_type} onChange={(event) => setForm({ ...form, owner_type: event.target.value, owner_id: "" })}><option value="organization">Organization</option><option value="technician">Technician</option></select>
            {form.owner_type === "technician" ? <select className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" value={form.owner_id} onChange={(event) => setForm({ ...form, owner_id: event.target.value })}><option value="">Choose technician</option>{workspace.technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.display_name}</option>)}</select> : <div className="min-h-11 rounded-md border border-border bg-secondary px-3 py-2 text-sm">Organization credential</div>}
            <select className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" value={form.document_type} onChange={(event) => setForm({ ...form, document_type: event.target.value })}><option value="business_license">Business license</option><option value="insurance">Insurance</option><option value="technician_license">Technician license</option><option value="identity">Identity verification</option></select>
            <Input placeholder="Document number" value={form.document_number} onChange={(event) => setForm({ ...form, document_number: event.target.value })} />
            <Input aria-label="Expiration date" type="date" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} />
            <Input accept=".pdf,image/png,image/jpeg,image/webp" aria-label="Document file" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <Button className="md:col-span-2 md:w-fit" disabled={busy || !file || (form.owner_type === "technician" && !form.owner_id)} onClick={() => void submit()}><Upload className="size-4" />{busy ? "Uploading…" : "Submit for review"}</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Compliance register</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {workspace.documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents submitted.</p> : workspace.documents.map((document) => (
              <div className="flex min-h-14 items-center gap-3 rounded-md border border-border p-3" key={document.id}>
                <FileCheck2 className="size-5 text-primary" />
                <div className="min-w-0 flex-1"><div className="font-medium">{document.document_type.replaceAll("_", " ")}</div><div className="text-xs text-muted-foreground">{document.owner_type}{document.expires_at ? ` · expires ${document.expires_at}` : ""}</div></div>
                <Badge variant={document.status === "verified" ? "success" : document.status === "rejected" || document.status === "expired" ? "danger" : "warn"}>{document.status.replaceAll("_", " ")}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
