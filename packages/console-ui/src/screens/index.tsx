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
import Link from "next/link";
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
  return mode === "org" ? jobs.filter((job) => job.provider_organization_id === orgId || job.dispatch_owner === "organization") : jobs;
}

function byPriority(job: Job): number {
  if (job.console_status === "stalled" || job.urgency === "critical") return 0;
  if (job.console_status === "offer_expiring" || job.safety_flags.length > 0) return 1;
  return job.age_min;
}

function primaryJob(mode: ConsoleMode): Job {
  return mode === "org" ? mustJob("JOB-B-2248") : mustJob("JOB-A-2201");
}

export function Dashboard({ mode }: { mode: ConsoleMode }) {
  const queue = [...scopedJobs(mode)].sort((a, b) => byPriority(a) - byPriority(b));
  const atRisk = queue.filter((job) => job.urgency === "critical" || job.console_status === "stalled" || job.console_status === "escalated");
  return (
    <div>
      <PageHeader
        kicker={mode === "org" ? "Provider command center" : "Operations command center"}
        title="Dispatch Dashboard"
        description="Live emergency-access operations, SLA exposure, technician availability, and recent trust-state activity."
        actions={<><Button>Create request</Button><Button variant="outline">Export shift report</Button></>}
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
        kicker={mode === "org" ? "Organization queue" : "ClueXP live queue"}
        title="Live Dispatch Queue"
        description="Sorted by stalled requests, safety flags, age, and service pressure. Customer trust-state stays separate from console status."
        actions={<><Button>Create Job</Button><Button variant="secondary"><Phone className="size-4" />Call Customer</Button><Button variant="outline"><Phone className="size-4" />Call Technician</Button></>}
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

export function JobDetail({ mode }: { mode: ConsoleMode }) {
  const job = primaryJob(mode);
  const tech = technicianById(job.technician_id);
  const org = organizationById(job.provider_organization_id);
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
            <CardHeader><CardTitle>Dispatch assignment</CardTitle></CardHeader>
            <CardContent>
              <DataTable columns={["Owner", "Organization", "Technician", "ETA", "Routing source"]} rows={[[job.dispatch_owner, org?.display_name ?? "ClueXP individual network", tech?.display_name ?? "No named technician yet", job.eta_min ? `${job.eta_min} min` : "Pending", job.routing_source]]} />
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
              {mode === "cluexp" ? <Button asChild variant="secondary"><Link href={`/jobs/${job.id}/route`}>Route</Link></Button> : <Button variant="secondary">Ask ClueXP</Button>}
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
  return (
    <div>
      <PageHeader
        kicker="Technician assignment"
        title="Choose verified access technician"
        description="Offer countdowns use backend expires_at. First accept wins is backend-enforced; the UI only reflects the result."
        actions={<><StatusBadge status={job.console_status} /><TrustStateChip trustState={job.trust_state} /><SlaCountdown deadline={offer.expires_at} /></>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-3">{candidates.map((tech) => <TechnicianCard key={tech.id} mode={mode} technician={tech} />)}</div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Job context</CardTitle><CardDescription>{job.address}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2"><Badge variant="outline">{job.access_type}</Badge><Badge variant="warn">{job.situation}</Badge><Badge variant="outline">{job.area}</Badge><StatusBadge status={offer.status} /></div>
              <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">Backend enforces first-accept-wins. If another technician accepts first, this screen must show the superseded offer state from the API.</div>
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
                <div className="flex flex-wrap gap-2">{org.status === "eligible" ? <><Button>Route to Organization</Button><Button variant="secondary"><Route className="size-4" />Route to Team</Button></> : <Badge variant="danger">Actions locked</Badge>}<Button variant="outline">View Profile</Button></div>
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
            <div className="flex flex-wrap gap-2"><Button>Accept for Organization</Button><Button variant="secondary">Assign Technician</Button><Button variant="outline">Ask ClueXP</Button><Button variant="destructive">Decline with Reason</Button></div>
          </CardContent>
        </Card>
        <div className="space-y-3">{technicians.filter((tech) => tech.primary_organization_id === orgId).map((tech) => <TechnicianCard key={tech.id} mode="org" technician={tech} />)}</div>
      </div>
    </div>
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
                      <div className="mt-2 text-xs text-muted-foreground">{technicianById(job.technician_id)?.display_name ?? organizationById(job.provider_organization_id)?.display_name ?? "Unassigned"}</div>
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
      <PageHeader kicker="Map operations" title="Jobs and technicians" description="Static operational map: job markers, technician markers, service area, route/ETA and location staleness." actions={<><Button><Navigation className="size-4" />Assign from Map</Button><Button variant="secondary">Dispatch</Button></>} />
      <div className="mb-6 grid gap-4 md:grid-cols-3"><StatCard label="Active technicians" value={String(technicians.filter((tech) => tech.is_available).length)} /><StatCard label="Pending jobs" value={String(activeJobs.filter((job) => job.trust_state === "INTAKE").length)} /><StatCard label="Emergency alerts" value={String(activeJobs.filter((job) => job.urgency === "critical").length)} intent="warn" /></div>
      <div className="mb-4"><FilterBar filters={["Auto Team", "Home Team", "Business Access", "Broken Key", "Stale GPS", "Within Service Area"]} /></div>
      <MapCard jobs={activeJobs} technicians={technicians} />
    </div>
  );
}

export function EscalationQueue({ mode }: { mode: ConsoleMode }) {
  const escalated = scopedJobs(mode).filter((job) => job.console_status === "escalated" || job.escalation_reason);
  return (
    <div>
      <PageHeader kicker="Escalations" title="Escalation Queue" description="Factual reasons, ownership, and resolution actions for jobs needing human intervention." />
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
      <Card><CardHeader><div><CardTitle>All documents</CardTitle><CardDescription>Approve/reject/suspend actions are ClueXP-only.</CardDescription></div></CardHeader><CardContent className="space-y-4"><FilterBar filters={["All", "Organizations", "Technicians", "Expired", "Pending Review", "Blocking"]} /><DataTable columns={["Entity", "Type", "Category", "Status", "Last verified", "Actions"]} rows={rows} /></CardContent></Card>
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
