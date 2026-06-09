/* eslint-disable */
// Generated from api/schema.py by scripts/generate_types.py.
// Do not edit by hand.

export type AccessType = "car" | "home" | "business" | "other";
export type AuthorityRole = "owner" | "tenant" | "manager" | "employee" | "other";
export type Channel = "mobile_web" | "voice";
export type KeyType = "mechanical" | "transponder" | "smart_key" | "unknown";
export type KeyTypeSource = "stated" | "inferred" | "unverified";
export type LockClass = "residential" | "commercial" | "high_security" | "safe" | "access_control";
export type SafetyType = "person_inside" | "pet_inside" | "medical" | "unsafe_location" | "none";
export type Situation = "locked_out" | "lost_key" | "broken_key" | "key_in_car" | "malfunction" | "rekey";
export type TicketStatus = "draft" | "complete" | "partial" | "fallback_to_human";
export type TrustState = "intake" | "matched" | "fulfillment";
export type Urgency = "emergency" | "urgent" | "standard" | "scheduled";

// Fulfillment cutover (Sprint 3) - operational job status
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

export interface Automotive {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  key_type?: KeyType;
  key_type_source?: KeyTypeSource;
}

export interface CancellationPolicy {
  currency?: string;
  free_until?: string;
  cancellation_fee?: number | null;
  no_show_fee?: number | null;
  accepted_by_customer?: boolean;
  accepted_at?: string;
}

export interface FinalCharge {
  currency?: string;
  final_amount: number;
  breakdown_note?: string | null;
  exceeds_estimate?: boolean;
  customer_approval_required?: boolean;
  customer_approved?: boolean;
  customer_approved_at?: string;
}

export interface Identity {
  claims_ownership?: boolean;
  authority_role?: AuthorityRole | null;
  verification_method?: string;
}

export interface Location {
  raw_text?: string | null;
  lat?: number | null;
  lng?: number | null;
  geocode_confidence?: string;
}

export interface PaymentMethod {
  processor: string;
  token: string;
  brand?: string | null;
  last4?: string | null;
  captured_at?: string;
}

export interface Photo {
  id: string;
  url: string;
  uploaded_at: string;
}

export interface PriceQuote {
  currency?: string;
  estimate_min?: number | null;
  estimate_max?: number | null;
  accepted_by_customer?: boolean;
  accepted_at?: string;
}

export interface Property {
  lock_type?: string | null;
  lock_class?: LockClass | null;
}

export interface SafetyFlag {
  present?: boolean;
  type?: SafetyType;
  advised_emergency_services?: boolean;
}

export interface TechnicianAssignment {
  technician_id: string;
  display_name: string;
  role?: string;
  photo_url?: string | null;
  rating?: number | null;
  verified?: boolean;
  eta_minutes_min?: number | null;
  eta_minutes_max?: number | null;
  assigned_at: string;
}

export interface Ticket {
  ticket_id?: string;
  created_at?: string;
  channel?: Channel;
  status?: TicketStatus;
  trust_state?: TrustState;
  access_type?: AccessType | null;
  situation?: Situation | null;
  urgency?: Urgency;
  safety_flag?: SafetyFlag;
  location?: Location;
  automotive?: Automotive;
  property?: Property;
  identity?: Identity;
  additional_details?: string | null;
  photos?: Photo[];
  payment_method?: PaymentMethod | null;
  cancellation_policy?: CancellationPolicy | null;
  price_quote?: PriceQuote | null;
  technician_assignment?: TechnicianAssignment | null;
  final_charge?: FinalCharge | null;
  equipment_hints?: string[];
  specialist_required?: boolean;
  confidence?: number;
  unresolved_fields?: string[];
  transcript_ref?: string | null;
}

export interface TicketGuards {
  may_show_technician: boolean;
  may_show_eta: boolean;
  may_show_live_tracking: boolean;
}

export interface TicketEnvelope {
  ticket: Ticket;
  guards: TicketGuards;
}

// Fulfillment cutover (Sprint 3) - tracking response extensions
export interface CustomerActions {
  can_confirm: boolean;
  can_dispute: boolean;
  can_review: boolean;
}

export interface TrackingResponse extends TicketEnvelope {
  token: string;
  tracking_token?: string | null;
  tracking_path?: string | null;
  status: JobStatus;
  customer_actions: CustomerActions;
  closed: boolean;
}