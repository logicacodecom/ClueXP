"use client";

import {
  Badge, Button, DataTable, EmptyState, Input, PageHeader,
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, StatCard
} from "@cluexp/console-ui";
import { useSession } from "@cluexp/app-core";
import { Edit, Eye, PauseCircle, RotateCcw, Trash2, UserPlus, Users as UsersIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";
import { GovernanceActionDialog } from "../governance-action-dialog";

interface OrgUser {
  id: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  status: string;
  created_at?: string | null;
}

const STATUSES = ["all", "active", "suspended", "archived"] as const;

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "suspended" || status === "archived") return "danger" as const;
  return "neutral" as const;
}

export default function UsersPage() {
  const { session } = useSession();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [form, setForm] = useState({ display_name: "", email: "", password: "", role: "dispatcher" });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [usersResponse, limitsResponse] = await Promise.all([
      fetch("/api/users", { cache: "no-store" }),
      fetch("/api/users/limits", { cache: "no-store" })
    ]);
    const usersBody = await usersResponse.json().catch(() => ({}));
    const limitsBody = await limitsResponse.json().catch(() => ({}));
    if (usersResponse.ok) setUsers(usersBody.users ?? []);
    if (limitsResponse.ok) setLimit(limitsBody.max_users ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const canManageUsers = session?.user.roles.includes("provider_admin") ?? false;
  const canSubmit = form.display_name.trim() && form.email.trim() && form.password.length >= 8;

  async function addUser() {
    setAddBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: form.display_name.trim(), email: form.email.trim(),
          password: form.password, role: form.role
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to add user");
      setForm({ display_name: "", email: "", password: "", role: "dispatcher" });
      setMessage("User added.");
      setAddOpen(false);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to add user");
    } finally {
      setAddBusy(false);
    }
  }

  async function runAction(row: OrgUser, action: "suspend" | "reactivate", reason = "") {
    setBusy(`${row.id}:${action}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(row.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${action} user`);
      await refresh();
      setMessage(`${row.display_name} ${action === "reactivate" ? "activated" : "suspended"}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${action} user`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrArchive(row: OrgUser, reason: string) {
    setBusy(`${row.id}:delete`);
    setMessage(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to delete or archive user");
      await refresh();
      setMessage(body.action === "deleted" ? `${row.display_name} deleted.` : `${row.display_name} archived because linked records exist.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to delete or archive user");
    } finally {
      setBusy(null);
    }
  }

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((row) => {
      const statusMatch = status === "all" || row.status === status;
      const queryMatch = !normalized || [row.display_name, row.email, row.phone, row.role, row.status]
        .some((value) => String(value || "").toLowerCase().includes(normalized));
      return statusMatch && queryMatch;
    });
  }, [query, users, status]);

  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended" || u.status === "archived").length;

  return (
    <AppFrame>
      <PageHeader
        kicker="Team"
        title="Users"
        description="Dispatchers and admins on your account."
        actions={
          <div className="flex items-center gap-2">
            {limit !== null ? <Badge variant={users.length >= limit ? "danger" : "outline"}>{users.length} of {limit} users</Badge> : null}
            {canManageUsers ? (
              <Sheet onOpenChange={setAddOpen} open={addOpen}>
                <SheetTrigger asChild>
                  <Button size="sm"><UserPlus className="size-4" />Add user</Button>
                </SheetTrigger>
                <SheetContent className="max-w-lg">
                  <SheetHeader>
                    <SheetTitle>Add user</SheetTitle>
                    <SheetDescription>They can sign in to provider-web immediately.</SheetDescription>
                  </SheetHeader>
                  <div className="space-y-3 p-6">
                    <Input onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))} placeholder="Name" value={form.display_name} />
                    <Input onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email" type="email" value={form.email} />
                    <Input onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder="Temporary password" type="password" value={form.password} />
                    <select className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} value={form.role}>
                      <option value="dispatcher">Dispatcher</option>
                      <option value="provider_admin">Admin</option>
                    </select>
                    <Button className="w-full" disabled={!canSubmit || addBusy} onClick={() => void addUser()}>{addBusy ? "Adding…" : "Add user"}</Button>
                  </div>
                </SheetContent>
              </Sheet>
            ) : null}
          </div>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard icon={UsersIcon} label="Total" value={String(users.length)} />
        <StatCard icon={UsersIcon} label="Active" value={String(active)} />
        <StatCard icon={UsersIcon} intent={suspended ? "danger" : "neutral"} label="Suspended or archived" value={String(suspended)} />
      </div>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,420px)_1fr]">
        <Input aria-label="Search users" onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, phone, or role" value={query} />
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((option) => (
            <button
              className={`min-h-10 rounded-md border px-3 py-1.5 text-xs font-medium capitalize ${status === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              key={option}
              onClick={() => setStatus(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {message ? <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
      {!loading && visibleRows.length === 0 ? (
        <EmptyState description="Adjust the status filter or search term." icon={UsersIcon} title="No users match" />
      ) : (
        <DataTable
          columns={["User", "Role", "Status", "Created", "Actions"]}
          rows={visibleRows.map((row) => [
            <Link className="font-medium text-foreground hover:text-primary" href={`/users/${row.id}`} key={`${row.id}-name`}>{row.display_name}</Link>,
            row.role.replaceAll("_", " "),
            <Badge key={`${row.id}-status`} variant={statusVariant(row.status)}>{row.status}</Badge>,
            row.created_at ? new Date(row.created_at).toLocaleDateString() : "—",
            <div className="flex items-center gap-2" key={`${row.id}-actions`}>
              <Button
                aria-label={canManageUsers ? `Edit ${row.display_name}` : `View ${row.display_name}`}
                asChild
                className="size-11"
                size="icon"
                title={canManageUsers ? "Edit" : "View"}
                variant="outline"
              >
                <Link href={`/users/${row.id}`}>{canManageUsers ? <Edit className="size-4" /> : <Eye className="size-4" />}</Link>
              </Button>
              {canManageUsers ? (
                <>
                  {row.status === "active" ? (
                    <GovernanceActionDialog confirmLabel="Suspend user" description={`Suspend ${row.display_name}. They will no longer be able to sign in.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "suspend", reason)} reasonRequired title={`Suspend ${row.display_name}?`} variant="destructive">
                      <Button aria-label={`Suspend ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Suspend" variant="destructive"><PauseCircle className="size-4" /></Button>
                    </GovernanceActionDialog>
                  ) : null}
                  {row.status === "suspended" || row.status === "archived" ? (
                    <GovernanceActionDialog confirmLabel="Activate user" description={`Reactivate ${row.display_name} so they can sign in again.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "reactivate", reason)} title={`Activate ${row.display_name}?`}>
                      <Button aria-label={`Activate ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Activate" variant="success"><RotateCcw className="size-4" /></Button>
                    </GovernanceActionDialog>
                  ) : null}
                  <GovernanceActionDialog confirmLabel="Delete or archive" description={`If ${row.display_name} has no linked records, they will be deleted. If linked records exist, they will be archived instead.`} disabled={busy !== null} onConfirm={(reason) => deleteOrArchive(row, reason)} reasonRequired title={`Delete or archive ${row.display_name}?`} variant="destructive">
                    <Button aria-label={`Delete ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Delete" variant="ghost"><Trash2 className="size-4" /></Button>
                  </GovernanceActionDialog>
                </>
              ) : null}
            </div>
          ])}
        />
      )}
    </AppFrame>
  );
}
