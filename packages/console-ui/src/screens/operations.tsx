"use client";

import type { ConsoleMode } from "@cluexp/api-client";
import {
  AlertTriangle,
  ClipboardCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GoogleMapView } from "../components/google-map";
import type { MapPoint } from "../components/google-map";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  LoadingSkeleton,
  PageHeader,
} from "../components";
import { cn } from "../lib/cn";
import {
  formatMinutes,
  groupTechnicians,
  locationFreshness,
  mergeOperationsRows,
  ongoingMinutes,
  requestRisk,
  sortOperationsRows,
  summarizeOperations,
  technicianStatusLabel,
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
  Busy: "danger",
  Offline: "warn",
};

function toMapRisk(risk: RequestRisk): "normal" | "watch" | "critical" {
  if (risk === "critical" || risk === "stalled") return "critical";
  if (risk === "ack_breached") return "watch";
  return "normal";
}

type Selection = { kind: "tech" | "job" | "request"; id: string } | null;
type QueueTab = "all" | "requests" | "active";
type TechFilter = "all" | TechnicianStatusLabel;

type Candidate = {
  id: string;
  display_name: string | null;
  is_online: boolean;
  is_busy: boolean;
  skills_match: boolean;
  distance_mi?: number | null;
  distance_km?: number | null;
  dist_km?: number | null;
  eta_min: number | null;
  eta_max: number | null;
};

type CandidatesResponse = { candidates: Candidate[]; distance_unit?: "mi" | "km" };

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
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [selected, setSelected] = useState<Selection>(null);
  const [tab, setTab] = useState<QueueTab>("all");
  const [riskOnly, setRiskOnly] = useState(false);
  const [techFilter, setTechFilter] = useState<TechFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

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

  const fetchAll = useCallback(async () => {
    await Promise.allSettled([fetchQueue(), fetchJobs(), fetchFleet()]);
    setLastUpdated(Date.now());
  }, [fetchQueue, fetchJobs, fetchFleet]);

  useEffect(() => {
    fetchAll();
    const id = window.setInterval(fetchAll, 30_000);
    return () => window.clearInterval(id);
  }, [fetchAll]);

  // Ticks the waiting/ongoing timers between polls without re-fetching.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const rows = useMemo(() => mergeOperationsRows(queue ?? [], activeJobs ?? []), [queue, activeJobs]);
  const sorted = useMemo(() => sortOperationsRows(rows, now, ACK_SLA_MINUTES, STALLED_MINUTES), [rows, now]);
  const summary = useMemo(
    () => summarizeOperations(rows, fleet ?? [], now, ACK_SLA_MINUTES, STALLED_MINUTES),
    [rows, fleet, now],
  );
  const techGroups = useMemo(() => groupTechnicians(fleet ?? []), [fleet]);

  const visibleRows = useMemo(() => {
    let list = sorted;
    if (tab === "requests") list = list.filter((r) => r.isRequest);
    if (tab === "active") list = list.filter((r) => !r.isRequest);
    if (riskOnly) list = list.filter((r) => r.isRequest && requestRisk(r, now, ACK_SLA_MINUTES, STALLED_MINUTES) !== "normal");
    if (search) {
      list = list.filter((r) =>
        r.id.toLowerCase().includes(search) ||
        (r.address ?? "").toLowerCase().includes(search) ||
        (r.situation ?? "").toLowerCase().includes(search));
    }
    return list;
  }, [sorted, tab, riskOnly, search, now]);

  const visibleTechs = techFilter === "all" ? (fleet ?? []) : techGroups[techFilter];

  const selectedRow = selected && selected.kind !== "tech" ? sorted.find((r) => r.id === selected.id) ?? null : null;
  const selectedTech = selected?.kind === "tech" ? (fleet ?? []).find((t) => t.id === selected.id) ?? null : null;
  const highlightTechId = selected?.kind === "tech" ? selected.id : selectedRow?.fulfillment_technician_id ?? null;
  const highlightJobId = selectedRow ? selectedRow.id : selectedTech?.active_job?.id ?? null;

  const [candidates, setCandidates] = useState<CandidatesResponse | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
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

  const requestPoints: MapPoint[] = sorted
    .filter((r) => r.isRequest && r.lat != null && r.lng != null)
    .map((r): MapPoint => ({
      lat: r.lat!, lng: r.lng!, kind: "request", id: r.id, label: r.address ?? r.id,
      risk: toMapRisk(requestRisk(r, now, ACK_SLA_MINUTES, STALLED_MINUTES)),
    }));
  const jobPoints: MapPoint[] = sorted
    .filter((r) => !r.isRequest && r.lat != null && r.lng != null)
    .map((r): MapPoint => ({ lat: r.lat!, lng: r.lng!, kind: "job", id: r.id, label: r.address ?? r.id }));
  const techPoints: MapPoint[] = (fleet ?? [])
    .filter((t) => t.current_lat != null && t.current_lng != null)
    .map((t): MapPoint => ({
      lat: t.current_lat!, lng: t.current_lng!, kind: "tech", id: t.id,
      label: t.display_name ?? t.id, status: t.marker_status ?? undefined,
    }));
  const allPoints = [...requestPoints, ...jobPoints, ...techPoints];

  const initialLoad = queue === null && activeJobs === null && fleet === null && !queueError && !jobsError && !fleetError;
  const sourceErrors = [
    queueError && "requests", jobsError && "active jobs", fleetError && "technician roster",
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

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Unassigned" value={String(summary.unassigned)} active={tab === "requests" && !riskOnly} onClick={() => { setTab("requests"); setRiskOnly(false); }} />
        <MetricTile label="SLA at risk" value={String(summary.atRisk)} intent="danger" active={riskOnly} onClick={() => { setTab("requests"); setRiskOnly(true); }} />
        <MetricTile label="Active jobs" value={String(summary.activeJobs)} active={tab === "active"} onClick={() => { setTab("active"); setRiskOnly(false); }} />
        <MetricTile label="Available techs" value={String(summary.availableTechnicians)} intent="success" active={techFilter === "Available"} onClick={() => setTechFilter((f) => (f === "Available" ? "all" : "Available"))} />
        <MetricTile label="Offline techs" value={String(summary.offlineTechnicians)} intent="warn" active={techFilter === "Offline"} onClick={() => setTechFilter((f) => (f === "Offline" ? "all" : "Offline"))} />
        <MetricTile label="All work" value={String(rows.length)} active={tab === "all" && !riskOnly} onClick={() => { setTab("all"); setRiskOnly(false); }} />
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
        <div className="grid gap-4 xl:h-[calc(100vh-260px)] xl:min-h-[560px] xl:grid-cols-[58fr_26fr_18fr]">
          <Card className="overflow-hidden xl:h-full">
            <CardContent className="relative h-[420px] p-0 xl:h-full">
              <div className="absolute inset-0 bg-[#101720]">
                {allPoints.length > 0 ? (
                  <GoogleMapView
                    points={allPoints}
                    richMarkers
                    onMarkerClick={(point) => setSelected({ kind: point.kind === "tech" ? "tech" : point.kind === "request" ? "request" : "job", id: point.id! })}
                    fallback={
                      <div className="absolute inset-0 grid content-start gap-2 overflow-y-auto p-4 text-xs text-muted-foreground">
                        <div className="mb-1 font-medium text-foreground">Map key not configured — list view</div>
                        {allPoints.map((point) => (
                          <button
                            className="rounded-md border border-border bg-background/90 px-3 py-2 text-left"
                            key={`${point.kind}-${point.id}`}
                            type="button"
                            onClick={() => setSelected({ kind: point.kind === "tech" ? "tech" : point.kind === "request" ? "request" : "job", id: point.id! })}
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
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: "#ef4444" }} />Busy tech</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5" style={{ background: "#8b5cf6" }} />Active job</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rotate-45" style={{ background: "#3b82f6" }} />Request</span>
              </div>
            </CardContent>
          </Card>

          <WorkQueuePanel
            rows={visibleRows}
            totalCount={rows.length}
            tab={tab}
            onTabChange={setTab}
            search={searchInput}
            onSearchChange={setSearchInput}
            now={now}
            selectedId={selectedRow?.id ?? null}
            highlightJobId={highlightJobId}
            onSelect={(row) => setSelected({ kind: row.isRequest ? "request" : "job", id: row.id })}
          />

          <div className="flex flex-col gap-4 xl:h-full xl:overflow-hidden">
            <SelectionDetails
              row={selectedRow}
              tech={selectedTech}
              candidates={candidates}
              candidatesError={candidatesError}
              onDismiss={() => setSelected(null)}
            />
            <TechnicianRosterPanel
              techs={visibleTechs}
              totalCount={(fleet ?? []).length}
              filter={techFilter}
              onFilterChange={setTechFilter}
              now={now}
              selectedId={selectedTech?.id ?? null}
              highlightId={highlightTechId}
              onSelect={(tech) => setSelected({ kind: "tech", id: tech.id })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricTile({
  active, intent, label, onClick, value,
}: { active?: boolean; intent?: "danger" | "success" | "warn"; label: string; onClick?: () => void; value: string }) {
  return (
    <button
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
  highlightJobId, now, onSearchChange, onSelect, onTabChange, rows, search, selectedId, tab, totalCount,
}: {
  highlightJobId: string | null;
  now: number;
  onSearchChange: (value: string) => void;
  onSelect: (row: OperationsRow) => void;
  onTabChange: (tab: QueueTab) => void;
  rows: OperationsRow[];
  search: string;
  selectedId: string | null;
  tab: QueueTab;
  totalCount: number;
}) {
  return (
    <Card className="flex flex-col overflow-hidden xl:h-full">
      <CardHeader className="flex-none">
        <div>
          <CardTitle>Work queue</CardTitle>
          <CardDescription>Requests and active jobs in one prioritized column.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden p-4 pt-0">
        <div className="flex flex-none flex-wrap items-center gap-2">
          {(["all", "requests", "active"] as const).map((value) => (
            <button
              className={cn(
                "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                tab === value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              key={value}
              onClick={() => onTabChange(value)}
              type="button"
            >
              {value === "all" ? "All" : value === "requests" ? "Requests" : "Active jobs"}
            </button>
          ))}
        </div>
        <Input
          className="flex-none"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search address, situation, or id"
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
            const risk = requestRisk(row, now, ACK_SLA_MINUTES, STALLED_MINUTES);
            const riskLabel = RISK_LABEL[risk];
            const isSelected = row.id === selectedId;
            const isLinked = !isSelected && row.id === highlightJobId;
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
                  <span className="font-medium">{row.address ?? row.id}</span>
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
  filter, highlightId, now, onFilterChange, onSelect, selectedId, techs, totalCount,
}: {
  filter: TechFilter;
  highlightId: string | null;
  now: number;
  onFilterChange: (filter: TechFilter) => void;
  onSelect: (tech: FleetRow) => void;
  selectedId: string | null;
  techs: FleetRow[];
  totalCount: number;
}) {
  return (
    <Card className="flex flex-1 flex-col overflow-hidden xl:min-h-0">
      <CardHeader className="flex-none">
        <div>
          <CardTitle>Technicians</CardTitle>
          <CardDescription>Status, current job, and location freshness.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden p-4 pt-0">
        <div className="flex flex-none flex-wrap items-center gap-2">
          {(["all", "Available", "Busy", "Offline"] as const).map((value) => (
            <button
              className={cn(
                "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                filter === value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              key={value}
              onClick={() => onFilterChange(value)}
              type="button"
            >
              {value === "all" ? "All" : value}
            </button>
          ))}
        </div>
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
            const isSelected = tech.id === selectedId;
            const isLinked = !isSelected && tech.id === highlightId;
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
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{tech.display_name ?? tech.id}</span>
                  <Badge variant={TECH_STATUS_VARIANT[status]}>{status}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Location {fresh.label}</div>
                {tech.active_job ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {JOB_STATUS_LABEL[tech.active_job.status] ?? tech.active_job.status} · {tech.active_job.address ?? tech.active_job.id}
                  </div>
                ) : null}
                {tech.skills.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">{tech.skills.map((skill) => <Badge key={skill} variant="outline">{skill}</Badge>)}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function SelectionDetails({
  candidates, candidatesError, onDismiss, row, tech,
}: {
  candidates: CandidatesResponse | null;
  candidatesError: string | null;
  onDismiss: () => void;
  row: OperationsRow | null;
  tech: FleetRow | null;
}) {
  if (!row && !tech) return null;
  const distanceUnit = candidates?.distance_unit === "km" ? "km" : "mi";
  return (
    <Card className="flex-none border-primary/30">
      <CardHeader>
        <CardTitle>{row ? (row.isRequest ? "Request" : "Active job") : "Technician"}</CardTitle>
        <Button onClick={onDismiss} size="sm" variant="ghost">Close</Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {row ? (
          <>
            <div className="text-muted-foreground">{row.address ?? row.id}</div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={JOB_STATUS_VARIANT[row.status] ?? "neutral"}>{JOB_STATUS_LABEL[row.status] ?? row.status}</Badge>
              {row.technician_display_name ? <Badge variant="outline">Tech: {row.technician_display_name}</Badge> : null}
            </div>
            {row.last_decline_reason ? <div className="text-xs text-muted-foreground">Last decline: “{row.last_decline_reason}”</div> : null}
            {row.last_issue ? <div className="text-xs text-muted-foreground">Last issue: {row.last_issue.replace(/^tech_issue:/, "")}</div> : null}
            {row.isRequest ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">Candidate technicians</div>
                {candidatesError ? <div className="text-xs text-destructive">{candidatesError}</div> : null}
                {!candidates && !candidatesError ? <div className="text-xs text-muted-foreground">Loading candidates…</div> : null}
                {candidates?.candidates.length === 0 ? <div className="text-xs text-muted-foreground">No eligible technicians found.</div> : null}
                {(candidates?.candidates ?? []).slice(0, 5).map((candidate) => (
                  <div className="rounded-md border border-border p-2 text-xs" key={candidate.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{candidate.display_name ?? candidate.id}</span>
                      <Badge variant={candidate.is_online ? "success" : "neutral"}>{candidate.is_online ? "Online" : "Offline"}</Badge>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {candidateDistance(candidate, distanceUnit)} · ETA {candidate.eta_min != null ? `${candidate.eta_min}–${candidate.eta_max}m` : "unknown"}
                      {candidate.is_busy ? " · busy" : ""}{candidate.skills_match ? " · skill match" : ""}
                    </div>
                  </div>
                ))}
                <Button asChild size="sm"><Link href={`/queue/${row.id}`}>Open assignment</Link></Button>
              </div>
            ) : null}
          </>
        ) : null}
        {tech ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant={TECH_STATUS_VARIANT[technicianStatusLabel(tech.marker_status)]}>{technicianStatusLabel(tech.marker_status)}</Badge>
            </div>
            {tech.active_job ? (
              <div className="text-muted-foreground">
                Current job: {JOB_STATUS_LABEL[tech.active_job.status] ?? tech.active_job.status} · {tech.active_job.address ?? tech.active_job.id}
              </div>
            ) : (
              <div className="text-muted-foreground">No active job</div>
            )}
            {tech.phone ? <div className="text-muted-foreground">Contact: <a className="underline" href={`tel:${tech.phone}`}>{tech.phone}</a></div> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
