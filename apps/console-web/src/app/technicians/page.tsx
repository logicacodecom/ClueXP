"use client";

import { Badge, Button, DataTable, EmptyState, Input, PageHeader, StatCard } from "@cluexp/console-ui";
import { Check, Edit, Eye, PauseCircle, Plus, RotateCcw, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";

interface TechnicianRow {
  id: string;
  display_name: string;
  status: string;
  vetting_status: string;
  provider_type: string;
  primary_organization_name?: string | null;
  created_at?: string | null;
}

const STATUSES = ["all", "pending_vetting", "active", "suspended", "rejected"] as const;

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "pending_vetting") return "warn" as const;
  if (status === "suspended" || status === "rejected") return "danger" as const;
  return "neutral" as const;
}

function pastTense(action: string) {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  if (action === "suspend") return "suspended";
  return "reactivated";
}

export default function TechniciansPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<TechnicianRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/technicians", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load technicians");
      setRows(body.technicians ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load technicians");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runAction(row: TechnicianRow, action: "approve" | "reject" | "suspend" | "reactivate") {
    const verb = action === "reactivate" ? "activate" : action;
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${row.display_name}? This changes the technician's production dispatch access.`)) return;
    setBusy(`${row.id}:${action}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/technicians/${encodeURIComponent(row.id)}/${action}`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${verb} technician`);
      await refresh();
      setMessage(`${row.display_name} ${pastTense(action)}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${verb} technician`);
    } finally {
      setBusy(null);
    }
  }

  function unavailableDelete(row: TechnicianRow) {
    window.alert(`Delete is not available for ${row.display_name} because technician records may be linked to dispatch history, documents, and provider affiliations. Suspend or reject the technician instead.`);
  }

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      const statusMatch = status === "all" || row.status === status || row.vetting_status === status;
      const queryMatch = !normalized || [
        row.display_name,
        row.provider_type,
        row.primary_organization_name,
        row.status,
        row.vetting_status,
        row.id
      ].some((value) => String(value || "").toLowerCase().includes(normalized));
      return statusMatch && queryMatch;
    });
  }, [query, rows, status]);

  const active = rows.filter((r) => r.status === "active").length;
  const pending = rows.filter((r) => r.status === "pending_vetting" || r.vetting_status === "unverified").length;
  const suspended = rows.filter((r) => r.status === "suspended").length;

  return (
    <AppFrame>
      <PageHeader
        kicker="Network"
        title="Technicians"
        description="Technician eligibility, company affiliation, and vetting actions."
        actions={<Button asChild><Link href="/technicians/new"><Plus className="size-4" />Add technician</Link></Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={UserRound} label="Total" value={String(rows.length)} />
        <StatCard icon={UserRound} label="Active" value={String(active)} />
        <StatCard icon={UserRound} intent={pending ? "warn" : "success"} label="Need vetting" value={String(pending)} />
        <StatCard icon={UserRound} intent={suspended ? "danger" : "neutral"} label="Suspended" value={String(suspended)} />
      </div>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,420px)_1fr]">
        <Input aria-label="Search technicians" placeholder="Search technician, company, status, skill, or ID" value={query} onChange={(event) => setQuery(event.target.value)} />
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
        <EmptyState icon={UserRound} title="No technicians match" description="Adjust the status filter or search term." />
      ) : (
        <DataTable
          columns={["Technician", "Provider type", "Company", "Status", "Vetting", "Created", "Actions"]}
          rows={visibleRows.map((row) => [
            <Link className="font-medium text-foreground hover:text-primary" href={`/technicians/${row.id}`} key={`${row.id}-name`}>{row.display_name}</Link>,
            row.provider_type.replaceAll("_", " "),
            row.primary_organization_name || "Independent",
            <Badge key={`${row.id}-status`} variant={statusVariant(row.status)}>{row.status.replaceAll("_", " ")}</Badge>,
            row.vetting_status.replaceAll("_", " "),
            row.created_at ? new Date(row.created_at).toLocaleDateString() : "-",
            <div className="flex min-w-[260px] flex-wrap items-center gap-2" key={`${row.id}-actions`}>
              <Button asChild size="sm" variant="outline"><Link href={`/technicians/${row.id}`}><Eye className="size-4" />View</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href={`/technicians/${row.id}`}><Edit className="size-4" />Edit</Link></Button>
              {row.status === "pending_vetting" || row.vetting_status === "unverified" ? <>
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
