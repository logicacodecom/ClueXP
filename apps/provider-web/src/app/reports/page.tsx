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
import { Download, RefreshCw } from "lucide-react";
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/provider/settlements", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load settlements");
      setRows(Array.isArray(body) ? body : []);
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

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader
          kicker="Finance"
          title="Settlement reports"
          description="Closeout-derived settlement rows for technician payout, reimbursement, company retained amount, and spreadsheet export."
          actions={
            <div className="flex flex-wrap gap-2">
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
