// Domain types for the ClueXP dispatch console.
// Source of truth: docs/SYSTEM-DESIGN.md §18.3-§18.4 (partner + ops subsystems).
// These mirror the spec's vocabulary exactly — do not invent state values.

/** §7.1 — operator projection over backend job/offer/technician events. NOT trust_state. */
export type ConsoleStatus =
  | "new_unrouted"
  | "routed_to_cluexp"
  | "routed_to_organization"
  | "awaiting_org_accept"
  | "awaiting_technician_assignment"
  | "offer_sent"
  | "offer_expiring"
  | "accepted"
  | "en_route"
  | "arrived"
  | "in_service"
  | "customer_approval_needed"
  | "completed"
  | "cancelled"
  | "escalated"
  | "stalled";

/**
 * §3.3 / §7.1 — the ONLY state that governs customer visibility. Backend-owned.
 * console_status must never drive trust_state. Exactly three values — no sub-states.
 */
export type TrustState = "INTAKE" | "MATCHED" | "FULFILLMENT";

/** §7.2 */
export type TechnicianEligibility =
  | "eligible"
  | "offline"
  | "busy"
  | "outside_service_area"
  | "missing_skill"
  | "blocked_by_documents"
  | "stale_location"
  | "suspended"
  | "manual_override_required";

/** §7.3 */
export type OrganizationEligibility =
  | "eligible"
  | "inactive"
  | "blocked_by_documents"
  | "outside_service_area"
  | "capacity_full"
  | "dispatch_unavailable"
  | "subscription_blocked"
  | "manual_override_required";

/** §7.4 */
export type OfferStatus =
  | "pending"
  | "sent"
  | "seen"
  | "accepted"
  | "declined"
  | "expired"
  | "superseded"
  | "failed_delivery";

export type ProviderType = "individual" | "affiliated";
export type AccessType = "car" | "home" | "business";
export type Urgency = "low" | "medium" | "high" | "critical";
export type DocumentStatus = "verified" | "expiring" | "expired" | "pending_review";
export type ConsoleMode = "cluexp" | "org";
export type AuthRole = "platform_admin" | "provider_admin" | "dispatcher" | "technician" | "customer";
export type DispatchMode = "organization_managed" | "cluexp_managed_routing";
export type FulfillmentPolicy = "private" | "network_overflow" | "network_open";
export type MarketplaceState =
  | "private"
  | "offered_to_network"
  | "open_network"
  | "awarded"
  | "withdrawn";

export interface Organization {
  id: string;
  legal_name: string;
  display_name: string;
  description?: string;
  status: OrganizationEligibility;
  service_area: string;
  distance_mi?: number;
  workload: "low" | "medium" | "high" | "full";
  rating?: number;
  jobs_completed?: number;
  avg_response_min?: number;
  document_status: DocumentStatus;
  blocking_reason?: string;
}

export interface AuthUser {
  id: string;
  display_name: string;
  email?: string;
  phone?: string;
  locale?: "en" | "es";
  roles: AuthRole[];
  organization_ids: string[];
  technician_id?: string;
  status: "active" | "invited" | "suspended";
}

export interface AuthSession {
  user: AuthUser;
  active_role: AuthRole;
  active_organization_id?: string;
  surface: "platform" | "provider" | "technician" | "customer";
  organization_name?: string;
  organization_status?: string;
  technician?: {
    id: string;
    status: string;
    vetting_status: string;
    is_available: boolean;
    display_name?: string;
    phone?: string | null;
    skills?: string[];
    service_area_radius_km?: number | null;
    approved: boolean;
  } | null;
}

export interface Team {
  id: string;
  organization_id: string;
  parent_team_id?: string;
  name: string;
  description?: string;
  members_count: number;
  workload: "low" | "medium" | "high";
  specialties: string[];
}

export interface Technician {
  id: string;
  display_name: string;
  initials: string;
  provider_type: ProviderType;
  primary_organization_id?: string;
  teams: string[];
  eligibility: TechnicianEligibility;
  skills: string[];
  service_area: string;
  distance_mi?: number;
  eta_min?: number;
  is_available: boolean;
  workload: number;
  rating?: number;
  document_status: DocumentStatus;
  location_updated_min_ago?: number;
  /** SYSTEM-DESIGN §20.4 — membership-level permission for verified network routing, future/planned. */
  direct_dispatch_allowed: boolean;
  blocking_reason?: string;
  verified?: boolean;
  background_check?: "verified" | "pending" | "expired";
  insurance_status?: DocumentStatus;
  payment_risk?: "low" | "medium" | "high";
  no_show_history?: number;
}

export interface SafetyFlag {
  code: string;
  label: string;
  severity: "info" | "warning" | "critical";
}

export interface Job {
  id: string;
  customer_display: string;
  trust_state: TrustState;
  console_status: ConsoleStatus;
  access_type: AccessType;
  situation: string;
  urgency: Urgency;
  area: string;
  address: string;
  routing_source: string;
  origin_org_id?: string;
  customer_owner_org_id?: string;
  origin_channel?: string;
  dispatch_mode?: DispatchMode;
  fulfillment_policy?: FulfillmentPolicy;
  marketplace_state?: MarketplaceState;
  responsible_organization_id?: string | null;
  safety_flags: SafetyFlag[];
  fulfillment_org_id?: string | null;
  fulfillment_technician_id?: string;
  age_min: number;
  sla_min?: number;
  sla_deadline_at?: string;
  eta_min?: number;
  price_quote?: string;
  escalation_reason?: string;
  lat?: number;
  lng?: number;
  detail?: Record<string, unknown>;
  photo_count?: number;
  photo_paths?: string[];
  photo_urls?: string[];
}

export interface DashboardAggregates {
  live_requests: number;
  avg_eta_min: number;
  active_professionals: number;
  sla_risk_count: number;
  revenue_today: string;
  completion_rate: string;
}

export interface DispatchOffer {
  id: string;
  job_id: string;
  target_type: "technician" | "organization" | "team";
  technician_id?: string;
  organization_id?: string;
  status: OfferStatus;
  rank?: number;
  offered_at: string;
  /** §7.4 — countdowns MUST be driven by this backend value, never client-invented. */
  expires_at: string;
  responded_at?: string;
  response_reason?: string;
}

export interface DispatchEvent {
  id: string;
  job_id: string;
  actor_display: string;
  actor_scope: "cluexp" | "organization" | "system" | "technician" | "customer";
  event: string;
  /** Snapshot of customer trust_state at the time — INTAKE | MATCHED | FULFILLMENT only. */
  trust_state?: TrustState;
  reason?: string;
  metadata?: Record<string, string | number>;
  at: string;
}

export interface ComplianceEntry {
  id: string;
  entity_name: string;
  entity_type: "organization" | "technician";
  category: string;
  document_status: DocumentStatus;
  last_verified: string;
  blocking: boolean;
}

export type TechnicianAvailability =
  | "offline"
  | "online"
  | "busy"
  | "break"
  | "blocked_by_documents"
  | "suspended";

export type GpsState =
  | "tracking_active"
  | "tracking_paused"
  | "permission_needed"
  | "low_accuracy"
  | "stale_location"
  | "background_limited";

export type AlarmState = "sound_enabled" | "sound_muted" | "permission_needed" | "alarm_active";

export interface TechnicianAppProfile {
  technician_id: string;
  availability: TechnicianAvailability;
  gps_state: GpsState;
  alarm_state: AlarmState;
  auto_accept: boolean;
  current_shift_started_at: string;
  workspace_label: string;
  masked_phone: string;
}

export interface TechnicianAppOffer {
  offer_id: string;
  job_id: string;
  source: "cluexp" | "organization";
  source_label: string;
  team_label?: string;
  distance_mi: number;
  eta_min: number;
  estimated_earnings?: string;
  auto_accept_eligible: boolean;
  status: OfferStatus;
  expires_at: string;
  superseded_by?: string;
}

export interface TechnicianCollectionItem {
  description: string;
  amount?: number | null;
  provided_by?: string | null;
  quantity?: number | null;
  taxable?: boolean | null;
}

export interface TechnicianActiveJob {
  id: string;
  status: JobStatus;
  access_type?: string | null;
  situation?: string | null;
  service_type?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  technician_current_lat?: number | null;
  technician_current_lng?: number | null;
  technician_location_updated_at?: string | null;
  technician_location_is_fresh?: boolean;
  distance_km?: number | null;
  distance_mi?: number | null;
  eta_min?: number | null;
  eta_max?: number | null;
  eta_is_estimate?: boolean;
  collection_items?: TechnicianCollectionItem[];
  collection_total?: number | null;
  collection_currency?: string | null;
  approval_status?: "pending" | "approved" | "disputed" | "expired" | null;
  approval_url?: string | null;
  tracking_token?: string | null;
  intake_photos?: Array<{ url: string; label?: string | null }>;
}

export interface TechnicianActivitySummary {
  today_completed: number;
  week_completed: number;
  provisional_earnings: string;
  completion_rate: string;
}

export interface TechnicianHistoryEntry {
  id: string;
  job_id: string;
  label: string;
  source_label: string;
  status: "completed" | "cancelled" | "expired" | "missed";
  completed_at: string;
  amount?: string;
}

// Fulfillment cutover (Sprint 3) - customer tracking API types

/** Operational job status for the fulfillment lifecycle */
export type JobStatus =
  | "pending_dispatch"
  | "assigned"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed_pending_customer"
  | "completed_confirmed"
  | "completed_auto_closed"
  | "disputed"
  | "cancelled"
  | "no_show";

/** Customer affordances for the token tracking link */
export interface CustomerActions {
  can_cancel: boolean;
  can_confirm: boolean;
  can_dispute: boolean;
  can_review: boolean;
}

/** Tracking response with cutover extensions */
export interface TrackingWithStatus {
  ticket_id: string;
  token: string;
  trust_state: TrustState;
  status: JobStatus;
  access_type: string;
  situation: string;
  location: { raw_text: string };
  assignment: {
    customer_owner: string | null;
    fulfillment_type: "company_technician" | "independent_technician" | "network_provider";
    provider_company: string | null;
    technician_display_name: string;
    role: string;
    rating: number | null;
    eta_min: number;
    eta_max: number;
    eta_is_estimate: boolean;
    assigned_at: string;
    job_status: string;
  } | null;
  guards: {
    may_show_technician: boolean;
    may_show_eta: boolean;
    may_show_live_tracking: boolean;
  };
  customer_actions: CustomerActions;
  terminal: boolean;
}
