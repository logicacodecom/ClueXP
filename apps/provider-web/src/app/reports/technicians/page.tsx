"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@cluexp/console-ui";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../frame";
import { buildPeriodQuery, money, SettlementValue, techLabel, type TechnicianSummary } from "./shared";

export default function TechnicianReportPage() {
  const router = useRouter();
  const [rows, setRows] = useState<TechnicianSummary[]>([]);
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [applied, setApplied] = useState({ start: "", end: "" });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (start: string, end: string) => {
    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch(`/api/provider/settlements/by-technician${buildPeriodQuery(start, end)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load technician report");
      setRows(Array.isArray(body) ? body : []);
      setStatus("ready");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load technician report");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load(applied.start, applied.end);
  }, [load, applied]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    collected: acc.collected + row.customer_total_cents,
    payout: acc.payout + row.tech_payout_cents,
    settlement: acc.settlement + row.settlement_value_cents,
    jobs: acc.jobs + row.job_count,
  }), { collected: 0, payout: 0, settlement: 0, jobs: 0 }), [rows]);

  const periodQuery = useMemo(() => buildPeriodQuery(applied.start, applied.end), [applied]);

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader
          kicker="Finance"
          title="Technician financial report"
          description="Per-technician totals for the period: volume, cuts, reviews, and the settlement balance. Green means the company owes the technician; red means the technician collected cash and owes the company."
          actions={<Button variant="outline" onClick={() => void load(applied.start, applied.end)}><RefreshCw className="size-4" />Refresh</Button>}
        />

        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}

        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">Start
              <input className="block rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">End
              <input className="block rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} />
            </label>
            <Button onClick={() => setApplied({ ...period })}>Apply period</Button>
            {(applied.start || applied.end) ? (
              <Button variant="outline" onClick={() => { setPeriod({ start: "", end: "" }); setApplied({ start: "", end: "" }); }}>Clear</Button>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Jobs" value={String(totals.jobs)} />
          <StatCard label="Total collected" value={money(totals.collected)} />
          <StatCard label="Tech payouts" value={money(totals.payout)} />
          <StatCard label="Net settlement" value={money(totals.settlement)} />
        </div>

        <Card>
          <CardHeader><CardTitle>By technician</CardTitle></CardHeader>
          <CardContent>
            {status === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading technician report…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No settlement rows in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Technician</TableHead>
                      <TableHead className="text-right">Jobs</TableHead>
                      <TableHead className="text-right">Collected</TableHead>
                      <TableHead className="text-right">Avg / job</TableHead>
                      <TableHead>Reviews</TableHead>
                      <TableHead className="text-right">Tech cut</TableHead>
                      <TableHead className="text-right">Company cut</TableHead>
                      <TableHead className="text-right">Settlement</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        className="cursor-pointer"
                        key={row.technician_id}
                        onClick={() => router.push(`/reports/technicians/${row.technician_id}${periodQuery}`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2 font-medium">
                            {techLabel(row)}
                            {row.affiliation_ended ? <Badge variant="neutral">ended</Badge> : null}
                            {row.agreement_statuses.includes("missing") ? <Badge variant="danger">no agreement</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{row.job_count}</TableCell>
                        <TableCell className="text-right">{money(row.customer_total_cents)}</TableCell>
                        <TableCell className="text-right">{money(row.average_job_cents)}</TableCell>
                        <TableCell>{row.review_count > 0 ? `${row.average_rating?.toFixed(1)} ★ (${row.review_count})` : "—"}</TableCell>
                        <TableCell className="text-right">{money(row.tech_payout_cents)}</TableCell>
                        <TableCell className="text-right">{money(row.company_retained_cents)}</TableCell>
                        <TableCell className="text-right"><SettlementValue cents={row.settlement_value_cents} /></TableCell>
                        <TableCell><ChevronRight className="size-4 text-muted-foreground" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
