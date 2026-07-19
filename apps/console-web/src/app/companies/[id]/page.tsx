"use client";

import { serviceSkillLabel } from "@cluexp/api-client";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, EmptyState, Input, PageHeader } from "@cluexp/console-ui";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../../frame";
import { GovernanceActionDialog } from "../../governance-action-dialog";

interface LimitField { value: number; is_override: boolean; platform_default: number }
interface OrganizationDetail {
  id: string; display_name: string; legal_name?: string | null; organization_type: string;
  status: string; subscription_status: string; phone?: string | null; email?: string | null;
  fulfillment_policy?: string | null;
  created_at?: string | null;
  members: { id: string; display_name: string; email?: string | null; phone?: string | null; role: string; status: string }[];
  technicians: { id: string; display_name: string; technician_status: string; affiliation_status: string; affiliation_type: string }[];
  documents: { id: string; document_type: string; status: string; expires_at?: string | null }[];
  limits: { max_users: LimitField; max_technicians: LimitField };
  capabilities: string[];
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
  const [profileInputs, setProfileInputs] = useState({ display_name: "", legal_name: "", phone: "", email: "", fulfillment_policy: "owner_first_then_network" });

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/organizations/${params.id}`, { cache: "no-store" });
    if (response.status === 404) { setNotFound(true); return; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(body.detail || "Unable to load company"); return; }
    setDetail(body);
    setLimitInputs({ max_users: String(body.limits.max_users.value), max_technicians: String(body.limits.max_technicians.value) });
    setProfileInputs({
      display_name: body.display_name || "",
      legal_name: body.legal_name || "",
      phone: body.phone || "",
      email: body.email || "",
      fulfillment_policy: body.fulfillment_policy || "owner_first_then_network"
    });
  }, [params.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runAction(action: "approve" | "reject" | "suspend" | "reactivate", reason = "") {
    if (!detail) return;
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/organizations/${params.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${action}`);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${action}`);
    } finally {
      setBusy(null);
    }
  }

  async function saveProfile() {
    setBusy("profile");
    setMessage(null);
    try {
      const response = await fetch(`/api/organizations/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: profileInputs.display_name.trim(),
          legal_name: profileInputs.legal_name.trim() || null,
          phone: profileInputs.phone.trim() || null,
          email: profileInputs.email.trim() || null,
          fulfillment_policy: profileInputs.fulfillment_policy
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save company profile");
      await refresh();
      setMessage("Company profile saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save company profile");
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrArchive(reason: string) {
    if (!detail) return;
    setBusy("delete");
    setMessage(null);
    try {
      const response = await fetch(`/api/organizations/${params.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to delete or archive company");
      await refresh();
      setMessage(body.action === "deleted" ? "Company deleted." : "Company archived because linked records exist.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to delete or archive company");
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
          <CardContent className="space-y-4 text-sm">
            <label className="block space-y-1.5 font-medium">
              Company name
              <Input value={profileInputs.display_name} onChange={(event) => setProfileInputs((prev) => ({ ...prev, display_name: event.target.value }))} />
            </label>
            <label className="block space-y-1.5 font-medium">
              Legal name
              <Input value={profileInputs.legal_name} onChange={(event) => setProfileInputs((prev) => ({ ...prev, legal_name: event.target.value }))} />
            </label>
            <label className="block space-y-1.5 font-medium">
              Email
              <Input type="email" value={profileInputs.email} onChange={(event) => setProfileInputs((prev) => ({ ...prev, email: event.target.value }))} />
            </label>
            <label className="block space-y-1.5 font-medium">
              Phone
              <Input value={profileInputs.phone} onChange={(event) => setProfileInputs((prev) => ({ ...prev, phone: event.target.value }))} />
            </label>
            <label className="block space-y-1.5 font-medium">
              Dispatch policy
              <select
                className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-normal"
                value={profileInputs.fulfillment_policy}
                onChange={(event) => setProfileInputs((prev) => ({ ...prev, fulfillment_policy: event.target.value }))}
              >
                <option value="private_owner_only">Only this company&apos;s own technicians</option>
                <option value="owner_first_then_network">Company technicians first, then the ClueXP network</option>
                <option value="network_open">Open to the full verified ClueXP network</option>
              </select>
              <span className="text-xs font-normal text-muted-foreground">Controls which technicians this company&apos;s jobs can be offered to. Set by ClueXP only.</span>
            </label>
            <div><span className="text-muted-foreground">Type:</span> {detail.organization_type}</div>
            <div><span className="text-muted-foreground">Subscription:</span> {detail.subscription_status}</div>
            <div><span className="text-muted-foreground">Created:</span> {detail.created_at ? new Date(detail.created_at).toLocaleDateString() : "—"}</div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button disabled={busy !== null || !profileInputs.display_name.trim()} onClick={() => void saveProfile()}>Save profile</Button>
              {detail.status === "pending_review" ? (
                <>
                  <GovernanceActionDialog confirmLabel="Approve company" description={`Approve ${detail.display_name} for production access.`} disabled={busy !== null} onConfirm={(reason) => runAction("approve", reason)} title={`Approve ${detail.display_name}?`}>
                    <Button disabled={busy !== null}>Approve</Button>
                  </GovernanceActionDialog>
                  <GovernanceActionDialog confirmLabel="Reject company" description={`Reject ${detail.display_name}. This blocks production access until reactivated.`} disabled={busy !== null} onConfirm={(reason) => runAction("reject", reason)} reasonRequired title={`Reject ${detail.display_name}?`} variant="destructive">
                    <Button disabled={busy !== null} variant="outline">Reject</Button>
                  </GovernanceActionDialog>
                </>
              ) : null}
              {detail.status === "active" ? (
                <GovernanceActionDialog confirmLabel="Suspend company" description={`Suspend ${detail.display_name}. Company users and technicians should no longer be treated as production-active.`} disabled={busy !== null} onConfirm={(reason) => runAction("suspend", reason)} reasonRequired title={`Suspend ${detail.display_name}?`} variant="destructive">
                  <Button disabled={busy !== null} variant="destructive">Suspend</Button>
                </GovernanceActionDialog>
              ) : null}
              {detail.status === "suspended" || detail.status === "rejected" || detail.status === "closed" ? (
                <GovernanceActionDialog confirmLabel="Activate company" description={`Reactivate ${detail.display_name} for production access.`} disabled={busy !== null} onConfirm={(reason) => runAction("reactivate", reason)} title={`Activate ${detail.display_name}?`}>
                  <Button disabled={busy !== null}>Activate</Button>
                </GovernanceActionDialog>
              ) : null}
              <GovernanceActionDialog confirmLabel="Delete or archive" description={`If ${detail.display_name} has no linked records, it will be deleted. If linked records exist, it will be archived instead.`} disabled={busy !== null} onConfirm={deleteOrArchive} reasonRequired title={`Delete or archive ${detail.display_name}?`} variant="destructive">
                <Button disabled={busy !== null} variant="outline">Delete</Button>
              </GovernanceActionDialog>
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
        <Card>
          <CardHeader>
            <CardTitle>Service capabilities</CardTitle>
            <CardDescription>Company-selected active services. Providers edit this in their own Settings; Console owns the global catalog.</CardDescription>
          </CardHeader>
          <CardContent>
            {(detail.capabilities ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No company service capabilities selected.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(detail.capabilities ?? []).map((skill) => (
                  <Badge key={skill} variant="outline">{serviceSkillLabel(skill)}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <div>
          <h2 className="mb-3 text-lg font-semibold">Members</h2>
          <DataTable
            columns={["Name", "Email", "Role", "Status", ""]}
            rows={detail.members.map((m) => [
              m.display_name, m.email || m.phone || "—", m.role.replaceAll("_", " "), m.status,
              <Link className="text-sm font-medium text-primary hover:underline" href={`/users/${m.id}`} key={`${m.id}-view`}>Manage</Link>
            ])}
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
