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
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../frame";
import { exportRowsToExcel } from "../technicians/excel";
import {
  AffiliationTag,
  buildPeriodQuery,
  formatDate,
  JobDetail,
  methodLabel,
  money,
  SettlementValue,
  type SettlementRow
} from "../technicians/shared";

export default function JobsReportPage() {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [applied, setApplied] = useState({ start: "", end: "" });
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (start: string, end: string) => {
    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch(`/api/provider/settlements${buildPeriodQuery(start, end)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load settlements");
      setRows(Array.isArray(body) ? body : []);
      setStatus("ready");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load settlements");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load(applied.start, applied.end);
  }, [load, applied]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    customer: acc.customer + row.customer_total_cents,
    tech: acc.tech + row.tech_payout_cents,
    retained: acc.retained + row.company_retained_cents,
    settlement: acc.settlement + row.settlement_value_cents,
  }), { customer: 0, tech: 0, retained: 0, settlement: 0 }), [rows]);

  const exportExcel = useCallback(() => {
    void exportRowsToExcel(
      rows.map((row) => ({
        job_id: row.job_id,
        finished_at: formatDate(row.finished_at),
        technician: row.technician_display_name ?? row.technician_id?.slice(0, 8) ?? "—",
        not_active: row.affiliation_ended ? "yes" : "no",
        agreement_status: row.agreement_status,
        payment_method: methodLabel(row.payment_method),
        customer_total: row.customer_total_cents / 100,
        commissionable: row.commissionable_cents / 100,
        tech_reimbursement: row.tech_reimbursement_cents / 100,
        tech_payout: row.tech_payout_cents / 100,
        company_retained: row.company_retained_cents / 100,
        settlement_value: row.settlement_value_cents / 100,
        review_rating: row.review?.rating ?? "",
      })),
      [
        { key: "job_id", header: "Job ID", width: 38 },
        { key: "finished_at", header: "Date", width: 14 },
        { key: "technician", header: "Technician", width: 22 },
        { key: "not_active", header: "Not active", width: 12 },
        { key: "agreement_status", header: "Agreement", width: 14 },
        { key: "payment_method", header: "Payment method", width: 16 },
        { key: "customer_total", header: "Customer total ($)", width: 18 },
        { key: "commissionable", header: "Commissionable ($)", width: 18 },
        { key: "tech_reimbursement", header: "Reimbursement ($)", width: 18 },
        { key: "tech_payout", header: "Tech payout ($)", width: 16 },
        { key: "company_retained", header: "Company retained ($)", width: 20 },
        { key: "settlement_value", header: "Settlement value ($)", width: 20 },
        { key: "review_rating", header: "Review", width: 10 },
      ],
      "settlement-report-by-job",
      "By job"
    );
  }, [rows]);

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader
          kicker="Finance"
          title="Settlement report by job"
          description="Closeout-derived settlement rows: technician payout, reimbursement, company retained amount, customer review, and the signed settlement balance. Click a job for the full breakdown."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void load(applied.start, applied.end)}><RefreshCw className="size-4" />Refresh</Button>
              <Button variant="outline" onClick={exportExcel} disabled={rows.length === 0}><FileSpreadsheet className="size-4" />Export Excel</Button>
            </div>
          }
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
          <StatCard label="Customer total" value={money(totals.customer)} />
          <StatCard label="Tech payouts" value={money(totals.tech)} />
          <StatCard label="Company retained" value={money(totals.retained)} />
          <StatCard label="Net settlement" value={money(totals.settlement)} />
        </div>

        <Card>
          <CardHeader><CardTitle>Settlement ledger</CardTitle></CardHeader>
          <CardContent>
            {status === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading settlement rows…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No settlement rows yet. Jobs appear here after a technician records an itemized closeout.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Agreement</TableHead>
                      <TableHead className="text-right">Customer</TableHead>
                      <TableHead className="text-right">Commissionable</TableHead>
                      <TableHead className="text-right">Reimb.</TableHead>
                      <TableHead className="text-right">Tech payout</TableHead>
                      <TableHead className="text-right">Company retained</TableHead>
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
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              {row.technician_display_name ?? row.technician_id?.slice(0, 8) ?? "—"}
                              <AffiliationTag ended={row.affiliation_ended} endedAt={row.affiliation_ended_at} />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.agreement_status === "active" ? "success" : row.agreement_status === "missing" ? "danger" : "warn"}>
                              {row.agreement_status}
                            </Badge>
                            <div className="mt-1 text-xs text-muted-foreground">{(row.cut_basis_points / 100).toFixed(2)}% cut</div>
                          </TableCell>
                          <TableCell className="text-right">{money(row.customer_total_cents)}</TableCell>
                          <TableCell className="text-right">{money(row.commissionable_cents)}</TableCell>
                          <TableCell className="text-right">{money(row.tech_reimbursement_cents)}</TableCell>
                          <TableCell className="text-right font-semibold">{money(row.tech_payout_cents)}</TableCell>
                          <TableCell className="text-right">{money(row.company_retained_cents)}</TableCell>
                          <TableCell className="text-right"><SettlementValue cents={row.settlement_value_cents} /></TableCell>
                          <TableCell>{row.review?.rating != null ? `${row.review.rating} ★` : "—"}</TableCell>
                        </TableRow>
                        {expandedJob === row.job_id ? (
                          <TableRow>
                            <TableCell colSpan={10}><JobDetail row={row} /></TableCell>
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
      </div>
    </AppFrame>
  );
}
