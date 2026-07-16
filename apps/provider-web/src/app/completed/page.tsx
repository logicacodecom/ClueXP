"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cluexp/console-ui";
import { RefreshCw, Star } from "lucide-react";
import { AppFrame } from "../frame";

const METHOD_LABELS: Record<string, string> = {
  credit_card: "Credit card", debit_card: "Debit card", cash: "Cash", check: "Check",
  zelle: "Zelle", cash_app: "Cash App", apple_pay: "Apple Pay", google_pay: "Google Pay",
  venmo: "Venmo", paypal: "PayPal", other: "Other"
};

const STATUS_LABELS: Record<string, string> = {
  completed_pending_customer: "Awaiting confirmation",
  completed_confirmed: "Confirmed", completed_auto_closed: "Auto-closed",
  cancelled: "Cancelled", no_show: "No-show"
};

const STATUS_VARIANTS: Record<string, "success" | "warn" | "danger" | "outline"> = {
  completed_pending_customer: "warn",
  completed_confirmed: "success",
  completed_auto_closed: "success",
  cancelled: "danger",
  no_show: "danger",
};

type PaymentReport = { amount: number; currency: string; method: string } | null;

type HistoryJob = {
  id: string;
  status: string;
  address: string | null;
  situation: string | null;
  finished_at: string | null;
  technician_display_name: string | null;
  review: { rating: number | null; comment: string | null } | null;
  payments: { technician: PaymentReport; customer: PaymentReport };
};

type SettlementRow = {
  job_id: string;
  technician_id: string | null;
  technician_display_name: string | null;
  status: string;
  finished_at: string | null;
  agreement_status: string;
  cut_basis_points: number;
  customer_total_cents: number;
  tax_cents: number;
  card_fee_cents: number;
  tip_cents: number;
  commissionable_cents: number;
  company_provided_items_cents: number;
  tech_reimbursement_cents: number;
  tech_service_payout_cents: number;
  tech_tip_cents: number;
  tech_payout_cents: number;
  company_retained_cents: number;
};

function money(p: PaymentReport): string {
  if (!p) return "—";
  return `${p.currency === "USD" ? "$" : `${p.currency} `}${p.amount.toFixed(2)} · ${METHOD_LABELS[p.method] ?? p.method}`;
}

function centsToMoney(cents: number | null | undefined): string {
  if (typeof cents !== "number" || Number.isNaN(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function paymentToCents(payment: PaymentReport): number {
  return payment ? Math.round(payment.amount * 100) : 0;
}

function todayInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function jobDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return todayInputValue(date);
}

function formatPercentFromBasisPoints(basisPoints: number | null | undefined): string {
  if (typeof basisPoints !== "number" || Number.isNaN(basisPoints)) return "—";
  return `${(basisPoints / 100).toFixed(2)}%`;
}

function settlementBadgeVariant(status: string | undefined): "success" | "warn" | "danger" | "outline" {
  if (status === "active") return "success";
  if (status === "missing") return "danger";
  if (status === "draft" || status === "inactive") return "warn";
  return "outline";
}

function CompletedJobs() {
  const defaultDate = useMemo(() => todayInputValue(), []);
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [periodStart, setPeriodStart] = useState(defaultDate);
  const [periodEnd, setPeriodEnd] = useState(defaultDate);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [historyResponse, settlementsResponse] = await Promise.all([
        fetch("/api/provider/jobs/history", { cache: "no-store" }),
        fetch("/api/provider/settlements", { cache: "no-store" }),
      ]);
      const [historyBody, settlementsBody] = await Promise.all([
        historyResponse.json().catch(() => ([])),
        settlementsResponse.json().catch(() => ([])),
      ]);
      if (!historyResponse.ok) throw new Error((historyBody as { detail?: string })?.detail || "Could not load completed jobs");
      if (!settlementsResponse.ok) throw new Error((settlementsBody as { detail?: string })?.detail || "Could not load settlement rows");
      setJobs(Array.isArray(historyBody) ? historyBody : []);
      setSettlements(Array.isArray(settlementsBody) ? settlementsBody : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load completed jobs");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const settlementByJobId = useMemo(() => {
    const map = new Map<string, SettlementRow>();
    settlements.forEach((row) => map.set(row.job_id, row));
    return map;
  }, [settlements]);

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const dateKey = jobDateKey(job.finished_at);
    if (!dateKey) return false;
    if (periodStart && dateKey < periodStart) return false;
    if (periodEnd && dateKey > periodEnd) return false;
    return true;
  }), [jobs, periodEnd, periodStart]);

  const totals = useMemo(() => filteredJobs.reduce((acc, job) => {
    const settlement = settlementByJobId.get(job.id);
    const collected = settlement?.customer_total_cents ?? paymentToCents(job.payments.technician);
    return {
      collected: acc.collected + collected,
      tech: acc.tech + (settlement?.tech_payout_cents ?? 0),
      retained: acc.retained + (settlement?.company_retained_cents ?? 0),
    };
  }, { collected: 0, tech: 0, retained: 0 }), [filteredJobs, settlementByJobId]);

  const confirmedCount = filteredJobs.filter((job) => job.status === "completed_confirmed").length;
  const pendingCount = filteredJobs.filter((job) => job.status === "completed_pending_customer").length;
  const reviewedCount = filteredJobs.filter((job) => job.review?.rating).length;
  const selectedPeriodLabel = periodStart || periodEnd
    ? `${periodStart || "Beginning"} → ${periodEnd || "Today"}`
    : "All time";

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Reports"
        title="Completed Jobs"
        description="Finished work, customer confirmation state, reviews, and closeout-derived earnings split between technician and company."
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={state === "loading"}>
            <RefreshCw className={state === "loading" ? "animate-spin" : undefined} />
            {state === "loading" ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-sm font-semibold">Report period</div>
            <p className="text-xs text-muted-foreground">Defaults to today. Clear both dates to review all completed jobs.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">
              Start
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">
              End
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
              />
            </label>
            <Button variant="outline" onClick={() => { setPeriodStart(defaultDate); setPeriodEnd(defaultDate); }}>Today</Button>
            <Button variant="ghost" onClick={() => { setPeriodStart(""); setPeriodEnd(""); }}>All time</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-5">
        <StatCard label="Completed jobs" value={state === "loading" ? "—" : String(filteredJobs.length)} />
        <StatCard label="Confirmed" value={state === "loading" ? "—" : String(confirmedCount)} intent="success" />
        <StatCard label="Customer total" value={state === "loading" ? "—" : centsToMoney(totals.collected)} />
        <StatCard label="Tech earnings" value={state === "loading" ? "—" : centsToMoney(totals.tech)} intent="success" />
        <StatCard label="Company retained" value={state === "loading" ? "—" : centsToMoney(totals.retained)} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Completed job history</CardTitle>
            <CardDescription>
              {selectedPeriodLabel} · {reviewedCount} customer review{reviewedCount === 1 ? "" : "s"} recorded · {pendingCount} awaiting customer confirmation.
            </CardDescription>
          </div>
          <Badge variant="outline">Provider scoped</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[1280px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead className="text-right">Customer total</TableHead>
                  <TableHead className="text-right">Tech earning</TableHead>
                  <TableHead className="text-right">Company retained</TableHead>
                  <TableHead className="text-right">Cut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
            {state === "error" ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-destructive">{error}</TableCell></TableRow>
            ) : state === "loading" ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">Loading completed jobs...</TableCell></TableRow>
            ) : filteredJobs.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No completed jobs for this period.</TableCell></TableRow>
            ) : (
              filteredJobs.map((job) => {
                const settlement = settlementByJobId.get(job.id);
                return (
                  <TableRow key={job.id} className="align-top">
                    <TableCell>
                      <div className="font-medium">{job.address || "Address unavailable"}</div>
                      <div className="mt-1 text-xs capitalize text-muted-foreground">{(job.situation || "Service request").replaceAll("_", " ")}</div>
                      {job.finished_at ? <div className="mt-1 text-xs text-muted-foreground">{new Date(job.finished_at).toLocaleString()}</div> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[job.status] ?? "outline"}>{STATUS_LABELS[job.status] ?? job.status}</Badge>
                    </TableCell>
                    <TableCell>{job.technician_display_name || "—"}</TableCell>
                    <TableCell>
                      {job.review?.rating ? (
                        <span className="inline-flex items-center gap-1 font-medium"><Star className="size-4 text-warn" />{job.review.rating}/5</span>
                      ) : <span className="text-muted-foreground">—</span>}
                      {job.review?.comment ? <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">"{job.review.comment}"</p> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium">{centsToMoney(settlement?.customer_total_cents ?? paymentToCents(job.payments.technician))}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{money(job.payments.technician)}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-semibold text-success">{centsToMoney(settlement?.tech_payout_cents)}</div>
                      {settlement ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Service {centsToMoney(settlement.tech_service_payout_cents)} · tip {centsToMoney(settlement.tech_tip_cents)} · reimb. {centsToMoney(settlement.tech_reimbursement_cents)}
                        </div>
                      ) : <div className="mt-1 text-xs text-muted-foreground">Closeout settlement pending</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-semibold">{centsToMoney(settlement?.company_retained_cents)}</div>
                      {settlement ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Commissionable {centsToMoney(settlement.commissionable_cents)}
                        </div>
                      ) : <div className="mt-1 text-xs text-muted-foreground">—</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {settlement ? (
                        <div className="space-y-1">
                          <Badge variant={settlementBadgeVariant(settlement.agreement_status)}>{settlement.agreement_status}</Badge>
                          <div className="text-xs text-muted-foreground">{formatPercentFromBasisPoints(settlement.cut_basis_points)} tech cut</div>
                        </div>
                      ) : <Badge variant="warn">Missing settlement</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CompletedPage() {
  return <AppFrame><CompletedJobs /></AppFrame>;
}
