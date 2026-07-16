"use client";

import { Badge, Button, DataTable, EmptyState, Input, PageHeader, StatCard } from "@cluexp/console-ui";
import { Edit, Eye, PauseCircle, RotateCcw, Trash2, Users as UsersIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";
import { GovernanceActionDialog } from "../governance-action-dialog";

interface UserRow {
  id: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  role: string;
  organization_name?: string | null;
  created_at?: string | null;
}

const STATUSES = ["all", "active", "suspended", "archived"] as const;

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "suspended" || status === "archived") return "danger" as const;
  return "neutral" as const;
}

export default function UsersPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/users?scope=company", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load users");
      setRows(body.users ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runAction(row: UserRow, action: "suspend" | "reactivate", reason = "") {
    const verb = action === "reactivate" ? "activate" : action;
    setBusy(`${row.id}:${action}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(row.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${verb} user`);
      await refresh();
      setMessage(`${row.display_name} ${action === "reactivate" ? "activated" : "suspended"}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${verb} user`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrArchive(row: UserRow, reason: string) {
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
    return rows.filter((row) => {
      const statusMatch = status === "all" || row.status === status;
      const queryMatch = !normalized || [
        row.display_name, row.email, row.phone, row.organization_name, row.role, row.status, row.id
      ].some((value) => String(value || "").toLowerCase().includes(normalized));
      return statusMatch && queryMatch;
    });
  }, [query, rows, status]);

  const active = rows.filter((r) => r.status === "active").length;
  const suspended = rows.filter((r) => r.status === "suspended" || r.status === "archived").length;

  return (
    <AppFrame>
      <PageHeader
        kicker="Network"
        title="Users"
        description="Dispatchers and admins across every company. Adding a new user happens from the company's own provider console — edit, suspend, or remove one here."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard icon={UsersIcon} label="Total" value={String(rows.length)} />
        <StatCard icon={UsersIcon} label="Active" value={String(active)} />
        <StatCard icon={UsersIcon} intent={suspended ? "danger" : "neutral"} label="Suspended or archived" value={String(suspended)} />
      </div>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,420px)_1fr]">
        <Input aria-label="Search users" placeholder="Search name, email, phone, company, or role" value={query} onChange={(event) => setQuery(event.target.value)} />
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
        <EmptyState icon={UsersIcon} title="No users match" description="Adjust the status filter or search term." />
      ) : (
        <DataTable
          columns={["User", "Company", "Role", "Status", "Created", "Actions"]}
          rows={visibleRows.map((row) => [
            <Link className="font-medium text-foreground hover:text-primary" href={`/users/${row.id}`} key={`${row.id}-name`}>{row.display_name}</Link>,
            row.organization_name || "—",
            row.role.replaceAll("_", " "),
            <Badge key={`${row.id}-status`} variant={statusVariant(row.status)}>{row.status}</Badge>,
            row.created_at ? new Date(row.created_at).toLocaleDateString() : "-",
            <div className="flex min-w-[220px] flex-wrap items-center gap-2" key={`${row.id}-actions`}>
              <Button asChild size="sm" variant="outline"><Link href={`/users/${row.id}`}><Eye className="size-4" />View</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href={`/users/${row.id}`}><Edit className="size-4" />Edit</Link></Button>
              {row.status === "active" ? (
                <GovernanceActionDialog confirmLabel="Suspend user" description={`Suspend ${row.display_name}. They will no longer be able to sign in.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "suspend", reason)} reasonRequired title={`Suspend ${row.display_name}?`} variant="destructive">
                  <Button disabled={busy !== null} size="sm" variant="destructive"><PauseCircle className="size-4" />Suspend</Button>
                </GovernanceActionDialog>
              ) : null}
              {row.status === "suspended" || row.status === "archived" ? (
                <GovernanceActionDialog confirmLabel="Activate user" description={`Reactivate ${row.display_name} so they can sign in again.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "reactivate", reason)} title={`Activate ${row.display_name}?`}>
                  <Button disabled={busy !== null} size="sm"><RotateCcw className="size-4" />Activate</Button>
                </GovernanceActionDialog>
              ) : null}
              <GovernanceActionDialog confirmLabel="Delete or archive" description={`If ${row.display_name} has no linked records, they will be deleted. If linked records exist, they will be archived instead.`} disabled={busy !== null} onConfirm={(reason) => deleteOrArchive(row, reason)} reasonRequired title={`Delete or archive ${row.display_name}?`} variant="destructive">
                <Button disabled={busy !== null} size="sm" variant="ghost"><Trash2 className="size-4" />Delete</Button>
              </GovernanceActionDialog>
            </div>
          ])}
        />
      )}
    </AppFrame>
  );
}
