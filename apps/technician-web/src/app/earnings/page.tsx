"use client";

import { AlertTriangle, BriefcaseBusiness, CheckCircle2, Clock, RefreshCw, Send, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pill, Screen, TechnicianShell } from "@/components/mobile";

const PAYMENT_METHODS = [
  "cash", "check", "zelle", "cash_app", "venmo", "paypal",
  "bank_transfer", "other",
] as const;

type TechPayment = {
  id: string;
  organization_id: string;
  organization_name?: string | null;
  direction: "company_to_technician" | "technician_to_company";
  amount_cents: number;
  payment_method: string;
  reference_number?: string | null;
  paid_on: string;
  note?: string | null;
  status: "pending" | "confirmed" | "rejected" | "voided";
  submitted_by_role: "provider" | "technician";
  rejected_reason?: string | null;
  void_reason?: string | null;
};

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
  const [payments, setPayments] = useState<TechPayment[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ organization_id: "", amount: "", method: "cash", paid_on: "", reference: "", note: "" });
  const [formBusy, setFormBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [response, paymentsResponse] = await Promise.all([
        fetch("/api/settlements", { cache: "no-store" }),
        fetch("/api/payments", { cache: "no-store" }),
      ]);
      if (response.status === 401 || paymentsResponse.status === 401) { window.location.assign("/signin"); return; }
      const body = await response.json().catch(() => ({}));
      const paymentsBody = await paymentsResponse.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { detail?: string })?.detail || "Could not load earnings");
      if (!paymentsResponse.ok) throw new Error((paymentsBody as { detail?: string })?.detail || "Could not load payments");
      setPayload({
        live: Array.isArray(body.live) ? body.live : [],
        period_rows: Array.isArray(body.period_rows) ? body.period_rows : []
      });
      setPayments(Array.isArray(paymentsBody) ? paymentsBody : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load earnings");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Companies the technician can register a remittance against: anywhere they
  // have settlement rows or existing payments.
  const companies = useMemo(() => {
    const byId = new Map<string, string | null>();
    for (const row of payload.live) {
      if (row.organization_id) byId.set(row.organization_id, null);
    }
    for (const payment of payments) {
      byId.set(payment.organization_id, payment.organization_name ?? byId.get(payment.organization_id) ?? null);
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [payload.live, payments]);

  useEffect(() => {
    if (!form.organization_id && companies.length > 0) {
      setForm((f) => ({ ...f, organization_id: companies[0].id }));
    }
  }, [companies, form.organization_id]);

  const registerPayment = useCallback(async () => {
    setFormMessage(null);
    const amountCents = Math.round(Number.parseFloat(form.amount || "0") * 100);
    setFormBusy(true);
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: form.organization_id,
          amount_cents: amountCents,
          payment_method: form.method,
          paid_on: form.paid_on || undefined,
          reference_number: form.reference || undefined,
          note: form.note || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { detail?: string })?.detail || "Could not register payment");
      setForm((f) => ({ ...f, amount: "", reference: "", note: "" }));
      setFormMessage("Submitted. Your company will confirm it.");
      await load();
    } catch (cause) {
      setFormMessage(cause instanceof Error ? cause.message : "Could not register payment");
    } finally {
      setFormBusy(false);
    }
  }, [form, load]);

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
              <h2 className="text-base font-black leading-tight">Payments</h2>
              <p className="mt-1 text-sm leading-5 text-muted">
                Money moved between you and your company. Payments you register stay pending until the company confirms them.
              </p>
            </div>
            <Pill tone="muted" icon={Send}>{payments.length}</Pill>
          </div>

          <div className="rounded-2xl border border-border bg-card-strong p-3">
            <p className="text-[11px] font-black uppercase tracking-[.1em] text-muted">Register a payment you made to the company</p>
            {formMessage ? <p className="mt-2 rounded-xl border border-border bg-card p-2 text-xs font-bold">{formMessage}</p> : null}
            <div className="mt-3 space-y-2">
              {companies.length > 1 ? (
                <select className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" value={form.organization_id} onChange={(e) => setForm((f) => ({ ...f, organization_id: e.target.value }))}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name ?? `Company ${c.id.slice(0, 8)}`}</option>
                  ))}
                </select>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <input className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" inputMode="decimal" placeholder="Amount $" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <input className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" type="date" value={form.paid_on} onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
                </select>
                <input className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" placeholder="Reference (optional)" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
              </div>
              <input className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              <button
                className="touch-target w-full rounded-xl bg-primary px-4 py-2 text-sm font-black uppercase text-primary-foreground disabled:opacity-50"
                disabled={formBusy || !form.organization_id || !form.amount}
                onClick={() => void registerPayment()}
                type="button"
              >
                Submit for confirmation
              </button>
            </div>
          </div>

          {payments.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {payments.map((payment) => (
                <li className="rounded-2xl border border-border bg-card-strong p-3" key={payment.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black">
                        {payment.direction === "company_to_technician" ? "Company paid you" : "You paid the company"} · {money(payment.amount_cents)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {date(payment.paid_on)} · {payment.payment_method.replace(/_/g, " ")}
                        {payment.reference_number ? ` · ref ${payment.reference_number}` : ""}
                        {payment.organization_name ? ` · ${payment.organization_name}` : ""}
                      </p>
                      {payment.status === "rejected" && payment.rejected_reason ? (
                        <p className="mt-1 text-xs font-bold text-danger">Rejected: {payment.rejected_reason}</p>
                      ) : null}
                      {payment.status === "voided" && payment.void_reason ? (
                        <p className="mt-1 text-xs text-muted">Voided: {payment.void_reason}</p>
                      ) : null}
                    </div>
                    <Pill
                      tone={payment.status === "confirmed" ? "success" : payment.status === "pending" ? "warn" : "muted"}
                      icon={payment.status === "confirmed" ? CheckCircle2 : Clock}
                    >
                      {payment.status}
                    </Pill>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

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
