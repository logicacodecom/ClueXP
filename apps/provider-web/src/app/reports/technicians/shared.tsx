import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@cluexp/console-ui";

export interface TechnicianSummary {
  technician_id: string;
  technician_display_name: string | null;
  affiliation_ended: boolean;
  affiliation_ended_at: string | null;
  job_count: number;
  customer_total_cents: number;
  average_job_cents: number;
  tech_payout_cents: number;
  company_retained_cents: number;
  settlement_value_cents: number;
  company_owes_tech_cents: number;
  tech_owes_company_cents: number;
  review_count: number;
  average_rating: number | null;
  agreement_statuses: string[];
}

export interface CloseoutLine {
  line_number: number;
  item_type_code: string;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  line_total_cents: number;
  taxable: boolean;
  provided_by: string | null;
  compensation_eligible: boolean;
  reimbursement_eligible: boolean;
  note: string | null;
}

export interface PaymentReport {
  amount: number;
  currency: string;
  method: string | null;
  reported_at: string | null;
}

export interface SettlementRow {
  job_id: string;
  technician_id: string | null;
  technician_display_name: string | null;
  status: string;
  finished_at: string | null;
  agreement_status: string;
  affiliation_ended?: boolean;
  affiliation_ended_at?: string | null;
  cut_basis_points: number;
  customer_total_cents: number;
  tax_cents: number;
  card_fee_cents: number;
  tip_cents: number;
  commissionable_cents: number;
  tech_reimbursement_cents: number;
  tech_service_payout_cents: number;
  tech_tip_cents: number;
  tech_payout_cents: number;
  company_retained_cents: number;
  payment_method: string | null;
  settlement_value_cents: number;
  review: { rating: number | null; comment: string | null; created_at: string | null } | null;
  payments: { technician: PaymentReport | null; customer: PaymentReport | null } | null;
  closeout: { line_items?: CloseoutLine[]; subtotal_cents?: number } | null;
}

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents || 0) / 100).toFixed(2)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function methodLabel(method: string | null | undefined): string {
  return method ? method.replace(/_/g, " ") : "—";
}

export function techLabel(row: { technician_display_name: string | null; technician_id: string }): string {
  return row.technician_display_name ?? row.technician_id.slice(0, 8);
}

export function buildPeriodQuery(start: string, end: string): string {
  const params = new URLSearchParams();
  if (start) params.set("period_start", start);
  if (end) params.set("period_end", end);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function SettlementValue({ cents }: { cents: number }) {
  // Green: company owes the tech. Red: the tech collected cash and owes the company.
  return (
    <span className={cents < 0 ? "font-semibold text-red-600 dark:text-red-400" : "font-semibold text-emerald-600 dark:text-emerald-400"}>
      {money(cents)}
    </span>
  );
}

export function AffiliationTag({ ended, endedAt }: { ended?: boolean; endedAt?: string | null }) {
  if (!ended) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant="danger">Not active</Badge>
      {endedAt ? <span className="text-xs text-muted-foreground">(ended {formatDate(endedAt)})</span> : null}
    </span>
  );
}

export function JobDetail({ row }: { row: SettlementRow }) {
  const lines = row.closeout?.line_items ?? [];
  const techReport = row.payments?.technician ?? null;
  const customerReport = row.payments?.customer ?? null;
  const reportsDisagree =
    techReport != null && customerReport != null &&
    (Math.round(techReport.amount * 100) !== Math.round(customerReport.amount * 100) || techReport.method !== customerReport.method);
  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/30 p-4 text-sm">
      {lines.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Provided by</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.line_number}>
                  <TableCell>
                    <div className="font-medium">{line.description}</div>
                    {line.note ? <div className="text-xs text-muted-foreground">{line.note}</div> : null}
                  </TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">{money(line.line_total_cents)}</TableCell>
                  <TableCell>{line.provided_by ?? "—"}</TableCell>
                  <TableCell className="space-x-1">
                    {line.compensation_eligible ? <Badge variant="success">commission</Badge> : null}
                    {line.reimbursement_eligible ? <Badge variant="warn">reimbursable</Badge> : null}
                    {line.taxable ? <Badge variant="outline">taxable</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-muted-foreground">No itemized closeout lines.</p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Money breakdown</div>
          <div className="flex justify-between"><span>Customer total</span><strong>{money(row.customer_total_cents)}</strong></div>
          <div className="flex justify-between"><span>Tax</span><span>{money(row.tax_cents)}</span></div>
          <div className="flex justify-between"><span>Tip</span><span>{money(row.tip_cents)}</span></div>
          <div className="flex justify-between"><span>Card fee</span><span>{money(row.card_fee_cents)}</span></div>
          <div className="flex justify-between"><span>Tech service cut ({(row.cut_basis_points / 100).toFixed(2)}%)</span><span>{money(row.tech_service_payout_cents)}</span></div>
          <div className="flex justify-between"><span>Tech reimbursement</span><span>{money(row.tech_reimbursement_cents)}</span></div>
          <div className="flex justify-between"><span>Tech tip share</span><span>{money(row.tech_tip_cents)}</span></div>
          <div className="flex justify-between border-t border-border pt-1"><span>Tech payout</span><strong>{money(row.tech_payout_cents)}</strong></div>
          <div className="flex justify-between"><span>Company retained</span><strong>{money(row.company_retained_cents)}</strong></div>
          <div className="flex justify-between"><span>Settlement balance</span><SettlementValue cents={row.settlement_value_cents} /></div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground">Payment reports</div>
            <div className="mt-1 space-y-1">
              <div className="flex justify-between">
                <span>Technician reported</span>
                <span>{techReport ? `$${techReport.amount.toFixed(2)} · ${methodLabel(techReport.method)}` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Customer reported</span>
                <span>{customerReport ? `$${customerReport.amount.toFixed(2)} · ${methodLabel(customerReport.method)}` : "—"}</span>
              </div>
              {reportsDisagree ? <Badge variant="danger">reports disagree</Badge> : null}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground">Customer review</div>
            {row.review?.rating != null ? (
              <div className="mt-1">
                <div>{row.review.rating} ★ <span className="text-xs text-muted-foreground">{formatDate(row.review.created_at)}</span></div>
                {row.review.comment ? <p className="mt-1 text-muted-foreground">“{row.review.comment}”</p> : null}
              </div>
            ) : (
              <p className="mt-1 text-muted-foreground">No review left.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
