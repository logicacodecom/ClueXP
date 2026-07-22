"use client";

import type { ConsoleMode } from "@cluexp/api-client";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  Route,
  UserRound,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  mergeOperationsRows,
  ongoingMinutes,
  requestRisk,
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

const TECH_STATUS_VARIANT: Record<TechnicianStatusLabel, BadgeVariant> = {
  Available: "success",
  Busy: "warn",
  Offline: "outline",
};

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

function compareTechnicians(a: FleetRow, b: FleetRow) {
  const aStatus = technicianStatusLabel(a.marker_status);
  const bStatus = technicianStatusLabel(b.marker_status);
  const statusDelta = TECH_SORT_RANK[aStatus] - TECH_SORT_RANK[bStatus];
  if (statusDelta !== 0) return statusDelta;
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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignedMessage, setAssignedMessage] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

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

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250);
    return () => window.clearTimeout(id);
  }, [searchInput]);

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
    if (search) {
      list = list.filter((r) =>
        r.id.toLowerCase().includes(search) ||
        (r.operational_id ?? "").toLowerCase().includes(search) ||
        (r.address ?? "").toLowerCase().includes(search) ||
        (r.situation ?? "").toLowerCase().includes(search));
    }
    return list;
  }, [sorted, tab, riskOnly, search, now, ackSlaMinutes, stalledMinutes]);

  const [candidates, setCandidates] = useState<CandidatesResponse | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  const selectedRow = selectedWork ? sorted.find((r) => r.id === selectedWork.id) ?? null : null;
  const selectedTech = selectedTechId ? (fleet ?? []).find((t) => t.id === selectedTechId) ?? null : null;
  const candidateById = useMemo(
    () => new Map((candidates?.candidates ?? []).map((candidate) => [candidate.id, candidate])),
    [candidates],
  );
  const selectedCandidate = selectedTechId ? candidateById.get(selectedTechId) ?? null : null;
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
      return compareTechnicians(a, b);
    });
  }, [candidates, fleet, selectedRow, techFilter, techGroups]);

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
    setOverrideFor(null);
    setOverrideReason("");
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
  }, [selectedTechId, selectedWork]);

  const clearFocus = useCallback(() => {
    setSelectedWork(null);
    setSelectedTechId(null);
    setMapFocus(null);
    setAssignError(null);
    setAssignedMessage(null);
    setOverrideFor(null);
    setOverrideReason("");
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
      !candidate.is_online && "offline or stale",
      candidate.is_busy && "busy",
      candidate.organization_supports_skill === false && "company capability missing",
      candidate.organization_supports_skill !== false && candidate.technician_supports_skill === false && "technician skill missing",
      candidate.skills_match === false && candidate.organization_supports_skill !== false && candidate.technician_supports_skill !== false && "skill mismatch",
    ].filter(Boolean) as string[];
  }

  function isCandidateFlagged(candidate: Candidate | null) {
    return candidateFlags(candidate).length > 0;
  }

  async function assignSelectedTechnician(reason?: string) {
    if (!selectedRow?.isRequest || !selectedTechId) return;
    setAssigning(true);
    setAssignError(null);
    setAssignedMessage(null);
    try {
      const res = await fetch(`${apiPrefix}/queue/${selectedRow.id}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { technician_id: selectedTechId, override_reason: reason } : { technician_id: selectedTechId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `${res.status}`);
      setAssignedMessage(`Offer sent to ${selectedTech?.display_name ?? selectedCandidate?.display_name ?? selectedTechId}.`);
      setOverrideFor(null);
      setOverrideReason("");
      await fetchAll();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setAssigning(false);
    }
  }

  const requestPoints: MapPoint[] = sorted
    .filter((r) => r.isRequest && r.lat != null && r.lng != null)
    .map((r): MapPoint => ({
      lat: r.lat!, lng: r.lng!, kind: "request", id: r.id, label: r.address ?? jobDisplayId(r),
      risk: toMapRisk(requestRisk(r, now, ackSlaMinutes, stalledMinutes)),
      selected: r.id === highlightedWorkId,
    }));
  const jobPoints: MapPoint[] = sorted
    .filter((r) => !r.isRequest && r.lat != null && r.lng != null)
    .map((r): MapPoint => ({ lat: r.lat!, lng: r.lng!, kind: "job", id: r.id, label: r.address ?? jobDisplayId(r), selected: r.id === highlightedWorkId }));
  const techPoints: MapPoint[] = (fleet ?? [])
    .filter((t) => t.current_lat != null && t.current_lng != null)
    .map((t): MapPoint => ({
      lat: t.current_lat!, lng: t.current_lng!, kind: "tech", id: t.id,
      label: t.display_name ?? t.id, status: t.marker_status ?? undefined,
      selected: t.id === highlightedTechId,
    }));
  const allPoints = [...requestPoints, ...jobPoints, ...techPoints];
  const selectedWorkPoint = selectedRow?.lat != null && selectedRow.lng != null
    ? { lat: selectedRow.lat, lng: selectedRow.lng, kind: selectedRow.isRequest ? "request" : "job", id: selectedRow.id, label: selectedRow.address ?? jobDisplayId(selectedRow), selected: true } satisfies MapPoint
    : null;
  const selectedTechPoint = selectedTech?.current_lat != null && selectedTech.current_lng != null
    ? { lat: selectedTech.current_lat, lng: selectedTech.current_lng, kind: "tech", id: selectedTech.id, label: selectedTech.display_name ?? selectedTech.id, status: selectedTech.marker_status ?? undefined, selected: true } satisfies MapPoint
    : null;
  const mapFocusPoint = mapFocus?.kind === "tech" ? selectedTechPoint : selectedWorkPoint;
  const focusPairs: [MapPoint, MapPoint][] = selectedWorkPoint && selectedTechPoint ? [[selectedTechPoint, selectedWorkPoint]] : [];

  const initialLoad = queue === null && activeJobs === null && fleet === null && !queueError && !jobsError && !fleetError;
  const sourceErrors = [
    queueError && "requests", jobsError && "active jobs", fleetError && "technician roster", settingsError && "dispatch settings",
  ].filter(Boolean) as string[];

  return (
    <div>
      <PageHeader
        kicker="Dispatcher workspace"
        title="Operations"
        description="Live map, work queue, and technician roster in one screen for scanning, prioritizing, and monitoring dispatch."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : "Loading…"}
            </span>
            <Button variant="outline" onClick={() => void fetchAll()}>Refresh</Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 xl:grid-cols-2">
        <MetricGroup label="Work" target="Work Queue">
          <MetricTile label="Unassigned" value={String(summary.unassigned)} active={tab === "requests" && !riskOnly} onClick={() => { setTab("requests"); setRiskOnly(false); }} />
          <MetricTile label="At risk" value={String(summary.atRisk)} intent="danger" active={riskOnly} onClick={() => { setTab("requests"); setRiskOnly(true); }} />
          <MetricTile label="Active jobs" value={String(summary.activeJobs)} active={tab === "active"} onClick={() => { setTab("active"); setRiskOnly(false); }} />
          <MetricTile label="All work" value={String(rows.length)} active={tab === "all" && !riskOnly} onClick={() => { setTab("all"); setRiskOnly(false); }} />
        </MetricGroup>
        <MetricGroup label="Workforce" target="Technicians">
          <MetricTile label="Available" value={String(summary.availableTechnicians)} intent="success" active={techFilter === "Available"} onClick={() => setTechFilter((f) => (f === "Available" ? "all" : "Available"))} />
          <MetricTile label="Busy" value={String(summary.busyTechnicians)} intent="warn" active={techFilter === "Busy"} onClick={() => setTechFilter((f) => (f === "Busy" ? "all" : "Busy"))} />
          <MetricTile label="Offline" value={String(summary.offlineTechnicians)} active={techFilter === "Offline"} onClick={() => setTechFilter((f) => (f === "Offline" ? "all" : "Offline"))} />
          <MetricTile label="All techs" value={String(summary.allTechnicians)} active={techFilter === "all"} onClick={() => setTechFilter("all")} />
        </MetricGroup>
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
        <div className="grid gap-4 xl:h-[calc(100vh-310px)] xl:min-h-[560px] xl:grid-cols-[48fr_29fr_23fr]">
          <Card className="overflow-hidden xl:h-full">
            <CardContent className="relative h-[420px] p-0 xl:h-full">
              <div className="absolute inset-0 bg-[#101720]">
                {allPoints.length > 0 ? (
                  <GoogleMapView
                    points={allPoints}
                    pairs={focusPairs}
                    focusPoint={mapFocusPoint}
                    richMarkers
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
              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: "#22c55e" }} />Available tech</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: "#f59e0b" }} />Busy tech</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5" style={{ background: "#8b5cf6" }} />Active job</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rotate-45" style={{ background: "#3b82f6" }} />Request</span>
              </div>
            </CardContent>
          </Card>

          <WorkQueuePanel
            rows={visibleRows}
            totalCount={rows.length}
            tab={tab}
            riskOnly={riskOnly}
            onClearFilter={() => { setTab("all"); setRiskOnly(false); }}
            search={searchInput}
            onSearchChange={setSearchInput}
            now={now}
            ackSlaMinutes={ackSlaMinutes}
            stalledMinutes={stalledMinutes}
            selectedId={selectedRow?.id ?? null}
            highlightJobId={highlightedWorkId}
            onSelect={selectWork}
          />

          <TechnicianRosterPanel
            techs={visibleTechs}
            totalCount={(fleet ?? []).length}
            filter={techFilter}
            onClearFilter={() => setTechFilter("all")}
            now={now}
            selectedId={selectedTech?.id ?? null}
            highlightId={highlightedTechId}
            candidateById={candidateById}
            candidatesLoading={Boolean(selectedRow?.isRequest && !candidates && !candidatesError)}
            candidatesError={selectedRow?.isRequest ? candidatesError : null}
            distanceUnit={candidates?.distance_unit === "km" ? "km" : "mi"}
            onSelect={selectTech}
          />
        </div>
        <FocusedActionBar
          assignError={assignError}
          assignedMessage={assignedMessage}
          assigning={assigning}
          activeOffer={activeOffer}
          candidate={selectedCandidate}
          candidateFlags={candidateFlags(selectedCandidate)}
          onAssign={() => {
            if (selectedCandidate && isCandidateFlagged(selectedCandidate)) {
              setOverrideFor(selectedCandidate.id);
              setOverrideReason("");
            } else {
              void assignSelectedTechnician();
            }
          }}
          onCancel={clearFocus}
          onConfirmOverride={() => void assignSelectedTechnician(overrideReason.trim())}
          overrideFor={overrideFor}
          overrideReason={overrideReason}
          row={selectedRow}
          setOverrideReason={setOverrideReason}
          tech={selectedTech}
          now={now}
        />
        <SkillLegend />
        </>
      )}
    </div>
  );
}

function MetricGroup({ children, label, target }: { children: ReactNode; label: string; target: string }) {
  return (
    <section className="rounded-md border border-border bg-card/40 p-2" aria-label={`${label} metrics filter ${target}`}>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{target}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

function MetricTile({
  active, intent, label, onClick, value,
}: { active?: boolean; intent?: "danger" | "success" | "warn"; label: string; onClick?: () => void; value: string }) {
  return (
    <button
      aria-pressed={Boolean(active)}
      className={cn(
        "rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/35",
      )}
      onClick={onClick}
      type="button"
    >
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-1 text-xl font-semibold tabular-nums text-foreground",
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

function WorkQueuePanel({
  ackSlaMinutes, highlightJobId, now, onClearFilter, onSearchChange, onSelect, riskOnly, rows, search, selectedId, stalledMinutes, tab, totalCount,
}: {
  ackSlaMinutes: number;
  highlightJobId: string | null;
  now: number;
  onClearFilter: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (row: OperationsRow) => void;
  riskOnly: boolean;
  rows: OperationsRow[];
  search: string;
  selectedId: string | null;
  stalledMinutes: number;
  tab: QueueTab;
  totalCount: number;
}) {
  return (
    <Card className="flex flex-col overflow-hidden xl:h-full">
      <CardHeader className="flex-none">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Work queue · {rows.length}</CardTitle>
          {tab !== "all" || riskOnly ? (
            <button
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={onClearFilter}
              type="button"
            >
              {riskOnly ? "SLA risk" : tab === "requests" ? "Requests" : "Active jobs"} <X className="size-3" />
            </button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden p-4 pt-0">
        <Input
          className="flex-none"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search address, situation, or operation ID"
          value={search}
        />
        <div className="flex-1 space-y-2 overflow-y-auto">
          {rows.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title={totalCount === 0 ? "No open work" : "No matches"}
              description={totalCount === 0 ? "Requests and active jobs will appear here as they come in." : "Nothing matches the current filters."}
            />
          ) : rows.map((row) => {
            const risk = requestRisk(row, now, ackSlaMinutes, stalledMinutes);
            const riskLabel = RISK_LABEL[risk];
            const isSelected = row.id === selectedId;
            const isLinked = !isSelected && row.id === highlightJobId;
            const displayId = jobDisplayId(row);
            return (
              <div
                className={cn(
                  "cursor-pointer rounded-md border p-3 transition-colors hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected && "border-primary bg-primary/5",
                  !isSelected && isLinked && "border-primary/40",
                  !isSelected && !isLinked && (risk === "critical" || risk === "stalled") && "border-destructive/35 bg-destructive/5",
                  !isSelected && !isLinked && risk === "ack_breached" && "border-warn/35 bg-warn/5",
                )}
                key={row.id}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row); } }}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {row.isRequest ? "Request" : "Job"} <span className="font-mono normal-case tracking-normal">{displayId}</span>
                    </div>
                    <div className="font-medium">{row.address ?? "No address"}</div>
                  </div>
                  <Badge variant={JOB_STATUS_VARIANT[row.status] ?? "neutral"}>{JOB_STATUS_LABEL[row.status] ?? row.status}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{row.isRequest ? `Waiting ${formatMinutes(waitingMinutes(row, now))}` : `Ongoing ${formatMinutes(ongoingMinutes(row, now))}`}</span>
                  {riskLabel ? <Badge variant={RISK_VARIANT[risk]}>{riskLabel}</Badge> : null}
                  {row.urgency ? <Badge variant={row.urgency === "critical" ? "critical" : row.urgency === "high" ? "warn" : "outline"}>{row.urgency}</Badge> : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {[row.access_type, row.situation].filter(Boolean).join(" · ") || "—"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {row.technician_display_name
                    ? `Assigned: ${row.technician_display_name}`
                    : row.isRequest
                      ? (row.offer_active ? "Offer sent" : "Awaiting assignment")
                      : "No technician on record"}
                </div>
                {row.lat == null || row.lng == null ? <div className="mt-1 text-xs text-muted-foreground">No location on file</div> : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function TechnicianRosterPanel({
  candidateById, candidatesError, candidatesLoading, distanceUnit, filter, highlightId, now, onClearFilter, onSelect, selectedId, techs, totalCount,
}: {
  candidateById: Map<string, Candidate>;
  candidatesError: string | null;
  candidatesLoading: boolean;
  distanceUnit: "mi" | "km";
  filter: TechFilter;
  highlightId: string | null;
  now: number;
  onClearFilter: () => void;
  onSelect: (tech: FleetRow) => void;
  selectedId: string | null;
  techs: FleetRow[];
  totalCount: number;
}) {
  return (
    <Card className="flex flex-1 flex-col overflow-hidden xl:min-h-0">
      <CardHeader className="flex-none">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Technicians · {techs.length}</CardTitle>
          {filter !== "all" ? (
            <button
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={onClearFilter}
              type="button"
            >
              {filter} <X className="size-3" />
            </button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden p-4 pt-0">
        {candidatesLoading ? <div className="text-xs text-muted-foreground">Ranking technicians for selected request…</div> : null}
        {candidatesError ? <div className="text-xs text-destructive">Candidate ranking unavailable: {candidatesError}</div> : null}
        <div className="flex-1 space-y-2 overflow-y-auto">
          {techs.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title={totalCount === 0 ? "No technicians" : "No matches"}
              description={totalCount === 0 ? "Technicians will appear here once your roster reports location." : "No technicians match the current filter."}
            />
          ) : techs.map((tech) => {
            const status = technicianStatusLabel(tech.marker_status);
            const fresh = locationFreshness(tech.location_updated_at, now, LOCATION_STALE_MINUTES);
            const candidate = candidateById.get(tech.id) ?? null;
            const isSelected = tech.id === selectedId;
            const isLinked = !isSelected && tech.id === highlightId;
            const skills = technicianSkillCodes(tech.skills);
            const photoUrl = tech.profile_photo_url ?? tech.photo_url ?? null;
            return (
              <div
                className={cn(
                  "cursor-pointer rounded-md border p-3 transition-colors hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected && "border-primary bg-primary/5",
                  !isSelected && isLinked && "border-primary/40",
                )}
                key={tech.id}
                onClick={() => onSelect(tech)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(tech); } }}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-start gap-3">
                  <TechAvatar name={tech.display_name ?? tech.id} photoUrl={photoUrl} status={status} stale={fresh.stale} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{tech.display_name ?? tech.id}</span>
                      <Badge variant={TECH_STATUS_VARIANT[status]}>{status}</Badge>
                    </div>
                    <div className={cn("mt-1 text-xs text-muted-foreground", fresh.stale && "text-warn")}>Location {fresh.label}</div>
                    {candidate ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span><Route className="mr-1 inline size-3" />{candidateDistance(candidate, distanceUnit)}</span>
                        <span>ETA {candidate.eta_min != null ? `${candidate.eta_min}-${candidate.eta_max}m` : "unknown"}</span>
                        <Badge variant={candidate.skills_match ? "success" : "outline"}>{candidate.skills_match ? "Skill match" : "Check skill"}</Badge>
                      </div>
                    ) : null}
                    {tech.active_job ? (
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {JOB_STATUS_LABEL[tech.active_job.status] ?? tech.active_job.status} · {tech.active_job.address ?? jobDisplayId(tech.active_job)}
                      </div>
                    ) : null}
                    {skills.codes.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {skills.codes.map((skill) => <Badge className="normal-case" key={skill.code} title={skill.label} variant="outline">{skill.code}</Badge>)}
                        {skills.overflow > 0 ? <Badge variant="outline">+{skills.overflow}</Badge> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

function TechAvatar({
  name, photoUrl, stale, status,
}: { name: string; photoUrl: string | null; stale: boolean; status: TechnicianStatusLabel }) {
  const ringClass = stale
    ? "ring-warn"
    : status === "Available"
      ? "ring-success"
      : status === "Busy"
        ? "ring-warn"
        : "ring-muted-foreground/45";
  return (
    <Avatar className={cn("size-11 border-background ring-2 ring-offset-2 ring-offset-background", ringClass)}>
      {photoUrl ? <AvatarImage alt={name} className="object-cover" src={photoUrl} /> : null}
      <AvatarFallback>{initialsFor(name).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function FocusedActionBar({
  activeOffer,
  assignError,
  assignedMessage,
  assigning,
  candidate,
  candidateFlags,
  now,
  onAssign,
  onCancel,
  onConfirmOverride,
  overrideFor,
  overrideReason,
  row,
  setOverrideReason,
  tech,
}: {
  activeOffer: boolean;
  assignError: string | null;
  assignedMessage: string | null;
  assigning: boolean;
  candidate: Candidate | null;
  candidateFlags: string[];
  now: number;
  onAssign: () => void;
  onCancel: () => void;
  onConfirmOverride: () => void;
  overrideFor: string | null;
  overrideReason: string;
  row: OperationsRow | null;
  setOverrideReason: (value: string) => void;
  tech: FleetRow | null;
}) {
  if (!row && !tech) return null;
  const canAssign = Boolean(row?.isRequest && tech && !activeOffer);
  const rowDisplayId = row ? jobDisplayId(row) : null;
  const timeLabel = row
    ? row.isRequest
      ? `Waiting ${formatMinutes(waitingMinutes(row, now))}`
      : `Ongoing ${formatMinutes(ongoingMinutes(row, now))}`
    : null;
  const eta = candidate?.eta_min != null ? `ETA ${candidate.eta_min}-${candidate.eta_max}m` : "ETA unknown";
  const exception = row && !row.isRequest && (
    row.status === "completed_pending_customer" ||
    row.status === "disputed" ||
    (ongoingMinutes(row, now) ?? 0) >= 180 ||
    (row.technician_location_updated_at && locationFreshness(row.technician_location_updated_at, now, LOCATION_STALE_MINUTES).stale)
  );

  return (
    <div className="mt-3 rounded-md border border-primary/30 bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {row ? (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{row.isRequest ? "Request" : "Job"} {rowDisplayId}</span>
              <Badge variant={JOB_STATUS_VARIANT[row.status] ?? "neutral"}>{JOB_STATUS_LABEL[row.status] ?? row.status}</Badge>
              {timeLabel ? <span className="text-muted-foreground">{timeLabel}</span> : null}
              {exception ? <Badge variant="warn">Review required</Badge> : null}
              {activeOffer ? <Badge variant="warn">Offer active</Badge> : null}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              <MapPin className="mr-1 inline size-3" />{row.address ?? "No address"}{tech ? ` · ${tech.display_name ?? tech.id} · ${eta}` : ""}
            </div>
          </div>
        ) : tech ? (
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{tech.display_name ?? tech.id}</span>
            <span className="ml-2 text-muted-foreground">{tech.active_job ? `Current job ${jobDisplayId(tech.active_job)}` : "No active job"}</span>
          </div>
        ) : null}
        <Button onClick={onCancel} size="sm" variant="outline"><X className="size-4" />Cancel</Button>
        {row?.isRequest ? (
          <Button disabled={!canAssign || assigning} onClick={onAssign} size="sm">
            <CheckCircle2 className="size-4" />{assigning ? "Sending…" : activeOffer ? "Offer pending" : "Assign"}
          </Button>
        ) : null}
      </div>
      {candidateFlags.length > 0 && row?.isRequest && tech ? (
        <div className="mt-2 text-xs text-warn">Flagged assignment: {candidateFlags.join(", ")}.</div>
      ) : null}
      {overrideFor && tech?.id === overrideFor ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warn/35 bg-warn/10 p-2">
          <Input
            className="min-w-[260px] flex-1"
            onChange={(event) => setOverrideReason(event.target.value)}
            placeholder="Reason for overriding dispatch warnings"
            value={overrideReason}
          />
          <Button disabled={assigning || overrideReason.trim().length < 3} onClick={onConfirmOverride} size="sm">
            Confirm override
          </Button>
        </div>
      ) : null}
      {assignError ? <div className="mt-2 text-xs text-destructive">{assignError}</div> : null}
      {assignedMessage ? <div className="mt-2 text-xs text-success">{assignedMessage}</div> : null}
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
