export type JobStatus =
  | "assigned"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed_pending_customer"
  | "completed_confirmed"
  | "completed_auto_closed"
  | "cancelled"
  | "disputed";

export type AuthSession = {
  user?: {
    id: string;
    email?: string | null;
    phone?: string | null;
    display_name?: string | null;
  };
  roles?: string[];
  technician?: {
    id: string;
    approved?: boolean;
    status?: string | null;
    vetting_status?: string | null;
    is_available?: boolean;
    location_updated_at?: string | null;
    photo_url?: string | null;
    photo_status?: "pending" | "approved" | "rejected" | null;
    phone?: string | null;
    skills?: string[] | null;
    service_area_radius_km?: number | null;
  };
  active_organization_id?: string | null;
  organization_name?: string | null;
};

export type LoginResponse = {
  access_token: string;
  refresh_token?: string | null;
  token_type: "bearer";
  session: AuthSession;
};

export type ReadinessSnapshot = {
  can_receive_offers: boolean;
  blocking_reasons: string[];
  account: {
    status?: string | null;
    vetting_status?: string | null;
    approved: boolean;
    available: boolean;
  };
  location: {
    fresh: boolean;
    updated_at?: string | null;
    threshold_minutes: number;
  };
  active_job: {
    busy: boolean;
    id?: string | null;
    status?: JobStatus | null;
  };
  push: {
    registered_devices: number;
    push_ready: boolean;
  };
};

export type ActiveJob = {
  id: string;
  operational_id?: string | null;
  status: JobStatus;
  access_type?: string | null;
  situation?: string | null;
  service_type?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  distance_mi?: number | null;
  distance_km?: number | null;
  eta_min?: number | null;
  eta_max?: number | null;
  eta_is_estimate?: boolean | null;
  detail?: Record<string, unknown> | null;
  location_requirements?: {
    location_is_fresh?: boolean | null;
    location_updated_at?: string | null;
  };
};

export type ActiveJobSnapshot = {
  active_job: ActiveJob | null;
  version: string | null;
  allowed_actions: string[];
};

// Read-only enrichment from GET /technicians/{id}/active-job (the endpoint
// technician-web's ActiveJobWorkflow uses). The snapshot above stays the
// only source for `version`/mutations; this only feeds display-only UI —
// see main.py's technician_active_job for the exact merged shape.
export type ActiveJobDetail = {
  customer_name?: string | null;
  customer_phone?: string | null;
  intake_photos?: Array<{ url: string; label?: string | null }> | null;
  collection_items?: Array<{ description: string; amount?: number | null; provided_by?: string | null }> | null;
  collection_total?: number | null;
  collection_currency?: string | null;
  approval_status?: "pending" | "approved" | "disputed" | "expired" | null;
  approval_url?: string | null;
  arrival_verification?: { pin_required?: boolean; dispatcher_fallback_allowed?: boolean } | null;
};

export type TechnicianOffer = {
  id?: string;
  offer_id?: string;
  job_id: string;
  status: "offered" | "seen" | "accepted" | "declined" | "expired" | "superseded" | "failed_delivery";
  expires_at: string;
  offered_at?: string | null;
  distance_mi?: number | null;
  dist_km?: number | null;
  eta_min?: number | null;
  estimated_earnings?: string | null;
  area?: string | null;
  area_lat?: number | null;
  area_lng?: number | null;
  service_type?: string | null;
  situation?: string | null;
  urgency?: "low" | "medium" | "high" | "critical" | null;
  organization_name?: string | null;
};

export type ApiProblem = {
  status: number;
  code?: string;
  message: string;
  current_version?: string;
  raw?: unknown;
};

export type JobMessage = {
  id: string;
  job_id: string;
  channel: "operations" | "customer" | string;
  sender_type: "technician" | "provider_admin" | "dispatcher" | "customer" | "system" | string;
  sender_user_id?: string | null;
  sender_technician_id?: string | null;
  sender_organization_id?: string | null;
  body?: string | null;
  template_code?: string | null;
  template_params?: Record<string, unknown> | null;
  client_message_id?: string | null;
  created_at?: string | null;
  delivery_state?: "sent" | string;
};

export type LocalMutationKind = "status" | "report_issue" | "collection" | "arrival_verify" | "message";

export type QueuedMutation = {
  clientMutationId: string;
  jobId: string;
  kind: LocalMutationKind;
  expectedVersion?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

// Mirrors apps/technician-web/src/app/documents/page.tsx's TechnicianDocument.
export type TechnicianDocument = {
  id: string;
  document_type: string;
  document_number?: string | null;
  status: "pending_review" | "approved" | "rejected";
  uploaded_at?: string | null;
  reviewed_at?: string | null;
  expiration_date?: string | null;
  rejected_reason?: string | null;
};

// Mirrors apps/technician-web/src/app/activity/page.tsx's PaymentReport/HistoryJob.
export type PaymentReport = { amount: number; currency: string; method: string; reported_at: string | null } | null;

export type HistoryJob = {
  id: string;
  operational_id?: string | null;
  status: string;
  address: string | null;
  situation: string | null;
  urgency?: string | null;
  created_at?: string | null;
  finished_at: string | null;
  technician_display_name?: string | null;
  review: { rating: number | null; comment: string | null } | null;
  payments: { technician: PaymentReport; customer: PaymentReport };
};

// Mirrors apps/technician-web/src/app/earnings/page.tsx's TechPayment/SettlementRow/PeriodRow.
export type TechPayment = {
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

export type SettlementRow = {
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

export type SettlementPeriodRow = {
  settlement_period_id: string;
  status: "draft" | "locked" | "paid" | string;
  label: string;
  period_start?: string | null;
  period_end?: string | null;
  locked_at?: string | null;
  paid_at?: string | null;
  row: SettlementRow;
};

export type SettlementPayload = {
  live: SettlementRow[];
  period_rows: SettlementPeriodRow[];
};

// Mirrors apps/technician-web/src/app/team/page.tsx's TechnicianAffiliation/Organization
// — matches store.list_technician_affiliations/list_technician_organizations exactly.
export type TechnicianAffiliation = {
  id: string;
  organization_id: string;
  organization_name?: string | null;
  status: "pending_invite" | "active" | "suspended" | "ended" | "rejected";
  affiliation_type?: string | null;
  exclusivity?: string | null;
  dispatch_allowed?: boolean;
  ended_at?: string | null;
};

export type TechnicianOrganization = {
  id: string;
  name: string;
};

// Mirrors apps/technician-web/src/components/active-job-workflow.tsx's
// CloseoutLineDraft (a technician-authored line, not the server's recorded shape).
export type CloseoutLineDraft = {
  id: string;
  item_type_code: string;
  description: string;
  quantity: string;
  unit_amount: string;
  taxable: boolean;
  provided_by: string;
  note: string;
};
