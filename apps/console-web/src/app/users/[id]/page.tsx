"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, PageHeader, EmptyState } from "@cluexp/console-ui";
import { KeyRound, UserRound } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../../frame";
import { GovernanceActionDialog } from "../../governance-action-dialog";

interface Membership { organization_id: string; organization_name?: string | null; role: string; status: string }
interface UserDetail {
  id: string; display_name: string; email?: string | null; phone?: string | null;
  status: string; created_at?: string | null; roles: string[]; memberships: Membership[];
}

const ROLES = ["dispatcher", "provider_admin"] as const;

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "suspended" || status === "archived") return "danger" as const;
  return "neutral" as const;
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [profileInputs, setProfileInputs] = useState({ display_name: "", email: "", phone: "" });
  const [passwordInputs, setPasswordInputs] = useState({ temporary: "" });
  const [passwordResult, setPasswordResult] = useState<string | null>(null);
  const [role, setRole] = useState<string>("dispatcher");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/users/${params.id}`, { cache: "no-store" });
    if (response.status === 404) { setNotFound(true); return; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(body.detail || "Unable to load user"); return; }
    setDetail(body);
    setProfileInputs({ display_name: body.display_name || "", email: body.email || "", phone: body.phone || "" });
    if (body.memberships?.[0]?.role) setRole(body.memberships[0].role);
  }, [params.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function saveProfile() {
    setBusy("profile");
    setMessage(null);
    try {
      const membership = detail?.memberships?.[0];
      const response = await fetch(`/api/users/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: profileInputs.display_name.trim(),
          email: profileInputs.email.trim() || null,
          phone: profileInputs.phone.trim() || null,
          role: membership ? role : undefined
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save user");
      await refresh();
      setMessage("User saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save user");
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
      if (!response.ok) throw new Error(body.detail || "Unable to delete or archive user");
      await refresh();
      setMessage(body.action === "deleted" ? "User deleted." : "User archived because linked records exist.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to delete or archive user");
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(mode: "set_temp_password" | "generate_temp_password" | "reset_link") {
    if (!detail) return;
    setBusy(mode);
    setMessage(null);
    setPasswordResult(null);
    try {
      const response = await fetch(`/api/users/${params.id}/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          password: mode === "set_temp_password" ? passwordInputs.temporary : undefined
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to reset password");
      if (body.temporary_password) setPasswordResult(`Temporary password: ${body.temporary_password}`);
      else if (body.reset_url) setPasswordResult(`Reset link: ${body.reset_url}`);
      else setPasswordResult("Temporary password set.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to reset password");
    } finally {
      setBusy(null);
    }
  }

  if (notFound) {
    return (
      <AppFrame>
        <EmptyState icon={UserRound} title="User not found" description="This user doesn't exist or was removed." />
      </AppFrame>
    );
  }
  if (!detail) return <AppFrame><div className="text-sm text-muted-foreground">Loading…</div></AppFrame>;

  const membership = detail.memberships[0];

  return (
    <AppFrame>
      <PageHeader
        kicker="Network"
        title={detail.display_name}
        description={membership ? `${membership.role.replaceAll("_", " ")} · ${membership.organization_name || "—"}` : undefined}
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
            {membership ? (
              <label className="block space-y-1.5 font-medium">
                Role
                <select className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setRole(event.target.value)} value={role}>
                  {ROLES.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}
                </select>
              </label>
            ) : null}
            <div><span className="text-muted-foreground">Created:</span> {detail.created_at ? new Date(detail.created_at).toLocaleDateString() : "—"}</div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button disabled={busy !== null || !profileInputs.display_name.trim()} onClick={() => void saveProfile()}>Save</Button>
              {detail.status === "active" ? (
                <GovernanceActionDialog confirmLabel="Suspend user" description={`Suspend ${detail.display_name}. They will no longer be able to sign in.`} disabled={busy !== null} onConfirm={(reason) => runAction("suspend", reason)} reasonRequired title={`Suspend ${detail.display_name}?`} variant="destructive">
                  <Button disabled={busy !== null} variant="destructive">Suspend</Button>
                </GovernanceActionDialog>
              ) : null}
              {detail.status === "suspended" || detail.status === "archived" ? (
                <GovernanceActionDialog confirmLabel="Activate user" description={`Reactivate ${detail.display_name} so they can sign in again.`} disabled={busy !== null} onConfirm={(reason) => runAction("reactivate", reason)} title={`Activate ${detail.display_name}?`}>
                  <Button disabled={busy !== null}>Activate</Button>
                </GovernanceActionDialog>
              ) : null}
              <GovernanceActionDialog confirmLabel="Delete or archive" description={`If ${detail.display_name} has no linked records, they will be deleted. If linked records exist, they will be archived instead.`} disabled={busy !== null} onConfirm={deleteOrArchive} reasonRequired title={`Delete or archive ${detail.display_name}?`} variant="destructive">
                <Button disabled={busy !== null} variant="outline">Delete</Button>
              </GovernanceActionDialog>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Company</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {membership ? (
              <>
                <div><span className="text-muted-foreground">Company:</span> {membership.organization_name || "—"}</div>
                <div><span className="text-muted-foreground">Role:</span> {membership.role.replaceAll("_", " ")}</div>
                <div><span className="text-muted-foreground">Membership status:</span> {membership.status}</div>
              </>
            ) : <p className="text-muted-foreground">No company affiliation on file.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Password reset</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-start gap-3 rounded-md border border-info/30 bg-info/5 p-3 text-info">
              <KeyRound className="mt-0.5 size-4 shrink-0" />
              <div>Use a temporary password for a direct handoff, or generate a reset link to send later.</div>
            </div>
            <label className="block space-y-1.5 font-medium">
              Set temporary password
              <Input type="text" value={passwordInputs.temporary} onChange={(event) => setPasswordInputs({ temporary: event.target.value })} placeholder="Minimum 8 characters" />
            </label>
            <div className="flex flex-wrap gap-2">
              <GovernanceActionDialog confirmLabel="Set password" description={`Set a temporary password for ${detail.display_name}. Share it through a secure channel.`} disabled={busy !== null || passwordInputs.temporary.length < 8} onConfirm={() => resetPassword("set_temp_password")} title={`Set password for ${detail.display_name}?`}>
                <Button disabled={busy !== null || passwordInputs.temporary.length < 8} variant="outline">Set temporary</Button>
              </GovernanceActionDialog>
              <GovernanceActionDialog confirmLabel="Generate password" description={`Generate a temporary password for ${detail.display_name}. It will be shown once here.`} disabled={busy !== null} onConfirm={() => resetPassword("generate_temp_password")} title={`Generate password for ${detail.display_name}?`}>
                <Button disabled={busy !== null} variant="outline">Generate temporary</Button>
              </GovernanceActionDialog>
              <GovernanceActionDialog confirmLabel="Generate reset link" description={`Generate a 24-hour reset link for ${detail.display_name}. You can send it later.`} disabled={busy !== null} onConfirm={() => resetPassword("reset_link")} title={`Generate reset link for ${detail.display_name}?`}>
                <Button disabled={busy !== null}>Generate reset link</Button>
              </GovernanceActionDialog>
            </div>
            {passwordResult ? <div className="break-all rounded-md border border-success/35 bg-success/10 p-3 text-sm text-success" role="status">{passwordResult}</div> : null}
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
