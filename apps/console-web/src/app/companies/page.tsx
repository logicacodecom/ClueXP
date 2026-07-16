"use client";

import { Badge, Button, DataTable, EmptyState, Input, PageHeader, StatCard } from "@cluexp/console-ui";
import { Building2, Check, Edit, Eye, PauseCircle, Plus, RotateCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";

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

  async function runAction(row: OrganizationRow, action: "approve" | "reject" | "suspend" | "reactivate") {
    const label = actionLabel(action);
    if (!window.confirm(`${label[0].toUpperCase()}${label.slice(1)} ${row.display_name}? This changes the company's production access.`)) return;
    setBusy(`${row.id}:${action}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/organizations/${encodeURIComponent(row.id)}/${action}`, { method: "POST" });
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

  function unavailableDelete(row: OrganizationRow) {
    window.alert(`Delete is not available for ${row.display_name} because company records may be linked to users, technicians, documents, and jobs. Suspend or reject it instead.`);
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
                <Button disabled={busy !== null} size="sm" onClick={() => void runAction(row, "approve")}><Check className="size-4" />Approve</Button>
                <Button disabled={busy !== null} size="sm" variant="outline" onClick={() => void runAction(row, "reject")}><X className="size-4" />Reject</Button>
              </> : null}
              {row.status === "active" ? <Button disabled={busy !== null} size="sm" variant="destructive" onClick={() => void runAction(row, "suspend")}><PauseCircle className="size-4" />Suspend</Button> : null}
              {row.status === "suspended" || row.status === "rejected" ? <Button disabled={busy !== null} size="sm" onClick={() => void runAction(row, "reactivate")}><RotateCcw className="size-4" />Activate</Button> : null}
              <Button size="sm" variant="ghost" onClick={() => unavailableDelete(row)}><Trash2 className="size-4" />Delete</Button>
            </div>
          ])}
        />
      )}
    </AppFrame>
  );
}
