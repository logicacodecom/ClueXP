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
import { Download, Lock, Plus, RefreshCw, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";

interface SettlementRow {
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
}

interface TechnicianOption {
  id: string;
  display_name: string | null;
}

interface SettlementPeriod {
  id: string;
  status: "draft" | "locked" | "paid" | "void";
  label: string;
  period_start: string | null;
  period_end: string | null;
  technician_id: string | null;
  job_count: number;
  customer_total_cents: number;
  tech_payout_cents: number;
  adjustment_cents: number;
  final_tech_payout_cents: number;
  company_retained_cents: number;
  note?: string | null;
  rows?: SettlementRow[];
  adjustments?: Array<{ id: string; amount_cents: number; reason: string; created_at: string | null }>;
}

function money(cents: number): string {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export default function ReportsPage() {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [periods, setPeriods] = useState<SettlementPeriod[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<SettlementPeriod | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ label: "", period_start: "", period_end: "", technician_id: "" });
  const [adjustment, setAdjustment] = useState({ amount: "", reason: "" });

  const technicianName = useCallback(
    (id: string | null) => technicians.find((t) => t.id === id)?.display_name ?? id?.slice(0, 8) ?? "—",
    [technicians]
  );

  const load = useCallback(async () => {
    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/provider/settlements", { cache: "no-store" });
      const periodsResponse = await fetch("/api/provider/settlement-periods", { cache: "no-store" });
      const techsResponse = await fetch("/api/technicians", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      const periodsBody = await periodsResponse.json().catch(() => ({}));
      const techsBody = await techsResponse.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load settlements");
      if (!periodsResponse.ok) throw new Error(periodsBody.detail || "Unable to load settlement periods");
      setRows(Array.isArray(body) ? body : []);
      setPeriods(Array.isArray(periodsBody) ? periodsBody : []);
      setTechnicians(Array.isArray(techsBody.technicians) ? techsBody.technicians : []);
      setStatus("ready");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load settlements");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    customer: acc.customer + row.customer_total_cents,
    tech: acc.tech + row.tech_payout_cents,
    retained: acc.retained + row.company_retained_cents,
    reimbursement: acc.reimbursement + row.tech_reimbursement_cents,
  }), { customer: 0, tech: 0, retained: 0, reimbursement: 0 }), [rows]);

  async function createPeriod() {
    setMessage(null);
    const response = await fetch("/api/provider/settlement-periods", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: createForm.label || undefined,
        period_start: createForm.period_start || undefined,
        period_end: createForm.period_end || undefined,
        technician_id: createForm.technician_id || undefined
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.detail || "Unable to create settlement period");
      return;
    }
    setCreateForm({ label: "", period_start: "", period_end: "", technician_id: "" });
    setSelectedPeriod(body as SettlementPeriod);
    await load();
  }

  async function loadPeriod(id: string) {
    const response = await fetch(`/api/provider/settlement-periods/${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.detail || "Unable to load settlement period");
      return;
    }
    setSelectedPeriod(body as SettlementPeriod);
  }

  async function periodAction(action: "lock" | "paid") {
    if (!selectedPeriod) return;
    const response = await fetch(`/api/provider/settlement-periods/${encodeURIComponent(selectedPeriod.id)}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: selectedPeriod.note || undefined })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.detail || "Unable to update settlement period");
      return;
    }
    setSelectedPeriod(body as SettlementPeriod);
    await load();
  }

  async function addAdjustment() {
    if (!selectedPeriod) return;
    const amount = Math.round(Number.parseFloat(adjustment.amount || "0") * 100);
    const response = await fetch(`/api/provider/settlement-periods/${encodeURIComponent(selectedPeriod.id)}/adjustments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount_cents: amount, reason: adjustment.reason })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.detail || "Unable to add adjustment");
      return;
    }
    setAdjustment({ amount: "", reason: "" });
    setSelectedPeriod(body as SettlementPeriod);
    await load();
  }

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader
          kicker="Finance"
          title="Settlement reports"
          description="Closeout-derived settlement rows for technician payout, reimbursement, company retained amount, and spreadsheet export."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href="/reports/technicians"><Users className="size-4" />By technician</a></Button>
              <Button variant="outline" onClick={() => void load()}><RefreshCw className="size-4" />Refresh</Button>
              <Button asChild><a href="/api/provider/settlements?format=csv"><Download className="size-4" />Export CSV</a></Button>
            </div>
          }
        />

        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Customer total" value={money(totals.customer)} />
          <StatCard label="Tech payouts" value={money(totals.tech)} />
          <StatCard label="Tech reimbursements" value={money(totals.reimbursement)} />
          <StatCard label="Company retained" value={money(totals.retained)} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader><CardTitle>Create settlement period</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Create a draft snapshot from the current settlement rows. Lock it after review; mark paid only after external payment is completed.</p>
              <input className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="Label, e.g. July 1–15 settlements" value={createForm.label} onChange={(e) => setCreateForm((f) => ({ ...f, label: e.target.value }))} />
              <label className="block space-y-1 text-xs font-semibold text-muted-foreground">
                Technician
                <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" value={createForm.technician_id} onChange={(e) => setCreateForm((f) => ({ ...f, technician_id: e.target.value }))}>
                  <option value="">All technicians</option>
                  {technicians.map((tech) => (
                    <option key={tech.id} value={tech.id}>{tech.display_name ?? tech.id.slice(0, 8)}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="space-y-1 text-xs font-semibold text-muted-foreground">Start<input className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" type="date" value={createForm.period_start} onChange={(e) => setCreateForm((f) => ({ ...f, period_start: e.target.value }))} /></label>
                <label className="space-y-1 text-xs font-semibold text-muted-foreground">End<input className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" type="date" value={createForm.period_end} onChange={(e) => setCreateForm((f) => ({ ...f, period_end: e.target.value }))} /></label>
              </div>
              <Button onClick={() => void createPeriod()}><Plus className="size-4" />Create draft period</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Settlement periods</CardTitle></CardHeader>
            <CardContent>
              {periods.length === 0 ? (
                <p className="text-sm text-muted-foreground">No settlement periods yet.</p>
              ) : (
                <div className="space-y-2">
                  {periods.map((period) => (
                    <button
                      className={`w-full rounded-md border p-3 text-left transition ${selectedPeriod?.id === period.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"}`}
                      key={period.id}
                      type="button"
                      onClick={() => void loadPeriod(period.id)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{period.label}</span>
                        <Badge variant={period.status === "paid" ? "success" : period.status === "locked" ? "warn" : "outline"}>{period.status}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{period.technician_id ? technicianName(period.technician_id) : "All technicians"} · {period.job_count} jobs · payout {money(period.final_tech_payout_cents)}</div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {selectedPeriod ? (
          <Card>
            <CardHeader><CardTitle>Period review: {selectedPeriod.label}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <StatCard label="Jobs" value={String(selectedPeriod.job_count)} />
                <StatCard label="Tech payout" value={money(selectedPeriod.tech_payout_cents)} />
                <StatCard label="Adjustments" value={money(selectedPeriod.adjustment_cents)} />
                <StatCard label="Final payout" value={money(selectedPeriod.final_tech_payout_cents)} />
              </div>
              {selectedPeriod.status === "draft" ? (
                <div className="grid gap-2 md:grid-cols-[160px_1fr_auto]">
                  <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" inputMode="decimal" placeholder="Adjustment $" value={adjustment.amount} onChange={(e) => setAdjustment((a) => ({ ...a, amount: e.target.value }))} />
                  <input className="rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="Required reason" value={adjustment.reason} onChange={(e) => setAdjustment((a) => ({ ...a, reason: e.target.value }))} />
                  <Button variant="outline" onClick={() => void addAdjustment()}>Add adjustment</Button>
                </div>
              ) : null}
              {(selectedPeriod.adjustments ?? []).length > 0 ? (
                <div className="rounded-md border border-border">
                  {(selectedPeriod.adjustments ?? []).map((item) => (
                    <div className="flex items-center justify-between gap-3 border-b border-border p-3 text-sm last:border-b-0" key={item.id}>
                      <span>{item.reason}</span>
                      <strong>{money(item.amount_cents)}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline"><a href={`/api/provider/settlement-periods/${selectedPeriod.id}?format=csv`}><Download className="size-4" />Export period CSV</a></Button>
                {selectedPeriod.status === "draft" ? <Button onClick={() => void periodAction("lock")}><Lock className="size-4" />Lock period</Button> : null}
                {selectedPeriod.status === "locked" ? <Button onClick={() => void periodAction("paid")}><Wallet className="size-4" />Mark paid</Button> : null}
              </div>
              <p className="text-xs text-muted-foreground">Locked and paid periods use the saved row snapshots. Later agreement edits or closeout corrections do not alter this period.</p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader><CardTitle>Settlement ledger</CardTitle></CardHeader>
          <CardContent>
            {status === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading settlement rows…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No settlement rows yet. Jobs appear here after a technician records an itemized closeout.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Agreement</TableHead>
                      <TableHead className="text-right">Customer</TableHead>
                      <TableHead className="text-right">Commissionable</TableHead>
                      <TableHead className="text-right">Reimb.</TableHead>
                      <TableHead className="text-right">Tech payout</TableHead>
                      <TableHead className="text-right">Company retained</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.job_id}>
                        <TableCell>
                          <div className="font-medium">{row.job_id.slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">{formatDate(row.finished_at)}</div>
                        </TableCell>
                        <TableCell>{row.technician_display_name ?? row.technician_id?.slice(0, 8) ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={row.agreement_status === "active" ? "success" : row.agreement_status === "missing" ? "danger" : "warn"}>
                            {row.agreement_status}
                          </Badge>
                          <div className="mt-1 text-xs text-muted-foreground">{(row.cut_basis_points / 100).toFixed(2)}% cut</div>
                        </TableCell>
                        <TableCell className="text-right">{money(row.customer_total_cents)}</TableCell>
                        <TableCell className="text-right">{money(row.commissionable_cents)}</TableCell>
                        <TableCell className="text-right">{money(row.tech_reimbursement_cents)}</TableCell>
                        <TableCell className="text-right font-semibold">{money(row.tech_payout_cents)}</TableCell>
                        <TableCell className="text-right">{money(row.company_retained_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
