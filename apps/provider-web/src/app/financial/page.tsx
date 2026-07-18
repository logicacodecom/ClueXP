"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard
} from "@cluexp/console-ui";
import { AlertTriangle, ArrowRight, Layers, Receipt, RefreshCw, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";
import { HorizontalBarList, MonthlyBars, StackedHorizontalBar, type BarRow, type StackedRow } from "./charts";
import { LogPaymentModal } from "./technicians/payment-modal";
import { buildPeriodQuery, formatDate, money, type PayableTechnician, type PaymentBalance } from "./technicians/shared";

interface FinancialOverview {
  generated_at: string;
  period: { start: string | null; end: string | null; undated_job_count: number };
  period_metrics: {
    job_count: number;
    customer_collected_cents: number;
    tech_payout_cents: number;
    tech_reimbursement_cents: number;
    company_retained_cents: number;
    average_job_cents: number;
  };
  position: {
    owed_to_technicians_cents: number;
    owed_by_technicians_cents: number;
    pending_confirmation_cents: number;
    pending_confirmation_count: number;
  };
  attention: {
    pending_payments_count: number;
    settlement_activity_missing_agreement_count: number;
    locked_settlement_runs_count: number;
  };
  monthly_trend: Array<{ month: string; customer_collected_cents: number; tech_payout_cents: number; company_retained_cents: number }>;
  job_types: Array<{ skill_code: string; label: string; job_count: number; customer_collected_cents: number; tech_payout_cents: number; company_retained_cents: number }>;
  customer_payment_methods: Array<{ payment_method: string; job_count: number; customer_collected_cents: number; company_retained_cents: number; card_fee_cents: number; collected_by_technician: boolean }>;
  technician_collection: Array<{
    technician_id: string; technician_display_name: string | null;
    company_collected_cents: number; technician_collected_cents: number;
    outstanding_company_to_tech_cents: number; outstanding_tech_to_company_cents: number;
    pending_confirmation_cents: number;
  }>;
  revenue_composition: {
    commissionable_labor_cents: number; company_provided_items_cents: number;
    technician_provided_reimbursables_cents: number; tax_cents: number;
    tip_cents: number; card_fee_cents: number; other_non_commissionable_cents: number;
  };
  top_reimbursable_item_types: Array<{ item_type_code: string; label: string; amount_cents: number }>;
  top_balances: Array<{
    technician_id: string; technician_display_name: string | null;
    affiliation_ended: boolean; affiliation_ended_at: string | null;
    balance: PaymentBalance;
  }>;
}

interface SettlementRunSummary {
  id: string;
  status: "draft" | "locked" | "paid" | "void";
  label: string;
}

type FetchState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** A panel that failed to load: explicit, retryable, and never a fabricated
 * $0.00 standing in for "we don't know." */
function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
      <span>Unable to load this data: {message}</span>
      <Button onClick={onRetry} size="sm" variant="outline"><RefreshCw className="size-4" />Retry</Button>
    </div>
  );
}

const DESTINATIONS = [
  { href: "/financial/technicians", label: "Technician report", description: "Per-technician totals, reviews, and outstanding balance", icon: Users },
  { href: "/financial/jobs", label: "Job report", description: "Every settled job, one row each, with drill-down", icon: Receipt },
  { href: "/financial/payments", label: "Payment ledger", description: "Every logged payment, pending confirmations, void history", icon: Wallet },
  { href: "/financial/settlements", label: "Settlement runs", description: "Optional payroll-batch snapshots and approval workflow", icon: Layers },
] as const;

export default function FinancialOverviewPage() {
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [applied, setApplied] = useState({ start: "", end: "" });
  const [overview, setOverview] = useState<FetchState<FinancialOverview>>({ status: "loading" });
  const [runs, setRuns] = useState<FetchState<SettlementRunSummary[]>>({ status: "loading" });
  const [payTechnicianId, setPayTechnicianId] = useState<string | null>(null);

  const loadOverview = useCallback(async (start: string, end: string) => {
    setOverview({ status: "loading" });
    try {
      const response = await fetch(`/api/provider/financial-overview${buildPeriodQuery(start, end)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load the financial overview");
      setOverview({ status: "ready", data: body as FinancialOverview });
    } catch (cause) {
      setOverview({ status: "error", message: cause instanceof Error ? cause.message : "Unable to load the financial overview" });
    }
  }, []);

  // Settlement-run status loads independently of the main overview: if the
  // overview call fails, "N runs locked" can still surface from this feed.
  const loadRuns = useCallback(async () => {
    setRuns({ status: "loading" });
    try {
      const response = await fetch("/api/provider/settlement-periods", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load settlement runs");
      setRuns({ status: "ready", data: Array.isArray(body) ? body : [] });
    } catch (cause) {
      setRuns({ status: "error", message: cause instanceof Error ? cause.message : "Unable to load settlement runs" });
    }
  }, []);

  useEffect(() => { void loadOverview(applied.start, applied.end); }, [loadOverview, applied]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const refreshAll = useCallback(() => {
    void loadOverview(applied.start, applied.end);
    void loadRuns();
  }, [loadOverview, loadRuns, applied]);

  const data = overview.status === "ready" ? overview.data : null;

  // The overview aggregate is uncapped; the separately-loaded run list is
  // capped at 50 (list_provider_settlement_periods' default limit). Prefer
  // the uncapped count whenever the overview loaded, and only fall back to
  // the run list when the overview itself is unavailable -- never let the
  // capped list override the real count.
  const lockedRunsCount = useMemo(() => {
    if (data) return data.attention.locked_settlement_runs_count;
    if (runs.status === "ready") return runs.data.filter((r) => r.status === "locked").length;
    return null; // neither source available -- don't fabricate a count
  }, [runs, data]);

  const attentionItems = useMemo(() => {
    const items: Array<{ key: string; text: string; href: string }> = [];
    if (data && data.attention.pending_payments_count > 0) {
      items.push({
        key: "pending",
        text: `${data.attention.pending_payments_count} technician-submitted payment${data.attention.pending_payments_count === 1 ? "" : "s"} pending confirmation`,
        href: "/financial/payments",
      });
    }
    if (data && data.attention.settlement_activity_missing_agreement_count > 0) {
      items.push({
        key: "missing-agreement",
        text: `${data.attention.settlement_activity_missing_agreement_count} technician${data.attention.settlement_activity_missing_agreement_count === 1 ? "" : "s"} with settlement activity with no agreement`,
        href: "/financial/technicians",
      });
    }
    if (lockedRunsCount !== null && lockedRunsCount > 0) {
      items.push({
        key: "locked-runs",
        text: `${lockedRunsCount} settlement run${lockedRunsCount === 1 ? "" : "s"} locked, awaiting external payment and reconciliation`,
        href: "/financial/settlements",
      });
    }
    return items;
  }, [data, lockedRunsCount]);

  const payableTechnicians: PayableTechnician[] = useMemo(
    () => data?.top_balances.map((b) => ({
      technician_id: b.technician_id,
      technician_display_name: b.technician_display_name,
      affiliation_ended: b.affiliation_ended,
      affiliation_ended_at: b.affiliation_ended_at,
      balance: b.balance,
    })) ?? [],
    [data]
  );

  const jobTypeRows: BarRow[] = useMemo(() => (data?.job_types ?? []).map((jt) => ({
    key: jt.skill_code,
    label: jt.label,
    value: jt.customer_collected_cents,
    formattedValue: money(jt.customer_collected_cents),
    secondaryText: `${jt.job_count} job${jt.job_count === 1 ? "" : "s"} · tech payout ${money(jt.tech_payout_cents)} · company retained ${money(jt.company_retained_cents)}`,
  })), [data]);

  const methodRows: BarRow[] = useMemo(() => (data?.customer_payment_methods ?? []).map((m) => ({
    key: m.payment_method,
    label: m.payment_method.replace(/_/g, " "),
    value: m.customer_collected_cents,
    formattedValue: money(m.customer_collected_cents),
    // primary and warn render as near-identical amber in this theme's tokens
    // (#ffbf00 vs #f5b53d) -- info (blue) actually contrasts against warn.
    color: m.collected_by_technician ? "warn" : "info",
    secondaryText: `${m.job_count} job${m.job_count === 1 ? "" : "s"} · company retained ${money(m.company_retained_cents)}${m.card_fee_cents ? ` · card fee ${money(m.card_fee_cents)}` : ""} · ${m.collected_by_technician ? "collected directly by technicians" : "collected by the company"}`,
  })), [data]);

  const collectionRows: StackedRow[] = useMemo(() => (data?.technician_collection ?? []).map((t) => {
    // Direction stated as plain text, not left to bar color alone. Only
    // non-zero statements render, so a settled technician shows nothing here.
    const context: string[] = [];
    if (t.outstanding_company_to_tech_cents > 0) context.push(`Company owes technician ${money(t.outstanding_company_to_tech_cents)}`);
    if (t.outstanding_tech_to_company_cents > 0) context.push(`Technician owes company ${money(t.outstanding_tech_to_company_cents)}`);
    if (t.pending_confirmation_cents > 0) context.push(`Pending confirmation ${money(t.pending_confirmation_cents)}`);
    return {
      key: t.technician_id,
      href: `/financial/technicians/${t.technician_id}`,
      label: t.technician_display_name ?? t.technician_id.slice(0, 8),
      segments: [
        { name: "Collected by company (card)", value: t.company_collected_cents, formattedValue: money(t.company_collected_cents), color: "info" as const },
        { name: "Collected by technician (cash-like)", value: t.technician_collected_cents, formattedValue: money(t.technician_collected_cents), color: "warn" as const },
      ],
      footerText: context.length > 0 ? context.join(" · ") : null,
    };
  }), [data]);

  const reimbursableRows: BarRow[] = useMemo(() => (data?.top_reimbursable_item_types ?? []).map((item) => ({
    key: item.item_type_code,
    label: item.label,
    value: item.amount_cents,
    formattedValue: money(item.amount_cents),
    color: "info",
  })), [data]);

  const trendMonths = data?.monthly_trend.map((m) => m.month) ?? [];

  return (
    <AppFrame>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 text-xs font-semibold uppercase text-primary/90">Finance</div>
            <h1 className="font-condensed text-3xl font-bold uppercase tracking-normal text-foreground md:text-4xl">Financial overview</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Operational settlement and payment position. These figures are company records, not a processor or bank balance.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Performance and insights use the selected period below. Outstanding balances and payment attention are all time.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
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
            <Button variant="outline" onClick={refreshAll}><RefreshCw className="size-4" />Refresh</Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {data ? `Last updated ${formatDateTime(data.generated_at)}` : overview.status === "loading" ? "Loading…" : "Last update unavailable"}
            </span>
          </CardContent>
        </Card>

        {/* Financial position: the dominant element. Never netted across the two directions. */}
        {overview.status === "error" ? (
          <PanelError message={overview.message} onRetry={() => void loadOverview(applied.start, applied.end)} />
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              icon={ArrowRight}
              intent="success"
              label="Owed to technicians (all time)"
              value={data ? money(data.position.owed_to_technicians_cents) : "…"}
            />
            <StatCard
              icon={ArrowRight}
              intent="danger"
              label="Owed by technicians (all time)"
              value={data ? money(data.position.owed_by_technicians_cents) : "…"}
            />
            <StatCard
              icon={AlertTriangle}
              intent={data && data.position.pending_confirmation_count > 0 ? "warn" : "neutral"}
              label="Pending confirmation (all time)"
              value={data ? `${money(data.position.pending_confirmation_cents)} · ${data.position.pending_confirmation_count}` : "…"}
            />
          </div>
        )}

        {/* Needs attention: only rendered when there's something to act on. */}
        {attentionItems.length > 0 ? (
          <Card className="border-warn/40">
            <CardHeader><CardTitle>Needs attention</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {attentionItems.map((item) => (
                  <li key={item.key}>
                    <a className="flex items-center justify-between gap-3 rounded-md p-2 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" href={item.href}>
                      <span className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0 text-warn" />{item.text}</span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {/* Period performance */}
        {overview.status !== "error" ? (
          <Card>
            <CardHeader><CardTitle>Period performance</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                <StatCard label="Jobs" value={data ? String(data.period_metrics.job_count) : "…"} />
                <StatCard label="Collected" value={data ? money(data.period_metrics.customer_collected_cents) : "…"} />
                <StatCard label="Tech payouts" value={data ? money(data.period_metrics.tech_payout_cents) : "…"} />
                <StatCard label="Tech reimbursements" value={data ? money(data.period_metrics.tech_reimbursement_cents) : "…"} />
                <StatCard label="Company retained" value={data ? money(data.period_metrics.company_retained_cents) : "…"} />
                <StatCard label="Average job value" value={data ? money(data.period_metrics.average_job_cents) : "…"} />
              </div>
              {data && data.period.undated_job_count > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {data.period.undated_job_count} job{data.period.undated_job_count === 1 ? "" : "s"} in these totals {data.period.undated_job_count === 1 ? "has" : "have"} no recorded finish date, so {data.period.undated_job_count === 1 ? "it isn't" : "they aren't"} shown in the monthly trend below.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Monthly trend */}
        {overview.status !== "error" ? (
          <Card>
            <CardHeader><CardTitle>Monthly financial trend</CardTitle></CardHeader>
            <CardContent>
              {data ? (
                <MonthlyBars
                  ariaLabel="Monthly customer collected, technician payouts, and company retained"
                  months={trendMonths}
                  series={[
                    { name: "Collected", color: "primary", values: data.monthly_trend.map((m) => m.customer_collected_cents), formattedValues: data.monthly_trend.map((m) => money(m.customer_collected_cents)) },
                    { name: "Tech payouts", color: "info", values: data.monthly_trend.map((m) => m.tech_payout_cents), formattedValues: data.monthly_trend.map((m) => money(m.tech_payout_cents)) },
                    { name: "Company retained", color: "success", values: data.monthly_trend.map((m) => m.company_retained_cents), formattedValues: data.monthly_trend.map((m) => money(m.company_retained_cents)) },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Loading trend…</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Insights */}
        {overview.status !== "error" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Revenue by job type</CardTitle></CardHeader>
              <CardContent>
                <HorizontalBarList ariaLabel="Customer collected by job type" rows={jobTypeRows} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Customer payment methods</CardTitle></CardHeader>
              <CardContent>
                <HorizontalBarList ariaLabel="Customer collected by payment method" rows={methodRows} />
                {methodRows.some((r) => r.color === "warn") ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Amber bars are methods this system's rules treat as collected directly by technicians (cash and peer-to-peer transfers), not the company's own settlement payment rails.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Collection by technician</CardTitle></CardHeader>
              <CardContent>
                <StackedHorizontalBar ariaLabel="Company-collected vs technician-collected customer totals by technician" rows={collectionRows} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Parts and revenue composition</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {data ? (
                  <>
                    <StackedHorizontalBar
                      ariaLabel="Revenue composition"
                      rows={[{
                        key: "composition",
                        label: "Customer collected, by category",
                        segments: [
                          // primary/warn render as near-identical amber in this theme, so the
                          // two categories most likely to both be large (labor, parts) get
                          // genuinely distinct hues; the two small residual categories share
                          // "muted" since only one of them is ever visually dominant.
                          { name: "Commissionable labor", value: data.revenue_composition.commissionable_labor_cents, formattedValue: money(data.revenue_composition.commissionable_labor_cents), color: "primary" },
                          { name: "Company-provided items", value: data.revenue_composition.company_provided_items_cents, formattedValue: money(data.revenue_composition.company_provided_items_cents), color: "info" },
                          { name: "Technician-provided reimbursables", value: data.revenue_composition.technician_provided_reimbursables_cents, formattedValue: money(data.revenue_composition.technician_provided_reimbursables_cents), color: "success" },
                          { name: "Tax", value: data.revenue_composition.tax_cents, formattedValue: money(data.revenue_composition.tax_cents), color: "muted" },
                          { name: "Tips", value: data.revenue_composition.tip_cents, formattedValue: money(data.revenue_composition.tip_cents), color: "warn" },
                          { name: "Card fees", value: data.revenue_composition.card_fee_cents, formattedValue: money(data.revenue_composition.card_fee_cents), color: "danger" },
                          { name: "Other non-commissionable", value: data.revenue_composition.other_non_commissionable_cents, formattedValue: money(data.revenue_composition.other_non_commissionable_cents), color: "muted" },
                        ],
                      }]}
                    />
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Top reimbursable item types</div>
                      <p className="mb-2 text-xs text-muted-foreground">Reimbursable line items a technician was owed back for — not all of these are physical parts.</p>
                      <HorizontalBarList ariaLabel="Top reimbursable item types by amount" rows={reimbursableRows} emptyText="No reimbursable items in this period." />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Top outstanding balances */}
        {overview.status !== "error" ? (
          <Card>
            <CardHeader><CardTitle>Top outstanding balances</CardTitle></CardHeader>
            <CardContent>
              {data && data.top_balances.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every technician balance is settled — $0.00 outstanding.</p>
              ) : (
                <div className="space-y-3">
                  {(data?.top_balances ?? []).map((b) => (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3" key={b.technician_id}>
                      <a className="min-w-0 flex-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" href={`/financial/technicians/${b.technician_id}`}>
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          {b.technician_display_name ?? b.technician_id.slice(0, 8)}
                          {b.affiliation_ended ? <Badge variant="danger">Not active{b.affiliation_ended_at ? ` (ended ${formatDate(b.affiliation_ended_at)})` : ""}</Badge> : null}
                        </div>
                        <div className={`text-sm font-semibold ${b.balance.net_outstanding_cents < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {money(b.balance.net_outstanding_cents)}
                          {b.balance.pending_tech_to_company_cents > 0 ? <span className="ml-2 text-xs font-normal text-muted-foreground">{money(b.balance.pending_tech_to_company_cents)} pending confirmation</span> : null}
                        </div>
                      </a>
                      <Button onClick={() => setPayTechnicianId(b.technician_id)} size="sm" variant="outline"><Wallet className="size-4" />Log payment</Button>
                    </div>
                  ))}
                  {!data && overview.status === "loading" ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Destinations */}
        <Card>
          <CardHeader><CardTitle>Go deeper</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {DESTINATIONS.map((dest) => (
                <a
                  className="flex items-center gap-3 rounded-md border border-border p-3 transition hover:border-primary/50 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  href={dest.href}
                  key={dest.href}
                >
                  <dest.icon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-medium">{dest.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{dest.description}</div>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <LogPaymentModal
          open={payTechnicianId !== null}
          onOpenChange={(open) => { if (!open) setPayTechnicianId(null); }}
          technicians={payableTechnicians}
          preselectedTechnicianId={payTechnicianId}
          sourcePeriod={applied}
          onLogged={refreshAll}
        />
      </div>
    </AppFrame>
  );
}
