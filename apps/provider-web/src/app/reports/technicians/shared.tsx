export interface TechnicianSummary {
  technician_id: string;
  technician_display_name: string | null;
  affiliation_ended: boolean;
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

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents || 0) / 100).toFixed(2)}`;
}

export function SettlementValue({ cents }: { cents: number }) {
  // Green: company owes the tech. Red: the tech collected cash and owes the company.
  return (
    <span className={cents < 0 ? "font-semibold text-red-600 dark:text-red-400" : "font-semibold text-emerald-600 dark:text-emerald-400"}>
      {money(cents)}
    </span>
  );
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
