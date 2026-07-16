export interface ProviderDocument {
  id: string;
  owner_type: string;
  document_type: string;
  document_number?: string | null;
  status: string;
  expires_at?: string | null;
  submitted_at?: string | null;
}

export type ComplianceState = "ready" | "expiring" | "pending" | "missing" | "rejected" | "expired";

export interface ComplianceItem {
  type: string;
  label: string;
  state: ComplianceState;
  document?: ProviderDocument;
  detail: string;
}

export const COMPANY_DOCUMENT_TYPES = [
  { type: "business_license", label: "Business license", required: true },
  { type: "insurance", label: "Insurance", required: true },
  { type: "tax_registration", label: "Tax registration", required: true },
  { type: "bonding", label: "Bonding certificate", required: false },
] as const;

const DAY_MS = 86_400_000;

function daysUntil(value: string): number | null {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - Date.now()) / DAY_MS);
}

export function documentComplianceState(document: ProviderDocument): ComplianceState {
  const status = document.status.toLowerCase();
  const remaining = document.expires_at ? daysUntil(document.expires_at) : null;
  if (status === "rejected") return "rejected";
  if (status === "expired" || (remaining !== null && remaining < 0)) return "expired";
  if (status === "pending" || status === "pending_review") return "pending";
  if (status === "verified" || status === "approved") {
    return remaining !== null && remaining <= 30 ? "expiring" : "ready";
  }
  return "pending";
}

const STATE_RANK: Record<ComplianceState, number> = {
  ready: 6,
  expiring: 5,
  pending: 4,
  rejected: 3,
  expired: 2,
  missing: 1,
};

function describe(state: ComplianceState, document?: ProviderDocument): string {
  if (state === "missing") return "Required for company approval";
  if (state === "pending") return "Submitted and waiting for ClueXP review";
  if (state === "rejected") return "Replace this document to continue review";
  if (state === "expired") return "Expired; upload a current replacement";
  if (state === "expiring" && document?.expires_at) {
    const remaining = daysUntil(document.expires_at);
    return remaining === 0 ? "Expires today" : `Expires in ${remaining} day${remaining === 1 ? "" : "s"}`;
  }
  if (document?.expires_at) return `Current through ${new Date(document.expires_at).toLocaleDateString()}`;
  return "Verified and current";
}

export function buildCompanyCompliance(documents: ProviderDocument[]): ComplianceItem[] {
  const companyDocuments = documents.filter((document) => document.owner_type === "organization");
  return COMPANY_DOCUMENT_TYPES.filter((definition) => definition.required).map((definition) => {
    const matches = companyDocuments.filter((document) => document.document_type === definition.type);
    const best = matches
      .map((document) => ({ document, state: documentComplianceState(document) }))
      .sort((left, right) => STATE_RANK[right.state] - STATE_RANK[left.state])[0];
    const state = best?.state ?? "missing";
    return {
      type: definition.type,
      label: definition.label,
      state,
      document: best?.document,
      detail: describe(state, best?.document),
    };
  });
}

export function complianceCounts(items: ComplianceItem[]) {
  return {
    ready: items.filter((item) => item.state === "ready").length,
    blocking: items.filter((item) => ["missing", "rejected", "expired"].includes(item.state)).length,
    pending: items.filter((item) => item.state === "pending").length,
    expiring: items.filter((item) => item.state === "expiring").length,
  };
}

export function complianceLabel(state: ComplianceState): string {
  return {
    ready: "Current",
    expiring: "Expiring soon",
    pending: "Pending review",
    missing: "Missing",
    rejected: "Rejected",
    expired: "Expired",
  }[state];
}
