"use client";

import { Badge, Button, DataTable, EmptyState, PageHeader, StatCard } from "@cluexp/console-ui";
import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

export default function CompaniesPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [rows, setRows] = useState<OrganizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (nextStatus: (typeof STATUSES)[number]) => {
    setLoading(true);
    setMessage(null);
    try {
      const qs = nextStatus === "all" ? "" : `?status=${encodeURIComponent(nextStatus)}`;
      const response = await fetch(`/api/organizations${qs}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load companies");
      setRows(body.organizations ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load companies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(status); }, [refresh, status]);

  const active = rows.filter((r) => r.status === "active").length;
  const pending = rows.filter((r) => r.status === "pending_review").length;

  return (
    <AppFrame>
      <PageHeader
        kicker="Network"
        title="Companies"
        description="Every provider organization in the network, its status, and how many users and technicians it has."
        actions={<Button asChild><Link href="/companies/new"><Plus className="size-4" />Add company</Link></Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Building2} label="Total" value={String(rows.length)} />
        <StatCard icon={Building2} label="Active" value={String(active)} />
        <StatCard icon={Building2} label="Pending review" value={String(pending)} />
        <StatCard icon={Building2} label="Filtered" value={status === "all" ? "All statuses" : status.replaceAll("_", " ")} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((option) => (
          <button
            className={`rounded-md border px-3 py-1.5 text-xs font-medium capitalize ${status === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
            key={option}
            onClick={() => setStatus(option)}
            type="button"
          >
            {option.replaceAll("_", " ")}
          </button>
        ))}
      </div>
      {message ? <div className="mb-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{message}</div> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState icon={Building2} title="No companies" description="No organizations match this filter yet." />
      ) : (
        <DataTable
          columns={["Company", "Type", "Status", "Members", "Technicians", "Created"]}
          rows={rows.map((row) => [
            <Link className="font-medium text-foreground hover:text-primary" href={`/companies/${row.id}`} key={`${row.id}-name`}>{row.display_name}</Link>,
            row.organization_type,
            <Badge key={`${row.id}-status`} variant={statusVariant(row.status)}>{row.status.replaceAll("_", " ")}</Badge>,
            String(row.member_count),
            String(row.technician_count),
            row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"
          ])}
        />
      )}
    </AppFrame>
  );
}
