"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, EmptyState, Input, PageHeader } from "@cluexp/console-ui";
import { Building2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../../frame";

interface LimitField { value: number; is_override: boolean; platform_default: number }
interface OrganizationDetail {
  id: string; display_name: string; legal_name?: string | null; organization_type: string;
  status: string; subscription_status: string; phone?: string | null; email?: string | null;
  created_at?: string | null;
  members: { id: string; display_name: string; email?: string | null; phone?: string | null; role: string; status: string }[];
  technicians: { id: string; display_name: string; technician_status: string; affiliation_status: string; affiliation_type: string }[];
  documents: { id: string; document_type: string; status: string; expires_at?: string | null }[];
  limits: { max_users: LimitField; max_technicians: LimitField };
}

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "pending_review") return "warn" as const;
  if (status === "suspended" || status === "rejected") return "danger" as const;
  return "neutral" as const;
}

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [limitInputs, setLimitInputs] = useState({ max_users: "", max_technicians: "" });

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/organizations/${params.id}`, { cache: "no-store" });
    if (response.status === 404) { setNotFound(true); return; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(body.detail || "Unable to load company"); return; }
    setDetail(body);
    setLimitInputs({ max_users: String(body.limits.max_users.value), max_technicians: String(body.limits.max_technicians.value) });
  }, [params.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runAction(action: "approve" | "reject" | "suspend" | "reactivate") {
    if (!detail) return;
    const verb = action === "reactivate" ? "activate" : action;
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${detail.display_name}? This changes the company's production access.`)) return;
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/organizations/${params.id}/${action}`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${action}`);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${action}`);
    } finally {
      setBusy(null);
    }
  }

  async function saveLimits() {
    setBusy("limits");
    setMessage(null);
    try {
      const response = await fetch(`/api/organizations/${params.id}/limits`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          max_users: Number(limitInputs.max_users),
          max_technicians: Number(limitInputs.max_technicians)
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save limits");
      await refresh();
      setMessage("Limits updated.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save limits");
    } finally {
      setBusy(null);
    }
  }

  async function openDocument(documentId: string) {
    setMessage(null);
    const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/download`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.detail || "Unable to open document");
      return;
    }
    window.open(body.download_url, "_blank", "noopener,noreferrer");
  }

  async function resetLimit(field: "max_users" | "max_technicians") {
    setBusy(`reset-${field}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/organizations/${params.id}/limits`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: null })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to reset limit");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to reset limit");
    } finally {
      setBusy(null);
    }
  }

  if (notFound) {
    return (
      <AppFrame>
        <EmptyState icon={Building2} title="Company not found" description="This organization doesn't exist or was removed." />
      </AppFrame>
    );
  }
  if (!detail) return <AppFrame><div className="text-sm text-muted-foreground">Loading…</div></AppFrame>;

  return (
    <AppFrame>
      <PageHeader
        kicker="Network"
        title={detail.display_name}
        description={detail.legal_name && detail.legal_name !== detail.display_name ? detail.legal_name : undefined}
        actions={<Badge variant={statusVariant(detail.status)}>{detail.status.replaceAll("_", " ")}</Badge>}
      />
      {message ? <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Type:</span> {detail.organization_type}</div>
            <div><span className="text-muted-foreground">Subscription:</span> {detail.subscription_status}</div>
            <div><span className="text-muted-foreground">Phone:</span> {detail.phone || "—"}</div>
            <div><span className="text-muted-foreground">Email:</span> {detail.email || "—"}</div>
            <div><span className="text-muted-foreground">Created:</span> {detail.created_at ? new Date(detail.created_at).toLocaleDateString() : "—"}</div>
            <div className="flex flex-wrap gap-2 pt-2">
              {detail.status === "pending_review" ? (
                <>
                  <Button disabled={busy !== null} onClick={() => void runAction("approve")}>Approve</Button>
                  <Button disabled={busy !== null} variant="outline" onClick={() => void runAction("reject")}>Reject</Button>
                </>
              ) : null}
              {detail.status === "active" ? <Button disabled={busy !== null} variant="destructive" onClick={() => void runAction("suspend")}>Suspend</Button> : null}
              {detail.status === "suspended" ? <Button disabled={busy !== null} onClick={() => void runAction("reactivate")}>Reactivate</Button> : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tenant limits</CardTitle>
            <CardDescription>Overrides the platform default for this company only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5 text-sm font-medium">
              Max users {detail.limits.max_users.is_override ? null : <span className="text-xs font-normal text-muted-foreground">(platform default)</span>}
              <div className="flex gap-2">
                <Input type="number" min={1} value={limitInputs.max_users} onChange={(e) => setLimitInputs((p) => ({ ...p, max_users: e.target.value }))} />
                {detail.limits.max_users.is_override ? <Button disabled={busy !== null} size="sm" variant="outline" onClick={() => void resetLimit("max_users")}>Reset</Button> : null}
              </div>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Max technicians {detail.limits.max_technicians.is_override ? null : <span className="text-xs font-normal text-muted-foreground">(platform default)</span>}
              <div className="flex gap-2">
                <Input type="number" min={1} value={limitInputs.max_technicians} onChange={(e) => setLimitInputs((p) => ({ ...p, max_technicians: e.target.value }))} />
                {detail.limits.max_technicians.is_override ? <Button disabled={busy !== null} size="sm" variant="outline" onClick={() => void resetLimit("max_technicians")}>Reset</Button> : null}
              </div>
            </label>
            <Button disabled={busy !== null} onClick={() => void saveLimits()}>Save limits</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {detail.documents.length === 0 ? <p className="text-muted-foreground">No documents on file. Ask the company to upload business license and insurance before activation.</p> : detail.documents.map((doc) => (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3" key={doc.id}>
                <div className="min-w-0">
                  <div className="font-medium">{doc.document_type.replaceAll("_", " ")}</div>
                  <div className="text-xs text-muted-foreground">{doc.expires_at ? `Expires ${new Date(doc.expires_at).toLocaleDateString()}` : "No expiry date"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={doc.status === "verified" ? "success" : doc.status === "rejected" ? "danger" : "warn"}>{doc.status.replaceAll("_", " ")}</Badge>
                  <Button size="sm" variant="outline" onClick={() => void openDocument(doc.id)}>Open</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="mt-6 space-y-6">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Members</h2>
          <DataTable
            columns={["Name", "Email", "Role", "Status"]}
            rows={detail.members.map((m) => [m.display_name, m.email || m.phone || "—", m.role.replaceAll("_", " "), m.status])}
          />
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">Affiliated technicians</h2>
          <DataTable
            columns={["Name", "Technician status", "Affiliation", "Type"]}
            rows={detail.technicians.map((t) => [t.display_name, t.technician_status, t.affiliation_status, t.affiliation_type.replaceAll("_", " ")])}
          />
        </div>
      </div>
    </AppFrame>
  );
}
