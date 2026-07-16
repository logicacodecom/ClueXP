"use client";

import { AlertTriangle, BriefcaseBusiness, CheckCircle2, Clock, RefreshCw, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pill, Screen, TechnicianShell } from "@/components/mobile";

type SettlementRow = {
  job_id: string;
  status: string;
  finished_at?: string | null;
  skill_code?: string | null;
  agreement_status: string;
  cut_basis_points: number;
  currency: string;
  customer_total_cents: number;
  tip_cents: number;
  commissionable_cents: number;
  tech_reimbursement_cents: number;
  tech_service_payout_cents: number;
  tech_tip_cents: number;
  tech_payout_cents: number;
  organization_id?: string | null;
};

type PeriodRow = {
  settlement_period_id: string;
  status: "draft" | "locked" | "paid" | string;
  label: string;
  period_start?: string | null;
  period_end?: string | null;
  locked_at?: string | null;
  paid_at?: string | null;
  row: SettlementRow;
};

type SettlementPayload = {
  live: SettlementRow[];
  period_rows: PeriodRow[];
};

function money(cents: number | null | undefined, currency = "USD") {
  const amount = ((cents ?? 0) / 100).toFixed(2);
  return currency === "USD" ? `$${amount}` : `${currency} ${amount}`;
}

function percent(bps: number | null | undefined) {
  return `${((bps ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}%`;
}

function date(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

function statusTone(status: string): "success" | "warn" | "muted" {
  if (status === "paid") return "success";
  if (status === "locked") return "warn";
  return "muted";
}

export default function EarningsPage() {
  const [payload, setPayload] = useState<SettlementPayload>({ live: [], period_rows: [] });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const response = await fetch("/api/settlements", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/signin"); return; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { detail?: string })?.detail || "Could not load earnings");
      setPayload({
        live: Array.isArray(body.live) ? body.live : [],
        period_rows: Array.isArray(body.period_rows) ? body.period_rows : []
      });
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load earnings");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const liveEstimate = payload.live.reduce((sum, row) => sum + (row.tech_payout_cents ?? 0), 0);
    const locked = payload.period_rows
      .filter((row) => row.status === "locked")
      .reduce((sum, row) => sum + (row.row.tech_payout_cents ?? 0), 0);
    const paid = payload.period_rows
      .filter((row) => row.status === "paid")
      .reduce((sum, row) => sum + (row.row.tech_payout_cents ?? 0), 0);
    return { liveEstimate, locked, paid };
  }, [payload]);

  return (
    <TechnicianShell title="Earnings">
      <Screen>
        <header className="border-b border-border pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[.12em] text-primary">Settlements</div>
              <h1 className="mt-1 font-condensed text-4xl font-bold uppercase leading-none">Earnings</h1>
              <p className="mt-2 text-sm leading-5 text-muted">
                Your provider-calculated payout rows. Paid means your company marked external payment complete.
              </p>
            </div>
            <button className="touch-target flex size-10 items-center justify-center rounded-full border border-border bg-card" onClick={() => void load()} aria-label="Refresh earnings">
              <RefreshCw className={`size-4 ${state === "loading" ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {state === "error" ? (
          <div className="mt-4 border border-danger/35 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-[18px] border border-border bg-card p-3">
            <p className="text-[10px] font-black uppercase tracking-[.1em] text-muted">Estimate</p>
            <p className="mt-1 font-condensed text-2xl font-bold">{money(stats.liveEstimate)}</p>
          </div>
          <div className="rounded-[18px] border border-primary/35 bg-primary/12 p-3">
            <p className="text-[10px] font-black uppercase tracking-[.1em] text-primary">Locked</p>
            <p className="mt-1 font-condensed text-2xl font-bold">{money(stats.locked)}</p>
          </div>
          <div className="rounded-[18px] border border-success/30 bg-success/10 p-3">
            <p className="text-[10px] font-black uppercase tracking-[.1em] text-success">Paid</p>
            <p className="mt-1 font-condensed text-2xl font-bold">{money(stats.paid)}</p>
          </div>
        </div>

        <section className="mt-4 rounded-[22px] border border-border bg-card p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-black leading-tight">Approved settlement periods</h2>
              <p className="mt-1 text-sm leading-5 text-muted">Locked and paid rows are saved snapshots; later agreement edits do not change them.</p>
            </div>
            <Pill tone="muted" icon={WalletCards}>{payload.period_rows.length}</Pill>
          </div>
          {state === "loading" ? (
            <p className="py-6 text-center text-sm text-muted">Loading earnings…</p>
          ) : payload.period_rows.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card-strong p-4 text-sm text-muted">
              No settlement periods yet. Your company must create and lock a settlement period before rows appear here.
            </div>
          ) : (
            <ul className="space-y-3">
              {payload.period_rows.map((item) => (
                <li className="rounded-2xl border border-border bg-card-strong p-3" key={`${item.settlement_period_id}-${item.row.job_id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">{item.label}</p>
                      <p className="mt-1 text-xs text-muted">
                        {date(item.period_start)} – {date(item.period_end)} · job {item.row.job_id.slice(0, 8)}
                      </p>
                    </div>
                    <Pill tone={statusTone(item.status)} icon={item.status === "paid" ? CheckCircle2 : Clock}>{item.status}</Pill>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-muted">Payout</dt><dd className="text-right font-black">{money(item.row.tech_payout_cents, item.row.currency)}</dd>
                    <dt className="text-muted">Service cut</dt><dd className="text-right font-black">{percent(item.row.cut_basis_points)}</dd>
                    <dt className="text-muted">Reimbursement</dt><dd className="text-right font-black">{money(item.row.tech_reimbursement_cents, item.row.currency)}</dd>
                    <dt className="text-muted">Tip share</dt><dd className="text-right font-black">{money(item.row.tech_tip_cents, item.row.currency)}</dd>
                  </dl>
                  {item.status === "paid" ? (
                    <p className="mt-3 rounded-xl border border-success/25 bg-success/10 p-2 text-xs font-bold text-success">Marked paid by provider on {date(item.paid_at)}.</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-4 rounded-[22px] border border-border bg-card p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-black leading-tight">Current payout estimates</h2>
              <p className="mt-1 text-sm leading-5 text-muted">Calculated from completed closeouts and the current company agreement.</p>
            </div>
            <Pill tone="warn" icon={AlertTriangle}>Estimate</Pill>
          </div>
          {payload.live.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card-strong p-4 text-sm text-muted">
              No calculated settlement rows yet. Completed itemized closeouts appear here before provider approval.
            </div>
          ) : (
            <ul className="space-y-3">
              {payload.live.map((row) => (
                <li className="rounded-2xl border border-border bg-card-strong p-3" key={row.job_id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black">{row.skill_code?.replaceAll("_", " ") ?? "Service job"}</p>
                      <p className="mt-1 text-xs text-muted">Finished {date(row.finished_at)} · agreement {row.agreement_status}</p>
                    </div>
                    <BriefcaseBusiness className="size-5 shrink-0 text-primary" />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-muted">Estimated payout</dt><dd className="text-right font-black">{money(row.tech_payout_cents, row.currency)}</dd>
                    <dt className="text-muted">Commissionable</dt><dd className="text-right font-black">{money(row.commissionable_cents, row.currency)}</dd>
                    <dt className="text-muted">Service cut</dt><dd className="text-right font-black">{percent(row.cut_basis_points)}</dd>
                    <dt className="text-muted">Tech items</dt><dd className="text-right font-black">{money(row.tech_reimbursement_cents, row.currency)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Screen>
    </TechnicianShell>
  );
}
