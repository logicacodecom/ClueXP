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
import { Check, FileSpreadsheet, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../frame";
import { exportRowsToExcel } from "../technicians/excel";
import { LogPaymentModal } from "../technicians/payment-modal";
import {
  directionLabel,
  formatDate,
  methodLabel,
  money,
  PAYMENT_STATUS_VARIANT,
  techLabel,
  type SettlementPayment,
  type TechnicianSummary
} from "../technicians/shared";

const inputClass = "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";

/** Inline confirm/reject/void controls for one payment row. */
function RowActions({
  payment, onAction,
}: {
  payment: SettlementPayment;
  onAction: (kind: "confirm" | "reject" | "void", payment: SettlementPayment, reason?: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"idle" | "reject" | "void">("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(kind: "confirm" | "reject" | "void", withReason?: string) {
    setBusy(true);
    try {
      await onAction(kind, payment, withReason);
      setMode("idle");
      setReason("");
    } finally {
      setBusy(false);
    }
  }

  if (mode !== "idle") {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          className={`${inputClass} w-44`}
          placeholder={mode === "reject" ? "Reason for rejection" : "Reason for voiding"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button size="sm" variant={mode === "reject" ? "destructive" : "outline"} disabled={busy || reason.trim().length < 3} onClick={() => void run(mode, reason.trim())}>
          {mode === "reject" ? "Reject" : "Void"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMode("idle"); setReason(""); }}>Cancel</Button>
      </div>
    );
  }
  if (payment.status === "pending") {
    return (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="success" disabled={busy} onClick={() => void run("confirm")}><Check className="size-4" />Confirm</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode("reject")}><X className="size-4" />Reject</Button>
      </div>
    );
  }
  if (payment.status === "confirmed") {
    return <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("void")}>Void</Button>;
  }
  return null;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<SettlementPayment[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianSummary[]>([]);
  const [filters, setFilters] = useState({ technician_id: "", start: "", end: "", status: "" });
  const [applied, setApplied] = useState(filters);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(async (active: typeof filters) => {
    setStatus("loading");
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (active.technician_id) params.set("technician_id", active.technician_id);
      if (active.start) params.set("period_start", active.start);
      if (active.end) params.set("period_end", active.end);
      const qs = params.toString();
      const [paymentsResponse, techsResponse] = await Promise.all([
        fetch(`/api/provider/settlement-payments${qs ? `?${qs}` : ""}`, { cache: "no-store" }),
        fetch("/api/provider/settlements/by-technician", { cache: "no-store" }),
      ]);
      const paymentsBody = await paymentsResponse.json().catch(() => ({}));
      const techsBody = await techsResponse.json().catch(() => ({}));
      if (!paymentsResponse.ok) throw new Error(paymentsBody.detail || "Unable to load payments");
      if (!techsResponse.ok) throw new Error(techsBody.detail || "Unable to load technicians");
      setPayments(Array.isArray(paymentsBody) ? paymentsBody : []);
      setTechnicians(Array.isArray(techsBody) ? techsBody : []);
      setStatus("ready");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load payments");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [load, applied]);

  const pending = useMemo(() => payments.filter((p) => p.status === "pending"), [payments]);
  const visible = useMemo(
    () => (applied.status ? payments.filter((p) => p.status === applied.status) : payments),
    [payments, applied.status]
  );
  const totals = useMemo(() => visible.reduce((acc, p) => {
    if (p.status !== "confirmed") return acc;
    if (p.direction === "company_to_technician") acc.toTech += p.amount_cents;
    else acc.toCompany += p.amount_cents;
    return acc;
  }, { toTech: 0, toCompany: 0 }), [visible]);

  const rowAction = useCallback(async (
    kind: "confirm" | "reject" | "void", payment: SettlementPayment, reason?: string,
  ) => {
    setMessage(null);
    const body = kind === "confirm" ? {} : { reason };
    const response = await fetch(`/api/provider/settlement-payments/${encodeURIComponent(payment.id)}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.detail || `Unable to ${kind} payment`);
      return;
    }
    await load(applied);
  }, [load, applied]);

  const exportExcel = useCallback(() => {
    void exportRowsToExcel(
      visible.map((p) => ({
        paid_on: formatDate(p.paid_on),
        technician: p.technician_display_name ?? p.technician_id.slice(0, 8),
        direction: directionLabel(p.direction),
        amount: p.amount_cents / 100,
        method: methodLabel(p.payment_method),
        reference: p.reference_number ?? "",
        submitted_by: p.submitted_by_role,
        status: p.status,
        note: p.note ?? "",
        rejected_reason: p.rejected_reason ?? "",
        void_reason: p.void_reason ?? "",
      })),
      [
        { key: "paid_on", header: "Date", width: 14 },
        { key: "technician", header: "Technician", width: 22 },
        { key: "direction", header: "Direction", width: 24 },
        { key: "amount", header: "Amount ($)", width: 14 },
        { key: "method", header: "Method", width: 16 },
        { key: "reference", header: "Reference", width: 18 },
        { key: "submitted_by", header: "Submitted by", width: 14 },
        { key: "status", header: "Status", width: 12 },
        { key: "note", header: "Note", width: 28 },
        { key: "rejected_reason", header: "Rejected reason", width: 24 },
        { key: "void_reason", header: "Void reason", width: 24 },
      ],
      "settlement-payments",
      "Payments"
    );
  }, [visible]);

  function paymentRow(payment: SettlementPayment, withActions: boolean) {
    return (
      <TableRow key={payment.id}>
        <TableCell>
          <div className="font-medium">{formatDate(payment.paid_on)}</div>
          {payment.source_period_start || payment.source_period_end ? (
            <div className="text-xs text-muted-foreground">
              source {payment.source_period_start ?? "…"} – {payment.source_period_end ?? "…"}
            </div>
          ) : null}
        </TableCell>
        <TableCell>{payment.technician_display_name ?? payment.technician_id.slice(0, 8)}</TableCell>
        <TableCell>{directionLabel(payment.direction)}</TableCell>
        <TableCell className={`text-right font-semibold ${payment.status === "voided" || payment.status === "rejected" ? "text-muted-foreground line-through" : ""}`}>
          {money(payment.amount_cents)}
        </TableCell>
        <TableCell className="capitalize">{methodLabel(payment.payment_method)}</TableCell>
        <TableCell>{payment.reference_number ?? "—"}</TableCell>
        <TableCell className="capitalize">{payment.submitted_by_role}</TableCell>
        <TableCell>
          <Badge variant={PAYMENT_STATUS_VARIANT[payment.status]}>{payment.status}</Badge>
          {payment.rejected_reason ? <div className="mt-1 text-xs text-muted-foreground">{payment.rejected_reason}</div> : null}
          {payment.void_reason ? <div className="mt-1 text-xs text-muted-foreground">{payment.void_reason}</div> : null}
        </TableCell>
        <TableCell>{payment.note ?? "—"}</TableCell>
        {withActions ? <TableCell><RowActions payment={payment} onAction={rowAction} /></TableCell> : null}
      </TableRow>
    );
  }

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader
          kicker="Finance"
          title="Settlement payments"
          description="The company–technician payment ledger: money that actually moved, in either direction. Settlement periods stay the approval batches; this is the record of settling them."
          actions={<Button onClick={() => setLogOpen(true)}><Wallet className="size-4" />Log payment</Button>}
        />

        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}

        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">Technician
              <select className={`${inputClass} block`} value={filters.technician_id} onChange={(e) => setFilters((f) => ({ ...f, technician_id: e.target.value }))}>
                <option value="">All technicians</option>
                {technicians.map((tech) => (
                  <option key={tech.technician_id} value={tech.technician_id}>{techLabel(tech)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">Start
              <input className={`${inputClass} block`} type="date" value={filters.start} onChange={(e) => setFilters((f) => ({ ...f, start: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">End
              <input className={`${inputClass} block`} type="date" value={filters.end} onChange={(e) => setFilters((f) => ({ ...f, end: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">Status
              <select className={`${inputClass} block`} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="rejected">Rejected</option>
                <option value="voided">Voided</option>
              </select>
            </label>
            <Button onClick={() => setApplied({ ...filters })}>Apply</Button>
            {(applied.technician_id || applied.start || applied.end || applied.status) ? (
              <Button variant="outline" onClick={() => { const cleared = { technician_id: "", start: "", end: "", status: "" }; setFilters(cleared); setApplied(cleared); }}>Clear</Button>
            ) : null}
            <Button className="ml-auto" variant="success" onClick={exportExcel} disabled={visible.length === 0}><FileSpreadsheet className="size-4" />Export Excel</Button>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Confirmed company → tech" value={money(totals.toTech)} />
          <StatCard label="Confirmed tech → company" value={money(totals.toCompany)} />
          <StatCard intent={pending.length > 0 ? "warn" : "neutral"} label="Pending confirmation" value={String(pending.length)} />
        </div>

        {pending.length > 0 && !applied.status ? (
          <Card className="border-warn/40">
            <CardHeader><CardTitle>Pending confirmation</CardTitle></CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                Technician-submitted payments. They do not reduce the outstanding balance until confirmed.
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Submitted by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((payment) => paymentRow(payment, true))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader><CardTitle>Transactions</CardTitle></CardHeader>
          <CardContent>
            {status === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading payments…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments logged yet. Use “Log payment”, or click a settlement balance in the technician report.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Submitted by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((payment) => paymentRow(payment, true))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <LogPaymentModal
          open={logOpen}
          onOpenChange={setLogOpen}
          technicians={technicians}
          preselectedTechnicianId={applied.technician_id || null}
          sourcePeriod={{ start: applied.start, end: applied.end }}
          onLogged={() => void load(applied)}
        />
      </div>
    </AppFrame>
  );
}
