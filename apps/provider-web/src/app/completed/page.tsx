"use client";

import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../frame";

const METHOD_LABELS: Record<string, string> = {
  credit_card: "Credit card", debit_card: "Debit card", cash: "Cash", check: "Check",
  zelle: "Zelle", cash_app: "Cash App", apple_pay: "Apple Pay", google_pay: "Google Pay",
  venmo: "Venmo", paypal: "PayPal", other: "Other"
};

const STATUS_LABELS: Record<string, string> = {
  completed_confirmed: "Confirmed", completed_auto_closed: "Auto-closed",
  cancelled: "Cancelled", no_show: "No-show"
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

function money(p: PaymentReport): string {
  if (!p) return "—";
  return `${p.currency === "USD" ? "$" : `${p.currency} `}${p.amount.toFixed(2)} · ${METHOD_LABELS[p.method] ?? p.method}`;
}

// A mismatch worth a dispatcher's eye: both sides reported but amounts differ.
function mismatch(job: HistoryJob): boolean {
  const t = job.payments.technician;
  const c = job.payments.customer;
  return Boolean(t && c && Math.abs(t.amount - c.amount) > 0.005);
}

function CompletedJobs() {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/provider/jobs/history", { cache: "no-store" });
      const body = await response.json().catch(() => ([]));
      if (!response.ok) throw new Error((body as { detail?: string })?.detail || "Could not load completed jobs");
      setJobs(Array.isArray(body) ? body : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load completed jobs");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalCollected = jobs.reduce((sum, j) => sum + (j.payments.technician?.amount ?? 0), 0);
  const totalCustomerPaid = jobs.reduce((sum, j) => sum + (j.payments.customer?.amount ?? 0), 0);

  return (
    <section className="p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-condensed text-3xl font-bold uppercase">Completed jobs</h1>
          <p className="mt-1 text-sm text-muted">Finished work with the customer review and reported payments — what the technician collected and what the customer paid.</p>
        </div>
        <button className="rounded-md border border-border bg-card px-3 py-2 text-sm font-bold" onClick={() => void load()}>
          {state === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {state === "ready" && jobs.length > 0 ? (
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="border border-border bg-card p-4">
            <p className="text-[11px] font-black uppercase tracking-wide text-muted">Completed jobs</p>
            <p className="mt-1 font-condensed text-3xl font-bold">{jobs.length}</p>
          </div>
          <div className="border border-border bg-card p-4">
            <p className="text-[11px] font-black uppercase tracking-wide text-muted">Earned (tech collected)</p>
            <p className="mt-1 font-condensed text-3xl font-bold">${totalCollected.toFixed(2)}</p>
          </div>
          <div className="border border-border bg-card p-4">
            <p className="text-[11px] font-black uppercase tracking-wide text-muted">Customer reported</p>
            <p className="mt-1 font-condensed text-3xl font-bold">${totalCustomerPaid.toFixed(2)}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto border border-border">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left text-[11px] font-black uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Job</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Technician</th>
              <th className="px-3 py-2">Review</th>
              <th className="px-3 py-2">Tech collected</th>
              <th className="px-3 py-2">Customer paid</th>
            </tr>
          </thead>
          <tbody>
            {state === "error" ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-danger">{error}</td></tr>
            ) : state === "loading" ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">Loading…</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">No completed jobs yet.</td></tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.id} className="border-b border-border align-top">
                  <td className="px-3 py-3">
                    <p className="font-bold">{job.address || "Address unavailable"}</p>
                    <p className="text-xs capitalize text-muted">{(job.situation || "Service request").replaceAll("_", " ")}</p>
                  </td>
                  <td className="px-3 py-3">{STATUS_LABELS[job.status] ?? job.status}</td>
                  <td className="px-3 py-3">{job.technician_display_name || "—"}</td>
                  <td className="px-3 py-3">
                    {job.review?.rating ? (
                      <span className="font-bold">{job.review.rating}/5</span>
                    ) : <span className="text-muted">—</span>}
                    {job.review?.comment ? <p className="max-w-[180px] truncate text-xs text-muted">“{job.review.comment}”</p> : null}
                  </td>
                  <td className="px-3 py-3 font-medium">{money(job.payments.technician)}</td>
                  <td className="px-3 py-3 font-medium">
                    {money(job.payments.customer)}
                    {mismatch(job) ? (
                      <span className="ml-2 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] font-black uppercase text-warn">Mismatch</span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function CompletedPage() {
  return <AppFrame><CompletedJobs /></AppFrame>;
}
