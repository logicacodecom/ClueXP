"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, DataTable, EmptyState, PageHeader } from "@cluexp/console-ui";
import { UserRound } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../../frame";

interface TechnicianDetail {
  id: string; display_name: string; email?: string | null; phone?: string | null;
  status: string; vetting_status: string; skills: string[]; provider_type: string;
  profile_photo_status: string; created_at?: string | null;
  affiliations: { id: string; organization_name?: string | null; status: string; affiliation_type: string }[];
  documents: { id: string; document_type: string; status: string; expiration_date?: string | null }[];
}

function statusVariant(status: string) {
  if (status === "active" || status === "approved" || status === "verified") return "success" as const;
  if (status === "pending_vetting" || status === "pending_review") return "warn" as const;
  if (status === "suspended" || status === "rejected") return "danger" as const;
  return "neutral" as const;
}

export default function TechnicianDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<TechnicianDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/technicians/${params.id}`, { cache: "no-store" });
    if (response.status === 404) { setNotFound(true); return; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(body.detail || "Unable to load technician"); return; }
    setDetail(body);
  }, [params.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runAction(action: "approve" | "reject" | "suspend" | "reactivate") {
    if (!detail) return;
    const verb = action === "reactivate" ? "activate" : action;
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${detail.display_name}? This changes the technician's production dispatch access.`)) return;
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/technicians/${params.id}/${action}`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${action}`);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${action}`);
    } finally {
      setBusy(null);
    }
  }

  async function openDocument(documentId: string) {
    setMessage(null);
    const response = await fetch(`/api/technician-documents/${encodeURIComponent(documentId)}/download`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.detail || "Unable to open document");
      return;
    }
    window.open(body.download_url, "_blank", "noopener,noreferrer");
  }

  if (notFound) {
    return (
      <AppFrame>
        <EmptyState icon={UserRound} title="Technician not found" description="This technician doesn't exist or was removed." />
      </AppFrame>
    );
  }
  if (!detail) return <AppFrame><div className="text-sm text-muted-foreground">Loading…</div></AppFrame>;

  return (
    <AppFrame>
      <PageHeader
        kicker="Network"
        title={detail.display_name}
        description={`${detail.provider_type} · ${detail.skills.join(", ") || "no skills listed"}`}
        actions={<Badge variant={statusVariant(detail.status)}>{detail.status.replaceAll("_", " ")}</Badge>}
      />
      {message ? <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Email:</span> {detail.email || "—"}</div>
            <div><span className="text-muted-foreground">Phone:</span> {detail.phone || "—"}</div>
            <div><span className="text-muted-foreground">Vetting:</span> {detail.vetting_status}</div>
            <div><span className="text-muted-foreground">Photo:</span> {detail.profile_photo_status}</div>
            <div><span className="text-muted-foreground">Created:</span> {detail.created_at ? new Date(detail.created_at).toLocaleDateString() : "—"}</div>
            <div className="flex flex-wrap gap-2 pt-2">
              {detail.status === "pending_vetting" ? (
                <>
                <Button disabled={busy !== null} onClick={() => void runAction("approve")}>Approve</Button>
                <Button disabled={busy !== null} variant="outline" onClick={() => void runAction("reject")}>Reject</Button>
                </>
              ) : null}
              {detail.status === "active" ? <Button disabled={busy !== null} variant="destructive" onClick={() => void runAction("suspend")}>Suspend</Button> : null}
              {detail.status === "suspended" || detail.status === "rejected" ? <Button disabled={busy !== null} onClick={() => void runAction("reactivate")}>Activate</Button> : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Compliance documents</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {detail.documents.length === 0 ? <p className="text-muted-foreground">No documents on file. Request license, insurance, and background-check documents before dispatch approval.</p> : detail.documents.map((doc) => (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3" key={doc.id}>
                <div className="min-w-0">
                  <div className="font-medium">{doc.document_type.replaceAll("_", " ")}</div>
                  <div className="text-xs text-muted-foreground">{doc.expiration_date ? `Expires ${new Date(doc.expiration_date).toLocaleDateString()}` : "No expiry date"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(doc.status)}>{doc.status.replaceAll("_", " ")}</Badge>
                  <Button size="sm" variant="outline" onClick={() => void openDocument(doc.id)}>Open</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Company affiliations</h2>
        <DataTable
          columns={["Company", "Status", "Type"]}
          rows={detail.affiliations.map((a) => [a.organization_name || "—", a.status.replaceAll("_", " "), a.affiliation_type.replaceAll("_", " ")])}
        />
      </div>
    </AppFrame>
  );
}
