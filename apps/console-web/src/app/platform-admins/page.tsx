"use client";

import { Badge, Button, DataTable, EmptyState, Input, PageHeader, StatCard } from "@cluexp/console-ui";
import { Edit, PauseCircle, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";
import { GovernanceActionDialog } from "../governance-action-dialog";

interface PlatformAdminRow {
  id: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  created_at?: string | null;
}

const STATUSES = ["all", "active", "suspended", "archived"] as const;

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "suspended" || status === "archived") return "danger" as const;
  return "neutral" as const;
}

export default function PlatformAdminsPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PlatformAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/users?scope=platform", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load platform admins");
      setRows(body.users ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load platform admins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runAction(row: PlatformAdminRow, action: "suspend" | "reactivate", reason = "") {
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
      if (!response.ok) throw new Error(body.detail || `Unable to ${verb} admin`);
      await refresh();
      setMessage(`${row.display_name} ${action === "reactivate" ? "activated" : "suspended"}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${verb} admin`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrArchive(row: PlatformAdminRow, reason: string) {
    setBusy(`${row.id}:delete`);
    setMessage(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to delete or archive admin");
      await refresh();
      setMessage(body.action === "deleted" ? `${row.display_name} deleted.` : `${row.display_name} archived because linked records exist.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to delete or archive admin");
    } finally {
      setBusy(null);
    }
  }

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      const statusMatch = status === "all" || row.status === status;
      const queryMatch = !normalized || [row.display_name, row.email, row.phone, row.status, row.id]
        .some((value) => String(value || "").toLowerCase().includes(normalized));
      return statusMatch && queryMatch;
    });
  }, [query, rows, status]);

  const active = rows.filter((r) => r.status === "active").length;

  return (
    <AppFrame>
      <PageHeader
        kicker="Platform"
        title="Platform Admins"
        description="Accounts with full platform-admin access to this console. There is no self-signup for this role."
        actions={<Button asChild><Link href="/platform-admins/new"><Plus className="size-4" />Add platform admin</Link></Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard icon={ShieldCheck} label="Total" value={String(rows.length)} />
        <StatCard icon={ShieldCheck} label="Active" value={String(active)} />
        <StatCard icon={ShieldCheck} intent={active <= 1 ? "warn" : "neutral"} label="Fewer than 2 active" value={active <= 1 ? "Yes" : "No"} />
      </div>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,420px)_1fr]">
        <Input aria-label="Search platform admins" placeholder="Search name, email, phone, or ID" value={query} onChange={(event) => setQuery(event.target.value)} />
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
        <EmptyState icon={ShieldCheck} title="No platform admins match" description="Adjust the status filter or search term." />
      ) : (
        <DataTable
          columns={["Admin", "Contact", "Status", "Created", "Actions"]}
          rows={visibleRows.map((row) => [
            <Link className="font-medium text-foreground hover:text-primary" href={`/platform-admins/${row.id}`} key={`${row.id}-name`}>{row.display_name}</Link>,
            row.email || row.phone || "—",
            <Badge key={`${row.id}-status`} variant={statusVariant(row.status)}>{row.status}</Badge>,
            row.created_at ? new Date(row.created_at).toLocaleDateString() : "-",
            <div className="flex items-center gap-2" key={`${row.id}-actions`}>
              <Button aria-label={`Edit ${row.display_name}`} asChild className="size-11" size="icon" title="Edit" variant="outline">
                <Link href={`/platform-admins/${row.id}`}><Edit className="size-4" /></Link>
              </Button>
              {row.status === "active" ? (
                <GovernanceActionDialog confirmLabel="Suspend admin" description={`Suspend ${row.display_name}. They will no longer be able to sign in. Blocked if they are the only active platform admin.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "suspend", reason)} reasonRequired title={`Suspend ${row.display_name}?`} variant="destructive">
                  <Button aria-label={`Suspend ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Suspend" variant="destructive"><PauseCircle className="size-4" /></Button>
                </GovernanceActionDialog>
              ) : null}
              {row.status === "suspended" || row.status === "archived" ? (
                <GovernanceActionDialog confirmLabel="Activate admin" description={`Reactivate ${row.display_name} so they can sign in again.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "reactivate", reason)} title={`Activate ${row.display_name}?`}>
                  <Button aria-label={`Activate ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Activate" variant="success"><RotateCcw className="size-4" /></Button>
                </GovernanceActionDialog>
              ) : null}
              <GovernanceActionDialog confirmLabel="Delete or archive" description={`If ${row.display_name} has no linked records, they will be deleted. If linked records exist, they will be archived instead. Blocked if they are the only active platform admin.`} disabled={busy !== null} onConfirm={(reason) => deleteOrArchive(row, reason)} reasonRequired title={`Delete or archive ${row.display_name}?`} variant="destructive">
                <Button aria-label={`Delete ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Delete" variant="outline"><Trash2 className="size-4" /></Button>
              </GovernanceActionDialog>
            </div>
          ])}
        />
      )}
    </AppFrame>
  );
}
