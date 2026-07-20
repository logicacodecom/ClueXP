"use client";

import { CalendarDays, ChevronDown, ChevronUp, Filter, RefreshCw, ShieldCheck, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Screen, TechnicianShell } from "@/components/mobile";

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

type PaymentReport = { amount: number; currency: string; method: string; reported_at: string | null } | null;

type HistoryJob = {
  id: string;
  status: string;
  address: string | null;
  situation: string | null;
  urgency?: string | null;
  created_at?: string | null;
  finished_at: string | null;
  technician_display_name?: string | null;
  review: { rating: number | null; comment: string | null } | null;
  payments: { technician: PaymentReport; customer: PaymentReport };
};

function money(p: PaymentReport): string {
  if (!p) return "—";
  return `${p.currency === "USD" ? "$" : `${p.currency} `}${p.amount.toFixed(2)} · ${METHOD_LABELS[p.method] ?? p.method}`;
}

// Status-color vocabulary shared with the rest of the app: green = confirmed,
// amber = awaiting the customer, red = cancelled/no-show, muted = auto-closed.
function statusTone(status: string): string {
  if (status === "completed_confirmed") return "border-success/40 bg-success/10 text-success";
  if (status === "completed_pending_customer") return "border-primary/40 bg-primary/10 text-primary";
  if (status === "cancelled" || status === "no_show") return "border-danger/40 bg-danger/10 text-danger";
  return "border-border bg-card text-muted";
}

export default function ActivityPage() {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/jobs/history", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/signin"); return; }
      const body = await response.json().catch(() => ([]));
      if (!response.ok) throw new Error((body as { detail?: string })?.detail || "Could not load your history");
      setJobs(Array.isArray(body) ? body : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your history");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredJobs = jobs.filter((job) => {
    if (statusFilter !== "all" && job.status !== statusFilter) return false;
    if (dateFilter === "all") return true;
    const finishedAt = job.finished_at ? new Date(job.finished_at).getTime() : 0;
    if (!finishedAt) return false;
    const days = dateFilter === "30d" ? 30 : dateFilter === "90d" ? 90 : 365;
    return finishedAt >= Date.now() - days * 24 * 60 * 60 * 1000;
  });
  const totalEarned = filteredJobs.reduce((sum, j) => sum + (j.payments.technician?.amount ?? 0), 0);
  const reviewedJobs = filteredJobs.filter((job) => job.review?.rating).length;
  const statusOptions = Array.from(new Set(jobs.map((job) => job.status))).sort();

  return (
    <TechnicianShell title="Activity">
      <Screen>
      <header className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-primary">Completed work</div>
          <h1 className="mt-1 font-condensed text-4xl font-bold uppercase leading-none">Activity</h1>
          <p className="mt-2 text-sm leading-5 text-muted">Finished jobs, collected money, and customer reviews.</p>
        </div>
        <button className="touch-target flex size-10 items-center justify-center rounded-full border border-border bg-card" onClick={() => void load()} aria-label="Refresh">
          <RefreshCw className={`size-4 ${state === "loading" ? "animate-spin" : ""}`} />
        </button>
      </header>

      {state === "ready" && jobs.length > 0 ? (
        <>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">Collected</p>
            <p className="mt-1 font-condensed text-2xl font-bold">${totalEarned.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">Jobs</p>
            <p className="mt-1 font-condensed text-2xl font-bold">{filteredJobs.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">Reviews</p>
            <p className="mt-1 font-condensed text-2xl font-bold">{reviewedJobs}</p>
          </div>
        </div>
        <div className="mt-3">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {["all", ...statusOptions].map((status) => {
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  className={`touch-target shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition ${active ? "border-primary bg-primary/12 text-primary" : "border-border bg-card text-muted"}`}
                  onClick={() => setStatusFilter(status)}
                  type="button"
                >
                  {status === "all" ? "All" : STATUS_LABELS[status] ?? status}
                </button>
              );
            })}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.1em] text-muted">
            <Filter className="size-3" />Period
            <select className="ml-auto min-h-9 rounded-md border border-border bg-card px-2 text-xs font-semibold text-foreground" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
              <option value="all">All time</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="365d">Last year</option>
            </select>
          </label>
        </div>
        </>
      ) : null}

      <div className="pt-4">
        {state === "error" ? (
          <p className="border border-danger/35 bg-danger/10 p-3 text-sm text-danger">{error}</p>
        ) : state === "loading" ? (
          <p className="py-10 text-center text-sm text-muted">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No finished jobs yet. Completed work appears here with payments and the customer’s review.</p>
        ) : filteredJobs.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5 text-center">
            <CalendarDays className="mx-auto size-8 text-muted" />
            <p className="mt-3 font-bold">No activity matches these filters</p>
            <p className="mt-2 text-sm leading-5 text-muted">Try a wider date range or another status.</p>
            <button className="touch-target mt-4 rounded-xl border border-border bg-card-strong px-4 py-2 text-sm font-bold" onClick={() => { setStatusFilter("all"); setDateFilter("all"); }}>
              Reset filters
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredJobs.map((job) => {
              const expanded = expandedJobId === job.id;
              return (
              <li key={job.id} className="border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold leading-5">{job.address || "Address unavailable"}</p>
                    <p className="mt-1 text-sm capitalize text-muted">{(job.situation || "Service request").replaceAll("_", " ")}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${statusTone(job.status)}`}>{STATUS_LABELS[job.status] ?? job.status}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted">You collected</dt>
                  <dd className="text-right font-bold">{money(job.payments.technician)}</dd>
                  <dt className="text-muted">Customer reported</dt>
                  <dd className="text-right font-bold">{money(job.payments.customer)}</dd>
                  <dt className="text-muted">Finished</dt>
                  <dd className="text-right font-bold">{job.finished_at ? new Date(job.finished_at).toLocaleDateString() : "—"}</dd>
                </dl>
                {job.review?.rating ? (
                  <div className="mt-3 flex items-center gap-1 border-t border-border pt-3 text-sm">
                    <Star className="size-4 fill-warn text-warn" />
                    <span className="font-bold">{job.review.rating}/5</span>
                    {job.review.comment ? <span className="ml-2 truncate text-muted">“{job.review.comment}”</span> : null}
                  </div>
                ) : job.status === "completed_pending_customer" ? (
                  <div className="mt-3 flex gap-2 border-t border-border pt-3 text-sm text-muted">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>Receipt confirmation is with dispatch. You are available for new jobs.</span>
                  </div>
                ) : (
                  <div className="mt-3 border-t border-border pt-3 text-sm text-muted">No customer review yet.</div>
                )}
                <button className="touch-target mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card-strong py-2 text-sm font-bold" onClick={() => setExpandedJobId(expanded ? null : job.id)}>
                  {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  {expanded ? "Hide details" : "View details"}
                </button>
                {expanded ? (
                  <div className="mt-3 rounded-xl border border-border bg-card-strong p-3 text-sm">
                    <dl className="grid grid-cols-2 gap-2">
                      <dt className="text-muted">Job ID</dt><dd className="truncate text-right font-bold">{job.id}</dd>
                      <dt className="text-muted">Urgency</dt><dd className="text-right font-bold capitalize">{(job.urgency || "—").replaceAll("_", " ")}</dd>
                      <dt className="text-muted">Created</dt><dd className="text-right font-bold">{job.created_at ? new Date(job.created_at).toLocaleString() : "—"}</dd>
                      <dt className="text-muted">Review</dt><dd className="text-right font-bold">{job.review?.rating ? `${job.review.rating}/5` : "No review yet"}</dd>
                    </dl>
                    {job.review?.comment ? <p className="mt-3 rounded-lg bg-card p-3 text-muted">“{job.review.comment}”</p> : null}
                  </div>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </div>
      </Screen>
    </TechnicianShell>
  );
}
