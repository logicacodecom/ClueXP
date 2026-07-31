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
  };
  active_organization_id?: string | null;
  organization_name?: string | null;
};

export type LoginResponse = {
  access_token: string;
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

export type LocalMutationKind = "status" | "report_issue" | "collection" | "arrival_verify";

export type QueuedMutation = {
  clientMutationId: string;
  jobId: string;
  kind: LocalMutationKind;
  expectedVersion?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
