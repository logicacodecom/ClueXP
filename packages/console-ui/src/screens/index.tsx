"use client";

import {
  compliance,
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
import { AlertTriangle, FileText, MessageSquare, Navigation, Phone, Route, ShieldCheck } from "lucide-react";
import {
  AccessIcon,
  Button,
  ComplianceStatus,
  Countdown,
  DataTable,
  FilterBar,
  MapPanel,
  Metric,
  OfferStatusChip,
  OrganizationRow,
  Panel,
  QueueRow,
  SafetyFlagBadge,
  ScreenHeader,
  StatusChip,
  TechnicianRow,
  Timeline,
  TrustStateChip,
  TruckIcon,
  XIcon
} from "../components";

const orgId = "org-metro";

function mustJob(id: string): Job {
  const job = jobs.find((item) => item.id === id);
  if (!job) {
    throw new Error(`Missing mock job: ${id}`);
  }
  return job;
}

function firstOffer() {
  const offer = offers[0];
  if (!offer) {
    throw new Error("Missing mock offer");
  }
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

export function LiveQueue({ mode }: { mode: ConsoleMode }) {
  const queue = [...scopedJobs(mode)].sort((a, b) => byPriority(a) - byPriority(b));
  return (
    <div className="cx-screen">
      <ScreenHeader
        kicker={mode === "org" ? "Organization queue" : "ClueXP live queue"}
        title="Live Dispatch Queue"
        subtitle="Sorted by stalled jobs, safety flags, age, and service pressure. Customer trust-state remains separate from console status."
        actions={<><Button tone="primary">Create Job</Button><Button tone="secondary"><Phone size={14} aria-hidden />Call Customer</Button><Button><Phone size={14} aria-hidden />Call Technician</Button></>}
      />
      <Panel title="Filter facets">
        <FilterBar filters={["Source", "Access type", "Situation", "Urgency", "Area", "Team", "Age", "Trust-state", "Escalation reason"]} />
      </Panel>
      <Panel title="Active queue">
        <div className="cx-queue-list">{queue.map((job) => <QueueRow job={job} key={job.id} />)}</div>
      </Panel>
      <div className="cx-grid-3">
        <Metric label="Queue depth" value={String(queue.length)} />
        <Metric label="Average response" value="8m" />
        <Metric label="Active technicians" value={String(technicians.filter((tech) => tech.is_available).length)} />
        <Metric label="Critical alerts" value={String(queue.filter((job) => job.urgency === "critical").length)} />
      </div>
    </div>
  );
}

export function JobDetail({ mode }: { mode: ConsoleMode }) {
  const job = mode === "org" ? mustJob("JOB-B-2248") : mustJob("JOB-A-2201");
  const tech = technicianById(job.technician_id);
  const org = organizationById(job.provider_organization_id);
  const jobEvents = eventsForJob(job.id);
  return (
    <div className="cx-screen">
      <ScreenHeader
        kicker="Job workspace"
        title={`${job.id} · ${job.situation}`}
        subtitle="Console status is an operator view. Trust-state is customer visibility and changes only when the backend assigns a named technician."
        actions={<><StatusChip status={job.console_status} /><TrustStateChip trustState={job.trust_state} /></>}
      />
      <div className="cx-split">
        <div className="cx-stack">
          <Panel title="Customer and access context">
            <div className="cx-toolbar">
              <span className="cx-chip muted"><AccessIcon accessType={job.access_type} />{job.access_type} access</span>
              <span className="cx-chip muted">{job.situation}</span>
              <span className="cx-chip muted">{job.area}</span>
              <span className="cx-chip muted">{job.price_quote ?? "Quote pending"}</span>
            </div>
            <div className="cx-grid-3" style={{ marginTop: 12 }}>
              <Metric label="Customer safe-name" value={job.customer_display} />
              <Metric label="Job age" value={`${job.age_min}m`} />
              <Metric label="SLA target" value={`${job.sla_min ?? "--"}m`} />
            </div>
            <div className="cx-toolbar" style={{ marginTop: 12 }}>
              {job.safety_flags.length > 0 ? job.safety_flags.map((flag) => <SafetyFlagBadge flag={flag} key={flag.code} />) : <span className="cx-chip success">No safety flags</span>}
            </div>
          </Panel>
          <Panel title="Dispatch assignment">
            <DataTable
              columns={["Owner", "Organization", "Technician", "ETA", "Routing source"]}
              rows={[
                [
                  job.dispatch_owner,
                  org?.display_name ?? "ClueXP individual network",
                  tech?.display_name ?? "No named technician yet",
                  job.eta_min ? `${job.eta_min} min` : "Pending",
                  job.routing_source
                ]
              ]}
            />
          </Panel>
          <Panel title="Event timeline">
            <Timeline events={jobEvents.length > 0 ? jobEvents : events.slice(-3)} />
          </Panel>
        </div>
        <div className="cx-stack">
          <Panel title="Actions">
            <div className="cx-actions">
              <a className="cx-button primary" href={`/jobs/${job.id}/assign`}>Assign</a>
              {mode === "cluexp" ? <a className="cx-button secondary" href={`/jobs/${job.id}/route`}>Route</a> : <Button tone="secondary">Ask ClueXP</Button>}
              <Button>Reassign</Button>
              <Button tone="danger"><XIcon />Cancel</Button>
              <Button tone="danger"><AlertTriangle size={14} aria-hidden />Escalate</Button>
              <Button><MessageSquare size={14} aria-hidden />Message / Call</Button>
              <Button>Add Internal Note</Button>
            </div>
          </Panel>
          <Panel title="Internal notes" className="cx-internal-notes">
            <div className="cx-note">Internal note: organization acceptance is not customer MATCHED. Wait for a named technician before changing the customer-visible state.</div>
          </Panel>
          <Panel title="Customer / technician messages">
            <div className="cx-stack">
              <div className="cx-meta">Customer: Can wait inside lobby. Needs arrival call.</div>
              <div className="cx-meta">Technician channel: no assigned technician yet.</div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function TechnicianAssignment({ mode }: { mode: ConsoleMode }) {
  const job = mode === "org" ? mustJob("JOB-B-2248") : mustJob("JOB-A-2201");
  const offer = offers.find((item) => item.job_id === job.id) ?? firstOffer();
  const candidates = mode === "org" ? technicians.filter((tech) => tech.primary_organization_id === orgId) : technicians;
  return (
    <div className="cx-screen">
      <ScreenHeader
        kicker="Technician assignment"
        title="Choose verified access technician"
        subtitle="Offer countdowns use backend expires_at. First accept wins is backend-enforced; the UI only reflects the result."
        actions={<><StatusChip status={job.console_status} /><TrustStateChip trustState={job.trust_state} /></>}
      />
      <div className="cx-grid-2">
        <Panel title="Candidate technicians">
          <div className="cx-stack">{candidates.map((tech) => <TechnicianRow key={tech.id} mode={mode} technician={tech} />)}</div>
        </Panel>
        <div className="cx-stack">
          <Panel title="Job context">
            <div className="cx-toolbar">
              <span className="cx-chip muted"><AccessIcon accessType={job.access_type} />{job.access_type}</span>
              <span className="cx-chip alert">{job.situation}</span>
              <span className="cx-chip muted">{job.area}</span>
              <OfferStatusChip status={offer.status} />
              <Countdown expiresAt={offer.expires_at} />
            </div>
            <div className="cx-note" style={{ marginTop: 12 }}>Backend enforces first-accept-wins. If another technician accepts first, this screen must show the superseded offer state from the API.</div>
          </Panel>
          <Panel title="Static route preview">
            <MapPanel jobs={[job]} technicians={candidates} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function RouteToOrganization() {
  const job = mustJob("JOB-B-2248");
  return (
    <div className="cx-screen">
      <ScreenHeader
        kicker="Route to organization"
        title="Select provider organization"
        subtitle="Routing creates an internal provider workflow. Customer trust-state remains INTAKE until a named technician is assigned."
        actions={<><StatusChip status={job.console_status} /><TrustStateChip trustState={job.trust_state} /></>}
      />
      <div className="cx-grid-2">
        <Panel title="Eligible organizations and blockers">
          <div className="cx-stack">{organizations.map((organization) => <OrganizationRow organization={organization} key={organization.id} />)}</div>
        </Panel>
        <Panel title="Available teams">
          <div className="cx-stack">
            {teams.map((team) => (
              <div className="cx-card" key={team.id}>
                <div className="cx-card-title">{team.name}</div>
                <div className="cx-meta">{team.description}</div>
                <div className="cx-toolbar">
                  <span className="cx-chip muted">{team.members_count} members</span>
                  <span className="cx-chip alert">Workload {team.workload}</span>
                  {team.specialties.map((skill) => <span className="cx-chip muted" key={skill}>{skill}</span>)}
                </div>
                <Button tone="secondary"><Route size={14} aria-hidden />Route to Team</Button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function OrgJobIntake() {
  const job = mustJob("JOB-B-2248");
  const offer = offers.find((item) => item.job_id === job.id) ?? firstOffer();
  return (
    <div className="cx-screen">
      <ScreenHeader
        kicker="Organization intake"
        title="Incoming job request"
        subtitle="Accepting creates an internal organization milestone. The customer is not MATCHED until a technician is assigned."
        actions={<><Countdown expiresAt={offer.expires_at} /><TrustStateChip trustState={job.trust_state} /></>}
      />
      <div className="cx-grid-2">
        <Panel title="Request details">
          <div className="cx-grid-3">
            <Metric label="Access" value={job.access_type} />
            <Metric label="Urgency" value={job.urgency} />
            <Metric label="Area" value={job.area} />
          </div>
          <div className="cx-toolbar" style={{ marginTop: 12 }}>
            <span className="cx-chip alert">{job.situation}</span>
            {job.safety_flags.map((flag) => <SafetyFlagBadge flag={flag} key={flag.code} />)}
          </div>
          <div className="cx-actions" style={{ marginTop: 14 }}>
            <Button tone="primary">Accept for Organization</Button>
            <Button tone="secondary">Assign Technician</Button>
            <Button>Ask ClueXP</Button>
            <Button tone="danger">Decline with Reason</Button>
          </div>
        </Panel>
        <Panel title="Available organization technicians">
          <div className="cx-stack">{technicians.filter((tech) => tech.primary_organization_id === orgId).map((tech) => <TechnicianRow key={tech.id} mode="org" technician={tech} />)}</div>
        </Panel>
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
    <div className="cx-screen">
      <ScreenHeader
        kicker="Console status board"
        title="Dispatch Board"
        subtitle="Columns are console_status lanes. Trust-state appears only as a small per-card chip."
      />
      <div className="cx-board">
        {lanes.map((lane) => {
          const cards = boardJobs.filter((job) => lane.statuses.includes(job.console_status)).sort((a, b) => byPriority(a) - byPriority(b));
          return (
            <section className="cx-lane" key={lane.label}>
              <div className="cx-lane-title"><span>{lane.label}</span><span>{cards.length}</span></div>
              {cards.map((job) => (
                <article className={`cx-card ${job.console_status === "stalled" ? "is-stalled" : ""}`} key={job.id}>
                  <div className="cx-card-title">{job.id}</div>
                  <div className="cx-meta">{job.situation}</div>
                  <div className="cx-toolbar">
                    <TrustStateChip trustState={job.trust_state} />
                    <span className="cx-chip muted">{job.age_min}m</span>
                    {job.eta_min ? <span className="cx-chip route">ETA {job.eta_min}m</span> : null}
                  </div>
                  <div className="cx-meta">{technicianById(job.technician_id)?.display_name ?? organizationById(job.provider_organization_id)?.display_name ?? "Unassigned"}</div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function MapOperations({ mode }: { mode: ConsoleMode }) {
  const activeJobs = scopedJobs(mode);
  return (
    <div className="cx-screen">
      <ScreenHeader
        kicker="Map operations"
        title="Jobs and technicians"
        subtitle="Static operational map: job markers, technician markers, service area, route/ETA and location staleness."
        actions={<><Button tone="primary"><Navigation size={14} aria-hidden />Assign from Map</Button><Button tone="secondary"><TruckIcon />Dispatch</Button></>}
      />
      <div className="cx-grid-2">
        <Panel title="Filters and counts">
          <div className="cx-grid-3">
            <Metric label="Active technicians" value={String(technicians.filter((tech) => tech.is_available).length)} />
            <Metric label="Pending jobs" value={String(activeJobs.filter((job) => job.trust_state === "INTAKE").length)} />
            <Metric label="Emergency alerts" value={String(activeJobs.filter((job) => job.urgency === "critical").length)} />
          </div>
          <FilterBar filters={["Auto Team", "Home Team", "Business Access", "Broken Key", "Stale GPS", "Within Service Area"]} />
        </Panel>
        <Panel title="Map legend and route data">
          <div className="cx-stack">
            <span className="cx-chip alert">Amber markers: Jobs</span>
            <span className="cx-chip route">Blue markers: Technicians</span>
            <span className="cx-chip muted">Route ETA: 7-18 min</span>
            <span className="cx-chip danger">Location stale: Morgan Vale 18 min</span>
          </div>
        </Panel>
      </div>
      <MapPanel jobs={activeJobs} technicians={technicians} />
    </div>
  );
}

export function EscalationQueue({ mode }: { mode: ConsoleMode }) {
  const escalated = scopedJobs(mode).filter((job) => job.console_status === "escalated" || job.escalation_reason);
  return (
    <div className="cx-screen">
      <ScreenHeader kicker="Escalations" title="Escalation Queue" subtitle="Factual reasons, ownership, and resolution actions for jobs needing human intervention." />
      <div className="cx-grid-2">
        <Panel title="Open escalations">
          <div className="cx-stack">
            {escalated.map((job) => (
              <article className="cx-card is-stalled" key={job.id}>
                <div className="cx-card-title">{job.id}</div>
                <div className="cx-meta">{job.escalation_reason ?? "Manual review required"}</div>
                <div className="cx-toolbar"><TrustStateChip trustState={job.trust_state} /><StatusChip status={job.console_status} /></div>
                <div className="cx-actions"><Button tone="primary">Take Ownership</Button><Button>Contact Customer</Button><Button>Contact Technician</Button><Button tone="secondary">Reassign</Button><Button tone="danger">Mark Resolved</Button></div>
              </article>
            ))}
          </div>
        </Panel>
        <Panel title="Escalation map and audit">
          <div className="cx-stack">
            <MapPanel jobs={escalated} technicians={technicians} />
            <div>
              <div className="cx-kicker" style={{ marginBottom: 8 }}>Escalation audit trail</div>
              <Timeline events={events} />
            </div>
          </div>
        </Panel>
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
    <div className="cx-actions" key={`${entry.id}-actions`}>
      <Button>View</Button>
      <Button>Request Update</Button>
      {mode === "cluexp" ? <><Button tone="primary">Approve</Button><Button tone="danger">Reject</Button></> : null}
      {mode === "cluexp" ? <Button tone="danger">Suspend</Button> : null}
    </div>
  ]);
  return (
    <div className="cx-screen">
      <ScreenHeader kicker="Documents" title="Compliance Matrix" subtitle="License, insurance, authorization and business documents that control dispatch eligibility." />
      <div className="cx-grid-3">
        <Metric label="Verified entities" value={String(compliance.filter((entry) => entry.document_status === "verified").length)} />
        <Metric label="Action required" value={String(compliance.filter((entry) => entry.blocking).length)} />
        <Metric label="Pending review" value={String(compliance.filter((entry) => entry.document_status === "pending_review").length)} />
      </div>
      <Panel title="All documents">
        <FilterBar filters={["All", "Organizations", "Technicians", "Expired", "Pending Review", "Blocking"]} />
        <DataTable columns={["Entity", "Type", "Category", "Status", "Last verified", "Actions"]} rows={rows} />
      </Panel>
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
    <pre className="cx-json" key={`${event.id}-json`}>{JSON.stringify(event.metadata ?? {}, null, 2)}</pre>
  ]);
  return (
    <div className="cx-screen">
      <ScreenHeader
        kicker="Append-only audit"
        title="Audit Log"
        subtitle="Trust-state column uses only INTAKE, MATCHED, or FULFILLMENT. Severity and reasons stay separate."
        actions={<><Button tone="secondary"><FileText size={14} aria-hidden />Export</Button><Button tone="primary"><ShieldCheck size={14} aria-hidden />Integrity verified</Button></>}
      />
      <Panel title="Event trail">
        <DataTable columns={["Actor", "Timestamp", "Event", "Trust state", "Reason", "Metadata"]} rows={rows} />
      </Panel>
    </div>
  );
}

export function NotInPrototype({ label }: { label: string }) {
  return (
    <div className="cx-placeholder">
      <div>
        <div className="cx-kicker">Prototype route</div>
        <h1>{label}</h1>
        <p className="cx-meta">This section is represented in navigation; detailed content is outside the current 10-screen pass.</p>
      </div>
    </div>
  );
}
