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
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../../frame";
import { buildPeriodQuery, money, SettlementValue, techLabel, type TechnicianSummary } from "../shared";

interface CloseoutLine {
  line_number: number;
  item_type_code: string;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  line_total_cents: number;
  taxable: boolean;
  provided_by: string | null;
  compensation_eligible: boolean;
  reimbursement_eligible: boolean;
  note: string | null;
}

interface PaymentReport {
  amount: number;
  currency: string;
  method: string | null;
  reported_at: string | null;
}

interface SettlementRow {
  job_id: string;
  technician_id: string | null;
  technician_display_name: string | null;
  status: string;
  finished_at: string | null;
  agreement_status: string;
  affiliation_ended?: boolean;
  cut_basis_points: number;
  customer_total_cents: number;
  tax_cents: number;
  card_fee_cents: number;
  tip_cents: number;
  commissionable_cents: number;
  tech_reimbursement_cents: number;
  tech_service_payout_cents: number;
  tech_tip_cents: number;
  tech_payout_cents: number;
  company_retained_cents: number;
  payment_method: string | null;
  settlement_value_cents: number;
  review: { rating: number | null; comment: string | null; created_at: string | null } | null;
  payments: { technician: PaymentReport | null; customer: PaymentReport | null } | null;
  closeout: { line_items?: CloseoutLine[]; subtotal_cents?: number } | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function methodLabel(method: string | null | undefined): string {
  return method ? method.replace(/_/g, " ") : "—";
}

function JobDetail({ row }: { row: SettlementRow }) {
  const lines = row.closeout?.line_items ?? [];
  const techReport = row.payments?.technician ?? null;
  const customerReport = row.payments?.customer ?? null;
  const reportsDisagree =
    techReport != null && customerReport != null &&
    (Math.round(techReport.amount * 100) !== Math.round(customerReport.amount * 100) || techReport.method !== customerReport.method);
  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/30 p-4 text-sm">
      {lines.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Provided by</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.line_number}>
                  <TableCell>
                    <div className="font-medium">{line.description}</div>
                    {line.note ? <div className="text-xs text-muted-foreground">{line.note}</div> : null}
                  </TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">{money(line.line_total_cents)}</TableCell>
                  <TableCell>{line.provided_by ?? "—"}</TableCell>
                  <TableCell className="space-x-1">
                    {line.compensation_eligible ? <Badge variant="success">commission</Badge> : null}
                    {line.reimbursement_eligible ? <Badge variant="warn">reimbursable</Badge> : null}
                    {line.taxable ? <Badge variant="outline">taxable</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-muted-foreground">No itemized closeout lines.</p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Money breakdown</div>
          <div className="flex justify-between"><span>Customer total</span><strong>{money(row.customer_total_cents)}</strong></div>
          <div className="flex justify-between"><span>Tax</span><span>{money(row.tax_cents)}</span></div>
          <div className="flex justify-between"><span>Tip</span><span>{money(row.tip_cents)}</span></div>
          <div className="flex justify-between"><span>Card fee</span><span>{money(row.card_fee_cents)}</span></div>
          <div className="flex justify-between"><span>Tech service cut ({(row.cut_basis_points / 100).toFixed(2)}%)</span><span>{money(row.tech_service_payout_cents)}</span></div>
          <div className="flex justify-between"><span>Tech reimbursement</span><span>{money(row.tech_reimbursement_cents)}</span></div>
          <div className="flex justify-between"><span>Tech tip share</span><span>{money(row.tech_tip_cents)}</span></div>
          <div className="flex justify-between border-t border-border pt-1"><span>Tech payout</span><strong>{money(row.tech_payout_cents)}</strong></div>
          <div className="flex justify-between"><span>Company retained</span><strong>{money(row.company_retained_cents)}</strong></div>
          <div className="flex justify-between"><span>Settlement balance</span><SettlementValue cents={row.settlement_value_cents} /></div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground">Payment reports</div>
            <div className="mt-1 space-y-1">
              <div className="flex justify-between">
                <span>Technician reported</span>
                <span>{techReport ? `$${techReport.amount.toFixed(2)} · ${methodLabel(techReport.method)}` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Customer reported</span>
                <span>{customerReport ? `$${customerReport.amount.toFixed(2)} · ${methodLabel(customerReport.method)}` : "—"}</span>
              </div>
              {reportsDisagree ? <Badge variant="danger">reports disagree</Badge> : null}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground">Customer review</div>
            {row.review?.rating != null ? (
              <div className="mt-1">
                <div>{row.review.rating} ★ <span className="text-xs text-muted-foreground">{formatDate(row.review.created_at)}</span></div>
                {row.review.comment ? <p className="mt-1 text-muted-foreground">“{row.review.comment}”</p> : null}
              </div>
            ) : (
              <p className="mt-1 text-muted-foreground">No review left.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TechnicianDetailReport() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const technicianId = params.id;
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

  const load = useCallback(async (start: string, end: string) => {
    setStatus("loading");
    setMessage(null);
    try {
      const periodQs = buildPeriodQuery(start, end);
      const jobsParams = new URLSearchParams(periodQs ? periodQs.slice(1) : "");
      jobsParams.set("technician_id", technicianId);
      const [summaryResponse, jobsResponse] = await Promise.all([
        fetch(`/api/provider/settlements/by-technician${periodQs}`, { cache: "no-store" }),
        fetch(`/api/provider/settlements?${jobsParams.toString()}`, { cache: "no-store" }),
      ]);
      const summaryBody = await summaryResponse.json().catch(() => ({}));
      const jobsBody = await jobsResponse.json().catch(() => ({}));
      if (!summaryResponse.ok) throw new Error(summaryBody.detail || "Unable to load technician report");
      if (!jobsResponse.ok) throw new Error(jobsBody.detail || "Unable to load technician jobs");
      setSummaries(Array.isArray(summaryBody) ? summaryBody : []);
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

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Finance"
        title="Technician settlement detail"
        description="Every settled job for the selected technician in the period. Click a job for the full closeout, payment, and review breakdown."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><a href={`/reports/technicians${periodQuery}`}><ArrowLeft className="size-4" />All technicians</a></Button>
            <Button variant="outline" onClick={() => void load(applied.start, applied.end)}><RefreshCw className="size-4" />Refresh</Button>
            <Button asChild>
              <a href={`/api/provider/settlements?${new URLSearchParams({ ...(applied.start ? { period_start: applied.start } : {}), ...(applied.end ? { period_end: applied.end } : {}), technician_id: technicianId, format: "csv" }).toString()}`}>
                <Download className="size-4" />Export CSV
              </a>
            </Button>
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
              onChange={(e) => router.push(`/reports/technicians/${e.target.value}${periodQuery}`)}
            >
              {selectorOptions.map((option) => (
                <option key={option.technician_id} value={option.technician_id}>{techLabel(option)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted-foreground">Start
            <input className="block rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted-foreground">End
            <input className="block rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} />
          </label>
          <Button onClick={() => setApplied({ ...period })}>Apply period</Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Jobs" value={String(summary?.job_count ?? rows.length)} />
        <StatCard label="Collected" value={money(summary?.customer_total_cents ?? 0)} />
        <StatCard label="Tech payout" value={money(summary?.tech_payout_cents ?? 0)} />
        <StatCard label="Reviews" value={summary && summary.review_count > 0 ? `${summary.average_rating?.toFixed(1)} ★ (${summary.review_count})` : "—"} />
      </div>

      {summary?.affiliation_ended ? (
        <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          This technician&apos;s affiliation has ended. Rows use the last agreement on file.
        </div>
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
    </div>
  );
}

export default function TechnicianDetailPage() {
  return (
    <AppFrame>
      <Suspense fallback={null}>
        <TechnicianDetailReport />
      </Suspense>
    </AppFrame>
  );
}
