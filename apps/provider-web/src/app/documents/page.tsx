"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader } from "@cluexp/console-ui";
import { AlertTriangle, CheckCircle2, Clock3, FileCheck2, FileX2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCompanyCompliance, COMPANY_DOCUMENT_TYPES, complianceCounts, complianceLabel, documentComplianceState, type ComplianceState, type ProviderDocument } from "../compliance";
import { AppFrame } from "../frame";

interface Workspace { organization: { id: string }; documents: ProviderDocument[]; }

const STATE_ICON = { ready: CheckCircle2, expiring: AlertTriangle, pending: Clock3, missing: FileX2, rejected: FileX2, expired: FileX2 } satisfies Record<ComplianceState, typeof CheckCircle2>;

function badgeVariant(state: ComplianceState): "success" | "warn" | "danger" | "outline" {
  if (state === "ready") return "success";
  if (state === "missing") return "outline";
  if (state === "rejected" || state === "expired") return "danger";
  return "warn";
}

export default function DocumentsPage() {
  const [workspace, setWorkspace] = useState<Workspace>({ organization: { id: "" }, documents: [] });
  const [form, setForm] = useState({ owner_type: "organization", owner_id: "", document_type: "business_license", document_number: "", expires_at: "" });
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | ComplianceState>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const uploadRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || "Unable to load documents");
    setWorkspace({ organization: body.organization, documents: body.documents ?? [] });
  }, []);
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [refresh]);

  const companyDocuments = useMemo(() => workspace.documents.filter((document) => document.owner_type === "organization"), [workspace.documents]);
  const checklist = useMemo(() => buildCompanyCompliance(companyDocuments), [companyDocuments]);
  const counts = complianceCounts(checklist);
  const currentCount = counts.ready + counts.expiring;
  const filteredDocuments = companyDocuments.filter((document) => (typeFilter === "all" || document.document_type === typeFilter) && (statusFilter === "all" || documentComplianceState(document) === statusFilter));

  function chooseDocument(type: string) {
    setForm((current) => ({ ...current, document_type: type }));
    uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const intentResponse = await fetch("/api/documents/upload-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: file.name, content_type: file.type, size: file.size }) });
      const intent = await intentResponse.json().catch(() => ({}));
      if (!intentResponse.ok) throw new Error(intent.detail || "Unable to prepare upload");
      const upload = await fetch(intent.upload_url, { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!upload.ok) throw new Error("Document upload failed");
      const response = await fetch("/api/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, owner_id: workspace.organization.id, document_number: form.document_number || null, expires_at: form.expires_at || null, storage_bucket: intent.bucket, storage_path: intent.path }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to record document");
      setFile(null);
      setForm((current) => ({ ...current, document_number: "", expires_at: "" }));
      setMessage("Document submitted for review. Your checklist has been updated.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to upload document");
    } finally { setBusy(false); }
  }

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader kicker="Compliance" title="Company documents" description="See what ClueXP needs for company approval, replace rejected or expired records, and renew credentials before they lapse." />
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
        <Card>
          <CardHeader>
            <div><CardTitle>Approval readiness</CardTitle><CardDescription>{currentCount} of {checklist.length} standard credentials are current.</CardDescription></div>
            <Badge variant={counts.blocking > 0 ? "danger" : counts.pending + counts.expiring > 0 ? "warn" : "success"}>{counts.blocking > 0 ? `${counts.blocking} action needed` : counts.pending > 0 ? `${counts.pending} pending review` : counts.expiring > 0 ? `${counts.expiring} expiring soon` : "Ready"}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={`${currentCount} of ${checklist.length} credentials current`} role="progressbar" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={currentCount}><div className="h-full bg-primary transition-transform" style={{ transform: `scaleX(${checklist.length ? currentCount / checklist.length : 0})`, transformOrigin: "left" }} /></div>
            <div className="divide-y divide-border">
              {checklist.map((item) => {
                const Icon = STATE_ICON[item.state];
                const action = item.state === "expiring" ? "Renew" : item.state === "ready" ? "Replace" : "Upload";
                return <div className="flex flex-col gap-3 py-4 first:pt-2 last:pb-0 sm:flex-row sm:items-center" key={item.type}><Icon className={`size-5 shrink-0 ${item.state === "ready" ? "text-emerald-500" : item.state === "missing" ? "text-muted-foreground" : "text-amber-500"}`} /><div className="min-w-0 flex-1"><div className="font-medium">{item.label}</div><div className="mt-0.5 text-sm text-muted-foreground">{item.detail}</div></div><div className="flex items-center gap-2"><Badge variant={badgeVariant(item.state)}>{complianceLabel(item.state)}</Badge>{item.state !== "pending" ? <Button size="sm" variant="outline" onClick={() => chooseDocument(item.type)}>{action}</Button> : null}</div></div>;
              })}
            </div>
          </CardContent>
        </Card>
        <div ref={uploadRef} className="scroll-mt-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="size-5 text-primary" />Submit company document</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="min-h-11 rounded-md border border-border bg-secondary px-3 py-2 text-sm md:col-span-2">Company credential — submitted to ClueXP Ops for verification</div>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">Document type<select className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={form.document_type} onChange={(event) => setForm({ ...form, document_type: event.target.value })}>{COMPANY_DOCUMENT_TYPES.map((definition) => <option key={definition.type} value={definition.type}>{definition.label}{definition.required ? "" : " (if applicable)"}</option>)}</select></label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">Document number<Input className="mt-1" placeholder="Optional" value={form.document_number} onChange={(event) => setForm({ ...form, document_number: event.target.value })} /></label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">Expiration date<Input className="mt-1" type="date" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} /></label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">Document file<Input className="mt-1" accept=".pdf,image/png,image/jpeg,image/webp" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
            <Button className="md:col-span-2 md:w-fit" disabled={busy || !file} onClick={() => void submit()}><Upload className="size-4" />{busy ? "Uploading…" : "Submit for review"}</Button>
          </CardContent>
        </Card>
        </div>
        <Card>
          <CardHeader><div><CardTitle>Company compliance register</CardTitle><CardDescription>Every company submission, including replacements and optional credentials.</CardDescription></div><div className="flex flex-wrap gap-2"><select aria-label="Filter by document type" className="min-h-10 rounded-md border border-input bg-background px-3 text-sm" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All document types</option>{COMPANY_DOCUMENT_TYPES.map((definition) => <option key={definition.type} value={definition.type}>{definition.label}</option>)}</select><select aria-label="Filter by status" className="min-h-10 rounded-md border border-input bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | ComplianceState)}><option value="all">All statuses</option><option value="ready">Current</option><option value="pending">Pending review</option><option value="expiring">Expiring soon</option><option value="rejected">Rejected</option><option value="expired">Expired</option></select></div></CardHeader>
          <CardContent className="space-y-2">
            {companyDocuments.length === 0 ? <div className="py-8 text-center"><FileCheck2 className="mx-auto size-8 text-muted-foreground" /><div className="mt-3 font-medium">No company documents submitted</div><p className="mt-1 text-sm text-muted-foreground">Start with the missing items in the approval checklist above.</p></div> : filteredDocuments.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No documents match these filters. <button className="font-semibold text-primary" onClick={() => { setTypeFilter("all"); setStatusFilter("all"); }}>Clear filters</button></div> : filteredDocuments.map((document) => { const state = documentComplianceState(document); return <div className="flex min-h-14 items-center gap-3 rounded-md border border-border p-3" key={document.id}><FileCheck2 className="size-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><div className="font-medium capitalize">{document.document_type.replaceAll("_", " ")}</div><div className="text-xs text-muted-foreground">Submitted{document.submitted_at ? ` ${new Date(document.submitted_at).toLocaleDateString()}` : ""}{document.expires_at ? ` · expires ${new Date(document.expires_at).toLocaleDateString()}` : ""}</div></div><Badge variant={badgeVariant(state)}>{complianceLabel(state)}</Badge></div>; })}
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
