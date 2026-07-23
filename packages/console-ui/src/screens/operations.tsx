"use client";

import type { ConsoleMode } from "@cluexp/api-client";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  RefreshCw,
  Route,
  Send,
  UserRound,
  X,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMapView } from "../components/google-map";
import type { MapPoint } from "../components/google-map";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  LoadingSkeleton,
  PageHeader,
} from "../components";
import { cn } from "../lib/cn";
import {
  DEFAULT_SKILL_LEGEND,
  formatMinutes,
  groupTechnicians,
  locationFreshness,
  missingCoordinateMessage,
  mergeOperationsRows,
  ongoingMinutes,
  requestRisk,
  skillCodeFor,
  sortOperationsRows,
  summarizeOperations,
  technicianStatusLabel,
  technicianSkillCodes,
  waitingMinutes,
} from "./operations-logic";
import type {
  ActiveJobRow,
  FleetRow,
  OperationsRow,
  QueueRow,
  RequestRisk,
  TechnicianStatusLabel,
} from "./operations-logic";

type BadgeVariant = "neutral" | "info" | "success" | "warn" | "danger" | "critical" | "outline";

function positiveMinutes(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const ACK_SLA_MINUTES = positiveMinutes(process.env.NEXT_PUBLIC_DISPATCH_ACK_SLA_MINUTES, 5);
const STALLED_MINUTES = Math.max(ACK_SLA_MINUTES, positiveMinutes(process.env.NEXT_PUBLIC_DISPATCH_STALLED_MINUTES, 15));
const LOCATION_STALE_MINUTES = positiveMinutes(process.env.NEXT_PUBLIC_LOCATION_STALE_MINUTES, 15);
const OPERATIONS_REFRESH_SECONDS = positiveMinutes(process.env.NEXT_PUBLIC_OPERATIONS_REFRESH_SECONDS, 30);
const AUTO_SCAN_IDLE_MS = 25_000;
const AUTO_SCAN_STEP_MS = 10_000;

const JOB_STATUS_LABEL: Record<string, string> = {
  pending_dispatch: "Unassigned",
  assigned: "Assigned",
  en_route: "En route",
  arrived: "On site",
  in_progress: "In service",
  completed_pending_customer: "Awaiting confirmation",
  disputed: "Disputed",
};

const JOB_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending_dispatch: "outline",
  assigned: "info",
  en_route: "info",
  arrived: "success",
  in_progress: "success",
  completed_pending_customer: "warn",
  disputed: "danger",
};

const RISK_LABEL: Record<RequestRisk, string | null> = {
  normal: null,
  ack_breached: "Ack SLA breached",
  stalled: "Stalled",
  critical: "Critical · act now",
};

const RISK_VARIANT: Record<RequestRisk, BadgeVariant> = {
  normal: "outline",
  ack_breached: "warn",
  stalled: "danger",
  critical: "critical",
};

function normalizedJobType(row: { access_type: string | null; situation: string | null }) {
  const parts = [row.access_type, row.situation]
    .filter(Boolean)
    .map((part) => String(part).replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()));
  return parts.join(" / ") || "General service";
}

function requiredSkillCodesForRow(row: OperationsRow | null): Set<string> {
  const values = [row?.access_type, row?.situation].filter(Boolean) as string[];
  return new Set(values.map((value) => skillCodeFor(value).code));
}

function toMapRisk(risk: RequestRisk): "normal" | "watch" | "critical" {
  if (risk === "critical" || risk === "stalled") return "critical";
  if (risk === "ack_breached") return "watch";
  return "normal";
}

const TECH_SORT_RANK: Record<TechnicianStatusLabel, number> = {
  Available: 0,
  Busy: 1,
  Offline: 2,
};

function compareTechnicians(a: FleetRow, b: FleetRow, now: number) {
  const aStatus = technicianStatusLabel(a.marker_status);
  const bStatus = technicianStatusLabel(b.marker_status);
  const statusDelta = TECH_SORT_RANK[aStatus] - TECH_SORT_RANK[bStatus];
  if (statusDelta !== 0) return statusDelta;
  const aFresh = locationFreshness(a.location_updated_at, now, LOCATION_STALE_MINUTES);
  const bFresh = locationFreshness(b.location_updated_at, now, LOCATION_STALE_MINUTES);
  const aTrust = a.current_lat == null || a.current_lng == null ? 2 : aFresh.stale ? 1 : 0;
  const bTrust = b.current_lat == null || b.current_lng == null ? 2 : bFresh.stale ? 1 : 0;
  if (aTrust !== bTrust) return aTrust - bTrust;
  return (a.display_name ?? a.id).localeCompare(b.display_name ?? b.id);
}

type QueueTab = "all" | "requests" | "active";
type TechFilter = "all" | TechnicianStatusLabel;

type Candidate = {
  id: string;
  display_name: string | null;
  is_online: boolean;
  is_busy: boolean;
  skills_match: boolean;
  organization_supports_skill?: boolean;
  technician_supports_skill?: boolean;
  distance_mi?: number | null;
  distance_km?: number | null;
  dist_km?: number | null;
  eta_min: number | null;
  eta_max: number | null;
  current_lat?: number | null;
  current_lng?: number | null;
  active_job?: FleetRow["active_job"];
};

type CandidatesResponse = { candidates: Candidate[]; distance_unit?: "mi" | "km" };

type DispatchNumberSetting = { value: number; is_override: boolean; platform_default: number };
type DispatchSettingsResponse = {
  ack_sla_minutes?: DispatchNumberSetting;
  stalled_minutes?: DispatchNumberSetting;
  operations_refresh_seconds?: DispatchNumberSetting;
};

function candidateDistance(candidate: Candidate, unit: "mi" | "km"): string {
  if (unit === "km") {
    if (candidate.distance_km != null) return `${candidate.distance_km} km`;
    if (candidate.dist_km != null) return `${candidate.dist_km} km`;
  } else {
    if (candidate.distance_mi != null) return `${candidate.distance_mi} mi`;
    if (candidate.dist_km != null) return `${Math.round(candidate.dist_km * 0.621371 * 100) / 100} mi`;
  }
  return "distance unknown";
}

function jobDisplayId(job: { id: string; operational_id?: string | null }) {
  return job.operational_id?.trim() || "No operation ID";
}

type ActiveJobException = {
  action: string;
  detail: string;
  label: string;
  severity: "critical" | "warn";
};

function activeJobException(row: OperationsRow, now: number): ActiveJobException | null {
  if (row.isRequest) return null;
  if (row.status === "disputed") {
    return {
      action: "Open dispute review",
      detail: row.last_issue
        ? `Customer dispute is open: ${row.last_issue}`
        : "Customer dispute is open. Review the timeline, notes, and close with an audited resolution.",
      label: "Dispute",
      severity: "critical",
    };
  }
  const ongoing = ongoingMinutes(row, now);
  if (row.status === "completed_pending_customer") {
    return {
      action: "Open confirmation",
      detail: `Customer confirmation is still pending${ongoing != null ? ` after ${formatMinutes(ongoing)}` : ""}. Confirm by phone in job detail only when the customer has approved receipt.`,
      label: "Confirm wait",
      severity: "warn",
    };
  }
  const freshness = row.technician_location_updated_at
    ? locationFreshness(row.technician_location_updated_at, now, LOCATION_STALE_MINUTES)
    : null;
  if (freshness?.stale) {
    return {
      action: "Focus technician",
      detail: `Assigned technician location is stale (${freshness.label.replace("stale · ", "")}). Verify the technician before dispatching nearby work.`,
      label: "Stale tech location",
      severity: "warn",
    };
  }
  if ((ongoing ?? 0) >= 180) {
    return {
      action: "Review job detail",
      detail: `This job has been active for ${formatMinutes(ongoing)}. Check notes or technician status before assigning nearby requests.`,
      label: "Long-running",
      severity: "warn",
    };
  }
  return null;
}

function activeJobExceptionLabel(row: OperationsRow, now: number): string | null {
  return activeJobException(row, now)?.label ?? null;
}

function operationMapCallout(
  row: OperationsRow,
  now: number,
  ackSlaMinutes: number,
  stalledMinutes: number,
  candidateCount?: number,
): NonNullable<MapPoint["callout"]> {
  const displayId = jobDisplayId(row);
  const status = JOB_STATUS_LABEL[row.status] ?? row.status;
  const time = row.isRequest
    ? `Waiting ${formatMinutes(waitingMinutes(row, now))}`
    : `Ongoing ${formatMinutes(ongoingMinutes(row, now))}`;
  const risk = row.isRequest ? requestRisk(row, now, ackSlaMinutes, stalledMinutes) : "normal";
  const exception = row.isRequest ? null : activeJobException(row, now);
  const riskLabel = row.isRequest ? RISK_LABEL[risk] : exception?.detail;
  const assignment = row.technician_display_name
    ? `Assigned: ${row.technician_display_name}`
    : row.isRequest
      ? row.offer_active ? "Offer active" : "Awaiting assignment"
      : "No technician on record";
  const lines = [
    row.address ?? "No address on file",
    assignment,
    row.isRequest && candidateCount != null ? `${candidateCount} candidate${candidateCount === 1 ? "" : "s"} ranked` : null,
    riskLabel,
  ].filter(Boolean) as string[];

  return {
    title: `${row.isRequest ? "Request" : "Job"} ${displayId}`,
    meta: [status, time, normalizedJobType(row)],
    lines,
  };
}

function requestChipTone(risk: RequestRisk): NonNullable<MapPoint["chipTone"]> {
  if (risk === "critical" || risk === "stalled") return "critical";
  if (risk === "ack_breached") return "warn";
  return "info";
}

function activeJobChipTone(row: OperationsRow, now: number): NonNullable<MapPoint["chipTone"]> {
  if (row.status === "disputed") return "critical";
  return activeJobExceptionLabel(row, now) ? "warn" : "neutral";
}

/** The production operations workspace: map + work queue + technician roster
 * in one screen, composed client-side from the existing queue/jobs/fleet
 * endpoints (see docs/PROVIDER-DISPATCHER-OPERATIONS-PROMPT.md). Additive —
 * /map and /queue keep working unchanged. */
export function DispatcherOperations({ mode }: { mode: ConsoleMode }) {
  const apiPrefix = mode === "org" ? "/api/provider" : "/api/ops";

  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [activeJobs, setActiveJobs] = useState<ActiveJobRow[] | null>(null);
  const [fleet, setFleet] = useState<FleetRow[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dispatchSettings, setDispatchSettings] = useState<DispatchSettingsResponse | null>(null);

  const [selectedWork, setSelectedWork] = useState<{ kind: "job" | "request"; id: string } | null>(null);
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState<{ kind: "job" | "request" | "tech"; id: string } | null>(null);
  const [tab, setTab] = useState<QueueTab>("all");
  const [riskOnly, setRiskOnly] = useState(false);
  const [techFilter, setTechFilter] = useState<TechFilter>("all");
  const [assigning, setAssigning] = useState(false);
  const [assignedMessage, setAssignedMessage] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [assignmentModalTechId, setAssignmentModalTechId] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`${apiPrefix}/queue`);
      if (!res.ok) throw new Error(`${res.status}`);
      setQueue(await res.json());
      setQueueError(null);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Failed to load requests");
    }
  }, [apiPrefix]);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${apiPrefix}/jobs`);
      if (!res.ok) throw new Error(`${res.status}`);
      setActiveJobs(await res.json());
      setJobsError(null);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "Failed to load active jobs");
    }
  }, [apiPrefix]);

  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch(`${apiPrefix}/fleet`);
      if (!res.ok) throw new Error(`${res.status}`);
      setFleet(await res.json());
      setFleetError(null);
    } catch (err) {
      setFleetError(err instanceof Error ? err.message : "Failed to load technician roster");
    }
  }, [apiPrefix]);

  const fetchDispatchSettings = useCallback(async () => {
    if (mode !== "org") {
      setDispatchSettings(null);
      setSettingsError(null);
      return;
    }
    try {
      const res = await fetch(`${apiPrefix}/settings/dispatch`);
      if (!res.ok) throw new Error(`${res.status}`);
      setDispatchSettings(await res.json());
      setSettingsError(null);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to load dispatch settings");
    }
  }, [apiPrefix, mode]);

  const fetchAll = useCallback(async () => {
    await Promise.allSettled([fetchQueue(), fetchJobs(), fetchFleet(), fetchDispatchSettings()]);
    setLastUpdated(Date.now());
  }, [fetchQueue, fetchJobs, fetchFleet, fetchDispatchSettings]);

  const ackSlaMinutes = dispatchSettings?.ack_sla_minutes?.value ?? ACK_SLA_MINUTES;
  const stalledMinutes = Math.max(
    ackSlaMinutes,
    dispatchSettings?.stalled_minutes?.value ?? STALLED_MINUTES,
  );
  const operationsRefreshMs = positiveMinutes(
    String(dispatchSettings?.operations_refresh_seconds?.value ?? OPERATIONS_REFRESH_SECONDS),
    OPERATIONS_REFRESH_SECONDS,
  ) * 1000;

  useEffect(() => {
    fetchAll();
    const id = window.setInterval(fetchAll, operationsRefreshMs);
    return () => window.clearInterval(id);
  }, [fetchAll, operationsRefreshMs]);

  // Ticks the waiting/ongoing timers between polls without re-fetching.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), operationsRefreshMs);
    return () => window.clearInterval(id);
  }, [operationsRefreshMs]);

  const rows = useMemo(() => mergeOperationsRows(queue ?? [], activeJobs ?? []), [queue, activeJobs]);
  const sorted = useMemo(() => sortOperationsRows(rows, now, ackSlaMinutes, stalledMinutes), [rows, now, ackSlaMinutes, stalledMinutes]);
  const summary = useMemo(
    () => summarizeOperations(rows, fleet ?? [], now, ackSlaMinutes, stalledMinutes),
    [rows, fleet, now, ackSlaMinutes, stalledMinutes],
  );
  const techGroups = useMemo(() => groupTechnicians(fleet ?? []), [fleet]);

  const visibleRows = useMemo(() => {
    let list = sorted;
    if (tab === "requests") list = list.filter((r) => r.isRequest);
    if (tab === "active") list = list.filter((r) => !r.isRequest);
    if (riskOnly) list = list.filter((r) => r.isRequest && requestRisk(r, now, ackSlaMinutes, stalledMinutes) !== "normal");
    return list;
  }, [sorted, tab, riskOnly, now, ackSlaMinutes, stalledMinutes]);

  const [candidates, setCandidates] = useState<CandidatesResponse | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  const selectedRow = selectedWork ? sorted.find((r) => r.id === selectedWork.id) ?? null : null;
  const selectedTech = selectedTechId ? (fleet ?? []).find((t) => t.id === selectedTechId) ?? null : null;
  const candidateById = useMemo(
    () => new Map((candidates?.candidates ?? []).map((candidate) => [candidate.id, candidate])),
    [candidates],
  );
  const candidateRankById = useMemo(
    () => new Map((candidates?.candidates ?? []).map((candidate, index) => [candidate.id, index + 1])),
    [candidates],
  );
  const assignmentModalTech = assignmentModalTechId ? (fleet ?? []).find((tech) => tech.id === assignmentModalTechId) ?? null : null;
  const assignmentModalCandidate = assignmentModalTechId ? candidateById.get(assignmentModalTechId) ?? null : null;
  const requiredSkillCodes = useMemo(() => requiredSkillCodesForRow(selectedRow), [selectedRow]);
  const activeOffer = Boolean(selectedRow?.isRequest && selectedRow.offer_active);
  const highlightedTechId = selectedTechId ?? selectedRow?.fulfillment_technician_id ?? null;
  const highlightedWorkId = selectedRow?.id ?? selectedTech?.active_job?.id ?? null;
  const visibleTechs = useMemo(() => {
    const base = techFilter === "all" ? (fleet ?? []) : techGroups[techFilter];
    const candidateRank = new Map((candidates?.candidates ?? []).map((candidate, index) => [candidate.id, index]));
    return [...base].sort((a, b) => {
      if (selectedRow?.isRequest) {
        const aRank = candidateRank.get(a.id);
        const bRank = candidateRank.get(b.id);
        if (aRank != null || bRank != null) return (aRank ?? 9999) - (bRank ?? 9999);
      }
      if (selectedRow && !selectedRow.isRequest) {
        if (a.id === selectedRow.fulfillment_technician_id) return -1;
        if (b.id === selectedRow.fulfillment_technician_id) return 1;
      }
      return compareTechnicians(a, b, now);
    });
  }, [candidates, fleet, now, selectedRow, techFilter, techGroups]);

  useEffect(() => {
    if (!selectedRow?.isRequest) { setCandidates(null); setCandidatesError(null); return; }
    let cancelled = false;
    setCandidates(null);
    setCandidatesError(null);
    fetch(`${apiPrefix}/queue/${selectedRow.id}/candidates`)
      .then((res) => { if (!res.ok) throw new Error(`${res.status}`); return res.json(); })
      .then((data) => { if (!cancelled) setCandidates(data); })
      .catch((err) => { if (!cancelled) setCandidatesError(err instanceof Error ? err.message : "Failed to load candidates"); });
    return () => { cancelled = true; };
  }, [selectedRow?.id, selectedRow?.isRequest, apiPrefix]);

  const selectWork = useCallback((row: OperationsRow) => {
    const nextWork = selectedWork?.id === row.id ? null : { kind: row.isRequest ? "request" as const : "job" as const, id: row.id };
    setAssignError(null);
    setAssignedMessage(null);
    setOverrideReason("");
    setAssignmentModalTechId(null);
    setSelectedWork(nextWork);
    setMapFocus(nextWork);
    if (!row.isRequest && row.fulfillment_technician_id) setSelectedTechId(row.fulfillment_technician_id);
    if (row.isRequest && row.fulfillment_technician_id) setSelectedTechId(row.fulfillment_technician_id);
  }, [selectedWork?.id]);

  const selectTech = useCallback((tech: FleetRow) => {
    const nextTechId = selectedTechId === tech.id ? null : tech.id;
    setSelectedTechId(nextTechId);
    setMapFocus(nextTechId ? { kind: "tech", id: tech.id } : selectedWork);
    setAssignedMessage(null);
    setAssignError(null);
    setOverrideReason("");
    setAssignmentModalTechId(null);
  }, [selectedTechId, selectedWork]);

  const focusJobFromTech = useCallback((jobId: string) => {
    const nextWork = { kind: "job" as const, id: jobId };
    setSelectedWork(nextWork);
    setMapFocus(nextWork);
    setAssignedMessage(null);
    setAssignError(null);
    setOverrideReason("");
    setAssignmentModalTechId(null);
  }, []);

  const clearFocus = useCallback(() => {
    setSelectedWork(null);
    setSelectedTechId(null);
    setMapFocus(null);
    setAssignError(null);
    setAssignedMessage(null);
    setOverrideReason("");
    setAssignmentModalTechId(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearFocus]);

  function candidateFlags(candidate: Candidate | null) {
    if (!candidate) return [];
    return [
      !candidate.is_online && "stale location",
      candidate.is_busy && "busy",
      candidate.organization_supports_skill === false && "company capability missing",
      candidate.organization_supports_skill !== false && candidate.technician_supports_skill === false && "technician skill missing",
      candidate.skills_match === false && candidate.organization_supports_skill !== false && candidate.technician_supports_skill !== false && "skill mismatch",
    ].filter(Boolean) as string[];
  }

  async function assignTechnician(technicianId: string, reason?: string) {
    if (!selectedRow?.isRequest) return;
    setAssigning(true);
    setAssignError(null);
    setAssignedMessage(null);
    try {
      const res = await fetch(`${apiPrefix}/queue/${selectedRow.id}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { technician_id: technicianId, override_reason: reason } : { technician_id: technicianId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `${res.status}`);
      const techName = (fleet ?? []).find((tech) => tech.id === technicianId)?.display_name
        ?? candidateById.get(technicianId)?.display_name
        ?? technicianId;
      setAssignedMessage(`Offer sent to ${techName}.`);
      setOverrideReason("");
      setAssignmentModalTechId(null);
      await fetchAll();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setAssigning(false);
    }
  }

  const selectedRequestCandidateCount = selectedRow?.isRequest ? candidates?.candidates.length : undefined;
  const requestPoints: MapPoint[] = sorted
    .filter((r) => r.isRequest && r.lat != null && r.lng != null)
    .map((r): MapPoint => {
      const risk = requestRisk(r, now, ackSlaMinutes, stalledMinutes);
      const selected = r.id === highlightedWorkId;
      return {
        lat: r.lat!,
        lng: r.lng!,
        kind: "request",
        id: r.id,
        label: r.address ?? jobDisplayId(r),
        risk: toMapRisk(risk),
        markerLabel: "R",
        selected,
        chip: formatMinutes(waitingMinutes(r, now)),
        chipTone: requestChipTone(risk),
        chipVisible: selected || risk !== "normal",
        callout: operationMapCallout(
          r,
          now,
          ackSlaMinutes,
          stalledMinutes,
          r.id === selectedRow?.id ? selectedRequestCandidateCount : undefined,
        ),
      };
    });
  const jobPoints: MapPoint[] = sorted
    .filter((r) => !r.isRequest && r.lat != null && r.lng != null)
    .map((r): MapPoint => {
      const selected = r.id === highlightedWorkId;
      const exception = activeJobExceptionLabel(r, now);
      const ongoing = ongoingMinutes(r, now);
      return {
        lat: r.lat!,
        lng: r.lng!,
        kind: "job",
        id: r.id,
        label: r.address ?? jobDisplayId(r),
        markerLabel: "J",
        selected,
        chip: ongoing != null ? formatMinutes(ongoing) : undefined,
        chipTone: activeJobChipTone(r, now),
        chipVisible: selected || Boolean(exception),
        callout: operationMapCallout(r, now, ackSlaMinutes, stalledMinutes),
      };
    });
  const techPoints: MapPoint[] = (fleet ?? [])
    .filter((t) => t.current_lat != null && t.current_lng != null)
    .map((t): MapPoint => {
      const rank = selectedRow?.isRequest ? candidateRankById.get(t.id) : undefined;
      return {
        lat: t.current_lat!, lng: t.current_lng!, kind: "tech", id: t.id,
        label: t.display_name ?? t.id, status: t.marker_status ?? undefined,
        avatarUrl: t.profile_photo_url ?? t.photo_url ?? null,
        initials: initialsFor(t.display_name ?? t.id),
        stale: locationFreshness(t.location_updated_at, now, LOCATION_STALE_MINUTES).stale,
        rankBadge: rank != null && rank <= 3 ? String(rank) : undefined,
        selected: t.id === highlightedTechId,
      };
    });
  const allPoints = [...requestPoints, ...jobPoints, ...techPoints];
  const selectedWorkPoint = selectedRow?.lat != null && selectedRow.lng != null
    ? {
      lat: selectedRow.lat,
      lng: selectedRow.lng,
      kind: selectedRow.isRequest ? "request" : "job",
      id: selectedRow.id,
      label: selectedRow.address ?? jobDisplayId(selectedRow),
      markerLabel: selectedRow.isRequest ? "R" : "J",
      selected: true,
      chip: selectedRow.isRequest
        ? formatMinutes(waitingMinutes(selectedRow, now))
        : ongoingMinutes(selectedRow, now) != null
          ? formatMinutes(ongoingMinutes(selectedRow, now))
          : undefined,
      chipTone: selectedRow.isRequest
        ? requestChipTone(requestRisk(selectedRow, now, ackSlaMinutes, stalledMinutes))
        : activeJobChipTone(selectedRow, now),
      chipVisible: true,
      callout: operationMapCallout(selectedRow, now, ackSlaMinutes, stalledMinutes, selectedRow.isRequest ? selectedRequestCandidateCount : undefined),
    } satisfies MapPoint
    : null;
  const selectedTechPoint = selectedTech?.current_lat != null && selectedTech.current_lng != null
    ? {
      lat: selectedTech.current_lat,
      lng: selectedTech.current_lng,
      kind: "tech",
      id: selectedTech.id,
      label: selectedTech.display_name ?? selectedTech.id,
      status: selectedTech.marker_status ?? undefined,
      avatarUrl: selectedTech.profile_photo_url ?? selectedTech.photo_url ?? null,
      initials: initialsFor(selectedTech.display_name ?? selectedTech.id),
      stale: locationFreshness(selectedTech.location_updated_at, now, LOCATION_STALE_MINUTES).stale,
      rankBadge: selectedRow?.isRequest && candidateRankById.get(selectedTech.id) != null && candidateRankById.get(selectedTech.id)! <= 3 ? String(candidateRankById.get(selectedTech.id)) : undefined,
      selected: true,
    } satisfies MapPoint
    : null;
  const mapFocusPoint = mapFocus?.kind === "tech" ? selectedTechPoint : selectedWorkPoint ?? selectedTechPoint;
  const focusPairs: [MapPoint, MapPoint][] = selectedWorkPoint && selectedTechPoint ? [[selectedTechPoint, selectedWorkPoint]] : [];
  const mappedTechCount = techPoints.length;
  const locationIssueCount = (fleet ?? []).filter((tech) => {
    if (tech.current_lat == null || tech.current_lng == null) return true;
    return locationFreshness(tech.location_updated_at, now, LOCATION_STALE_MINUTES).stale;
  }).length;
  const availableMappedCount = techPoints.filter((point) => point.status === "free").length;
  const selectedWorkMissingLocation = Boolean(selectedRow && (selectedRow.lat == null || selectedRow.lng == null));

  const initialLoad = queue === null && activeJobs === null && fleet === null && !queueError && !jobsError && !fleetError;
  const sourceErrors = [
    queueError && "requests", jobsError && "active jobs", fleetError && "technician roster", settingsError && "dispatch settings",
  ].filter(Boolean) as string[];

  return (
    <div>
      <PageHeader
        kicker="Dispatcher workspace"
        title={mode === "org" ? "Copilot" : "Operations"}
      />

      <div className="mb-4 flex items-center gap-2 overflow-x-auto rounded-md border border-border bg-card/40 p-2 [scrollbar-width:thin]" aria-label="Operations insight filters">
        <button
          aria-pressed={tab === "all" && !riskOnly}
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tab === "all" && !riskOnly ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-card hover:text-foreground",
          )}
          onClick={() => { setTab("all"); setRiskOnly(false); }}
          type="button"
        >
          Work ({rows.length})
        </button>
        <div className="flex shrink-0 items-center gap-2 border-r border-border pr-2">
          <MetricTile label="Unassigned" value={String(summary.unassigned)} active={tab === "requests" && !riskOnly} onClick={() => { setTab("requests"); setRiskOnly(false); }} />
          <MetricTile label="At risk" value={String(summary.atRisk)} intent="danger" active={riskOnly} onClick={() => { setTab("requests"); setRiskOnly(true); }} />
          <MetricTile label="Active jobs" value={String(summary.activeJobs)} active={tab === "active"} onClick={() => { setTab("active"); setRiskOnly(false); }} />
        </div>
        <button
          aria-pressed={techFilter === "all"}
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            techFilter === "all" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-card hover:text-foreground",
          )}
          onClick={() => setTechFilter("all")}
          type="button"
        >
          Technicians ({summary.allTechnicians})
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <MetricTile label="Available" value={String(summary.availableTechnicians)} intent="success" active={techFilter === "Available"} onClick={() => setTechFilter((f) => (f === "Available" ? "all" : "Available"))} />
          <MetricTile label="Busy" value={String(summary.busyTechnicians)} intent="warn" active={techFilter === "Busy"} onClick={() => setTechFilter((f) => (f === "Busy" ? "all" : "Busy"))} />
          <MetricTile label="Offline" value={String(summary.offlineTechnicians)} active={techFilter === "Offline"} onClick={() => setTechFilter((f) => (f === "Offline" ? "all" : "Offline"))} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-[11px] text-muted-foreground">
          <span>{lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : "Loading..."}</span>
          <Button aria-label="Refresh" className="h-7 w-7 p-0" title="Refresh" variant="outline" onClick={() => void fetchAll()}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {sourceErrors.length > 0 ? (
        <div className="mb-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <AlertTriangle className="mr-1.5 inline size-4" aria-hidden />
          {sourceErrors.join(", ")} failed to load. Showing what is available; retrying automatically.
        </div>
      ) : null}

      {initialLoad ? (
        <LoadingSkeleton />
      ) : (
        <>
        <div className="grid gap-4 xl:h-[calc(100vh-260px)] xl:min-h-[560px] xl:grid-cols-[48fr_29fr_23fr]">
          <Card className="overflow-hidden xl:h-full">
            <CardContent className="relative h-[420px] p-0 xl:h-full">
              <div className="absolute inset-0 bg-[#101720]">
                {allPoints.length > 0 ? (
                  <GoogleMapView
                    clusterMarkers
                    points={allPoints}
                    pairs={focusPairs}
                    focusPoint={mapFocusPoint}
                    richMarkers
                    showViewportControls
                    onMarkerClick={(point) => {
                      if (!point.id) return;
                      if (point.kind === "tech") {
                        setSelectedTechId(point.id);
                        setMapFocus({ kind: "tech", id: point.id });
                      } else {
                        const nextWork = { kind: point.kind === "request" ? "request" as const : "job" as const, id: point.id };
                        setSelectedWork(nextWork);
                        setMapFocus(nextWork);
                      }
                    }}
                    fallback={
                      <div className="absolute inset-0 grid content-start gap-2 overflow-y-auto p-4 text-xs text-muted-foreground">
                        <div className="mb-1 font-medium text-foreground">Map key not configured — list view</div>
                        {allPoints.map((point) => (
                          <button
                            className="rounded-md border border-border bg-background/90 px-3 py-2 text-left"
                            key={`${point.kind}-${point.id}`}
                            type="button"
                            onClick={() => {
                              if (!point.id) return;
                              if (point.kind === "tech") {
                                setSelectedTechId(point.id);
                                setMapFocus({ kind: "tech", id: point.id });
                              } else {
                                const nextWork = { kind: point.kind === "request" ? "request" as const : "job" as const, id: point.id };
                                setSelectedWork(nextWork);
                                setMapFocus(nextWork);
                              }
                            }}
                          >
                            <span className="font-medium text-foreground">{point.label}</span>
                            <span className="ml-2 tabular-nums">{point.lat.toFixed(4)}, {point.lng.toFixed(4)}</span>
                          </button>
                        ))}
                      </div>
                    }
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">No location data yet</div>
                )}
              </div>
              <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border bg-background/90 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground backdrop-blur">
                Tech coverage · {mappedTechCount} of {(fleet ?? []).length} mapped · {availableMappedCount} available
                {locationIssueCount > 0 ? <span className="text-warn"> · {locationIssueCount} location issues</span> : null}
              </div>
              {selectedWorkMissingLocation && selectedRow ? (
                <div className="absolute left-3 right-3 top-14 rounded-md border border-warn/35 bg-background/95 px-3 py-2 text-xs text-warn shadow-sm backdrop-blur">
                  {missingCoordinateMessage(selectedRow, Boolean(selectedTechPoint))}
                </div>
              ) : null}
              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
                <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-t-full rounded-bl-full border-2 border-success bg-card rotate-45" />Available tech</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-t-full rounded-bl-full border-2 border-warn bg-card rotate-45" />Busy tech</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "#8b5cf6" }} />Active job</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rotate-45" style={{ background: "#3b82f6" }} />Request</span>
              </div>
            </CardContent>
          </Card>

        <WorkQueuePanel
          rows={visibleRows}
          totalCount={rows.length}
          now={now}
          ackSlaMinutes={ackSlaMinutes}
          stalledMinutes={stalledMinutes}
          selectedId={selectedRow?.id ?? null}
          highlightJobId={highlightedWorkId}
          autoScan={!selectedWork && !selectedTechId && !assigning && !assignmentModalTechId}
          onSelect={selectWork}
        />

        <TechnicianRosterPanel
          techs={visibleTechs}
          totalCount={(fleet ?? []).length}
          now={now}
          selectedId={selectedTech?.id ?? null}
          highlightId={highlightedTechId}
          candidateById={candidateById}
          candidatesLoading={Boolean(selectedRow?.isRequest && !candidates && !candidatesError)}
          candidatesError={selectedRow?.isRequest ? candidatesError : null}
          distanceUnit={candidates?.distance_unit === "km" ? "km" : "mi"}
          autoScan={!selectedWork && !selectedTechId && !assigning && !assignmentModalTechId}
          activeOffer={activeOffer}
          canAssign={Boolean(selectedRow?.isRequest && !activeOffer)}
          requiredSkillCodes={requiredSkillCodes}
          onSelect={selectTech}
          onFocusJob={focusJobFromTech}
          onOpenAssign={(tech) => {
            setSelectedTechId(tech.id);
            setMapFocus({ kind: "tech", id: tech.id });
            setOverrideReason("");
            setAssignError(null);
            setAssignmentModalTechId(tech.id);
          }}
        />
        </div>
        <FocusedActionBar
          assignError={assignError}
          assignedMessage={assignedMessage}
          activeOffer={activeOffer}
          onCancel={clearFocus}
          onFocusAssignedTech={() => {
            if (!selectedRow?.fulfillment_technician_id) return;
            setSelectedTechId(selectedRow.fulfillment_technician_id);
            setMapFocus({ kind: "tech", id: selectedRow.fulfillment_technician_id });
          }}
          row={selectedRow}
          tech={selectedTech}
          now={now}
        />
        <AssignmentConfirmModal
          assigning={assigning}
          candidate={assignmentModalCandidate}
          candidateFlags={candidateFlags(assignmentModalCandidate)}
          distanceUnit={candidates?.distance_unit === "km" ? "km" : "mi"}
          error={assignError}
          now={now}
          onClose={() => {
            setAssignmentModalTechId(null);
            setOverrideReason("");
          }}
          onConfirm={(reason) => void assignTechnician(assignmentModalTech!.id, reason)}
          overrideReason={overrideReason}
          request={selectedRow?.isRequest ? selectedRow : null}
          setOverrideReason={setOverrideReason}
          tech={assignmentModalTech}
        />
        <SkillLegend />
        </>
      )}
    </div>
  );
}

function MetricTile({
  active, intent, label, onClick, value,
}: { active?: boolean; intent?: "danger" | "success" | "warn"; label: string; onClick?: () => void; value: string }) {
  return (
    <button
      aria-pressed={Boolean(active)}
      className={cn(
        "inline-flex h-9 min-w-[116px] items-center justify-between gap-3 rounded-md border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/35",
      )}
      onClick={onClick}
      type="button"
    >
      <div className="whitespace-nowrap text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className={cn(
        "text-base font-semibold tabular-nums text-foreground",
        intent === "danger" && "text-destructive",
        intent === "warn" && "text-warn",
        intent === "success" && "text-success",
      )}
      >
        {value}
      </div>
    </button>
  );
}

type ListRange = { start: number; end: number; canUp: boolean; canDown: boolean };

function useControlledListRange(count: number, autoScan = false) {
  const ref = useRef<HTMLDivElement>(null);
  const interactionUntilRef = useRef(Date.now() + AUTO_SCAN_IDLE_MS);
  const [range, setRange] = useState<ListRange>({ start: count > 0 ? 1 : 0, end: count, canUp: false, canDown: false });

  const pauseAutoScan = useCallback(() => {
    interactionUntilRef.current = Date.now() + AUTO_SCAN_IDLE_MS;
  }, []);

  const updateRange = useCallback(() => {
    const el = ref.current;
    if (!el || count === 0) {
      setRange({ start: count > 0 ? 1 : 0, end: count, canUp: false, canDown: false });
      return;
    }
    const canUp = el.scrollTop > 2;
    const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    const estimatedVisible = Math.max(1, Math.min(count, Math.round(el.clientHeight / 92)));
    const maxStart = Math.max(1, count - estimatedVisible + 1);
    const scrollable = Math.max(1, el.scrollHeight - el.clientHeight);
    const start = Math.min(maxStart, Math.max(1, Math.floor((el.scrollTop / scrollable) * maxStart) + 1));
    const end = Math.min(count, start + estimatedVisible - 1);
    setRange({ start, end, canUp, canDown });
  }, [count]);

  useEffect(() => {
    updateRange();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateRange);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateRange]);

  useEffect(() => {
    if (autoScan) pauseAutoScan();
  }, [autoScan, pauseAutoScan]);

  const scrollBy = useCallback((direction: 1 | -1) => {
    pauseAutoScan();
    ref.current?.scrollBy({ top: direction * 260, behavior: "smooth" });
  }, [pauseAutoScan]);

  const scrollToId = useCallback((id: string | null) => {
    if (!id) return;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const target = Array.from(el.querySelectorAll<HTMLElement>("[data-scroll-id]"))
        .find((item) => item.dataset.scrollId === id);
      if (!target) return;
      pauseAutoScan();
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      window.setTimeout(updateRange, 180);
    });
  }, [pauseAutoScan, updateRange]);

  useEffect(() => {
    if (!autoScan || count < 2) return;
    const id = window.setInterval(() => {
      const el = ref.current;
      if (!el) return;
      if (Date.now() < interactionUntilRef.current) return;
      if (el.scrollHeight <= el.clientHeight + 2) return;
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      if (nearBottom) {
        el.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        el.scrollBy({ top: Math.max(180, Math.min(260, el.clientHeight * 0.65)), behavior: "smooth" });
      }
      window.setTimeout(updateRange, 180);
    }, AUTO_SCAN_STEP_MS);
    return () => window.clearInterval(id);
  }, [autoScan, count, updateRange]);

  return { ref, range, pauseAutoScan, scrollBy, scrollToId, updateRange };
}

function ListRangeControls({
  count,
  label,
  onScrollBy,
  range,
}: {
  count: number;
  label: string;
  onScrollBy: (direction: 1 | -1) => void;
  range: ListRange;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
      <span className="whitespace-nowrap">{count > 0 ? `Showing ${range.start}-${range.end} of ${count}` : "Showing 0 of 0"}</span>
      <div className="flex items-center gap-1" aria-label={`${label} list controls`}>
        <Button aria-label={`Scroll ${label} up`} className="h-7 w-7 p-0" disabled={!range.canUp} onClick={() => onScrollBy(-1)} size="sm" type="button" variant="outline">
          <ChevronUp className="size-3.5" />
        </Button>
        <Button aria-label={`Scroll ${label} down`} className="h-7 w-7 p-0" disabled={!range.canDown} onClick={() => onScrollBy(1)} size="sm" type="button" variant="outline">
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ControlledListScroller({
  children,
  count,
  empty,
  onScroll,
  onUserActivity,
  scrollRef,
}: {
  children: ReactNode;
  count: number;
  empty: ReactNode;
  onScroll: () => void;
  onUserActivity: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]"
        onFocus={onUserActivity}
        onKeyDown={onUserActivity}
        onMouseEnter={onUserActivity}
        onPointerDown={onUserActivity}
        onScroll={onScroll}
        onTouchStart={onUserActivity}
        onWheel={onUserActivity}
        ref={scrollRef}
      >
        {count === 0 ? empty : children}
      </div>
    </div>
  );
}

function WorkQueuePanel({
  ackSlaMinutes, autoScan, highlightJobId, now, onSelect, rows, selectedId, stalledMinutes, totalCount,
}: {
  ackSlaMinutes: number;
  autoScan: boolean;
  highlightJobId: string | null;
  now: number;
  onSelect: (row: OperationsRow) => void;
  rows: OperationsRow[];
  selectedId: string | null;
  stalledMinutes: number;
  totalCount: number;
}) {
  const list = useControlledListRange(rows.length, autoScan);
  const { scrollToId } = list;
  useEffect(() => {
    scrollToId(selectedId);
  }, [scrollToId, selectedId]);

  return (
    <Card className="flex flex-col overflow-hidden xl:h-full">
      <CardHeader className="flex-none py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle>Work queue</CardTitle>
          </div>
          <ListRangeControls count={rows.length} label="work queue" onScrollBy={list.scrollBy} range={list.range} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col overflow-hidden p-4 pt-0">
        <ControlledListScroller
          count={rows.length}
          onScroll={list.updateRange}
          onUserActivity={list.pauseAutoScan}
          scrollRef={list.ref}
          empty={
            <EmptyState
              icon={ClipboardCheck}
              title={totalCount === 0 ? "No open work" : "No matches"}
              description={totalCount === 0 ? "Requests and active jobs will appear here as they come in." : "Nothing matches the current filters."}
            />
          }
        >
          {rows.map((row) => {
            const risk = requestRisk(row, now, ackSlaMinutes, stalledMinutes);
            const riskLabel = RISK_LABEL[risk];
            const exception = activeJobException(row, now);
            const isSelected = row.id === selectedId;
            const isLinked = !isSelected && row.id === highlightJobId;
            const displayId = jobDisplayId(row);
            return (
              <div
                className={cn(
                  "cursor-pointer rounded-md border p-2.5 transition-colors hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected && "border-primary bg-primary/5",
                  !isSelected && isLinked && "border-primary/40",
                  !isSelected && !isLinked && (risk === "critical" || risk === "stalled") && "border-destructive/35 bg-destructive/5",
                  !isSelected && !isLinked && risk === "ack_breached" && "border-warn/35 bg-warn/5",
                )}
                data-scroll-id={row.id}
                key={row.id}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row); } }}
                role="button"
                tabIndex={0}
                title={row.address ?? "No address"}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {row.isRequest ? "Request" : "Job"} <span className="font-mono normal-case tracking-normal">{displayId}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={JOB_STATUS_VARIANT[row.status] ?? "neutral"}>{JOB_STATUS_LABEL[row.status] ?? row.status}</Badge>
                      <span>{row.isRequest ? `Waiting ${formatMinutes(waitingMinutes(row, now))}` : `Ongoing ${formatMinutes(ongoingMinutes(row, now))}`}</span>
                      <span>{normalizedJobType(row)}</span>
                    </div>
                  </div>
                  {riskLabel ? <Badge variant={RISK_VARIANT[risk]}>{riskLabel}</Badge> : null}
                  {exception ? <Badge variant={exception.severity === "critical" ? "danger" : "warn"}>{exception.label}</Badge> : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {row.technician_display_name
                    ? <span>Assigned: {row.technician_display_name}</span>
                    : row.isRequest
                      ? <span>{row.offer_active ? "Offer sent" : "Awaiting assignment"}</span>
                      : <span>No technician on record</span>}
                  {row.urgency ? <Badge variant={row.urgency === "critical" ? "critical" : row.urgency === "high" ? "warn" : "outline"}>{row.urgency}</Badge> : null}
                  {row.lat == null || row.lng == null ? <span>No map point</span> : null}
                </div>
              </div>
            );
          })}
        </ControlledListScroller>
      </CardContent>
    </Card>
  );
}

function TechnicianRosterPanel({
  activeOffer, autoScan, canAssign, candidateById, candidatesError, candidatesLoading, distanceUnit, highlightId, now, onFocusJob, onOpenAssign, onSelect, requiredSkillCodes, selectedId, techs, totalCount,
}: {
  activeOffer: boolean;
  autoScan: boolean;
  canAssign: boolean;
  candidateById: Map<string, Candidate>;
  candidatesError: string | null;
  candidatesLoading: boolean;
  distanceUnit: "mi" | "km";
  highlightId: string | null;
  now: number;
  onFocusJob: (jobId: string) => void;
  onOpenAssign: (tech: FleetRow) => void;
  onSelect: (tech: FleetRow) => void;
  requiredSkillCodes: Set<string>;
  selectedId: string | null;
  techs: FleetRow[];
  totalCount: number;
}) {
  const list = useControlledListRange(techs.length, autoScan);
  const { scrollToId } = list;
  useEffect(() => {
    scrollToId(selectedId);
  }, [scrollToId, selectedId]);

  return (
    <Card className="flex flex-1 flex-col overflow-hidden xl:min-h-0">
      <CardHeader className="flex-none py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle>Technicians</CardTitle>
          </div>
          <ListRangeControls count={techs.length} label="technician roster" onScrollBy={list.scrollBy} range={list.range} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 overflow-hidden p-4 pt-0">
        {candidatesLoading ? <div className="text-xs text-muted-foreground">Ranking technicians for selected request…</div> : null}
        {candidatesError ? <div className="text-xs text-destructive">Candidate ranking unavailable: {candidatesError}</div> : null}
        <ControlledListScroller
          count={techs.length}
          onScroll={list.updateRange}
          onUserActivity={list.pauseAutoScan}
          scrollRef={list.ref}
          empty={
            <EmptyState
              icon={UserRound}
              title={totalCount === 0 ? "No technicians" : "No matches"}
              description={totalCount === 0 ? "Technicians will appear here once your roster reports location." : "No technicians match the current filter."}
            />
          }
        >
          {techs.map((tech) => {
            const status = technicianStatusLabel(tech.marker_status);
            const fresh = locationFreshness(tech.location_updated_at, now, LOCATION_STALE_MINUTES);
            const candidate = candidateById.get(tech.id) ?? null;
            const isSelected = tech.id === selectedId;
            const isLinked = !isSelected && tech.id === highlightId;
            const skills = technicianSkillCodes(tech.skills);
            const photoUrl = tech.profile_photo_url ?? tech.photo_url ?? null;
            const avatarTooltip = `${status} · Location ${fresh.label}`;
            return (
              <div
                className={cn(
                  "cursor-pointer rounded-md border p-2.5 transition-colors hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected && "border-primary bg-primary/5",
                  !isSelected && isLinked && "border-primary/40",
                )}
                data-scroll-id={tech.id}
                key={tech.id}
                onClick={() => onSelect(tech)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(tech); } }}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-start gap-3">
                  <TechAvatar name={tech.display_name ?? tech.id} photoUrl={photoUrl} stale={fresh.stale} status={status} title={avatarTooltip} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words font-medium leading-tight" title={tech.display_name ?? tech.id}>{tech.display_name ?? tech.id}</span>
                      {canAssign ? (
                        <button
                          aria-label={`Assign ${tech.display_name ?? tech.id}`}
                          className={cn(
                            "inline-flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            activeOffer ? "cursor-not-allowed opacity-45" : "border-border bg-background/70",
                          )}
                          disabled={activeOffer}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenAssign(tech);
                          }}
                          title={activeOffer ? "Offer already pending" : `Assign ${tech.display_name ?? tech.id}`}
                          type="button"
                        >
                          <Send className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                    {candidate ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span><Route className="mr-1 inline size-3" />{candidateDistance(candidate, distanceUnit)}</span>
                        <span>ETA {candidate.eta_min != null ? `${candidate.eta_min}-${candidate.eta_max}m` : "unknown"}</span>
                      </div>
                    ) : null}
                    {tech.active_job ? (
                      <button
                        className="mt-1 inline-flex max-w-full items-center rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-primary/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(event) => { event.stopPropagation(); onFocusJob(tech.active_job!.id); }}
                        title={tech.active_job.address ?? `Focus job ${jobDisplayId(tech.active_job)}`}
                        type="button"
                      >
                        <span className="truncate">Job {jobDisplayId(tech.active_job)}</span>
                      </button>
                    ) : null}
                    {skills.codes.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {skills.codes.map((skill) => {
                          const matched = requiredSkillCodes.has(skill.code);
                          return (
                            <Badge
                              className={cn(
                                "px-1 py-0 text-[9px] leading-3.5 normal-case",
                                matched && "border-success/45 bg-success/10 text-success",
                              )}
                              key={skill.code}
                              title={matched ? `${skill.label} matches selected request` : skill.label}
                              variant={matched ? "success" : "outline"}
                            >
                              {skill.code}
                            </Badge>
                          );
                        })}
                        {skills.overflow > 0 ? <Badge className="px-1 py-0 text-[9px] leading-3.5" variant="outline">+{skills.overflow}</Badge> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </ControlledListScroller>
      </CardContent>
    </Card>
  );
}

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

function TechAvatar({
  name, photoUrl, stale, status, title,
}: { name: string; photoUrl: string | null; stale: boolean; status: TechnicianStatusLabel; title: string }) {
  const ringClass = stale && status !== "Offline"
    ? "ring-warn"
    : status === "Available"
    ? "ring-success"
    : status === "Busy"
      ? "ring-warn"
      : "ring-muted-foreground/45";
  return (
    <Avatar className={cn("size-11 border-background ring-2 ring-offset-2 ring-offset-background", ringClass)} title={title}>
      {photoUrl ? <AvatarImage alt={name} className="object-cover" src={photoUrl} /> : null}
      <AvatarFallback>{initialsFor(name).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function FocusedActionBar({
  activeOffer,
  assignError,
  assignedMessage,
  now,
  onCancel,
  onFocusAssignedTech,
  row,
  tech,
}: {
  activeOffer: boolean;
  assignError: string | null;
  assignedMessage: string | null;
  now: number;
  onCancel: () => void;
  onFocusAssignedTech: () => void;
  row: OperationsRow | null;
  tech: FleetRow | null;
}) {
  if (!row && !tech) return null;
  const rowDisplayId = row ? jobDisplayId(row) : null;
  const timeLabel = row
    ? row.isRequest
      ? `Waiting ${formatMinutes(waitingMinutes(row, now))}`
      : `Ongoing ${formatMinutes(ongoingMinutes(row, now))}`
    : null;
  const exception = row ? activeJobException(row, now) : null;

  return (
    <div className="mt-3 rounded-md border border-primary/30 bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {row ? (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{row.isRequest ? "Request" : "Job"} {rowDisplayId}</span>
              <Badge variant={JOB_STATUS_VARIANT[row.status] ?? "neutral"}>{JOB_STATUS_LABEL[row.status] ?? row.status}</Badge>
              {timeLabel ? <span className="text-muted-foreground">{timeLabel}</span> : null}
              {exception ? <Badge variant={exception.severity === "critical" ? "danger" : "warn"}>{exception.label}</Badge> : null}
              {activeOffer ? <Badge variant="warn">Offer active</Badge> : null}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              <MapPin className="mr-1 inline size-3" />{row.address ?? "No address"}{tech ? ` · ${tech.display_name ?? tech.id}` : ""}
            </div>
          </div>
        ) : tech ? (
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{tech.display_name ?? tech.id}</span>
            <span className="ml-2 text-muted-foreground">{tech.active_job ? `Current job ${jobDisplayId(tech.active_job)}` : "No active job"}</span>
          </div>
        ) : null}
        {exception ? (
          <Button
            onClick={() => {
              if (exception.action === "Focus technician") {
                onFocusAssignedTech();
              } else if (typeof window !== "undefined" && row) {
                window.location.assign(`/jobs/${encodeURIComponent(row.id)}`);
              }
            }}
            size="sm"
            type="button"
            variant={exception.severity === "critical" ? "destructive" : "outline"}
          >
            {exception.action}
          </Button>
        ) : null}
        <Button onClick={onCancel} size="sm" variant="outline"><X className="size-4" />Close</Button>
      </div>
      {exception && row && !row.isRequest ? (
        <div className={cn(
          "mt-3 rounded-md border p-2 text-xs",
          exception.severity === "critical" ? "border-destructive/35 bg-destructive/10 text-destructive" : "border-warn/35 bg-warn/10 text-warn",
        )}
        >
          <div className="font-semibold">{exception.label}</div>
          <div className="mt-0.5 text-muted-foreground">{exception.detail}</div>
        </div>
      ) : null}
      {assignError ? <div className="mt-2 text-xs text-destructive">{assignError}</div> : null}
      {assignedMessage ? <div className="mt-2 text-xs text-success">{assignedMessage}</div> : null}
    </div>
  );
}

function AssignmentConfirmModal({
  assigning,
  candidate,
  candidateFlags,
  distanceUnit,
  error,
  now,
  onClose,
  onConfirm,
  overrideReason,
  request,
  setOverrideReason,
  tech,
}: {
  assigning: boolean;
  candidate: Candidate | null;
  candidateFlags: string[];
  distanceUnit: "mi" | "km";
  error: string | null;
  now: number;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  overrideReason: string;
  request: OperationsRow | null;
  setOverrideReason: (value: string) => void;
  tech: FleetRow | null;
}) {
  if (!request || !tech) return null;
  const eta = candidate?.eta_min != null ? `ETA ${candidate.eta_min}-${candidate.eta_max}m` : "ETA unknown";
  const needsOverride = candidateFlags.length > 0;
  const canConfirm = !assigning && (!needsOverride || overrideReason.trim().length >= 3);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="assign-modal-title">
      <div className="w-full max-w-lg rounded-lg border border-primary/35 bg-card p-4 text-card-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Confirm assignment</div>
            <h2 className="mt-1 text-lg font-semibold leading-tight" id="assign-modal-title">
              Send offer to {tech.display_name ?? tech.id}?
            </h2>
          </div>
          <Button aria-label="Close assignment confirmation" className="h-8 w-8 p-0" onClick={onClose} type="button" variant="outline">
            <X className="size-4" />
          </Button>
        </div>
        <div className="mt-4 rounded-md border border-border bg-background/55 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Request {jobDisplayId(request)}</span>
            <Badge variant={JOB_STATUS_VARIANT[request.status] ?? "neutral"}>{JOB_STATUS_LABEL[request.status] ?? request.status}</Badge>
            <span className="text-muted-foreground">Waiting {formatMinutes(waitingMinutes(request, now))}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            <MapPin className="mr-1 inline size-3" />{request.address ?? "No address"} · {normalizedJobType(request)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span><Route className="mr-1 inline size-3" />{candidate ? candidateDistance(candidate, distanceUnit) : "distance unknown"}</span>
            <span>{eta}</span>
          </div>
        </div>
        {needsOverride ? (
          <div className="mt-3 rounded-md border border-warn/35 bg-warn/10 p-3">
            <div className="text-xs font-semibold text-warn">Warning: {candidateFlags.join(", ")}</div>
            <Input
              className="mt-2"
              onChange={(event) => setOverrideReason(event.target.value)}
              placeholder="Reason for overriding dispatch warnings"
              value={overrideReason}
            />
          </div>
        ) : null}
        {error ? <div className="mt-3 text-xs text-destructive">{error}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button disabled={assigning} onClick={onClose} type="button" variant="outline">Back</Button>
          <Button disabled={!canConfirm} onClick={() => onConfirm(needsOverride ? overrideReason.trim() : undefined)} type="button">
            <CheckCircle2 className="size-4" />{assigning ? "Sending…" : "Send offer"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SkillLegend() {
  return (
    <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
      <span className="mr-2 font-semibold uppercase text-foreground">Skill codes</span>
      {DEFAULT_SKILL_LEGEND.map((item, index) => (
        <span key={item.code}>
          {index > 0 ? <span className="mx-1">·</span> : null}
          <span className="font-semibold text-foreground">{item.code}</span> {item.label}
        </span>
      ))}
    </div>
  );
}
