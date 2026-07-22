// Pure data logic for the provider dispatcher operations workspace (no React,
// no DOM) — combining /api/provider/queue, /api/provider/jobs, and
// /api/provider/fleet into one operational row set, plus the timer/risk/sort
// rules the workspace needs. Kept dependency-free so it runs under
// `node --test` without a browser or React renderer.

const STATUS_PENDING_DISPATCH = "pending_dispatch";

export type QueueRow = {
  id: string;
  operational_id?: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  access_type: string | null;
  situation: string | null;
  urgency: string | null;
  created_at: string | null;
  dispatch_attempts: number;
  offer_active: boolean;
  offered_technician_id: string | null;
  offer_expires_at: string | null;
  last_decline_reason: string | null;
  decline_count: number;
  photo_count?: number | null;
  photo_urls?: string[];
  detail?: Record<string, unknown>;
};

export type ActiveJobRow = {
  id: string;
  operational_id?: string | null;
  status: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  access_type: string | null;
  situation: string | null;
  urgency: string | null;
  created_at: string | null;
  fulfillment_technician_id: string | null;
  technician_display_name: string | null;
  technician_location_updated_at: string | null;
  active_status_started_at: string | null;
  offer_active: boolean;
  offer_expires_at: string | null;
  last_issue: string | null;
};

export type FleetActiveJob = {
  id: string;
  operational_id?: string | null;
  status: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  access_type: string | null;
  situation: string | null;
};

export type FleetRow = {
  id: string;
  display_name: string | null;
  profile_photo_url?: string | null;
  profile_photo_status?: string | null;
  photo_url?: string | null;
  skills: string[];
  is_available: boolean;
  current_lat: number | null;
  current_lng: number | null;
  location_updated_at: string | null;
  status?: string | null;
  phone?: string | null;
  marker_status?: "free" | "busy" | "inactive" | null;
  active_job: FleetActiveJob | null;
};

export type OperationsRow = {
  id: string;
  operational_id?: string | null;
  status: string;
  isRequest: boolean;
  address: string | null;
  lat: number | null;
  lng: number | null;
  access_type: string | null;
  situation: string | null;
  urgency: string | null;
  created_at: string | null;
  active_status_started_at: string | null;
  fulfillment_technician_id: string | null;
  technician_display_name: string | null;
  technician_location_updated_at: string | null;
  offer_active: boolean;
  offer_expires_at: string | null;
  dispatch_attempts: number | null;
  last_decline_reason: string | null;
  decline_count: number | null;
  photo_count: number | null;
  photo_urls: string[];
  last_issue: string | null;
  detail?: Record<string, unknown>;
};

/** Combine the pending-dispatch queue and the active/recoverable jobs feed
 * into one row per job id. A job can appear in both while it is still
 * `pending_dispatch` (the jobs feed's recoverable set includes it) — the
 * queue record wins for pending-dispatch fields (dispatch attempts, decline
 * history, photos); the jobs record wins for active/recovery fields
 * (assigned technician, `active_status_started_at`). */
export function mergeOperationsRows(queue: QueueRow[], jobs: ActiveJobRow[]): OperationsRow[] {
  const byId = new Map<string, OperationsRow>();
  for (const j of jobs) {
    byId.set(j.id, {
      id: j.id,
      operational_id: j.operational_id ?? null,
      status: j.status,
      isRequest: j.status === STATUS_PENDING_DISPATCH,
      address: j.address,
      lat: j.lat,
      lng: j.lng,
      access_type: j.access_type,
      situation: j.situation,
      urgency: j.urgency,
      created_at: j.created_at,
      active_status_started_at: j.active_status_started_at,
      fulfillment_technician_id: j.fulfillment_technician_id,
      technician_display_name: j.technician_display_name,
      technician_location_updated_at: j.technician_location_updated_at,
      offer_active: j.offer_active,
      offer_expires_at: j.offer_expires_at,
      dispatch_attempts: null,
      last_decline_reason: null,
      decline_count: null,
      photo_count: null,
      photo_urls: [],
      last_issue: j.last_issue,
    });
  }
  for (const q of queue) {
    const existing = byId.get(q.id);
    byId.set(q.id, {
      id: q.id,
      operational_id: q.operational_id ?? existing?.operational_id ?? null,
      status: STATUS_PENDING_DISPATCH,
      isRequest: true,
      address: q.address ?? existing?.address ?? null,
      lat: q.lat ?? existing?.lat ?? null,
      lng: q.lng ?? existing?.lng ?? null,
      access_type: q.access_type ?? existing?.access_type ?? null,
      situation: q.situation ?? existing?.situation ?? null,
      urgency: q.urgency ?? existing?.urgency ?? null,
      created_at: q.created_at ?? existing?.created_at ?? null,
      active_status_started_at: existing?.active_status_started_at ?? null,
      fulfillment_technician_id: q.offered_technician_id ?? existing?.fulfillment_technician_id ?? null,
      technician_display_name: existing?.technician_display_name ?? null,
      technician_location_updated_at: existing?.technician_location_updated_at ?? null,
      offer_active: q.offer_active,
      offer_expires_at: q.offer_expires_at,
      dispatch_attempts: q.dispatch_attempts,
      last_decline_reason: q.last_decline_reason,
      decline_count: q.decline_count,
      photo_count: q.photo_count ?? null,
      photo_urls: q.photo_urls ?? [],
      last_issue: existing?.last_issue ?? null,
      detail: q.detail,
    });
  }
  return [...byId.values()];
}

export function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / 60_000));
}

/** `now - created_at`, meaningful only for unassigned/pending requests. */
export function waitingMinutes(row: OperationsRow, now: number): number | null {
  return row.isRequest ? minutesSince(row.created_at, now) : null;
}

/** `now - active_status_started_at`, meaningful only for active jobs — never
 * falls back to `created_at`, so a job whose lifecycle timestamp is missing
 * truthfully reports "unknown" rather than a fabricated ongoing time. */
export function ongoingMinutes(row: OperationsRow, now: number): number | null {
  return row.isRequest ? null : minutesSince(row.active_status_started_at, now);
}

export function formatMinutes(mins: number | null): string {
  if (mins === null) return "—";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const SKILL_CODE_MAP: Array<[RegExp, { code: string; label: string }]> = [
  [/commercial|business/i, { code: "COM", label: "Commercial" }],
  [/auto|vehicle|car/i, { code: "AUTO", label: "Automotive" }],
  [/safe/i, { code: "SAFE", label: "Safe service" }],
  [/rekey/i, { code: "REKEY", label: "Rekeying" }],
  [/access|control|badge|keycard/i, { code: "ACCESS", label: "Access control" }],
  [/lockout|locked|unlock/i, { code: "LOCK", label: "Lockout" }],
  [/residential|home|house/i, { code: "RES", label: "Residential" }],
];

export const DEFAULT_SKILL_LEGEND: Array<{ code: string; label: string }> = [
  { code: "RES", label: "Residential" },
  { code: "COM", label: "Commercial" },
  { code: "AUTO", label: "Automotive" },
  { code: "SAFE", label: "Safe service" },
  { code: "LOCK", label: "Lockout" },
  { code: "REKEY", label: "Rekeying" },
  { code: "ACCESS", label: "Access control" },
];

export function skillCodeFor(skill: string): { code: string; label: string } {
  const normalized = skill.trim();
  for (const [pattern, mapped] of SKILL_CODE_MAP) {
    if (pattern.test(normalized)) return mapped;
  }
  const cleaned = normalized
    .split(/[._:\-/\s]+/)
    .filter(Boolean)
    .at(-1) ?? normalized;
  return {
    code: cleaned.slice(0, 5).toUpperCase() || "SKILL",
    label: cleaned.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
  };
}

export function technicianSkillCodes(skills: string[], limit = 3): { codes: Array<{ code: string; label: string }>; overflow: number } {
  const unique = new Map<string, { code: string; label: string }>();
  for (const skill of skills) {
    const mapped = skillCodeFor(skill);
    if (!unique.has(mapped.code)) unique.set(mapped.code, mapped);
  }
  const codes = [...unique.values()];
  return { codes: codes.slice(0, limit), overflow: Math.max(0, codes.length - limit) };
}

export type RequestRisk = "normal" | "ack_breached" | "stalled" | "critical";

/** Same semantics as LiveQueue's dispatch-SLA risk, reimplemented for the
 * merged operations row shape (kept independent rather than shared, since
 * refactoring the shipped LiveQueue's logic is out of scope here). */
export function requestRisk(row: OperationsRow, now: number, ackMinutes: number, stalledMinutes: number): RequestRisk {
  if (!row.isRequest) return "normal";
  if (row.urgency === "critical" && !row.offer_active) return "critical";
  if (row.offer_active) return "normal";
  const waiting = waitingMinutes(row, now);
  if (waiting === null) return "normal";
  if (waiting >= stalledMinutes) return "stalled";
  if ((row.dispatch_attempts ?? 0) === 0 && waiting >= ackMinutes) return "ack_breached";
  return "normal";
}

function riskRank(risk: RequestRisk): number {
  if (risk === "critical" || risk === "stalled") return 0;
  if (risk === "ack_breached") return 1;
  return 2;
}

/** Sort order: critical/SLA-breached requests first, then at-risk, then the
 * rest of the requests oldest-waiting first, then active jobs longest-ongoing
 * first. */
export function compareOperationsRows(
  a: OperationsRow, b: OperationsRow, now: number, ackMinutes: number, stalledMinutes: number,
): number {
  if (a.isRequest !== b.isRequest) return a.isRequest ? -1 : 1;
  if (a.isRequest) {
    const rankDiff = riskRank(requestRisk(a, now, ackMinutes, stalledMinutes)) - riskRank(requestRisk(b, now, ackMinutes, stalledMinutes));
    if (rankDiff !== 0) return rankDiff;
    return (waitingMinutes(b, now) ?? 0) - (waitingMinutes(a, now) ?? 0);
  }
  return (ongoingMinutes(b, now) ?? -1) - (ongoingMinutes(a, now) ?? -1);
}

export function sortOperationsRows(rows: OperationsRow[], now: number, ackMinutes: number, stalledMinutes: number): OperationsRow[] {
  return [...rows].sort((a, b) => compareOperationsRows(a, b, now, ackMinutes, stalledMinutes));
}

export type TechnicianStatusLabel = "Available" | "Busy" | "Offline";

/** The fleet feed only ever reports free/busy/inactive — map those to
 * dispatcher-facing labels without inventing richer statuses (en route, on
 * site, break) the backend doesn't actually track yet. */
export function technicianStatusLabel(markerStatus: FleetRow["marker_status"]): TechnicianStatusLabel {
  if (markerStatus === "free") return "Available";
  if (markerStatus === "busy") return "Busy";
  return "Offline";
}

export function groupTechnicians(fleet: FleetRow[]): Record<TechnicianStatusLabel, FleetRow[]> {
  const groups: Record<TechnicianStatusLabel, FleetRow[]> = { Available: [], Busy: [], Offline: [] };
  for (const tech of fleet) groups[technicianStatusLabel(tech.marker_status)].push(tech);
  return groups;
}

export function locationFreshness(updatedAt: string | null, now: number, staleMinutes: number): { label: string; stale: boolean } {
  const mins = minutesSince(updatedAt, now);
  if (mins === null) return { label: "no location", stale: true };
  const age = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  return { label: mins >= staleMinutes ? `stale · ${age}` : age, stale: mins >= staleMinutes };
}

export function missingCoordinateMessage(row: OperationsRow, showingTechnicianLocation: boolean): string {
  const hasAddress = Boolean(row.address?.trim());
  if (hasAddress) {
    return showingTechnicianLocation
      ? "Address saved, but map coordinates are not resolved yet. Showing the assigned technician's last reported location."
      : "Address saved, but map coordinates are not resolved yet.";
  }
  return showingTechnicianLocation
    ? "Selected job has no address or coordinates. Showing the assigned technician's last reported location."
    : "Selected job has no address or coordinates.";
}

export type OperationsSummary = {
  unassigned: number;
  atRisk: number;
  activeJobs: number;
  availableTechnicians: number;
  busyTechnicians: number;
  offlineTechnicians: number;
  allTechnicians: number;
};

export function summarizeOperations(
  rows: OperationsRow[], fleet: FleetRow[], now: number, ackMinutes: number, stalledMinutes: number,
): OperationsSummary {
  let unassigned = 0, atRisk = 0, activeJobs = 0;
  for (const row of rows) {
    if (row.isRequest) {
      unassigned += 1;
      if (requestRisk(row, now, ackMinutes, stalledMinutes) !== "normal") atRisk += 1;
    } else {
      activeJobs += 1;
    }
  }
  const groups = groupTechnicians(fleet);
  return {
    unassigned,
    atRisk,
    activeJobs,
    availableTechnicians: groups.Available.length,
    busyTechnicians: groups.Busy.length,
    offlineTechnicians: groups.Offline.length,
    allTechnicians: fleet.length,
  };
}
