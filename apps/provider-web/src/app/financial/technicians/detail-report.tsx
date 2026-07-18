"use client";

import {
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
import { ArrowLeft, FileSpreadsheet, Wallet } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { exportRowsToExcel } from "./excel";
import { LogPaymentModal } from "./payment-modal";
import {
  AffiliationTag,
  buildPeriodQuery,
  formatDate,
  JobDetail,
  methodLabel,
  money,
  SettlementValue,
  techLabel,
  type SettlementRow,
  type TechnicianSummary
} from "./shared";

export interface TechnicianDetailReportProps {
  technicianId: string;
  onTechnicianChange: (id: string) => void;
}

export function TechnicianDetailReport({ technicianId, onTechnicianChange }: TechnicianDetailReportProps) {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState({
    start: searchParams.get("period_start") ?? "",
    end: searchParams.get("period_end") ?? "",
  });
  const [applied, setApplied] = useState(period);
  const [summaries, setSummaries] = useState<TechnicianSummary[]>([]);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(async (start: string, end: string) => {
    setStatus("loading");
    setMessage(null);
    try {
      const periodQs = buildPeriodQuery(start, end);
      const summaryResponse = await fetch(`/api/provider/settlements/by-technician${periodQs}`, { cache: "no-store" });
      const summaryBody = await summaryResponse.json().catch(() => ({}));
      if (!summaryResponse.ok) throw new Error(summaryBody.detail || "Unable to load technician report");
      setSummaries(Array.isArray(summaryBody) ? summaryBody : []);

      const jobsParams = new URLSearchParams(periodQs ? periodQs.slice(1) : "");
      jobsParams.set("technician_id", technicianId);
      const jobsResponse = await fetch(`/api/provider/settlements?${jobsParams.toString()}`, { cache: "no-store" });
      const jobsBody = await jobsResponse.json().catch(() => ({}));
      if (!jobsResponse.ok) throw new Error(jobsBody.detail || "Unable to load technician jobs");
      setRows(Array.isArray(jobsBody) ? jobsBody : []);
      setStatus("ready");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load technician report");
      setStatus("error");
    }
  }, [technicianId]);

  useEffect(() => {
    void load(applied.start, applied.end);
  }, [load, applied]);

  const summary = useMemo(
    () => summaries.find((s) => s.technician_id === technicianId) ?? null,
    [summaries, technicianId]
  );
  // Selector comes from the report itself so ex-affiliated techs stay selectable;
  // the current id is merged in case it has no rows in the applied period.
  const selectorOptions = useMemo(() => {
    if (summaries.some((s) => s.technician_id === technicianId)) return summaries;
    return [...summaries, {
      technician_id: technicianId,
      technician_display_name: rows[0]?.technician_display_name ?? null,
    } as TechnicianSummary];
  }, [summaries, technicianId, rows]);

  const periodQuery = useMemo(() => buildPeriodQuery(applied.start, applied.end), [applied]);

  const exportExcel = useCallback(() => {
    void exportRowsToExcel(
      rows.map((row) => ({
        job_id: row.job_id,
        finished_at: formatDate(row.finished_at),
        payment_method: methodLabel(row.payment_method),
        customer_total: (row.customer_total_cents || 0) / 100,
        commissionable: (row.commissionable_cents || 0) / 100,
        tech_payout: (row.tech_payout_cents || 0) / 100,
        company_retained: (row.company_retained_cents || 0) / 100,
        settlement_value: (row.settlement_value_cents || 0) / 100,
        review_rating: row.review?.rating ?? "",
      })),
      [
        { key: "job_id", header: "Job ID", width: 38 },
        { key: "finished_at", header: "Date", width: 14 },
        { key: "payment_method", header: "Payment method", width: 16 },
        { key: "customer_total", header: "Customer total ($)", width: 18 },
        { key: "commissionable", header: "Commissionable ($)", width: 18 },
        { key: "tech_payout", header: "Tech payout ($)", width: 16 },
        { key: "company_retained", header: "Company retained ($)", width: 20 },
        { key: "settlement_value", header: "Settlement value ($)", width: 20 },
        { key: "review_rating", header: "Review", width: 10 },
      ],
      `technician-${technicianId}`,
      "Jobs"
    );
  }, [rows, technicianId]);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Finance"
        title="Technician settlement detail"
        description="Every settled job for the selected technician in the period. Click a job for the full closeout, payment, and review breakdown."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><a href={`/financial/technicians${periodQuery}`}><ArrowLeft className="size-4" />Technicians</a></Button>
            <Button onClick={() => setPayOpen(true)}><Wallet className="size-4" />Log payment</Button>
          </div>
        }
      />

      {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <label className="space-y-1 text-xs font-semibold text-muted-foreground">Technician
            <select
              className="block rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={technicianId}
              onChange={(e) => onTechnicianChange(e.target.value)}
            >
              {selectorOptions.map((option) => (
                <option key={option.technician_id} value={option.technician_id}>
                  {techLabel(option)}{option.affiliation_ended ? ` — not active${option.affiliation_ended_at ? ` (ended ${formatDate(option.affiliation_ended_at)})` : ""}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted-foreground">Start
            <input className="block rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted-foreground">End
            <input className="block rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} />
          </label>
          <Button onClick={() => setApplied({ ...period })}>Apply</Button>
          {(applied.start || applied.end) ? (
            <Button variant="outline" onClick={() => { setPeriod({ start: "", end: "" }); setApplied({ start: "", end: "" }); }}>Clear</Button>
          ) : null}
          <Button className="ml-auto" variant="success" onClick={exportExcel} disabled={rows.length === 0}><FileSpreadsheet className="size-4" />Export Excel</Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{summary ? techLabel(summary) : "Technician"}</h2>
        <AffiliationTag ended={summary?.affiliation_ended} endedAt={summary?.affiliation_ended_at} />
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <StatCard label="Jobs" value={String(summary?.job_count ?? rows.length)} />
        <StatCard label="Collected" value={money(summary?.customer_total_cents ?? 0)} />
        <StatCard label="Tech payout" value={money(summary?.tech_payout_cents ?? 0)} />
        <StatCard label="Reviews" value={summary && summary.review_count > 0 ? `${summary.average_rating?.toFixed(1)} ★ (${summary.review_count})` : "—"} />
        <StatCard
          intent={(summary?.balance?.net_outstanding_cents ?? 0) < 0 ? "danger" : "success"}
          label="Outstanding (all time)"
          value={money(summary?.balance?.net_outstanding_cents ?? 0)}
        />
      </div>
      {summary?.balance && summary.balance.pending_tech_to_company_cents > 0 ? (
        <p className="text-xs text-muted-foreground">
          {money(summary.balance.pending_tech_to_company_cents)} technician-submitted payment pending confirmation — review it on the Payments page.
        </p>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Jobs in period</CardTitle></CardHeader>
        <CardContent>
          {status === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading jobs…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No settled jobs for this technician in the period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Customer</TableHead>
                    <TableHead className="text-right">Commissionable</TableHead>
                    <TableHead className="text-right">Tech payout</TableHead>
                    <TableHead className="text-right">Settlement</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <Fragment key={row.job_id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpandedJob((current) => (current === row.job_id ? null : row.job_id))}
                      >
                        <TableCell>
                          <div className="font-medium">{row.job_id.slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">{formatDate(row.finished_at)}</div>
                        </TableCell>
                        <TableCell className="capitalize">{methodLabel(row.payment_method)}</TableCell>
                        <TableCell className="text-right">{money(row.customer_total_cents)}</TableCell>
                        <TableCell className="text-right">{money(row.commissionable_cents)}</TableCell>
                        <TableCell className="text-right">{money(row.tech_payout_cents)}</TableCell>
                        <TableCell className="text-right"><SettlementValue cents={row.settlement_value_cents} /></TableCell>
                        <TableCell>{row.review?.rating != null ? `${row.review.rating} ★` : "—"}</TableCell>
                      </TableRow>
                      {expandedJob === row.job_id ? (
                        <TableRow>
                          <TableCell colSpan={7}><JobDetail row={row} /></TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <LogPaymentModal
        open={payOpen}
        onOpenChange={setPayOpen}
        technicians={summary ? [summary] : []}
        preselectedTechnicianId={technicianId}
        sourcePeriod={applied}
        onLogged={() => void load(applied.start, applied.end)}
      />
    </div>
  );
}
