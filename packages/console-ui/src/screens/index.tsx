"use client";

import {
  compliance,
  dashboardAggregates,
  events,
  eventsForJob,
  jobs,
  offers,
  organizationById,
  organizations,
  teams,
  technicianById,
  technicians
} from "@cluexp/api-client";
import type { ConsoleMode, ConsoleStatus, Job } from "@cluexp/api-client";
import { GoogleMapView } from "../components/google-map";
import type { MapPoint } from "../components/google-map";
import {
  Building2,
  Bell,
  BellRing,
  CheckCircle2,
  CircleDot,
  Lock,
  MapPin,
  RadioTower,
  SlidersHorizontal,
  UserCheck
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  AlertTriangle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ComplianceStatus,
  DataTable,
  DispatchQueue,
  EmptyState,
  FileText,
  FilterBar,
  Input,
  LoadingSkeleton,
  MapCard,
  MessageSquare,
  Navigation,
  PageHeader,
  Phone,
  Route,
  RowActions,
  SlaCountdown,
  Sparkles,
  StatCard,
  StatusBadge,
  TechnicianCard,
  Timeline,
  TrustSafety,
  TrustStateChip,
  UrgencyTag,
  UserRound
} from "../components";
import { cn } from "../lib/cn";

const orgId = "org-metro";

function mustJob(id: string): Job {
  const job = jobs.find((item) => item.id === id);
  if (!job) throw new Error(`Missing mock job: ${id}`);
  return job;
}

function firstOffer() {
  const offer = offers[0];
  if (!offer) throw new Error("Missing mock offer");
  return offer;
}

function scopedJobs(mode: ConsoleMode): Job[] {
  return mode === "org" ? jobs.filter((job) => job.origin_org_id === orgId || job.customer_owner_org_id === orgId || job.fulfillment_org_id === orgId) : jobs;
}

function byPriority(job: Job): number {
  if (job.console_status === "stalled" || job.urgency === "critical") return 0;
  if (job.console_status === "offer_expiring" || job.safety_flags.length > 0) return 1;
  return job.age_min;
}

function primaryJob(mode: ConsoleMode): Job {
  return mode === "org" ? mustJob("JOB-B-2248") : mustJob("JOB-A-2201");
}

function organizationLabel(id?: string | null): string {
  if (!id) return "Not assigned";
  if (id === "platform-cluexp") return "ClueXP Platform";
  return organizationById(id)?.display_name ?? id;
}

function fulfillmentLabel(job: Job): string {
  if (job.fulfillment_technician_id) return technicianById(job.fulfillment_technician_id)?.display_name ?? job.fulfillment_technician_id;
  if (job.fulfillment_org_id) return organizationLabel(job.fulfillment_org_id);
  return "Pending network assignment";
}

function policyLabel(job: Job): string {
  const policy = job.fulfillment_policy?.replace(/_/g, " ") ?? "not set";
  const mode = job.dispatch_mode?.replace(/_/g, " ") ?? "not set";
  return `${mode} · ${policy}`;
}

export function Dashboard({ mode }: { mode: ConsoleMode }) {
  const queue = [...scopedJobs(mode)].sort((a, b) => byPriority(a) - byPriority(b));
  const atRisk = queue.filter((job) => job.urgency === "critical" || job.console_status === "stalled" || job.console_status === "escalated");
  return (
    <div>
      <PageHeader
        kicker={mode === "org" ? "Provider command center" : "Operations command center"}
        title="Dispatch Dashboard"
        description="Live service requests, network capacity, SLA exposure, and recent trust-state activity."
        actions={<><Button asChild><Link href={mode === "org" ? "/intake/new" : "/queue"}>Create request</Link></Button><Button variant="outline">Export shift report</Button></>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Live Requests" value={String(dashboardAggregates.live_requests)} delta="+3" trend="last 30 min" />
        <StatCard label="Average ETA" value={`${dashboardAggregates.avg_eta_min}m`} delta="-2m" intent="success" />
        <StatCard label="Active Professionals" value={String(dashboardAggregates.active_professionals)} />
        <StatCard label="SLA Risk" value={String(dashboardAggregates.sla_risk_count)} delta="watch" intent="warn" />
        <StatCard label="Revenue Today" value={dashboardAggregates.revenue_today} />
        <StatCard label="Completion Rate" value={dashboardAggregates.completion_rate} delta="+4%" intent="success" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Live queue preview</CardTitle>
              <CardDescription>Priority requests float first. Open rows for the request drawer.</CardDescription>
            </div>
            <Button asChild variant="outline"><Link href="/queue">Open queue</Link></Button>
          </CardHeader>
          <CardContent><DispatchQueue jobs={queue.slice(0, 4)} /></CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>At-risk strip</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {atRisk.length ? atRisk.map((job) => (
                <div className="rounded-md border border-destructive/35 bg-destructive/5 p-3" key={job.id}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{job.id}</span><StatusBadge status={job.console_status} /></div>
                  <div className="mt-1 text-sm text-muted-foreground">{job.escalation_reason ?? job.situation}</div>
                </div>
              )) : <EmptyState title="No SLA exposure" description="At-risk requests will appear here." />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
            <CardContent><Timeline events={events.slice(0, 4)} /></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

type OpsJob = {
  id: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  detail?: Record<string, unknown>;
  access_type: string | null;
  situation: string | null;
  urgency: string | null;
  created_at: string | null;
  customer_owner_org_id: string | null;
  fulfillment_policy: string | null;
  dispatch_attempts: number;
  offer_active: boolean;
  offer_id: string | null;
  offered_technician_id: string | null;
  offer_expires_at: string | null;
  last_decline_reason: string | null;
  decline_count: number;
  photo_count?: number;
  photo_paths?: string[];
  photo_urls?: string[];
};

const API_BASE = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL ?? "";

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("cluexp_access_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function ageLabel(created_at: string | null): string {
  if (!created_at) return "--";
  const diffMs = Date.now() - new Date(created_at).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function positiveMinutes(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DISPATCH_ACK_SLA_MINUTES = positiveMinutes(
  process.env.NEXT_PUBLIC_DISPATCH_ACK_SLA_MINUTES,
  5,
);
const DISPATCH_STALLED_MINUTES = Math.max(
  DISPATCH_ACK_SLA_MINUTES,
  positiveMinutes(process.env.NEXT_PUBLIC_DISPATCH_STALLED_MINUTES, 15),
);

type QueueRisk = "normal" | "ack_breached" | "stalled" | "critical";

function waitingMinutes(createdAt: string | null, now: number): number | null {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return null;
  return Math.max(0, Math.floor((now - created) / 60_000));
}

function queueRisk(job: OpsJob, now: number): QueueRisk {
  if (job.urgency === "critical" && !job.offer_active) return "critical";
  if (job.offer_active) return "normal";
  const waiting = waitingMinutes(job.created_at, now);
  if (waiting === null) return "normal";
  if (waiting >= DISPATCH_STALLED_MINUTES) return "stalled";
  if (job.dispatch_attempts === 0 && waiting >= DISPATCH_ACK_SLA_MINUTES) return "ack_breached";
  return "normal";
}

function riskLabel(risk: QueueRisk): string | null {
  if (risk === "critical") return "Critical · act now";
  if (risk === "stalled") return "Stalled";
  if (risk === "ack_breached") return "Ack SLA breached";
  return null;
}

function jobDetailSummary(detail?: Record<string, unknown>): string | null {
  if (!detail) return null;
  const notes = typeof detail.additional_details === "string" ? detail.additional_details.trim() : "";
  const automotive = detail.automotive && typeof detail.automotive === "object" ? detail.automotive as Record<string, unknown> : null;
  const vehicle = automotive
    ? [automotive.year, automotive.make, automotive.model, automotive.color]
        .filter((value) => value != null && String(value).trim())
        .map(String)
        .join(" ")
    : "";
  const property = detail.property && typeof detail.property === "object" ? detail.property as Record<string, unknown> : null;
  const propertyHint = property
    ? [property.property_type, property.lock_type]
        .filter((value) => value != null && String(value).trim())
        .map(String)
        .join(" · ")
    : "";
  return [vehicle, propertyHint, notes].filter(Boolean).join(" · ") || null;
}

export function LiveQueue({ mode }: { mode: ConsoleMode }) {
  const router = useRouter();
  const [queue, setQueue] = useState<OpsJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const previousJobIds = useRef<Set<string> | null>(null);
  const notifiedRisks = useRef(new Set<string>());
  // ClueXP ops dispatches from the global pool; a provider company dispatches
  // its own org-scoped queue. Same UI, different tenant-scoped endpoint.
  const apiPrefix = mode === "org" ? "/api/provider" : "/api/ops";

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`${apiPrefix}/queue`);
      if (!res.ok) throw new Error(`${res.status}`);
      setQueue(await res.json());
      setNow(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queue");
    }
  }, [apiPrefix]);

  useEffect(() => {
    fetchQueue();
    const id = window.setInterval(fetchQueue, 30_000);
    return () => window.clearInterval(id);
  }, [fetchQueue]);

  useEffect(() => {
    setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  const risks = useMemo(
    () => new Map((queue ?? []).map((job) => [job.id, queueRisk(job, now)])),
    [queue, now],
  );
  const attentionCount = [...risks.values()].filter((risk) => risk !== "normal").length;
  const criticalCount = [...risks.values()].filter((risk) => risk === "critical").length;

  useEffect(() => {
    if (mode !== "org" || queue === null) return;
    const currentIds = new Set(queue.map((job) => job.id));
    const previousIds = previousJobIds.current;
    previousJobIds.current = currentIds;
    if (!("Notification" in window) || notificationPermission !== "granted") return;

    for (const job of queue) {
      const risk = risks.get(job.id) ?? "normal";
      const isNew = previousIds !== null && !previousIds.has(job.id);
      const riskKey = `${job.id}:${risk}`;
      if (!isNew && risk === "normal") continue;
      if (!isNew && notifiedRisks.current.has(riskKey)) continue;
      notifiedRisks.current.add(riskKey);
      const label = riskLabel(risk);
      new Notification(isNew ? "New dispatch request" : label ?? "Dispatch queue update", {
        body: `${job.urgency ? `${job.urgency} urgency · ` : ""}${label ?? "Open the staffed dispatch console to review."}`,
        tag: riskKey,
      });
    }
  }, [mode, notificationPermission, queue, risks]);

  const enableBrowserAlerts = useCallback(async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }, []);

  const queuePoints: MapPoint[] = useMemo(
    () => (queue ?? [])
      .filter((job) => job.lat != null && job.lng != null)
      .map((job): MapPoint => ({
        lat: job.lat!,
        lng: job.lng!,
        kind: "job",
        id: job.id,
        label: job.address ?? job.id,
      })),
    [queue],
  );

  return (
    <div>
      <PageHeader
        kicker={mode === "org" ? "Company dispatch queue" : "Ops dispatch queue"}
        title="Live Queue"
        description="All pending jobs in arrival order. Click a job to view candidates and send an assignment offer."
        actions={
          <div className="flex flex-wrap gap-2">
            {mode === "org" && notificationPermission !== "unsupported" ? (
              <Button variant="outline" onClick={enableBrowserAlerts} disabled={notificationPermission !== "default"}>
                {notificationPermission === "granted" ? <BellRing /> : <Bell />}
                {notificationPermission === "granted"
                  ? "Browser alerts on"
                  : notificationPermission === "denied"
                    ? "Browser alerts blocked"
                    : "Enable browser alerts"}
              </Button>
            ) : null}
            <Button variant="outline" onClick={fetchQueue}>Refresh</Button>
          </div>
        }
      />
      {error ? <div className="mb-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      {mode === "org" ? (
        <div className={`mb-4 rounded-md border p-3 text-sm ${attentionCount > 0 ? "border-destructive/35 bg-destructive/10 text-destructive" : "border-border bg-secondary/30 text-muted-foreground"}`} role={attentionCount > 0 ? "alert" : undefined}>
          <div className="font-medium">
            {attentionCount > 0
              ? `${attentionCount} job${attentionCount === 1 ? "" : "s"} need immediate dispatcher attention${criticalCount > 0 ? ` · ${criticalCount} critical` : ""}`
              : "Dispatcher queue is within the staffed-console SLA"}
          </div>
          <div className="mt-1 text-xs">
            Acknowledge within {DISPATCH_ACK_SLA_MINUTES}m; unassigned jobs are stalled at {DISPATCH_STALLED_MINUTES}m. Browser alerts work only while this console is open and are not a substitute for production SMS/push escalation.
          </div>
        </div>
      ) : null}
      {queue === null && !error ? (
        <LoadingSkeleton />
      ) : queue && queue.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Queue empty" description="No jobs are waiting for dispatch." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card text-left text-xs font-semibold uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Address</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Situation</th>
                    <th className="px-4 py-3">Urgency</th>
                    <th className="px-4 py-3">Age</th>
                    <th className="px-4 py-3">Attempts</th>
                    <th className="px-4 py-3">Offer</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {(queue ?? []).map((job) => {
                    const risk = risks.get(job.id) ?? "normal";
                    const label = riskLabel(risk);
                    const detail = jobDetailSummary(job.detail);
                    return (
                    <tr
                      key={job.id}
                      className={`border-t transition-colors hover:bg-secondary/40 cursor-pointer ${risk === "normal" ? "border-border" : "border-destructive/35 bg-destructive/5"}`}
                      onClick={() => router.push(`/queue/${job.id}`)}
                    >
                      <td className="px-4 py-3 font-medium">
                        <div>{job.address ?? "—"}</div>
                        {detail ? <div className="mt-1 max-w-[34rem] truncate text-xs font-normal text-muted-foreground">{detail}</div> : null}
                        {job.photo_count ? <div className="mt-1 text-xs text-muted-foreground">{job.photo_count} intake photo{job.photo_count === 1 ? "" : "s"}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{job.access_type ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{job.situation ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={job.urgency === "critical" ? "critical" : job.urgency === "high" ? "warn" : "outline"}>{job.urgency ?? "—"}</Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        <div>{ageLabel(job.created_at)}</div>
                        {label ? <Badge className="mt-1" variant={risk === "ack_breached" ? "warn" : "danger"}>{label}</Badge> : null}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{job.dispatch_attempts}</td>
                      <td className="px-4 py-3">
                        {job.offer_active
                          ? <Badge variant="warn">Offer sent · <SlaCountdown deadline={job.offer_expires_at ?? undefined} /></Badge>
                          : <Badge variant="outline">Awaiting</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); router.push(`/queue/${job.id}`); }}>
                          {mode === "org" ? "Assign" : "View"}
                        </Button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <span>{queue?.length ?? 0} jobs waiting</span>
                <span>Refreshes every 30s</span>
              </div>
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Queue map</CardTitle>
              <CardDescription>{queuePoints.length} job{queuePoints.length === 1 ? "" : "s"} with coordinates.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="relative h-[420px] bg-[#101720]">
                {queuePoints.length > 0 ? (
                  <GoogleMapView
                    points={queuePoints}
                    fallback={
                      <div className="absolute inset-0 grid content-center gap-3 p-4 text-xs text-muted-foreground">
                        {queuePoints.map((point) => (
                          <button
                            className="rounded-md border border-border bg-background/90 px-3 py-2 text-left"
                            key={point.id}
                            type="button"
                            onClick={() => router.push(`/queue/${point.id}`)}
                          >
                            <span className="font-medium text-foreground">{point.label}</span>
                            <span className="ml-2 tabular-nums">{point.lat.toFixed(4)}, {point.lng.toFixed(4)}</span>
                          </button>
                        ))}
                      </div>
                    }
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">No queue jobs have coordinates</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

const capacityCells = [
  { area: "Downtown", available: 4, eta: "6-9 min", skill: "Auto access", freshness: "Live", pressure: "low" },
  { area: "North Hills", available: 2, eta: "12-16 min", skill: "Residential", freshness: "2 min", pressure: "medium" },
  { area: "Midtown", available: 1, eta: "9-13 min", skill: "Auto access", freshness: "Live", pressure: "high" },
  { area: "East Side", available: 3, eta: "15-20 min", skill: "Commercial", freshness: "4 min", pressure: "medium" }
] as const;

function rankedScore(techId: string) {
  const scores: Record<string, { score: number; reasons: string[] }> = {
    "tech-jordan": { score: 94, reasons: ["0.8 mi away", "Auto access match", "GPS updated 1 min ago"] },
    "tech-samir": { score: 88, reasons: ["High completion rating", "Verified provider roster", "Current workload: 1"] },
    "tech-lina": { score: 81, reasons: ["Available now", "Residential skill overlap", "GPS updated 4 min ago"] },
    "tech-marcus": { score: 42, reasons: ["Strong skill match", "Documents block dispatch", "Manual review required"] },
    "tech-morgan": { score: 38, reasons: ["3.3 mi away", "GPS stale 18 min", "Existing workload"] }
  };
  return scores[techId] ?? { score: 50, reasons: ["Eligible profile", "Service-area match pending", "Availability check pending"] };
}

interface PlacePrediction {
  description: string;
  place_id: string;
}

interface PlacesAutocompleteResponse {
  predictions?: PlacePrediction[];
}

type GeocodeResponse =
  | {
      resolved: true;
      formatted_address?: string;
      geocode_confidence: string;
    }
  | { resolved: false };

const accessTypeOptions = [
  { value: "home", label: "Home" },
  { value: "vehicle", label: "Vehicle" },
  { value: "business", label: "Business" },
  { value: "other", label: "Other" },
] as const;

const situationOptions = [
  { value: "locked_out", label: "Locked out" },
  { value: "lost_key", label: "Lost key" },
  { value: "broken_key", label: "Broken key" },
  { value: "key_in_car", label: "Key in car" },
  { value: "malfunction", label: "Malfunction" },
  { value: "rekey", label: "Rekey" },
] as const;

const urgencyOptions = [
  { value: "emergency", label: "Emergency" },
  { value: "urgent", label: "Urgent" },
  { value: "standard", label: "Standard" },
  { value: "scheduled", label: "Scheduled" },
] as const;

const authorityOptions = [
  { value: "owner", label: "Owner" },
  { value: "tenant", label: "Tenant" },
  { value: "manager", label: "Manager" },
  { value: "employee", label: "Employee" },
  { value: "other", label: "Other authorized" },
] as const;

const safetyOptions = [
  { value: "none", label: "None reported" },
  { value: "person_inside", label: "Person inside" },
  { value: "pet_inside", label: "Pet inside" },
  { value: "medical", label: "Medical concern" },
  { value: "unsafe_location", label: "Unsafe location" },
] as const;

const sourceChannelOptions = [
  { value: "Phone intake", label: "Phone" },
  { value: "Walk-in", label: "Walk-in" },
  { value: "Website callback", label: "Website callback" },
  { value: "Referral", label: "Referral" },
] as const;

const initialProviderRequestForm = {
  customer_name: "",
  customer_phone: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  zip: "",
  source_channel: "Phone intake",
  access_type: "",
  situation: "",
  urgency: "",
  authority_role: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_year: "",
  vehicle_color: "",
  key_type: "unknown",
  lock_type: "",
  other_detail: "",
  safety_flag: "",
  scheduled_date: "",
  scheduled_time: "",
  notes: ""
};

function optionLabel(options: readonly { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? "Missing";
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function splitAddress(description: string) {
  const parts = description.split(",").map((part) => part.trim()).filter(Boolean);
  const stateZip = parts[2] || "";
  const match = stateZip.match(/^([A-Za-z]{2})\s+(.+)$/);
  return {
    street1: parts[0] || description,
    city: parts[1] || "",
    state: match?.[1] || "",
    zip: match?.[2] || "",
  };
}

function fullAddress(form: typeof initialProviderRequestForm) {
  return [
    form.street1.trim(),
    form.street2.trim(),
    [form.city.trim(), form.state.trim(), form.zip.trim()].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
}

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  required,
  tone = "default"
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: string;
  onChange: (value: T) => void;
  required?: boolean;
  tone?: "default" | "safety";
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}{required ? <span className="text-destructive"> *</span> : null}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            className={cn(
              "min-h-10 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
              value === option.value
                ? tone === "safety" && option.value !== "none"
                  ? "border-destructive bg-destructive text-destructive-foreground"
                  : "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-accent"
            )}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProviderNewRequest() {
  const org = organizationById(orgId);
  const customerNameRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState(initialProviderRequestForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [placePredictions, setPlacePredictions] = useState<PlacePrediction[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [addressStatus, setAddressStatus] = useState<"manual" | "selected" | "unresolved">("manual");
  const [geocodeConfidence, setGeocodeConfidence] = useState<string | null>(null);
  const [activePredictionIndex, setActivePredictionIndex] = useState(-1);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (["street1", "street2", "city", "state", "zip"].includes(field)) {
      setAddressStatus("manual");
      setGeocodeConfidence(null);
    }
  }

  function resetForNextCall() {
    setForm(initialProviderRequestForm);
    setError(null);
    setCreatedId(null);
    setPlacePredictions([]);
    setAddressStatus("manual");
    setGeocodeConfidence(null);
    requestAnimationFrame(() => customerNameRef.current?.focus());
  }

  function buildNotes() {
    const details = [
      form.notes.trim(),
      `Authority: ${optionLabel(authorityOptions, form.authority_role)}`,
      `Safety flag: ${optionLabel(safetyOptions, form.safety_flag)}`,
      form.urgency === "scheduled"
        ? `Scheduled service: ${form.scheduled_date || "date missing"} ${form.scheduled_time || "time missing"}`
        : "",
      form.access_type === "vehicle"
        ? `Vehicle: ${[form.vehicle_year, form.vehicle_color, form.vehicle_make, form.vehicle_model].filter(Boolean).join(" ") || "details not provided"}; key type: ${form.key_type}`
        : "",
      form.access_type === "home" || form.access_type === "business"
        ? `Lock/property: ${form.lock_type.trim() || "not sure"}`
        : "",
      form.access_type === "other" ? `Other service detail: ${form.other_detail.trim() || "not provided"}` : "",
      addressStatus === "selected" ? `Address verified: ${geocodeConfidence || "confidence unknown"}` : "Address not verified by autocomplete",
    ].filter(Boolean);
    return details.join("\n");
  }

  async function selectPlace(description: string) {
    const parsed = splitAddress(description);
    setForm((current) => ({ ...current, ...parsed }));
    setPlacePredictions([]);
    setActivePredictionIndex(-1);
    setPlacesLoading(true);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(description)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as GeocodeResponse;
      if (!response.ok) throw new Error("Unable to verify address");
      if (body.resolved) {
        const verified = splitAddress(body.formatted_address || description);
        setForm((current) => ({ ...current, ...verified }));
        setAddressStatus("selected");
        setGeocodeConfidence(body.geocode_confidence);
      } else {
        setAddressStatus("unresolved");
        setGeocodeConfidence("none");
      }
    } catch {
      setAddressStatus("unresolved");
      setGeocodeConfidence("none");
    } finally {
      setPlacesLoading(false);
    }
  }

  function handleAddressKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!placePredictions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActivePredictionIndex((index) => Math.min(index + 1, placePredictions.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActivePredictionIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter" && activePredictionIndex >= 0) {
      event.preventDefault();
      void selectPlace(placePredictions[activePredictionIndex]!.description);
    }
    if (event.key === "Escape") {
      setPlacePredictions([]);
      setActivePredictionIndex(-1);
    }
  }

  async function createRequest() {
    setBusy(true);
    setError(null);
    setCreatedId(null);
    try {
      const response = await fetch("/api/provider/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_name: form.customer_name.trim() || null,
          customer_phone: form.customer_phone.trim() || null,
          address: fullAddress(form),
          source_channel: form.source_channel,
          access_type: form.access_type,
          situation: form.situation,
          urgency: form.urgency,
          notes: buildNotes(),
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Request failed: ${response.status}`);
      setCreatedId(body.ticket?.ticket_id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create request");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const address = form.street1.trim();
    if (address.length < 2 || addressStatus === "selected") {
      setPlacePredictions([]);
      setPlacesLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPlacesLoading(true);
      try {
        const response = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(address)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({})) as PlacesAutocompleteResponse;
        setPlacePredictions(response.ok ? (body.predictions || []).slice(0, 5) : []);
        setActivePredictionIndex(-1);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setPlacePredictions([]);
      } finally {
        setPlacesLoading(false);
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [form.street1, addressStatus]);

  useEffect(() => {
    customerNameRef.current?.focus();
  }, []);

  const phoneValid = normalizePhone(form.customer_phone).length >= 10;
  const scheduledReady = form.urgency !== "scheduled" || Boolean(form.scheduled_date && form.scheduled_time);
  const canCreate = Boolean(
    form.customer_name.trim().length >= 2 &&
    phoneValid &&
    form.street1.trim() &&
    form.city.trim() &&
    form.state.trim() &&
    form.zip.trim() &&
    form.access_type &&
    form.situation &&
    form.urgency &&
    form.authority_role &&
    form.safety_flag &&
    scheduledReady
  );
  const missingItems = [
    form.customer_name.trim().length >= 2 ? "" : "caller name",
    phoneValid ? "" : "valid callback phone",
    form.street1.trim() && form.city.trim() && form.state.trim() && form.zip.trim() ? "" : "complete address",
    form.access_type ? "" : "service type",
    form.situation ? "" : "situation",
    form.urgency ? "" : "urgency",
    form.authority_role ? "" : "authority",
    form.safety_flag ? "" : "safety",
    scheduledReady ? "" : "scheduled date and time",
  ].filter(Boolean);
  const composedNotes = buildNotes();

  return (
    <div>
      <PageHeader
        kicker="Call intake"
        title="New service request"
        description="Capture the caller, location, service need, safety status, and authorization before sending the job to dispatch."
        actions={<><Badge variant="outline">{org?.display_name ?? "Provider"}</Badge><Badge variant="outline">Phone workflow</Badge></>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Call details</CardTitle>
              <CardDescription>Required fields are marked. Leave unknown technical details as not sure instead of guessing.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium">Customer name <span className="text-destructive">*</span><Input ref={customerNameRef} placeholder="Customer display name" value={form.customer_name} onChange={(event) => update("customer_name", event.target.value)} /></label>
              <label className="space-y-2 text-sm font-medium">Callback phone <span className="text-destructive">*</span><Input type="tel" inputMode="tel" placeholder="Verified callback number" value={form.customer_phone} onChange={(event) => update("customer_phone", event.target.value)} /></label>
              <label className="space-y-2 text-sm font-medium">
                Source channel
                <select className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={form.source_channel} onChange={(event) => update("source_channel", event.target.value)}>
                  {sourceChannelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>

            <div className="space-y-4 rounded-md border border-border bg-secondary/30 p-4">
              <div>
                <div className="text-sm font-semibold">1. Location <span className="text-destructive">*</span></div>
                <p className="text-xs text-muted-foreground">Use autocomplete when possible. Manual fields stay editable.</p>
              </div>
              <label className="relative space-y-2 text-sm font-medium">
                Street 1
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    aria-autocomplete="list"
                    aria-controls="provider-address-suggestions"
                    aria-expanded={placePredictions.length > 0}
                    className="pl-9"
                    placeholder="Start typing street address"
                    role="combobox"
                    value={form.street1}
                    onChange={(event) => update("street1", event.target.value)}
                    onKeyDown={handleAddressKeyDown}
                    autoComplete="off"
                  />
                </div>
                <div className="min-h-5 text-xs text-muted-foreground" role="status">
                  {placesLoading ? "Checking suggestions..." : addressStatus === "selected" ? `Address verified${geocodeConfidence ? ` · ${geocodeConfidence} confidence` : ""}` : addressStatus === "unresolved" ? "Using typed address. Dispatch may need to confirm location." : "Autocomplete is unscoped. Select a match or keep typing."}
                </div>
                {placePredictions.length > 0 ? (
                  <div className="absolute left-0 right-0 top-full z-20 overflow-hidden rounded-md border border-border bg-popover shadow-lg" id="provider-address-suggestions" role="listbox">
                    {placePredictions.map((prediction, index) => (
                      <button
                        aria-selected={activePredictionIndex === index}
                        className={cn("flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none", activePredictionIndex === index && "bg-accent")}
                        key={prediction.place_id}
                        role="option"
                        type="button"
                        onClick={() => void selectPlace(prediction.description)}
                      >
                        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{prediction.description}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm font-medium">Street 2 / unit<Input placeholder="Apartment, suite, gate, landmark" value={form.street2} onChange={(event) => update("street2", event.target.value)} /></label>
                <label className="space-y-2 text-sm font-medium">City <span className="text-destructive">*</span><Input value={form.city} onChange={(event) => update("city", event.target.value)} /></label>
                <label className="space-y-2 text-sm font-medium">State <span className="text-destructive">*</span><Input maxLength={2} value={form.state} onChange={(event) => update("state", event.target.value.toUpperCase())} /></label>
                <label className="space-y-2 text-sm font-medium">ZIP <span className="text-destructive">*</span><Input inputMode="numeric" value={form.zip} onChange={(event) => update("zip", event.target.value)} /></label>
              </div>
            </div>

            <div className="space-y-5 rounded-md border border-border bg-secondary/30 p-4">
              <div>
                <div className="text-sm font-semibold">2. Service</div>
                <p className="text-xs text-muted-foreground">Choose coded values for dispatch. Labels shown here are normalized for agents.</p>
              </div>
              <OptionGroup required label="Service type" options={accessTypeOptions} value={form.access_type} onChange={(value) => update("access_type", value)} />
              {form.access_type === "vehicle" ? (
                <div className="grid gap-4 rounded-md border border-border bg-background p-4 md:grid-cols-3">
                  <label className="space-y-2 text-sm font-medium">Make<Input placeholder="Toyota, Ford..." value={form.vehicle_make} onChange={(event) => update("vehicle_make", event.target.value)} /></label>
                  <label className="space-y-2 text-sm font-medium">Model<Input placeholder="Camry, F-150..." value={form.vehicle_model} onChange={(event) => update("vehicle_model", event.target.value)} /></label>
                  <label className="space-y-2 text-sm font-medium">Year<Input inputMode="numeric" placeholder="2021" value={form.vehicle_year} onChange={(event) => update("vehicle_year", event.target.value)} /></label>
                  <label className="space-y-2 text-sm font-medium">Color<Input placeholder="Black, white..." value={form.vehicle_color} onChange={(event) => update("vehicle_color", event.target.value)} /></label>
                  <label className="space-y-2 text-sm font-medium md:col-span-2">
                    Key type
                    <select className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={form.key_type} onChange={(event) => update("key_type", event.target.value)}>
                      <option value="unknown">Not sure</option>
                      <option value="mechanical">Mechanical key</option>
                      <option value="transponder">Transponder</option>
                      <option value="smart_key">Smart key / fob</option>
                    </select>
                  </label>
                </div>
              ) : null}
              {form.access_type === "home" || form.access_type === "business" ? (
                <label className="block space-y-2 rounded-md border border-border bg-background p-4 text-sm font-medium">
                  Lock or property detail
                  <Input placeholder={form.access_type === "business" ? "Storefront, office, access control, safe..." : "Front door, deadbolt, smart lock, garage..."} value={form.lock_type} onChange={(event) => update("lock_type", event.target.value)} />
                </label>
              ) : null}
              {form.access_type === "other" ? (
                <label className="block space-y-2 rounded-md border border-border bg-background p-4 text-sm font-medium">
                  Other service detail
                  <Input placeholder="Describe the access problem" value={form.other_detail} onChange={(event) => update("other_detail", event.target.value)} />
                </label>
              ) : null}
              <OptionGroup required label="Situation" options={situationOptions} value={form.situation} onChange={(value) => update("situation", value)} />
              <OptionGroup required label="Urgency" options={urgencyOptions} value={form.urgency} onChange={(value) => update("urgency", value)} />
              {form.urgency === "scheduled" ? (
                <div className="grid gap-4 rounded-md border border-border bg-background p-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium">Calendar date <span className="text-destructive">*</span><Input type="date" value={form.scheduled_date} onChange={(event) => update("scheduled_date", event.target.value)} /></label>
                  <label className="space-y-2 text-sm font-medium">Time <span className="text-destructive">*</span><Input type="time" value={form.scheduled_time} onChange={(event) => update("scheduled_time", event.target.value)} /></label>
                  <p className="text-xs text-muted-foreground md:col-span-2">Scheduling is captured with the request details for dispatch visibility.</p>
                </div>
              ) : null}
              <OptionGroup required label="Customer authority" options={authorityOptions} value={form.authority_role} onChange={(value) => update("authority_role", value)} />
            </div>

            <div className="space-y-5 rounded-md border border-border bg-secondary/30 p-4">
              <div>
                <div className="text-sm font-semibold">3. Safety <span className="text-destructive">*</span></div>
                <p className="text-xs text-muted-foreground">Ask directly. Do not leave this blank.</p>
              </div>
              <OptionGroup required tone="safety" label="Safety status" options={safetyOptions} value={form.safety_flag} onChange={(value) => update("safety_flag", value)} />
            </div>

            <label className="space-y-2 text-sm font-medium">
              Dispatcher notes
              <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" placeholder="Plain-language notes from the call" value={form.notes} onChange={(event) => update("notes", event.target.value)} />
            </label>
            {createdId ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-success/35 bg-success/10 p-3 text-sm text-success">
                <span>Created request {createdId}</span>
                <Button asChild size="sm" variant="outline"><Link href={`/queue/${createdId}`}>Open assignment</Link></Button>
                <Button size="sm" onClick={resetForNextCall}>Create another</Button>
              </div>
            ) : null}
            {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !canCreate} onClick={createRequest}>{busy ? "Creating..." : "Create Request"}</Button>
              <Button asChild variant="outline"><Link href="/queue">Back to Queue</Link></Button>
            </div>
            {!canCreate ? <p className="text-sm text-muted-foreground">Add {missingItems.join(", ")} before creating the request.</p> : null}
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Request readiness</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3"><span>Caller and callback</span><Badge variant={form.customer_name.trim().length >= 2 && phoneValid ? "success" : "outline"}>{form.customer_name.trim().length >= 2 && phoneValid ? "Ready" : "Missing"}</Badge></div>
                <div className="flex items-center justify-between gap-3"><span>Location</span><Badge variant={form.street1 && form.city && form.state && form.zip ? "success" : "outline"}>{addressStatus === "selected" ? "Verified" : form.street1 ? "Manual" : "Missing"}</Badge></div>
                <div className="flex items-center justify-between gap-3"><span>Service</span><Badge variant={form.access_type && form.situation ? "success" : "outline"}>{form.access_type && form.situation ? `${optionLabel(accessTypeOptions, form.access_type)} · ${optionLabel(situationOptions, form.situation)}` : "Missing"}</Badge></div>
                <div className="flex items-center justify-between gap-3"><span>Urgency</span><Badge variant={form.urgency ? "success" : "outline"}>{optionLabel(urgencyOptions, form.urgency)}</Badge></div>
                <div className="flex items-center justify-between gap-3"><span>Authority</span><Badge variant={form.authority_role ? "success" : "outline"}>{optionLabel(authorityOptions, form.authority_role)}</Badge></div>
                <div className="flex items-center justify-between gap-3"><span>Safety</span><Badge variant={form.safety_flag && form.safety_flag !== "none" ? "danger" : form.safety_flag ? "success" : "outline"}>{optionLabel(safetyOptions, form.safety_flag)}</Badge></div>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <div className="mb-2 font-medium">Summary</div>
                <div className="space-y-1 text-muted-foreground">
                  <div>{form.customer_name || "Caller name"} · {form.customer_phone || "callback missing"}</div>
                  <div>{fullAddress(form) || "Address missing"}</div>
                  <div>{form.access_type ? optionLabel(accessTypeOptions, form.access_type) : "Service type missing"} · {form.situation ? optionLabel(situationOptions, form.situation) : "situation missing"}</div>
                  {form.urgency === "scheduled" ? <div>Scheduled: {form.scheduled_date || "date missing"} {form.scheduled_time || "time missing"}</div> : null}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <div className="mb-2 font-medium">Notes preview</div>
                <pre className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{composedNotes || "No notes yet."}</pre>
              </div>
            </CardContent>
          </Card>
          <TrustSafety status="INTAKE" flags={[]} />
        </div>
      </div>
    </div>
  );
}

export function JobDetail({ mode }: { mode: ConsoleMode }) {
  const job = primaryJob(mode);
  const tech = technicianById(job.fulfillment_technician_id);
  const jobEvents = eventsForJob(job.id);
  return (
    <div>
      <PageHeader
        kicker="Job workspace"
        title={`${job.id} · ${job.situation}`}
        description="Console status is the operator view. Trust-state is customer visibility and changes only when the backend assigns a named technician."
        actions={<><StatusBadge status={job.console_status} /><TrustStateChip trustState={job.trust_state} /><SlaCountdown deadline={job.sla_deadline_at} targetMinutes={job.sla_min} /></>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div><CardTitle>Customer and access context</CardTitle><CardDescription>{job.address}</CardDescription></div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{job.access_type} access</Badge>
                <Badge variant="outline">{job.situation}</Badge>
                <Badge variant="outline">{job.area}</Badge>
                <Badge variant="outline">{job.price_quote ?? "Quote pending"}</Badge>
                <UrgencyTag urgency={job.urgency} />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <StatCard label="Customer safe-name" value={job.customer_display} />
                <StatCard label="Job age" value={`${job.age_min}m`} />
                <StatCard label="SLA target" value={`${job.sla_min ?? "--"}m`} />
              </div>
            </CardContent>
          </Card>
          <TrustSafety flags={job.safety_flags} status={job.trust_state} technician={tech} />
          <Card>
            <CardHeader><CardTitle>Network routing and ownership</CardTitle></CardHeader>
            <CardContent>
              <DataTable
                columns={["Origin", "Customer Owner", "Fulfillment", "Dispatch Policy", "ETA", "Routing source"]}
                rows={[[organizationLabel(job.origin_org_id), organizationLabel(job.customer_owner_org_id), fulfillmentLabel(job), policyLabel(job), job.eta_min ? `${job.eta_min} min` : "Pending", job.routing_source]]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Event timeline</CardTitle></CardHeader>
            <CardContent><Timeline events={jobEvents.length > 0 ? jobEvents : events.slice(-3)} /></CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild><Link href={`/jobs/${job.id}/assign`}>Assign</Link></Button>
              {mode === "cluexp" ? <Button asChild variant="secondary"><Link href={`/jobs/${job.id}/route`}>Route</Link></Button> : <Button variant="secondary">Request Network Overflow</Button>}
              <Button variant="outline">Reassign</Button>
              <Button variant="destructive">Cancel</Button>
              <Button variant="destructive"><AlertTriangle className="size-4" />Escalate</Button>
              <Button variant="outline"><MessageSquare className="size-4" />Message / Call</Button>
              <Button variant="outline">Add Note</Button>
            </CardContent>
          </Card>
          <Card className="border-info/35 bg-info/5">
            <CardHeader><CardTitle>Internal notes</CardTitle></CardHeader>
            <CardContent className="text-sm text-info">Organization acceptance is not customer MATCHED. Wait for a named technician before changing the customer-visible state.</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Messages</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Customer: Can wait inside lobby. Needs arrival call.</p>
              <p>Technician channel: no assigned technician yet.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

type OpsCandidate = {
  id: string;
  display_name: string | null;
  skills: string[];
  required_skill?: string | null;
  organization_supports_skill?: boolean;
  technician_supports_skill?: boolean;
  skills_match: boolean;
  dist_km: number | null;
  distance_mi?: number | null;
  distance_km?: number | null;
  eta_min: number | null;
  eta_max: number | null;
  is_online: boolean;
  is_busy: boolean;
  active_job: { id: string; status: string; address: string | null } | null;
  current_lat: number | null;
  current_lng: number | null;
  service_area_center_lat: number | null;
  service_area_center_lng: number | null;
};

type CandidatesResponse = {
  job: OpsJob;
  candidates: OpsCandidate[];
  distance_unit?: "mi" | "km";
};

export function TechnicianAssignment({ jobId, mode }: { jobId?: string; mode: ConsoleMode }) {
  const router = useRouter();
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  // Override confirmation: when a flagged candidate (offline/busy/skill-mismatch) is
  // chosen, the backend requires a reason; capture it inline before submitting.
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const apiPrefix = mode === "org" ? "/api/provider" : "/api/ops";
  const canAssign = mode === "org"; // ClueXP Ops is read-only oversight; companies dispatch.

  const fetchCandidates = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`${apiPrefix}/queue/${jobId}/candidates`);
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load candidates");
    }
  }, [jobId, apiPrefix]);

  useEffect(() => { fetchCandidates(); }, [fetchCandidates]);

  async function assign(technicianId: string, reason?: string) {
    if (!jobId) return;
    setAssigning(technicianId);
    setAssignError(null);
    try {
      const res = await fetch(`${apiPrefix}/queue/${jobId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { technician_id: technicianId, override_reason: reason } : { technician_id: technicianId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `${res.status}`);
      setAssigned(technicianId);
      setOverrideFor(null);
      setOverrideReason("");
      await fetchCandidates();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setAssigning(null);
    }
  }

  function candidateFlags(tech: {
    is_online?: boolean;
    is_busy?: boolean;
    skills_match?: boolean;
    organization_supports_skill?: boolean;
    technician_supports_skill?: boolean;
  }) {
    return [
      !tech.is_online && "offline/stale",
      tech.is_busy && "busy",
      tech.organization_supports_skill === false && "company does not offer this service",
      tech.organization_supports_skill !== false && tech.technician_supports_skill === false && "technician missing required skill",
      tech.skills_match === false && tech.organization_supports_skill !== false && tech.technician_supports_skill !== false && "missing required skill",
    ].filter(Boolean) as string[];
  }

  function isFlagged(tech: { is_online?: boolean; is_busy?: boolean; skills_match?: boolean }) {
    return !tech.is_online || tech.is_busy || tech.skills_match === false;
  }

  if (!jobId) {
    const job = primaryJob(mode);
    const offer = offers.find((item) => item.job_id === job.id) ?? firstOffer();
    const candidates = mode === "org" ? technicians.filter((tech) => tech.primary_organization_id === orgId) : technicians;
    return (
      <div>
        <PageHeader kicker="Assignment" title="Choose technician" description="Select a technician to send a targeted assignment offer." actions={<><StatusBadge status={job.console_status} /><TrustStateChip trustState={job.trust_state} /><SlaCountdown deadline={offer.expires_at} /></>} />
        <div className="space-y-3">{candidates.map((tech) => <TechnicianCard key={tech.id} mode={mode} technician={tech} />)}</div>
      </div>
    );
  }

  const job = data?.job;
  const candidates = data?.candidates ?? [];
  const distanceUnit = data?.distance_unit === "km" ? "km" : "mi";
  const formatCandidateDistance = (tech: OpsCandidate) => {
    if (distanceUnit === "km") {
      return tech.distance_km != null ? `${tech.distance_km} km` : tech.dist_km != null ? `${tech.dist_km} km` : "Distance unknown";
    }
    return tech.distance_mi != null ? `${tech.distance_mi} mi` : tech.dist_km != null ? `${Math.round(tech.dist_km * 0.621371 * 100) / 100} mi` : "Distance unknown";
  };

  const jobPoint: MapPoint | null = (job?.lat != null && job?.lng != null) ? { lat: job.lat, lng: job.lng, kind: "job", label: job.address ?? "Job", id: job.id } : null;
  const mapPoints: MapPoint[] = [
    ...(jobPoint ? [jobPoint] : []),
    ...candidates
      .filter((t) => t.current_lat != null && t.current_lng != null)
      .map((t): MapPoint => ({
        lat: t.current_lat!,
        lng: t.current_lng!,
        kind: "tech",
        label: t.display_name ?? t.id,
        id: t.id,
      })),
  ];

  const activeOffer = job?.offer_active ? job : null;
  const selectedJobDetail = jobDetailSummary(job?.detail);

  return (
    <div>
      <PageHeader
        kicker={canAssign ? "Dispatch assignment" : "Platform oversight (read-only)"}
        title={canAssign ? "Choose technician" : "Candidate view"}
        description={canAssign
          ? "Dispatcher selects one of the company's technicians to send a targeted offer. No automatic ranking — you decide."
          : "Read-only view of eligible technicians. ClueXP does not dispatch — the owning company assigns."}
        actions={
          <Button variant="outline" asChild><Link href="/queue">Back to queue</Link></Button>
        }
      />
      {error ? <div className="mb-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      {assignError ? <div className="mb-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{assignError}</div> : null}
      {assigned ? <div className="mb-4 rounded-md border border-success/35 bg-success/10 p-3 text-sm text-success">Offer sent. Technician has {job?.offer_expires_at ? "until " + new Date(job.offer_expires_at).toLocaleTimeString() : "90 seconds"} to accept.</div> : null}
      {activeOffer && !assigned ? (
        <div className="mb-4 rounded-md border border-warn/35 bg-warn/10 p-3 text-sm text-warn">
          Active offer already sent · expires <SlaCountdown deadline={job?.offer_expires_at ?? undefined} /> · wait for it to expire or be declined before reassigning.
        </div>
      ) : null}

      {data === null && !error ? (
        <LoadingSkeleton />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <div className="space-y-3">
            {candidates.length === 0 ? (
              <EmptyState icon={UserRound} title="No technicians available" description="No active, verified technicians found." />
            ) : candidates.map((tech) => (
              <Card key={tech.id} className={cn("transition-colors hover:border-primary/35", tech.skills_match && "border-success/30")}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{tech.display_name ?? tech.id}</span>
                        <Badge variant={tech.is_online ? "success" : "neutral"}>{tech.is_online ? "Online" : "Offline"}</Badge>
                        <Badge variant={tech.is_busy ? "warn" : "outline"}>{tech.is_busy ? "Busy" : "Free"}</Badge>
                        {tech.skills_match ? <Badge variant="success">Skill match</Badge> : null}
                        {tech.organization_supports_skill === false ? <Badge variant="danger">Company capability missing</Badge> : null}
                        {tech.organization_supports_skill !== false && tech.technician_supports_skill === false ? <Badge variant="danger">Technician skill missing</Badge> : null}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {formatCandidateDistance(tech)} · ETA {tech.eta_min != null ? `${tech.eta_min}–${tech.eta_max}m` : "unknown"}
                      </div>
                      {tech.is_busy && tech.active_job ? (
                        <div className="mt-1 text-xs text-muted-foreground">Active job: {tech.active_job.status} — {tech.active_job.address ?? tech.active_job.id}</div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1">{tech.skills.map((s) => <Badge key={s} variant={s === job?.access_type ? "success" : "outline"}>{s}</Badge>)}</div>
                    </div>
                    {canAssign ? (
                      <Button
                        size="sm"
                        disabled={assigning === tech.id || Boolean(activeOffer)}
                        onClick={() => {
                          if (isFlagged(tech)) { setOverrideFor(tech.id); setOverrideReason(""); }
                          else { void assign(tech.id); }
                        }}
                      >
                        {assigning === tech.id ? "Sending..." : isFlagged(tech) ? "Assign…" : "Assign"}
                      </Button>
                    ) : null}
                  </div>
                  {canAssign && overrideFor === tech.id ? (
                    <div className="mt-3 rounded-md border border-warn/35 bg-warn/10 p-3">
                      <p className="text-sm font-medium text-warn">
                        This assignment is flagged: {candidateFlags(tech).join(", ")}. A reason is required to override.
                      </p>
                      <input
                        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="Reason for overriding (required)"
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                      />
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setOverrideFor(null); setOverrideReason(""); }}>Cancel</Button>
                        <Button size="sm" disabled={assigning === tech.id || overrideReason.trim().length < 3 || Boolean(activeOffer)} onClick={() => void assign(tech.id, overrideReason.trim())}>
                          {assigning === tech.id ? "Sending..." : "Override & assign"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-6">
            {job ? (
              <Card>
                <CardHeader><CardTitle>Job context</CardTitle><CardDescription>{job.address}</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{job.access_type ?? "—"}</Badge>
                    <Badge variant="warn">{job.situation ?? "—"}</Badge>
                    <Badge variant={job.urgency === "critical" ? "critical" : job.urgency === "high" ? "warn" : "outline"}>{job.urgency ?? "—"}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">Age: {ageLabel(job.created_at)} · {job.dispatch_attempts} attempt{job.dispatch_attempts === 1 ? "" : "s"}</div>
                  {selectedJobDetail ? <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">{selectedJobDetail}</div> : null}
                  {job.photo_count ? (
                    <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm">
                      <div className="font-medium">{job.photo_count} intake photo{job.photo_count === 1 ? "" : "s"}</div>
                      {job.photo_urls?.length ? (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {job.photo_urls.map((url) => (
                            <a className="block overflow-hidden rounded-md border border-border bg-background" href={url} key={url} target="_blank" rel="noreferrer">
                              <img className="aspect-square w-full object-cover" src={url} alt="Intake upload" />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1 break-all text-xs text-muted-foreground">{(job.photo_paths ?? []).join(", ")}</div>
                      )}
                    </div>
                  ) : null}
                  {job.last_decline_reason ? (
                    <div className="rounded-md border border-warn/35 bg-warn/10 p-2 text-sm text-warn">
                      Last decline{job.decline_count > 1 ? ` (${job.decline_count} total)` : ""}: “{job.last_decline_reason}”
                    </div>
                  ) : job.decline_count > 0 ? (
                    <div className="text-sm text-muted-foreground">{job.decline_count} prior decline{job.decline_count === 1 ? "" : "s"} (no reason given)</div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {selectedPoint ? (
              <Card className="border-primary/30">
                <CardHeader><CardTitle>{selectedPoint.kind === "tech" ? "Technician" : "Job"}</CardTitle></CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {selectedPoint.label} · {selectedPoint.lat?.toFixed(4)}, {selectedPoint.lng?.toFixed(4)}
                  <Button size="sm" variant="ghost" className="ml-2" onClick={() => setSelectedPoint(null)}>Close</Button>
                </CardContent>
              </Card>
            ) : null}

            <Card className="overflow-hidden">
              <CardHeader><CardTitle>Location map</CardTitle><CardDescription>Job (blue) and technicians (amber). Click a marker for details.</CardDescription></CardHeader>
              <CardContent className="p-0">
                <div className="relative h-[420px] bg-[#101720]">
                  {mapPoints.length > 0 ? (
                    <GoogleMapView
                      points={mapPoints}
                      onMarkerClick={setSelectedPoint}
                      fallback={<div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Map key not configured</div>}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">No location data</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export function RouteToOrganization() {
  const job = mustJob("JOB-B-2248");
  return (
    <div>
      <PageHeader
        kicker="Route to organization"
        title="Select provider organization"
        description="Routing creates an internal provider workflow. Customer trust-state remains INTAKE until a named technician is assigned."
        actions={<><StatusBadge status={job.console_status} /><TrustStateChip trustState={job.trust_state} /></>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-3">
          {organizations.map((org) => (
            <Card className={cn(org.status !== "eligible" && "border-destructive/35")} key={org.id}>
              <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{org.display_name}</span><StatusBadge status={org.status} /><StatusBadge status={org.document_status} /></div>
                  <div className="mt-1 text-sm text-muted-foreground">{org.description} · {org.distance_mi ?? "--"} mi · avg response {org.avg_response_min ?? "--"} min</div>
                  {org.blocking_reason ? <div className="mt-2 text-sm text-destructive">{org.blocking_reason}</div> : null}
                </div>
              <div className="flex flex-wrap gap-2">{org.status === "eligible" ? <><Button>Route to Provider</Button><Button variant="secondary"><Route className="size-4" />Route to Team</Button></> : <Badge variant="danger">Actions locked</Badge>}<Button variant="outline">View Profile</Button></div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader><CardTitle>Available teams</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {teams.map((team) => (
              <div className="rounded-md border border-border p-3" key={team.id}>
                <div className="font-medium">{team.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">{team.description}</div>
                <div className="mt-3 flex flex-wrap gap-2"><Badge variant="outline">{team.members_count} members</Badge><Badge variant="warn">Workload {team.workload}</Badge>{team.specialties.map((skill) => <Badge key={skill} variant="outline">{skill}</Badge>)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function OrgJobIntake() {
  const job = mustJob("JOB-B-2248");
  const offer = offers.find((item) => item.job_id === job.id) ?? firstOffer();
  return (
    <div>
      <PageHeader kicker="Organization intake" title="Incoming job request" description="Accepting creates an internal organization milestone. The customer is not MATCHED until a technician is assigned." actions={<><SlaCountdown deadline={offer.expires_at} /><TrustStateChip trustState={job.trust_state} /></>} />
      <div className="grid gap-6 xl:grid-cols-[.85fr_1.15fr]">
        <Card>
          <CardHeader><CardTitle>Request details</CardTitle><CardDescription>{job.address}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3"><StatCard label="Access" value={job.access_type} /><StatCard label="Urgency" value={job.urgency} /><StatCard label="Area" value={job.area} /></div>
            <div className="flex flex-wrap gap-2"><Badge variant="warn">{job.situation}</Badge>{job.safety_flags.map((flag) => <Badge key={flag.code} variant="warn">{flag.label}</Badge>)}</div>
            <div className="flex flex-wrap gap-2"><Button>Accept for Organization</Button><Button variant="secondary">Assign Technician</Button><Button variant="outline">Request Network Overflow</Button><Button variant="destructive">Decline with Reason</Button></div>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <NetworkReleasePanel job={job} />
          <div className="space-y-3">{technicians.filter((tech) => tech.primary_organization_id === orgId).map((tech) => <TechnicianCard key={tech.id} mode="org" technician={tech} />)}</div>
        </div>
      </div>
    </div>
  );
}

function NetworkReleasePanel({ job }: { job: Job }) {
  const [released, setReleased] = useState(false);
  return (
    <Card className={cn(released ? "border-success/40 bg-success/5" : "border-primary/35 bg-primary/5")}>
      <CardHeader>
        <div>
          <CardTitle>Network release preview</CardTitle>
          <CardDescription>Keep customer ownership with the origin organization while requesting verified external capacity.</CardDescription>
        </div>
        <Badge variant={released ? "success" : "warn"}>{released ? "Preview released" : "Private queue"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-3"><div className="text-xs uppercase text-muted-foreground">Origin</div><div className="mt-1 font-medium">{organizationLabel(job.origin_org_id)}</div></div>
          <div className="rounded-md border border-border p-3"><div className="text-xs uppercase text-muted-foreground">Customer owner</div><div className="mt-1 font-medium">{organizationLabel(job.customer_owner_org_id)}</div></div>
          <div className="rounded-md border border-border p-3"><div className="text-xs uppercase text-muted-foreground">Fulfillment</div><div className="mt-1 font-medium">{released ? "Verified network capacity" : "Organization roster"}</div></div>
        </div>
        <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm leading-6 text-info">
          Release changes the fulfillment search only. It does not transfer customer ownership, expose customer PII to anonymous capacity views, or make the customer MATCHED.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setReleased(true)} disabled={released}><RadioTower className="size-4" />Release to Network</Button>
          <Button onClick={() => setReleased(false)} disabled={!released} variant="outline">Withdraw Preview</Button>
          <Button variant="ghost">Review No-Solicit Terms</Button>
        </div>
      </CardContent>
    </Card>
  );
}

const lanes: Array<{ label: string; statuses: ConsoleStatus[] }> = [
  { label: "Awaiting assignment", statuses: ["awaiting_technician_assignment", "new_unrouted", "routed_to_cluexp", "routed_to_organization", "awaiting_org_accept", "stalled"] },
  { label: "Offer sent", statuses: ["offer_sent", "offer_expiring"] },
  { label: "Accepted", statuses: ["accepted"] },
  { label: "En route", statuses: ["en_route"] },
  { label: "Arrived", statuses: ["arrived"] },
  { label: "In service", statuses: ["in_service"] },
  { label: "Approval needed", statuses: ["customer_approval_needed"] },
  { label: "Completed", statuses: ["completed", "cancelled"] },
  { label: "Escalated", statuses: ["escalated"] }
];

export function DispatchBoard({ mode }: { mode: ConsoleMode }) {
  const boardJobs = scopedJobs(mode);
  return (
    <div>
      <PageHeader kicker="Console status board" title="Dispatch Board" description="Columns are console_status lanes. Trust-state appears only as a small per-card chip." />
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1980px] grid-cols-9 gap-3">
          {lanes.map((lane) => {
            const cards = boardJobs.filter((job) => lane.statuses.includes(job.console_status)).sort((a, b) => byPriority(a) - byPriority(b));
            return (
              <Card className="min-h-[520px]" key={lane.label}>
                <CardHeader className="px-3 py-3"><CardTitle className="flex w-full items-center justify-between text-xs"><span>{lane.label}</span><Badge variant="outline">{cards.length}</Badge></CardTitle></CardHeader>
                <CardContent className="space-y-2 p-3">
                  {cards.map((job) => (
                    <div className={cn("rounded-md border border-border bg-secondary/40 p-3", job.console_status === "stalled" && "border-destructive/45 bg-destructive/10")} key={job.id}>
                      <div className="font-medium">{job.id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{job.situation}</div>
                      <div className="mt-3 flex flex-wrap gap-2"><TrustStateChip trustState={job.trust_state} /><Badge variant="outline">{job.age_min}m</Badge>{job.eta_min ? <Badge variant="info">ETA {job.eta_min}m</Badge> : null}</div>
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <div>Origin: {organizationLabel(job.origin_org_id)}</div>
                        <div>Customer owner: {organizationLabel(job.customer_owner_org_id)}</div>
                        <div>Fulfillment: {fulfillmentLabel(job)}</div>
                        <div>{policyLabel(job)}</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MapOperations({ mode }: { mode: ConsoleMode }) {
  const activeJobs = scopedJobs(mode);
  return (
    <div>
      <PageHeader kicker="Anonymous capacity" title="Network capacity map" description="Area-level supply signals support routing decisions without exposing technician identity or exact location before assignment." actions={<><Button><Navigation className="size-4" />Assign from Map</Button><Button variant="secondary">Dispatch</Button></>} />
      <div className="mb-6 grid gap-4 md:grid-cols-3"><StatCard label="Active technicians" value={String(technicians.filter((tech) => tech.is_available).length)} /><StatCard label="Pending jobs" value={String(activeJobs.filter((job) => job.trust_state === "INTAKE").length)} /><StatCard label="Emergency alerts" value={String(activeJobs.filter((job) => job.urgency === "critical").length)} intent="warn" /></div>
      <div className="mb-4"><FilterBar filters={["Auto Team", "Home Team", "Business Access", "Broken Key", "Stale GPS", "Within Service Area"]} /></div>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
        <MapCard jobs={activeJobs} technicians={[]} />
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Masked capacity by area</CardTitle>
              <CardDescription>Aggregated counts and ETA bands only. Names, exact coordinates, phone numbers, and provider identity stay hidden.</CardDescription>
            </div>
            <Badge variant="success"><Lock className="size-3" />PII masked</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {capacityCells.map((cell) => (
              <div className="rounded-md border border-border p-3" key={cell.area}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium"><MapPin className="size-4 text-primary" />{cell.area}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{cell.skill} · ETA band {cell.eta}</div>
                  </div>
                  <Badge variant={cell.pressure === "high" ? "warn" : cell.pressure === "medium" ? "info" : "success"}>{cell.pressure} pressure</Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-md bg-secondary p-2"><div className="text-xs text-muted-foreground">Available</div><div className="mt-1 font-semibold">{cell.available}</div></div>
                  <div className="rounded-md bg-secondary p-2"><div className="text-xs text-muted-foreground">Location</div><div className="mt-1 font-semibold">{cell.freshness}</div></div>
                  <div className="rounded-md bg-secondary p-2"><div className="text-xs text-muted-foreground">Identity</div><div className="mt-1 font-semibold">Masked</div></div>
                </div>
              </div>
            ))}
            <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm leading-6 text-info">
              Exact technician identity becomes available only through an authorized assignment or offer workflow.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type MarkerStatus = "free" | "busy" | "inactive";

type FleetTech = {
  id: string;
  display_name: string | null;
  skills: string[];
  is_available: boolean;
  current_lat: number | null;
  current_lng: number | null;
  location_updated_at: string | null;
  status?: string | null;
  phone?: string | null;
  marker_status?: MarkerStatus | null;
  active_job: {
    id: string;
    status: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    access_type: string | null;
    situation: string | null;
  } | null;
};

// Derive the marker classification from a fleet row. Falls back to the same
// rule the backend uses when `marker_status` is absent (e.g. ops fleet feed).
function fleetMarkerStatus(t: FleetTech): MarkerStatus {
  if (t.marker_status) return t.marker_status;
  if (t.active_job) return "busy";
  if ((t.status == null || t.status === "active") && t.is_available) return "free";
  return "inactive";
}

const MARKER_STATUS_META: Record<MarkerStatus, { label: string; variant: "success" | "danger" | "warn"; dot: string }> = {
  free: { label: "Free", variant: "success", dot: "#22c55e" },
  busy: { label: "Busy", variant: "danger", dot: "#ef4444" },
  inactive: { label: "Inactive", variant: "warn", dot: "#eab308" },
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "no update";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "no update";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function FleetMap({ mode }: { mode: ConsoleMode }) {
  const [fleet, setFleet] = useState<FleetTech[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const apiPrefix = mode === "org" ? "/api/provider" : "/api/ops";

  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch(`${apiPrefix}/fleet`);
      if (!res.ok) throw new Error(`${res.status}`);
      setFleet(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fleet");
    }
  }, [apiPrefix]);

  useEffect(() => {
    fetchFleet();
    const id = window.setInterval(fetchFleet, 45_000);
    return () => window.clearInterval(id);
  }, [fetchFleet]);

  const techPoints: MapPoint[] = (fleet ?? [])
    .filter((t) => t.current_lat != null && t.current_lng != null)
    .map((t): MapPoint => ({ lat: t.current_lat!, lng: t.current_lng!, kind: "tech", label: t.display_name ?? t.id, id: t.id, status: fleetMarkerStatus(t) }));

  const jobPoints: MapPoint[] = (fleet ?? [])
    .filter((t) => t.active_job?.lat != null && t.active_job?.lng != null)
    .map((t): MapPoint => ({ lat: t.active_job!.lat!, lng: t.active_job!.lng!, kind: "job", label: t.active_job?.address ?? t.active_job?.id, id: t.active_job?.id }));

  const pairs: [MapPoint, MapPoint][] = (fleet ?? [])
    .filter((t) => t.current_lat != null && t.current_lng != null && t.active_job?.lat != null && t.active_job?.lng != null)
    .map((t): [MapPoint, MapPoint] => [
      { lat: t.current_lat!, lng: t.current_lng!, kind: "tech", id: t.id },
      { lat: t.active_job!.lat!, lng: t.active_job!.lng!, kind: "job", id: t.active_job!.id },
    ]);

  const allPoints = [...techPoints, ...jobPoints];

  const selectedTech = selected?.kind === "tech" && fleet ? fleet.find((t) => t.id === selected.id) ?? null : null;
  const selectedJob = selected?.kind === "job" && fleet ? fleet.find((t) => t.active_job?.id === selected.id)?.active_job ?? null : null;

  const free = (fleet ?? []).filter((t) => fleetMarkerStatus(t) === "free").length;
  const busy = (fleet ?? []).filter((t) => fleetMarkerStatus(t) === "busy").length;
  const inactive = (fleet ?? []).filter((t) => fleetMarkerStatus(t) === "inactive").length;

  return (
    <div>
      <PageHeader kicker="Live fleet" title={mode === "org" ? "Coverage" : "Fleet Map"} description={mode === "org" ? "Your company's technicians — free (green) and busy (red) by live location, inactive (yellow) by last known. Click a marker for details. Refreshes every 45s." : "All active technicians and their current jobs. Click a marker for details. Refreshes every 45s."} actions={<Button variant="outline" onClick={fetchFleet}>Refresh</Button>} />
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <StatCard label="Technicians" value={fleet ? String(fleet.length) : "—"} />
        <StatCard label="Free" value={fleet ? String(free) : "—"} intent="success" />
        <StatCard label="Busy" value={fleet ? String(busy) : "—"} intent="danger" />
        <StatCard label="Inactive" value={fleet ? String(inactive) : "—"} intent="warn" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: "#22c55e" }} />Free · available</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: "#ef4444" }} />Busy · on a job</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full opacity-70" style={{ background: "#eab308" }} />Inactive · last known</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: "#62a8ff" }} />Job location</span>
      </div>
      {error ? <div className="mb-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="relative h-[560px] bg-[#101720]">
              {fleet === null && !error ? (
                <div className="absolute inset-0 animate-pulse bg-card-strong/50" />
              ) : allPoints.length > 0 ? (
                <GoogleMapView
                  points={allPoints}
                  pairs={pairs}
                  onMarkerClick={setSelected}
                  fallback={<div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Map key not configured</div>}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">No location data</div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selected ? (
            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle>{selected.kind === "tech" ? "Technician" : "Job"} · {selected.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {selectedTech ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={MARKER_STATUS_META[fleetMarkerStatus(selectedTech)].variant}>{MARKER_STATUS_META[fleetMarkerStatus(selectedTech)].label}</Badge>
                    </div>
                    <div className="text-muted-foreground">Location updated: {timeAgo(selectedTech.location_updated_at)}</div>
                    <div className="text-muted-foreground">Skills: {selectedTech.skills.join(", ") || "—"}</div>
                    {selectedTech.active_job ? <div className="text-muted-foreground">Current job: {selectedTech.active_job.status.replaceAll("_", " ")} · {selectedTech.active_job.address ?? selectedTech.active_job.id}</div> : null}
                    {selectedTech.phone ? <div className="text-muted-foreground">Contact: <a className="underline" href={`tel:${selectedTech.phone}`}>{selectedTech.phone}</a></div> : null}
                  </>
                ) : null}
                {selectedJob ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{selectedJob.status}</Badge>
                      <Badge variant="outline">{selectedJob.access_type ?? "—"}</Badge>
                    </div>
                    <div className="text-muted-foreground">{selectedJob.address ?? "—"}</div>
                    <div className="text-muted-foreground">{selectedJob.situation ?? "—"}</div>
                  </>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Dismiss</Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">Click a marker on the map to see details.</CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Technician list</CardTitle></CardHeader>
            <CardContent className="space-y-2 max-h-[420px] overflow-y-auto">
              {fleet === null ? <LoadingSkeleton /> : fleet.length === 0 ? (
                <p className="text-sm text-muted-foreground">No technicians to show.</p>
              ) : fleet.map((t) => {
                const ms = fleetMarkerStatus(t);
                return (
                  <div key={t.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t.display_name ?? t.id}</span>
                      <Badge variant={MARKER_STATUS_META[ms].variant}>{MARKER_STATUS_META[ms].label}</Badge>
                    </div>
                    {t.active_job ? (
                      <div className="mt-1 text-xs text-muted-foreground">{t.active_job.status.replaceAll("_", " ")} · {t.active_job.address ?? "—"}</div>
                    ) : (
                      <div className="mt-1 text-xs text-muted-foreground">Location {timeAgo(t.location_updated_at)}</div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function DispatchPolicySettings({ mode }: { mode: ConsoleMode }) {
  const [dispatchMode, setDispatchMode] = useState<"organization_managed" | "cluexp_managed_routing">(mode === "org" ? "organization_managed" : "cluexp_managed_routing");
  const [policy, setPolicy] = useState<"private" | "network_overflow" | "network_open">(mode === "org" ? "network_overflow" : "network_open");
  const [overflowMinutes, setOverflowMinutes] = useState("12");
  const [saved, setSaved] = useState(false);
  const organization = organizationById(orgId);

  return (
    <div>
      <PageHeader
        kicker="Mock policy concept"
        title="Dispatch Policy"
        description="Configure who manages dispatch and when a private provider queue may request verified network capacity. This preview does not persist changes."
        actions={<Badge variant="outline"><SlidersHorizontal className="size-3" />Draft configuration</Badge>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div><CardTitle>Dispatch control</CardTitle><CardDescription>Choose the operating model without changing origin or customer ownership.</CardDescription></div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <button
                className={cn("rounded-md border p-4 text-left transition-colors", dispatchMode === "organization_managed" ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}
                onClick={() => { setDispatchMode("organization_managed"); setSaved(false); }}
              >
                <Building2 className="size-5 text-primary" />
                <div className="mt-3 font-medium">Organization managed</div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">The provider controls assignment from its private roster and may trigger overflow by policy.</div>
              </button>
              <button
                className={cn("rounded-md border p-4 text-left transition-colors", dispatchMode === "cluexp_managed_routing" ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}
                onClick={() => { setDispatchMode("cluexp_managed_routing"); setSaved(false); }}
              >
                <RadioTower className="size-5 text-primary" />
                <div className="mt-3 font-medium">ClueXP managed routing</div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">The network operator ranks eligible providers and independent technicians using trusted routing.</div>
              </button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div><CardTitle>Fulfillment policy</CardTitle><CardDescription>Private by default with explicit, auditable release behavior.</CardDescription></div>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                ["private", "Private only", "Keep every request inside the organization roster."],
                ["network_overflow", "Network overflow", "Search verified network capacity after a configured threshold or manual release."],
                ["network_open", "Network open", "Allow immediate trusted routing across eligible network supply."]
              ].map(([value, label, description]) => (
                <button
                  className={cn("flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors", policy === value ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}
                  key={value}
                  onClick={() => { setPolicy(value as typeof policy); setSaved(false); }}
                >
                  <CircleDot className={cn("mt-0.5 size-5", policy === value ? "text-primary" : "text-muted-foreground")} />
                  <span><span className="block font-medium">{label}</span><span className="mt-1 block text-sm leading-6 text-muted-foreground">{description}</span></span>
                </button>
              ))}
              {policy === "network_overflow" ? (
                <label className="block space-y-2 text-sm font-medium">
                  Automatic overflow threshold
                  <div className="flex items-center gap-2"><Input className="max-w-28" min="1" onChange={(event) => { setOverflowMinutes(event.target.value); setSaved(false); }} type="number" value={overflowMinutes} /><span className="text-muted-foreground">minutes without an assigned technician</span></div>
                </label>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Policy preview</CardTitle><CardDescription>{organization?.display_name ?? "Current workspace"}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-border p-3"><span className="text-sm text-muted-foreground">Dispatch mode</span><Badge variant="outline">{dispatchMode.replaceAll("_", " ")}</Badge></div>
              <div className="flex items-center justify-between rounded-md border border-border p-3"><span className="text-sm text-muted-foreground">Fulfillment policy</span><Badge variant="outline">{policy.replaceAll("_", " ")}</Badge></div>
              <div className="flex items-center justify-between rounded-md border border-border p-3"><span className="text-sm text-muted-foreground">Customer owner</span><span className="text-sm font-medium">Unchanged</span></div>
              <div className="flex items-center justify-between rounded-md border border-border p-3"><span className="text-sm text-muted-foreground">Network bidding</span><Badge variant="success">Disabled</Badge></div>
              <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm leading-6 text-info">
                Network release changes fulfillment search only. Origin and customer ownership remain attached to the request.
              </div>
              {saved ? <div className="flex items-center gap-2 rounded-md border border-success/35 bg-success/10 p-3 text-sm text-success"><CheckCircle2 className="size-4" />Mock draft saved locally for this screen.</div> : null}
              <Button className="w-full" onClick={() => setSaved(true)}><UserCheck className="size-4" />Save Draft Preview</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function EscalationQueue({ mode }: { mode: ConsoleMode }) {
  const escalated = scopedJobs(mode).filter((job) => job.console_status === "escalated" || job.escalation_reason);
  return (
    <div>
      <PageHeader kicker="Escalations" title="Escalation Queue" description="Factual reasons, ownership, and resolution actions for service requests needing human intervention." />
      <div className="grid gap-6 xl:grid-cols-[1fr_460px]">
        <div className="space-y-3">
          {escalated.map((job) => (
            <Card className="border-destructive/35" key={job.id}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div><div className="font-medium">{job.id}</div><div className="mt-1 text-sm text-muted-foreground">{job.escalation_reason ?? "Manual review required"}</div><div className="mt-2 flex gap-2"><TrustStateChip trustState={job.trust_state} /><StatusBadge status={job.console_status} /></div></div>
                  <div className="flex flex-wrap gap-2"><Button>Take Ownership</Button><Button variant="outline">Contact Customer</Button><Button variant="outline">Contact Technician</Button><Button variant="secondary">Reassign</Button><Button variant="destructive">Mark Resolved</Button></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="space-y-6"><MapCard jobs={escalated} technicians={technicians} /><Card><CardHeader><CardTitle>Escalation audit trail</CardTitle></CardHeader><CardContent><Timeline events={events} /></CardContent></Card></div>
      </div>
    </div>
  );
}

export function DocumentsCompliance({ mode }: { mode: ConsoleMode }) {
  const rows = compliance.map((entry) => [
    entry.entity_name,
    entry.entity_type,
    entry.category,
    <ComplianceStatus entry={entry} key={`${entry.id}-status`} />,
    entry.last_verified,
    <div className="flex items-center gap-1" key={`${entry.id}-actions`}>
      <Button size="sm" variant="outline">View</Button>
      <Button size="sm" variant="outline">Request Update</Button>
      {mode === "cluexp" ? <RowActions items={["Approve", "Reject", "Suspend", "Block / Unblock"]} /> : null}
    </div>
  ]);
  return (
    <div>
      <PageHeader kicker="Documents" title="Compliance Matrix" description="License, insurance, authorization and business documents that control dispatch eligibility." />
      <div className="mb-6 grid gap-4 md:grid-cols-3"><StatCard label="Verified entities" value={String(compliance.filter((entry) => entry.document_status === "verified").length)} /><StatCard label="Action required" value={String(compliance.filter((entry) => entry.blocking).length)} intent="warn" /><StatCard label="Pending review" value={String(compliance.filter((entry) => entry.document_status === "pending_review").length)} /></div>
      <Card><CardHeader><div><CardTitle>All documents</CardTitle><CardDescription>Approve/reject/suspend actions are platform-operator actions.</CardDescription></div></CardHeader><CardContent className="space-y-4"><FilterBar filters={["All", "Organizations", "Technicians", "Expired", "Pending Review", "Blocking"]} /><DataTable columns={["Entity", "Type", "Category", "Status", "Last verified", "Actions"]} rows={rows} /></CardContent></Card>
    </div>
  );
}

export function AuditLog() {
  const rows = events.map((event) => [
    event.actor_display,
    new Date(event.at).toLocaleString(),
    event.event,
    event.trust_state ? <TrustStateChip trustState={event.trust_state} key={`${event.id}-trust`} /> : "No trust change",
    event.reason ?? "n/a",
    <pre className="max-w-md overflow-auto rounded-md bg-background p-2 text-xs text-muted-foreground" key={`${event.id}-json`}>{JSON.stringify(event.metadata ?? {}, null, 2)}</pre>
  ]);
  return (
    <div>
      <PageHeader kicker="Append-only audit" title="Audit Log" description="Trust-state column uses only INTAKE, MATCHED, or FULFILLMENT. Severity and reasons stay separate." actions={<><Button variant="secondary"><FileText className="size-4" />Export</Button><Button><Sparkles className="size-4" />Integrity verified</Button></>} />
      <Card><CardHeader><CardTitle>Event trail</CardTitle></CardHeader><CardContent><DataTable columns={["Actor", "Timestamp", "Event", "Trust state", "Reason", "Metadata"]} rows={rows} /></CardContent></Card>
    </div>
  );
}

export function NotInPrototype({ label }: { label: string }) {
  return <EmptyState title={label} description="This section is represented in navigation; detailed content is outside the current 10-screen pass." />;
}

export { DispatcherOperations } from "./operations";
export * from "./operations-logic";
