"use client";

import { Badge, Button, DataTable, EmptyState, Input, PageHeader, StatCard } from "@cluexp/console-ui";
import { Building2, Check, Edit, Eye, PauseCircle, Plus, RotateCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";
import { GovernanceActionDialog } from "../governance-action-dialog";

interface OrganizationRow {
  id: string;
  display_name: string;
  organization_type: string;
  status: string;
  member_count: number;
  technician_count: number;
  created_at?: string | null;
}

const STATUSES = ["all", "pending_review", "active", "suspended", "rejected", "closed"] as const;

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "pending_review") return "warn" as const;
  if (status === "suspended" || status === "rejected") return "danger" as const;
  return "neutral" as const;
}

function actionLabel(action: string) {
  return action === "reactivate" ? "reactivate" : action;
}

function pastTense(action: string) {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  if (action === "suspend") return "suspended";
  return "reactivated";
}

export default function CompaniesPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<OrganizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/organizations", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load companies");
      setRows(body.organizations ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load companies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runAction(row: OrganizationRow, action: "approve" | "reject" | "suspend" | "reactivate", reason = "") {
    const label = actionLabel(action);
    setBusy(`${row.id}:${action}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/organizations/${encodeURIComponent(row.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${label} company`);
      await refresh();
      setMessage(`${row.display_name} ${pastTense(action)}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${label} company`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrArchive(row: OrganizationRow, reason: string) {
    setBusy(`${row.id}:delete`);
    setMessage(null);
    try {
      const response = await fetch(`/api/organizations/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to delete or archive company");
      await refresh();
      setMessage(body.action === "deleted" ? `${row.display_name} deleted.` : `${row.display_name} archived because linked records exist.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to delete or archive company");
    } finally {
      setBusy(null);
    }
  }

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      const statusMatch = status === "all" || row.status === status;
      const queryMatch = !normalized || [
        row.display_name,
        row.organization_type,
        row.status,
        row.id
      ].some((value) => String(value || "").toLowerCase().includes(normalized));
      return statusMatch && queryMatch;
    });
  }, [query, rows, status]);

  const active = rows.filter((r) => r.status === "active").length;
  const pending = rows.filter((r) => r.status === "pending_review").length;
  const suspended = rows.filter((r) => r.status === "suspended").length;

  return (
    <AppFrame>
      <PageHeader
        kicker="Network"
        title="Companies"
        description="Provider companies, dispatch eligibility, and admin actions."
        actions={<Button asChild><Link href="/companies/new"><Plus className="size-4" />Add company</Link></Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Building2} label="Total" value={String(rows.length)} />
        <StatCard icon={Building2} label="Active" value={String(active)} />
        <StatCard icon={Building2} intent={pending ? "warn" : "success"} label="Need approval" value={String(pending)} />
        <StatCard icon={Building2} intent={suspended ? "danger" : "neutral"} label="Suspended" value={String(suspended)} />
      </div>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,420px)_1fr]">
        <Input aria-label="Search companies" placeholder="Search company, type, status, or ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((option) => (
            <button
              className={`min-h-10 rounded-md border px-3 py-1.5 text-xs font-medium capitalize ${status === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              key={option}
              onClick={() => setStatus(option)}
              type="button"
            >
              {option.replaceAll("_", " ")}
            </button>
          ))}
        </div>
      </div>
      {message ? <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
      {!loading && visibleRows.length === 0 ? (
        <EmptyState icon={Building2} title="No companies match" description="Adjust the status filter or search term." />
      ) : (
        <DataTable
          columns={["Company", "Type", "Status", "Members", "Technicians", "Created", "Actions"]}
          rows={visibleRows.map((row) => [
            <Link className="font-medium text-foreground hover:text-primary" href={`/companies/${row.id}`} key={`${row.id}-name`}>{row.display_name}</Link>,
            row.organization_type.replaceAll("_", " "),
            <Badge key={`${row.id}-status`} variant={statusVariant(row.status)}>{row.status.replaceAll("_", " ")}</Badge>,
            String(row.member_count),
            String(row.technician_count),
            row.created_at ? new Date(row.created_at).toLocaleDateString() : "-",
            <div className="flex min-w-[260px] flex-wrap items-center gap-2" key={`${row.id}-actions`}>
              <Button asChild size="sm" variant="outline"><Link href={`/companies/${row.id}`}><Eye className="size-4" />View</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href={`/companies/${row.id}`}><Edit className="size-4" />Edit</Link></Button>
              {row.status === "pending_review" ? <>
                <GovernanceActionDialog confirmLabel="Approve company" description={`Approve ${row.display_name} for production access.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "approve", reason)} title={`Approve ${row.display_name}?`}>
                  <Button disabled={busy !== null} size="sm"><Check className="size-4" />Approve</Button>
                </GovernanceActionDialog>
                <GovernanceActionDialog confirmLabel="Reject company" description={`Reject ${row.display_name}. This blocks production access until reactivated.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "reject", reason)} reasonRequired title={`Reject ${row.display_name}?`} variant="destructive">
                  <Button disabled={busy !== null} size="sm" variant="outline"><X className="size-4" />Reject</Button>
                </GovernanceActionDialog>
              </> : null}
              {row.status === "active" ? (
                <GovernanceActionDialog confirmLabel="Suspend company" description={`Suspend ${row.display_name}. Company users and technicians should no longer be treated as production-active.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "suspend", reason)} reasonRequired title={`Suspend ${row.display_name}?`} variant="destructive">
                  <Button disabled={busy !== null} size="sm" variant="destructive"><PauseCircle className="size-4" />Suspend</Button>
                </GovernanceActionDialog>
              ) : null}
              {row.status === "suspended" || row.status === "rejected" || row.status === "closed" ? (
                <GovernanceActionDialog confirmLabel="Activate company" description={`Reactivate ${row.display_name} for production access.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "reactivate", reason)} title={`Activate ${row.display_name}?`}>
                  <Button disabled={busy !== null} size="sm"><RotateCcw className="size-4" />Activate</Button>
                </GovernanceActionDialog>
              ) : null}
              <GovernanceActionDialog confirmLabel="Delete or archive" description={`If ${row.display_name} has no linked records, it will be deleted. If linked records exist, it will be archived instead.`} disabled={busy !== null} onConfirm={(reason) => deleteOrArchive(row, reason)} reasonRequired title={`Delete or archive ${row.display_name}?`} variant="destructive">
                <Button disabled={busy !== null} size="sm" variant="ghost"><Trash2 className="size-4" />Delete</Button>
              </GovernanceActionDialog>
            </div>
          ])}
        />
      )}
    </AppFrame>
  );
}
