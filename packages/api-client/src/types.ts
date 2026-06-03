// Domain types for the ClueXP dispatch console.
// Source of truth: docs/ORGANIZATION-DISPATCH-CONSOLE-SPEC.md §7 (states) and §10 (data).
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
export type DispatchOwner = "cluexp" | "organization";
export type AccessType = "car" | "home" | "business";
export type Urgency = "low" | "medium" | "high" | "critical";
export type DocumentStatus = "verified" | "expiring" | "expired" | "pending_review";
export type ConsoleMode = "cluexp" | "org";

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
  /** §3.2 — membership-level permission, future/planned. Lets ClueXP dispatch directly. */
  direct_dispatch_allowed: boolean;
  blocking_reason?: string;
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
  dispatch_owner: DispatchOwner;
  access_type: AccessType;
  situation: string;
  urgency: Urgency;
  area: string;
  address: string;
  routing_source: string;
  safety_flags: SafetyFlag[];
  provider_organization_id?: string;
  technician_id?: string;
  age_min: number;
  sla_min?: number;
  eta_min?: number;
  price_quote?: string;
  escalation_reason?: string;
  lat?: number;
  lng?: number;
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
