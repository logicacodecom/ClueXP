"use client";

import { Badge, Button, DataTable, EmptyState, PageHeader, StatCard } from "@cluexp/console-ui";
import { Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

export default function TechniciansPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [rows, setRows] = useState<TechnicianRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (nextStatus: (typeof STATUSES)[number]) => {
    setLoading(true);
    setMessage(null);
    try {
      const qs = nextStatus === "all" ? "" : `?status=${encodeURIComponent(nextStatus)}`;
      const response = await fetch(`/api/technicians${qs}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load technicians");
      setRows(body.technicians ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load technicians");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(status); }, [refresh, status]);

  const active = rows.filter((r) => r.status === "active").length;
  const pending = rows.filter((r) => r.status === "pending_vetting").length;

  return (
    <AppFrame>
      <PageHeader
        kicker="Network"
        title="Technicians"
        description="Every technician in the network, independent or company-affiliated."
        actions={<Button asChild><Link href="/technicians/new"><Plus className="size-4" />Add technician</Link></Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={UserRound} label="Total" value={String(rows.length)} />
        <StatCard icon={UserRound} label="Active" value={String(active)} />
        <StatCard icon={UserRound} label="Pending vetting" value={String(pending)} />
        <StatCard icon={UserRound} label="Filtered" value={status === "all" ? "All statuses" : status.replaceAll("_", " ")} />
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
        <EmptyState icon={UserRound} title="No technicians" description="No technicians match this filter yet." />
      ) : (
        <DataTable
          columns={["Technician", "Provider type", "Company", "Status", "Vetting", "Created"]}
          rows={rows.map((row) => [
            <Link className="font-medium text-foreground hover:text-primary" href={`/technicians/${row.id}`} key={`${row.id}-name`}>{row.display_name}</Link>,
            row.provider_type,
            row.primary_organization_name || "Independent",
            <Badge key={`${row.id}-status`} variant={statusVariant(row.status)}>{row.status.replaceAll("_", " ")}</Badge>,
            row.vetting_status,
            row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"
          ])}
        />
      )}
    </AppFrame>
  );
}
