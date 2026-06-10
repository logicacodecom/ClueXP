// Local mock dataset (SPEC §14 — "Use local mock data first"; no real API).
// Domain: emergency ACCESS (locksmith) — car / home / business lockouts, broken/lost keys.
// Built around the §13 demo dataset (Jobs A/B/C) plus enough rows to populate the board,
// queue and map. NOT a real dispatch algorithm.

import type {
  AuthSession,
  AuthUser,
  ComplianceEntry,
  CustomerActions,
  DashboardAggregates,
  DispatchEvent,
  DispatchOffer,
  Job,
  JobStatus,
  Organization,
  Team,
  Technician,
  TechnicianActivitySummary,
  TechnicianAppOffer,
  TechnicianAppProfile,
  TechnicianHistoryEntry,
  TrackingWithStatus
} from "./types";

export const organizations: Organization[] = [
  {
    id: "org-metro",
    legal_name: "Metro Key Partners LLC",
    display_name: "Metro Key Partners",
    description: "Residential & auto access provider, north metro.",
    status: "eligible",
    service_area: "North Hills · Downtown",
    distance_mi: 2.4,
    workload: "low",
    rating: 4.9,
    jobs_completed: 12000,
    avg_response_min: 6,
    document_status: "verified"
  },
  {
    id: "org-citywide",
    legal_name: "City Wide Lock & Safe Inc.",
    display_name: "City Wide Lock",
    description: "Commercial access specialist.",
    status: "blocked_by_documents",
    service_area: "Downtown · Midtown",
    distance_mi: 1.8,
    workload: "medium",
    rating: 4.4,
    jobs_completed: 5300,
    avg_response_min: 11,
    document_status: "expired",
    blocking_reason: "Liability insurance expired 2024-11-14"
  },
  {
    id: "org-precision",
    legal_name: "Precision Entry Co.",
    display_name: "Precision Entry",
    description: "High-security & smart-lock access.",
    status: "eligible",
    service_area: "Strip Mall · East Side",
    distance_mi: 5.1,
    workload: "medium",
    rating: 4.7,
    jobs_completed: 3100,
    avg_response_min: 9,
    document_status: "verified"
  }
];

export const teams: Team[] = [
  {
    id: "team-home",
    organization_id: "org-metro",
    name: "Home Team",
    description: "Residential lockouts & rekeys.",
    members_count: 6,
    workload: "low",
    specialties: ["Residential lock", "Rekey", "Broken-key extraction"]
  },
  {
    id: "team-auto",
    organization_id: "org-metro",
    name: "Auto Team",
    description: "Vehicle lockouts & key programming.",
    members_count: 4,
    workload: "medium",
    specialties: ["Auto lock", "Key programming"]
  }
];

export const authUsers: AuthUser[] = [
  {
    id: "user-platform-ops",
    display_name: "Avery Knox",
    email: "avery@cluexp.com",
    roles: ["platform_admin"],
    organization_ids: [],
    status: "active"
  },
  {
    id: "user-metro-dispatch",
    display_name: "Nadia Reyes",
    email: "dispatch@metrokey.example",
    roles: ["provider_admin", "dispatcher"],
    organization_ids: ["org-metro"],
    status: "active"
  },
  {
    id: "user-tech-jordan",
    display_name: "Jordan Lee",
    phone: "(555) 014-2201",
    roles: ["technician"],
    organization_ids: [],
    technician_id: "tech-jordan",
    status: "active"
  }
];

export const platformSession: AuthSession = {
  user: authUsers[0]!,
  active_role: "platform_admin",
  surface: "platform"
};

export const providerSession: AuthSession = {
  user: authUsers[1]!,
  active_role: "provider_admin",
  active_organization_id: "org-metro",
  surface: "provider"
};

export const technicians: Technician[] = [
  {
    id: "tech-jordan",
    display_name: "Jordan Lee",
    initials: "JL",
    provider_type: "individual",
    teams: [],
    eligibility: "eligible",
    skills: ["Auto lock", "Broken-key extraction"],
    service_area: "Downtown",
    distance_mi: 0.8,
    eta_min: 9,
    is_available: true,
    workload: 0,
    rating: 4.8,
    document_status: "verified",
    location_updated_min_ago: 1,
    direct_dispatch_allowed: false,
    verified: true,
    background_check: "verified",
    insurance_status: "verified",
    payment_risk: "low",
    no_show_history: 0
  },
  {
    id: "tech-samir",
    display_name: "Samir Patel",
    initials: "SP",
    provider_type: "affiliated",
    primary_organization_id: "org-metro",
    teams: ["team-home"],
    eligibility: "eligible",
    skills: ["Residential lock", "Rekey"],
    service_area: "North Hills",
    distance_mi: 1.2,
    eta_min: 12,
    is_available: true,
    workload: 1,
    rating: 4.9,
    document_status: "verified",
    location_updated_min_ago: 2,
    // ADR 0004: Metro may release Samir for verified network routing (future/planned).
    direct_dispatch_allowed: true,
    verified: true,
    background_check: "verified",
    insurance_status: "verified",
    payment_risk: "low",
    no_show_history: 0
  },
  {
    id: "tech-lina",
    display_name: "Lina Gomez",
    initials: "LG",
    provider_type: "affiliated",
    primary_organization_id: "org-metro",
    teams: ["team-home"],
    eligibility: "eligible",
    skills: ["Residential lock", "Smart lock"],
    service_area: "North Hills",
    distance_mi: 2.1,
    eta_min: 18,
    is_available: true,
    workload: 0,
    rating: 4.7,
    document_status: "verified",
    location_updated_min_ago: 4,
    direct_dispatch_allowed: false,
    verified: true,
    background_check: "verified",
    insurance_status: "verified",
    payment_risk: "low",
    no_show_history: 1
  },
  {
    id: "tech-marcus",
    display_name: "Marcus Vale",
    initials: "MV",
    provider_type: "affiliated",
    primary_organization_id: "org-metro",
    teams: ["team-auto"],
    eligibility: "blocked_by_documents",
    skills: ["Commercial lock", "High-security"],
    service_area: "Downtown",
    is_available: false,
    workload: 0,
    rating: 4.6,
    document_status: "expired",
    location_updated_min_ago: 9,
    direct_dispatch_allowed: false,
    blocking_reason: "Locksmith license expired 2024-01-05",
    verified: false,
    background_check: "expired",
    insurance_status: "expired",
    payment_risk: "medium",
    no_show_history: 0
  },
  {
    id: "tech-morgan",
    display_name: "Morgan Vale",
    initials: "MV",
    provider_type: "individual",
    teams: [],
    eligibility: "stale_location",
    skills: ["Commercial lock", "Broken-key extraction"],
    service_area: "Strip Mall",
    distance_mi: 3.3,
    is_available: true,
    workload: 1,
    rating: 4.5,
    document_status: "verified",
    location_updated_min_ago: 18,
    direct_dispatch_allowed: false,
    blocking_reason: "GPS stale 18 min",
    verified: true,
    background_check: "verified",
    insurance_status: "verified",
    payment_risk: "medium",
    no_show_history: 2
  }
];

const CLUEXP_PLATFORM_ID = "platform-cluexp";

// §13 demo dataset — Job A (ClueXP-managed routing), Job B (org-managed), Job C (escalation) + extras.
export const jobs: Job[] = [
  {
    id: "JOB-A-2201",
    customer_display: "Alex T.",
    trust_state: "INTAKE", // not MATCHED — no named technician assigned yet
    console_status: "awaiting_technician_assignment",
    access_type: "car",
    situation: "Locked out — keys in ignition",
    urgency: "high",
    area: "Downtown",
    address: "1200 Market St, Financial District",
    routing_source: "ClueXP managed routing",
    origin_org_id: CLUEXP_PLATFORM_ID,
    customer_owner_org_id: CLUEXP_PLATFORM_ID,
    origin_channel: "cluexp-public",
    dispatch_mode: "cluexp_managed_routing",
    fulfillment_policy: "network_open",
    marketplace_state: "offered_to_network",
    responsible_organization_id: null,
    fulfillment_org_id: null,
    safety_flags: [],
    age_min: 4,
    sla_min: 20,
    sla_deadline_at: "2026-06-03T23:40:00Z",
    price_quote: "$95 est.",
    lat: 40.7075,
    lng: -74.0113
  },
  {
    id: "JOB-B-2248",
    customer_display: "R. Daniels",
    trust_state: "INTAKE", // org accepted, but customer is NOT MATCHED until a tech is named
    console_status: "routed_to_organization",
    access_type: "home",
    situation: "Locked out — door secured",
    urgency: "medium",
    area: "North Hills",
    address: "123 Maple St, Region 4",
    routing_source: "Partner website intake",
    origin_org_id: "org-metro",
    customer_owner_org_id: "org-metro",
    origin_channel: "metro-key-website",
    dispatch_mode: "organization_managed",
    fulfillment_policy: "private",
    marketplace_state: "private",
    responsible_organization_id: "org-metro",
    safety_flags: [
      { code: "alone_at_night", label: "Customer alone at night", severity: "warning" }
    ],
    fulfillment_org_id: "org-metro",
    age_min: 7,
    sla_min: 30,
    sla_deadline_at: "2026-06-03T23:55:00Z",
    lat: 40.7880,
    lng: -73.9460
  },
  {
    id: "JOB-C-2289",
    customer_display: "Strip Mall Mgmt",
    trust_state: "FULFILLMENT",
    console_status: "escalated",
    access_type: "business",
    situation: "Broken key in lock",
    urgency: "critical",
    area: "Strip Mall",
    address: "880 Retail Blvd, Unit 12",
    routing_source: "ClueXP phone intake",
    origin_org_id: CLUEXP_PLATFORM_ID,
    customer_owner_org_id: CLUEXP_PLATFORM_ID,
    origin_channel: "cluexp-phone",
    dispatch_mode: "cluexp_managed_routing",
    fulfillment_policy: "network_open",
    marketplace_state: "awarded",
    responsible_organization_id: null,
    fulfillment_org_id: null,
    safety_flags: [],
    fulfillment_technician_id: "tech-morgan",
    age_min: 31,
    sla_deadline_at: "2026-06-03T23:18:00Z",
    escalation_reason: "GPS stale for 18 minutes",
    lat: 40.7420,
    lng: -73.9890
  },
  {
    id: "JOB-D-2301",
    customer_display: "M. Owen",
    trust_state: "MATCHED",
    console_status: "en_route",
    access_type: "car",
    situation: "Lost key — Ford F150",
    urgency: "medium",
    area: "Midtown",
    address: "44 8th Ave",
    routing_source: "ClueXP managed routing",
    origin_org_id: CLUEXP_PLATFORM_ID,
    customer_owner_org_id: CLUEXP_PLATFORM_ID,
    origin_channel: "cluexp-public",
    dispatch_mode: "cluexp_managed_routing",
    fulfillment_policy: "network_open",
    marketplace_state: "awarded",
    responsible_organization_id: null,
    fulfillment_org_id: null,
    safety_flags: [],
    fulfillment_technician_id: "tech-jordan",
    age_min: 22,
    sla_deadline_at: "2026-06-03T23:33:00Z",
    eta_min: 7,
    lat: 40.7402,
    lng: -74.0027
  },
  {
    id: "JOB-E-2312",
    customer_display: "J. Miller",
    trust_state: "MATCHED",
    console_status: "accepted",
    access_type: "home",
    situation: "Broken key extraction",
    urgency: "low",
    area: "North Hills",
    address: "9 Oak Ridge",
    routing_source: "Partner phone intake",
    origin_org_id: "org-metro",
    customer_owner_org_id: "org-metro",
    origin_channel: "metro-key-phone",
    dispatch_mode: "organization_managed",
    fulfillment_policy: "private",
    marketplace_state: "private",
    responsible_organization_id: "org-metro",
    safety_flags: [],
    fulfillment_org_id: "org-metro",
    fulfillment_technician_id: "tech-samir",
    age_min: 14,
    sla_deadline_at: "2026-06-03T23:48:00Z",
    eta_min: 15,
    lat: 40.7950,
    lng: -73.9510
  },
  {
    id: "JOB-F-2320",
    customer_display: "Global Logistics",
    trust_state: "INTAKE",
    console_status: "stalled",
    access_type: "business",
    situation: "Locked out — gate code unknown",
    urgency: "critical",
    area: "Industrial Park",
    address: "500 Dock Rd",
    routing_source: "ClueXP managed routing",
    origin_org_id: CLUEXP_PLATFORM_ID,
    customer_owner_org_id: CLUEXP_PLATFORM_ID,
    origin_channel: "cluexp-public",
    dispatch_mode: "cluexp_managed_routing",
    fulfillment_policy: "network_open",
    marketplace_state: "offered_to_network",
    responsible_organization_id: null,
    fulfillment_org_id: null,
    safety_flags: [],
    age_min: 26,
    sla_min: 20,
    sla_deadline_at: "2026-06-03T23:22:00Z",
    escalation_reason: "No eligible technician in range",
    lat: 40.6890,
    lng: -74.0150
  }
];

export const offers: DispatchOffer[] = [
  {
    id: "offer-a-1",
    job_id: "JOB-A-2201",
    target_type: "technician",
    technician_id: "tech-jordan",
    status: "sent",
    rank: 1,
    offered_at: "2026-06-02T14:58:30Z",
    expires_at: "2026-06-02T15:00:00Z" // countdown driven by this value, not the client
  },
  {
    id: "offer-b-1",
    job_id: "JOB-B-2248",
    target_type: "organization",
    organization_id: "org-metro",
    status: "accepted",
    offered_at: "2026-06-02T14:42:00Z",
    expires_at: "2026-06-02T14:47:00Z",
    responded_at: "2026-06-02T14:44:00Z"
  }
];

export const events: DispatchEvent[] = [
  {
    id: "evt-1",
    job_id: "JOB-C-2289",
    actor_display: "Jack Wilson (ID: 002)",
    actor_scope: "cluexp",
    event: "Dispatcher took ownership",
    trust_state: "FULFILLMENT",
    reason: "Manual intervention — stale GPS",
    metadata: { action_code: "OWN_MANUAL_04" },
    at: "2026-06-02T14:25:31Z"
  },
  {
    id: "evt-2",
    job_id: "JOB-C-2289",
    actor_display: "System Watchdog",
    actor_scope: "system",
    event: "System escalation: GPS stale",
    trust_state: "FULFILLMENT",
    reason: "telemetry_loss",
    metadata: { stale_limit_s: 480, elapsed_s: 480 },
    at: "2026-06-02T14:23:10Z"
  },
  {
    id: "evt-3",
    job_id: "JOB-C-2289",
    actor_display: "Technician app (Morgan Vale)",
    actor_scope: "technician",
    event: "GPS update lost",
    trust_state: "FULFILLMENT",
    reason: "ping_timeout",
    at: "2026-06-02T14:15:00Z"
  },
  {
    id: "evt-4",
    job_id: "JOB-C-2289",
    actor_display: "Morgan Vale",
    actor_scope: "technician",
    event: "Technician assigned",
    trust_state: "MATCHED", // becomes MATCHED only at named-technician assignment
    metadata: { fulfillment_technician_id: "tech-morgan" },
    at: "2026-06-02T13:50:44Z"
  },
  {
    id: "evt-5",
    job_id: "JOB-C-2289",
    actor_display: "ClueXP Agent",
    actor_scope: "system",
    event: "Job created from intake",
    trust_state: "INTAKE",
    at: "2026-06-02T13:42:00Z"
  }
];

export const compliance: ComplianceEntry[] = [
  {
    id: "cmp-1",
    entity_name: "City Wide Lock",
    entity_type: "organization",
    category: "Liability insurance",
    document_status: "expired",
    last_verified: "2024-11-14",
    blocking: true
  },
  {
    id: "cmp-2",
    entity_name: "Marcus Vale",
    entity_type: "technician",
    category: "Locksmith license",
    document_status: "expired",
    last_verified: "2024-01-05",
    blocking: true
  },
  {
    id: "cmp-3",
    entity_name: "Samir Patel",
    entity_type: "technician",
    category: "Locksmith license",
    document_status: "verified",
    last_verified: "2024-03-20",
    blocking: false
  },
  {
    id: "cmp-4",
    entity_name: "Metro Key Partners",
    entity_type: "organization",
    category: "Liability insurance",
    document_status: "verified",
    last_verified: "2025-09-01",
    blocking: false
  }
];

export const dashboardAggregates: DashboardAggregates = {
  live_requests: jobs.filter((job) => job.console_status !== "completed" && job.console_status !== "cancelled").length,
  avg_eta_min: 11,
  active_professionals: technicians.filter((tech) => tech.is_available).length,
  sla_risk_count: jobs.filter((job) => job.urgency === "critical" || job.console_status === "stalled").length,
  revenue_today: "$4.8k",
  completion_rate: "92%"
};

export function technicianById(id?: string): Technician | undefined {
  return technicians.find((t) => t.id === id);
}

export function organizationById(id?: string): Organization | undefined {
  return organizations.find((o) => o.id === id);
}

export function eventsForJob(jobId: string): DispatchEvent[] {
  return events.filter((e) => e.job_id === jobId);
}

export const currentTechnician = technicians.find((tech) => tech.id === "tech-jordan") ?? technicians[0]!;

export const technicianAppProfile: TechnicianAppProfile = {
  technician_id: currentTechnician.id,
  availability: "online",
  gps_state: "tracking_active",
  alarm_state: "sound_enabled",
  auto_accept: false,
  current_shift_started_at: "2026-06-03T18:12:00Z",
  workspace_label: "Verified Network",
  masked_phone: "(555) ***-0144"
};

export const technicianSession: AuthSession = {
  user: authUsers[2]!,
  active_role: "technician",
  surface: "technician"
};

function mockOfferExpiresAt(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

export const technicianAppOffers: TechnicianAppOffer[] = [
  {
    offer_id: "offer-a-1",
    job_id: "JOB-A-2201",
    source: "cluexp",
    source_label: "ClueXP Network",
    distance_mi: 2.4,
    eta_min: 9,
    estimated_earnings: "$72-95",
    auto_accept_eligible: true,
    status: "sent",
    expires_at: mockOfferExpiresAt(75)
  },
  {
    offer_id: "offer-b-tech",
    job_id: "JOB-B-2248",
    source: "organization",
    source_label: "Metro Key Partners",
    team_label: "Home Team",
    distance_mi: 5.8,
    eta_min: 18,
    estimated_earnings: "Org settlement",
    auto_accept_eligible: false,
    status: "pending",
    expires_at: mockOfferExpiresAt(90)
  },
  {
    offer_id: "offer-superseded-demo",
    job_id: "JOB-C-2289",
    source: "cluexp",
    source_label: "ClueXP Network",
    distance_mi: 3.1,
    eta_min: 12,
    estimated_earnings: "$88-120",
    auto_accept_eligible: false,
    status: "superseded",
    expires_at: mockOfferExpiresAt(0),
    superseded_by: "Another verified technician accepted first"
  }
];

export const activeTechnicianJobIds = ["JOB-D-2301"];
export const assignedTechnicianJobIds = ["JOB-D-2301", "JOB-E-2312"];

export const technicianActivitySummary: TechnicianActivitySummary = {
  today_completed: 3,
  week_completed: 18,
  provisional_earnings: "$640",
  completion_rate: "96%"
};

export const technicianHistory: TechnicianHistoryEntry[] = [
  {
    id: "hist-1",
    job_id: "JOB-2198",
    label: "Car lockout · Downtown garage",
    source_label: "ClueXP",
    status: "completed",
    completed_at: "2026-06-03T16:32:00Z",
    amount: "$92"
  },
  {
    id: "hist-2",
    job_id: "JOB-2188",
    label: "Home rekey · North Hills",
    source_label: "Metro Key Partners",
    status: "completed",
    completed_at: "2026-06-03T14:08:00Z",
    amount: "Org settlement"
  },
  {
    id: "hist-3",
    job_id: "JOB-2170",
    label: "Expired offer · Strip Mall",
    source_label: "ClueXP",
    status: "expired",
    completed_at: "2026-06-02T21:40:00Z"
  }
];

export function jobById(id?: string): Job | undefined {
  return jobs.find((job) => job.id === id);
}

export function technicianOfferById(id?: string): TechnicianAppOffer | undefined {
  const offer = technicianAppOffers.find((item) => item.offer_id === id);
  if (!offer || offer.status === "superseded") return offer;
  const seconds = offer.offer_id === "offer-a-1" ? 75 : 90;
  return { ...offer, expires_at: mockOfferExpiresAt(seconds) };
}

export function technicianJobs(): Job[] {
  return jobs.filter((job) => assignedTechnicianJobIds.includes(job.id));
}

// Fulfillment cutover (Sprint 3) - mock tracking data

export function mockTrackingWithStatus(token: string, status: JobStatus): TrackingWithStatus {
  const job = jobs.find((j) => j.id === "JOB-A");
  return {
    ticket_id: token,
    token,
    trust_state: status === "pending_dispatch" || status === "assigned" ? "MATCHED" : "FULFILLMENT",
    status,
    access_type: "car",
    situation: "locked_out",
    location: { raw_text: "1234 Main St, Downtown" },
    assignment: job && ["assigned", "en_route", "arrived", "in_progress", "completed_pending_customer", "completed_confirmed", "completed_auto_closed", "disputed"].includes(status)
      ? {
          customer_owner: "Metro Key Partners",
          fulfillment_type: "company_technician",
          provider_company: "Metro Key Partners",
          technician_display_name: "Marcus Reyes",
          role: "Verified Technician",
          rating: 4.9,
          eta_min: 10,
          eta_max: 17,
          eta_is_estimate: true,
          assigned_at: "2026-06-09T14:30:00Z",
          job_status: status
        }
      : null,
    guards: {
      may_show_technician: status !== "pending_dispatch",
      may_show_eta: status === "assigned",
      may_show_live_tracking: status === "en_route" || status === "arrived" || status === "in_progress"
    },
    can_confirm: status === "completed_pending_customer",
    can_review: ["completed_pending_customer", "completed_confirmed", "completed_auto_closed", "disputed"].includes(status),
    can_dispute: status === "completed_pending_customer",
    terminal: ["completed_confirmed", "completed_auto_closed", "cancelled", "no_show"].includes(status)
  };
}

export function mockCustomerActions(status: JobStatus): CustomerActions {
  return {
    can_confirm: status === "completed_pending_customer",
    can_dispute: status === "completed_pending_customer",
    can_review: ["completed_pending_customer", "completed_confirmed", "completed_auto_closed", "disputed"].includes(status)
  };
}
