"use client";

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@cluexp/console-ui";
import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import {
  formatDate,
  money,
  SETTLEMENT_PAYMENT_METHODS,
  SettlementValue,
  techLabel,
  type PaymentBalance,
  type PaymentDirection,
  type TechnicianSummary
} from "./shared";

/** Balance after a hypothetical payment: paying one side only reduces that
 * side's outstanding bucket (clamped at zero) — mirrors the backend math. */
function projectedNet(balance: PaymentBalance, direction: PaymentDirection, amountCents: number): number {
  const c2t = direction === "company_to_technician"
    ? Math.max(0, balance.outstanding_company_to_tech_cents - amountCents)
    : balance.outstanding_company_to_tech_cents;
  const t2c = direction === "technician_to_company"
    ? Math.max(0, balance.outstanding_tech_to_company_cents - amountCents)
    : balance.outstanding_tech_to_company_cents;
  return c2t - t2c;
}

const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";
const labelClass = "block space-y-1 text-xs font-semibold text-muted-foreground";

export interface LogPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Selectable technicians; when exactly one is passed the selector is locked. */
  technicians: TechnicianSummary[];
  preselectedTechnicianId?: string | null;
  /** The report period the user was looking at — recorded as source context only. */
  sourcePeriod?: { start: string; end: string };
  onLogged: () => void;
}

export function LogPaymentModal({
  open, onOpenChange, technicians, preselectedTechnicianId, sourcePeriod, onLogged,
}: LogPaymentModalProps) {
  const [technicianId, setTechnicianId] = useState<string>("");
  const [direction, setDirection] = useState<PaymentDirection>("company_to_technician");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ackMismatch, setAckMismatch] = useState(false);

  const selected = technicians.find((t) => t.technician_id === technicianId) ?? null;
  const balance = selected?.balance;

  const amountCents = Math.round(Number.parseFloat(amount || "0") * 100) || 0;
  // Direction that cannot move the balance toward zero: the balance says one
  // party owes, but the payment is going the other way.
  const directionMismatch = !!balance && amountCents > 0 && (
    (balance.net_outstanding_cents > 0 && direction === "technician_to_company") ||
    (balance.net_outstanding_cents < 0 && direction === "company_to_technician")
  );
  const sideOutstanding = balance
    ? (direction === "company_to_technician"
        ? balance.outstanding_company_to_tech_cents
        : balance.outstanding_tech_to_company_cents)
    : 0;
  const overshoot = !!balance && !directionMismatch && amountCents > sideOutstanding;
  const preview = balance && amountCents > 0 ? projectedNet(balance, direction, amountCents) : null;

  // Re-prime the form each time the modal opens: amount defaults to the
  // outstanding balance, direction to whichever side owes.
  useEffect(() => {
    if (!open) return;
    const tech = technicians.find((t) => t.technician_id === preselectedTechnicianId) ?? technicians[0] ?? null;
    setTechnicianId(tech?.technician_id ?? "");
    const net = tech?.balance?.net_outstanding_cents ?? 0;
    setDirection(net < 0 ? "technician_to_company" : "company_to_technician");
    setAmount(net !== 0 ? (Math.abs(net) / 100).toFixed(2) : "");
    setMethod("cash");
    setPaidOn(new Date().toISOString().slice(0, 10));
    setReference("");
    setNote("");
    setError(null);
    setAckMismatch(false);
  }, [open, preselectedTechnicianId, technicians]);

  async function submit() {
    const amountCents = Math.round(Number.parseFloat(amount || "0") * 100);
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/provider/settlement-payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          technician_id: technicianId,
          direction,
          amount_cents: amountCents,
          payment_method: method,
          paid_on: paidOn || undefined,
          reference_number: reference || undefined,
          note: note || undefined,
          source_period_start: sourcePeriod?.start || undefined,
          source_period_end: sourcePeriod?.end || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to log payment");
      onOpenChange(false);
      onLogged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to log payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Log payment</SheetTitle>
          <SheetDescription>
            Records money that actually moved between the company and the technician.
            Balance is all-time. Current report period is only the source context.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-6">
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div> : null}

          <label className={labelClass}>Technician
            <select
              className={inputClass}
              disabled={technicians.length === 1}
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
            >
              {technicians.map((tech) => (
                <option key={tech.technician_id} value={tech.technician_id}>{techLabel(tech)}</option>
              ))}
            </select>
          </label>

          {balance ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Outstanding balance (all time)</span>
                <SettlementValue cents={balance.net_outstanding_cents} />
              </div>
              {balance.pending_tech_to_company_cents > 0 ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {money(balance.pending_tech_to_company_cents)} technician-submitted, pending confirmation
                </div>
              ) : null}
            </div>
          ) : null}

          <label className={labelClass}>Direction
            <select className={inputClass} value={direction} onChange={(e) => { setDirection(e.target.value as PaymentDirection); setAckMismatch(false); }}>
              <option value="company_to_technician">Company paid technician</option>
              <option value="technician_to_company">Technician paid company</option>
            </select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className={labelClass}>Amount ($)
              <input className={inputClass} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setAckMismatch(false); }} />
            </label>
            <label className={labelClass}>Payment date
              <input className={inputClass} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
          </div>

          <label className={labelClass}>Method
            <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
              {SETTLEMENT_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
              ))}
            </select>
          </label>

          <label className={labelClass}>Reference number (optional)
            <input className={inputClass} placeholder="Check #, Zelle confirmation, payroll run…" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>

          <label className={labelClass}>Note (optional)
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {preview !== null ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">After this payment, outstanding will be</span>
              <SettlementValue cents={preview} />
            </div>
          ) : null}

          {directionMismatch ? (
            <div className="space-y-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm" role="alert">
              <p className="font-semibold">This direction won’t reduce the balance.</p>
              <p className="text-muted-foreground">
                The balance says {balance!.net_outstanding_cents > 0 ? "the company owes the technician" : "the technician owes the company"},
                but this payment goes the other way — the outstanding amount will not move toward zero.
              </p>
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input checked={ackMismatch} type="checkbox" onChange={(e) => setAckMismatch(e.target.checked)} />
                Log it anyway — the money really moved in this direction
              </label>
            </div>
          ) : null}

          {overshoot ? (
            <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-sm" role="alert">
              Amount exceeds what this side owes ({money(sideOutstanding)}). The extra {money(amountCents - sideOutstanding)} will
              not carry over to the other side of the balance.
            </div>
          ) : null}

          {sourcePeriod && (sourcePeriod.start || sourcePeriod.end) ? (
            <p className="text-xs text-muted-foreground">
              Source context: report period {sourcePeriod.start ? formatDate(sourcePeriod.start) : "…"} – {sourcePeriod.end ? formatDate(sourcePeriod.end) : "…"}.
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy || !technicianId || !amount || (directionMismatch && !ackMismatch)}>
              <Wallet className="size-4" />{direction === "company_to_technician" ? "Log payment to technician" : "Log payment from technician"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Provider-logged payments are confirmed immediately and reduce the outstanding balance.
            A wrong entry is voided with a reason — never edited.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
