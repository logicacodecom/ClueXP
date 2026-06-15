"use client";

import { ArrowLeft, RefreshCw, Star } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const METHOD_LABELS: Record<string, string> = {
  credit_card: "Credit card", debit_card: "Debit card", cash: "Cash", check: "Check",
  zelle: "Zelle", cash_app: "Cash App", apple_pay: "Apple Pay", google_pay: "Google Pay",
  venmo: "Venmo", paypal: "PayPal", other: "Other"
};

const STATUS_LABELS: Record<string, string> = {
  completed_confirmed: "Confirmed", completed_auto_closed: "Auto-closed",
  cancelled: "Cancelled", no_show: "No-show"
};

type PaymentReport = { amount: number; currency: string; method: string; reported_at: string | null } | null;

type HistoryJob = {
  id: string;
  status: string;
  address: string | null;
  situation: string | null;
  finished_at: string | null;
  review: { rating: number | null; comment: string | null } | null;
  payments: { technician: PaymentReport; customer: PaymentReport };
};

function money(p: PaymentReport): string {
  if (!p) return "—";
  return `${p.currency === "USD" ? "$" : `${p.currency} `}${p.amount.toFixed(2)} · ${METHOD_LABELS[p.method] ?? p.method}`;
}

export default function ActivityPage() {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="min-h-full bg-background pb-28">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4">
        <div className="flex items-center gap-3">
          <Link href="/jobs" className="touch-target flex size-10 items-center justify-center rounded-full border border-border bg-card" aria-label="Back">
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="font-condensed text-2xl font-bold uppercase">Job history</h1>
        </div>
        <button className="touch-target flex size-10 items-center justify-center rounded-full border border-border bg-card" onClick={() => void load()} aria-label="Refresh">
          <RefreshCw className={`size-4 ${state === "loading" ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="px-4 pt-4">
        {state === "error" ? (
          <p className="border border-danger/35 bg-danger/10 p-3 text-sm text-danger">{error}</p>
        ) : state === "loading" ? (
          <p className="py-10 text-center text-sm text-muted">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No finished jobs yet. Completed work appears here with payments and the customer’s review.</p>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.id} className="border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black leading-5">{job.address || "Address unavailable"}</p>
                    <p className="mt-1 text-sm capitalize text-muted">{(job.situation || "Service request").replaceAll("_", " ")}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-border px-2 py-1 text-[10px] font-black uppercase text-muted">{STATUS_LABELS[job.status] ?? job.status}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted">You collected</dt>
                  <dd className="text-right font-bold">{money(job.payments.technician)}</dd>
                  <dt className="text-muted">Customer paid</dt>
                  <dd className="text-right font-bold">{money(job.payments.customer)}</dd>
                </dl>
                {job.review?.rating ? (
                  <div className="mt-3 flex items-center gap-1 border-t border-border pt-3 text-sm">
                    <Star className="size-4 fill-warn text-warn" />
                    <span className="font-black">{job.review.rating}/5</span>
                    {job.review.comment ? <span className="ml-2 truncate text-muted">“{job.review.comment}”</span> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
