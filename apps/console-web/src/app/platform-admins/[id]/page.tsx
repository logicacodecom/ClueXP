"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, PageHeader, EmptyState } from "@cluexp/console-ui";
import { ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../../frame";
import { GovernanceActionDialog } from "../../governance-action-dialog";
import { PasswordResetCard } from "../../password-reset-card";

interface AdminDetail {
  id: string; display_name: string; email?: string | null; phone?: string | null;
  status: string; created_at?: string | null; roles: string[];
}

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "suspended" || status === "archived") return "danger" as const;
  return "neutral" as const;
}

export default function PlatformAdminDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AdminDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [profileInputs, setProfileInputs] = useState({ display_name: "", email: "", phone: "" });

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/users/${params.id}`, { cache: "no-store" });
    if (response.status === 404) { setNotFound(true); return; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(body.detail || "Unable to load admin"); return; }
    setDetail(body);
    setProfileInputs({ display_name: body.display_name || "", email: body.email || "", phone: body.phone || "" });
  }, [params.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function saveProfile() {
    setBusy("profile");
    setMessage(null);
    try {
      const response = await fetch(`/api/users/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: profileInputs.display_name.trim(),
          email: profileInputs.email.trim() || null,
          phone: profileInputs.phone.trim() || null
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save admin");
      await refresh();
      setMessage("Admin saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save admin");
    } finally {
      setBusy(null);
    }
  }

  async function runAction(action: "suspend" | "reactivate", reason = "") {
    if (!detail) return;
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/users/${params.id}/${action}`, {
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

  async function deleteOrArchive(reason: string) {
    if (!detail) return;
    setBusy("delete");
    setMessage(null);
    try {
      const response = await fetch(`/api/users/${params.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to delete or archive admin");
      await refresh();
      setMessage(body.action === "deleted" ? "Admin deleted." : "Admin archived because linked records exist.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to delete or archive admin");
    } finally {
      setBusy(null);
    }
  }

  if (notFound) {
    return (
      <AppFrame>
        <EmptyState icon={ShieldCheck} title="Admin not found" description="This platform admin doesn't exist or was removed." />
      </AppFrame>
    );
  }
  if (!detail) return <AppFrame><div className="text-sm text-muted-foreground">Loading…</div></AppFrame>;

  return (
    <AppFrame>
      <PageHeader
        kicker="Platform"
        title={detail.display_name}
        description="Platform admin"
        actions={<Badge variant={statusVariant(detail.status)}>{detail.status}</Badge>}
      />
      {message ? <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <label className="block space-y-1.5 font-medium">
              Name
              <Input value={profileInputs.display_name} onChange={(event) => setProfileInputs((prev) => ({ ...prev, display_name: event.target.value }))} />
            </label>
            <label className="block space-y-1.5 font-medium">
              Email
              <Input type="email" value={profileInputs.email} onChange={(event) => setProfileInputs((prev) => ({ ...prev, email: event.target.value }))} />
            </label>
            <label className="block space-y-1.5 font-medium">
              Phone
              <Input value={profileInputs.phone} onChange={(event) => setProfileInputs((prev) => ({ ...prev, phone: event.target.value }))} />
            </label>
            <div><span className="text-muted-foreground">Created:</span> {detail.created_at ? new Date(detail.created_at).toLocaleDateString() : "—"}</div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button disabled={busy !== null || !profileInputs.display_name.trim()} onClick={() => void saveProfile()}>Save</Button>
              {detail.status === "active" ? (
                <GovernanceActionDialog confirmLabel="Suspend admin" description={`Suspend ${detail.display_name}. They will no longer be able to sign in. Blocked if they are the only active platform admin, or if this is your own account.`} disabled={busy !== null} onConfirm={(reason) => runAction("suspend", reason)} reasonRequired title={`Suspend ${detail.display_name}?`} variant="destructive">
                  <Button disabled={busy !== null} variant="destructive">Suspend</Button>
                </GovernanceActionDialog>
              ) : null}
              {detail.status === "suspended" || detail.status === "archived" ? (
                <GovernanceActionDialog confirmLabel="Activate admin" description={`Reactivate ${detail.display_name} so they can sign in again.`} disabled={busy !== null} onConfirm={(reason) => runAction("reactivate", reason)} title={`Activate ${detail.display_name}?`}>
                  <Button disabled={busy !== null}>Activate</Button>
                </GovernanceActionDialog>
              ) : null}
              <GovernanceActionDialog confirmLabel="Delete or archive" description={`If ${detail.display_name} has no linked records, they will be deleted. If linked records exist, they will be archived instead. Blocked if they are the only active platform admin, or if this is your own account.`} disabled={busy !== null} onConfirm={deleteOrArchive} reasonRequired title={`Delete or archive ${detail.display_name}?`} variant="destructive">
                <Button disabled={busy !== null} variant="outline">Delete</Button>
              </GovernanceActionDialog>
            </div>
          </CardContent>
        </Card>
        <PasswordResetCard
          displayName={detail.display_name}
          helperText="Reset this platform admin's account with a temporary password or a 24-hour reset link."
          userId={detail.id}
        />
      </div>
    </AppFrame>
  );
}
