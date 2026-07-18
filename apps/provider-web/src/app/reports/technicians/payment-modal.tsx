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
  directionLabel,
  formatDate,
  money,
  SETTLEMENT_PAYMENT_METHODS,
  SettlementValue,
  techLabel,
  type PaymentDirection,
  type TechnicianSummary
} from "./shared";

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

  const selected = technicians.find((t) => t.technician_id === technicianId) ?? null;
  const balance = selected?.balance;

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
            <select className={inputClass} value={direction} onChange={(e) => setDirection(e.target.value as PaymentDirection)}>
              <option value="company_to_technician">Company paid technician</option>
              <option value="technician_to_company">Technician paid company</option>
            </select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className={labelClass}>Amount ($)
              <input className={inputClass} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
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

          {sourcePeriod && (sourcePeriod.start || sourcePeriod.end) ? (
            <p className="text-xs text-muted-foreground">
              Source context: report period {sourcePeriod.start ? formatDate(sourcePeriod.start) : "…"} – {sourcePeriod.end ? formatDate(sourcePeriod.end) : "…"}.
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy || !technicianId || !amount}>
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
