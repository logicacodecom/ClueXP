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
import {
  Building2,
  CheckCircle2,
  CircleDot,
  Lock,
  MapPin,
  RadioTower,
  SlidersHorizontal,
  UserCheck
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
  MapCard,
  MessageSquare,
  Navigation,
  PageHeader,
  Phone,
  RequestTable,
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
  UrgencyTag
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

export function LiveQueue({ mode }: { mode: ConsoleMode }) {
  const queue = [...scopedJobs(mode)].sort((a, b) => byPriority(a) - byPriority(b));
  return (
    <div>
      <PageHeader
        kicker={mode === "org" ? "Organization queue" : "Network live queue"}
        title="Live Dispatch Queue"
        description="Sorted by stalled service requests, safety flags, age, and service pressure. Customer trust-state stays separate from console status."
        actions={<><Button asChild><Link href={mode === "org" ? "/intake/new" : "/queue"}>Create Request</Link></Button><Button variant="secondary"><Phone className="size-4" />Call Customer</Button><Button variant="outline"><Phone className="size-4" />Call Technician</Button></>}
      />
      <div className="mb-4"><FilterBar filters={["Source", "Access type", "Situation", "Urgency", "Area", "Team", "Age", "Trust-state", "Escalation reason"]} /></div>
      <RequestTable jobs={queue} />
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queue depth" value={String(queue.length)} />
        <StatCard label="Average response" value="8m" />
        <StatCard label="Active technicians" value={String(technicians.filter((tech) => tech.is_available).length)} />
        <StatCard label="Critical alerts" value={String(queue.filter((job) => job.urgency === "critical").length)} intent="warn" />
      </div>
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

export function ProviderNewRequest() {
  const org = organizationById(orgId);
  const [form, setForm] = useState({
    customer_name: "Taylor Morgan",
    customer_phone: "(555) 014-0199",
    address: "210 Pine St, North Hills",
    source_channel: "Phone intake",
    access_type: "home",
    situation: "locked_out",
    urgency: "urgent",
    notes: "Customer called from lobby. Has ID available. No safety concern reported."
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function createRequest() {
    setBusy(true);
    setError(null);
    setCreatedId(null);
    try {
      const token = window.localStorage.getItem("cluexp_access_token");
      if (!token) throw new Error("Sign in before creating provider requests.");
      const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "";
      const response = await fetch(`${apiBase}/api/provider/requests`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(form)
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

  return (
    <div>
      <PageHeader
        kicker="Manual intake"
        title="New Service Request"
        description="Call-center entry for provider-owned requests. The backend creates the job with trusted org/session context, not a browser-supplied org id."
        actions={<><Badge variant="outline">Origin: {org?.display_name ?? "Provider"}</Badge><Badge variant="outline">Customer owner: {org?.display_name ?? "Provider"}</Badge></>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Request details</CardTitle>
              <CardDescription>Designed for phone and dispatcher-entered requests. Submit stores the customer under the authenticated provider tenant.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium">Customer name<Input placeholder="Customer display name" value={form.customer_name} onChange={(event) => update("customer_name", event.target.value)} /></label>
              <label className="space-y-2 text-sm font-medium">Customer phone<Input placeholder="Verified phone" value={form.customer_phone} onChange={(event) => update("customer_phone", event.target.value)} /></label>
              <label className="space-y-2 text-sm font-medium">Service address<Input placeholder="Address or landmark" value={form.address} onChange={(event) => update("address", event.target.value)} /></label>
              <label className="space-y-2 text-sm font-medium">Source channel<Input placeholder="Phone, website, QR, referral" value={form.source_channel} onChange={(event) => update("source_channel", event.target.value)} /></label>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-sm font-medium">Access type<Input value={form.access_type} onChange={(event) => update("access_type", event.target.value)} /></label>
              <label className="space-y-2 text-sm font-medium">Situation<Input value={form.situation} onChange={(event) => update("situation", event.target.value)} /></label>
              <label className="space-y-2 text-sm font-medium">Urgency<Input value={form.urgency} onChange={(event) => update("urgency", event.target.value)} /></label>
            </div>
            <label className="space-y-2 text-sm font-medium">
              Dispatcher notes
              <textarea className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" value={form.notes} onChange={(event) => update("notes", event.target.value)} />
            </label>
            {createdId ? <div className="rounded-md border border-success/35 bg-success/10 p-3 text-sm text-success">Created request {createdId}</div> : null}
            {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={createRequest}>{busy ? "Creating..." : "Create Request"}</Button>
              <Button variant="secondary">Save Draft</Button>
              <Button asChild variant="outline"><Link href="/queue">Back to Queue</Link></Button>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Tenant policy preview</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">dispatch_mode: organization_managed</Badge>
                <Badge variant="outline">fulfillment_policy: private</Badge>
                <Badge variant="success">no-solicit required</Badge>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                On submit, the authenticated provider session sets origin and customer owner.
                The browser only sends form content and source context.
              </p>
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

export function TechnicianAssignment({ mode }: { mode: ConsoleMode }) {
  const job = primaryJob(mode);
  const offer = offers.find((item) => item.job_id === job.id) ?? firstOffer();
  const candidates = mode === "org" ? technicians.filter((tech) => tech.primary_organization_id === orgId) : technicians;
  const rankedCandidates = [...candidates].sort((a, b) => rankedScore(b.id).score - rankedScore(a.id).score);
  return (
    <div>
      <PageHeader
        kicker="Ranked match preview"
        title="Choose verified access technician"
        description="Mock ranking explains distance, skill, availability, verification, and workload. It does not dispatch or override backend eligibility."
        actions={<><StatusBadge status={job.console_status} /><TrustStateChip trustState={job.trust_state} /><SlaCountdown deadline={offer.expires_at} /></>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-3">
          {rankedCandidates.map((tech, index) => {
            const match = rankedScore(tech.id);
            return (
              <div className="relative" key={tech.id}>
                <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
                  <Badge variant={index === 0 ? "success" : "outline"}>Rank {index + 1}</Badge>
                  <Badge variant={match.score >= 85 ? "success" : match.score >= 70 ? "info" : "warn"}>{match.score}% match</Badge>
                </div>
                <div className="pt-11">
                  <TechnicianCard mode={mode} technician={tech} />
                </div>
                <div className="mx-4 -mt-3 mb-4 rounded-md border border-border bg-background p-3">
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Why this rank</div>
                  <div className="flex flex-wrap gap-2">
                    {match.reasons.map((reason) => <Badge key={reason} variant="outline">{reason}</Badge>)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Job context</CardTitle><CardDescription>{job.address}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2"><Badge variant="outline">{job.access_type}</Badge><Badge variant="warn">{job.situation}</Badge><Badge variant="outline">{job.area}</Badge><StatusBadge status={offer.status} /></div>
              <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">Backend enforces first-accept-wins. If another technician accepts first, this screen must show the superseded offer state from the API.</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Ranking inputs</CardTitle>
                <CardDescription>Transparent mock weights for operator review. No auction or bidding.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                ["Distance and ETA", "35%"],
                ["Skill fit", "30%"],
                ["Availability and workload", "20%"],
                ["Verification and reliability", "15%"]
              ].map(([label, weight]) => (
                <div className="flex items-center justify-between rounded-md border border-border p-3" key={label}>
                  <span className="text-sm font-medium">{label}</span>
                  <Badge variant="outline">{weight}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <TrustSafety flags={job.safety_flags} status={job.trust_state} />
          <MapCard jobs={[job]} technicians={candidates} />
        </div>
      </div>
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
