"use client";

import type {
  ComplianceEntry,
  ConsoleMode,
  ConsoleStatus,
  Job,
  OfferStatus,
  Organization,
  OrganizationEligibility,
  SafetyFlag as SafetyFlagType,
  Technician,
  TechnicianEligibility,
  TrustState,
  Urgency
} from "@cluexp/api-client";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Gauge,
  HelpCircle,
  History,
  Home,
  KeyRound,
  LayoutDashboard,
  Map,
  MessageSquare,
  Navigation,
  Phone,
  Route,
  Search,
  Settings,
  ShieldAlert,
  Truck,
  UserRound,
  Users,
  XCircle
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type StatusLike = ConsoleStatus | TechnicianEligibility | OrganizationEligibility | OfferStatus;

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const defaultNav: NavItem[] = [
  { href: "/queue", label: "Live Queue", icon: Gauge },
  { href: "/board", label: "Dispatch Board", icon: LayoutDashboard },
  { href: "/map", label: "Map", icon: Map },
  { href: "/jobs/JOB-A-2201/assign", label: "Technicians", icon: Users },
  { href: "/teams", label: "Teams", icon: Briefcase },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/reports", label: "Reports", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/audit", label: "Audit Log", icon: History }
];

const statusLabels: Record<StatusLike, string> = {
  new_unrouted: "New unrouted",
  routed_to_cluexp: "Routed to ClueXP",
  routed_to_organization: "Routed to org",
  awaiting_org_accept: "Awaiting org accept",
  awaiting_technician_assignment: "Awaiting assignment",
  offer_sent: "Offer sent",
  offer_expiring: "Offer expiring",
  accepted: "Accepted",
  en_route: "En route",
  arrived: "Arrived",
  in_service: "In service",
  customer_approval_needed: "Approval needed",
  completed: "Completed",
  cancelled: "Cancelled",
  escalated: "Escalated",
  stalled: "Stalled",
  eligible: "Eligible",
  offline: "Offline",
  busy: "Busy",
  outside_service_area: "Outside area",
  missing_skill: "Missing skill",
  blocked_by_documents: "Blocked by documents",
  stale_location: "Stale location",
  suspended: "Suspended",
  manual_override_required: "Manual override",
  inactive: "Inactive",
  capacity_full: "Capacity full",
  dispatch_unavailable: "Dispatch unavailable",
  subscription_blocked: "Subscription blocked",
  pending: "Pending",
  sent: "Sent",
  seen: "Seen",
  declined: "Declined",
  expired: "Expired",
  superseded: "Superseded",
  failed_delivery: "Failed delivery"
};

function statusTone(status: StatusLike): string {
  if (
    status === "accepted" ||
    status === "arrived" ||
    status === "in_service" ||
    status === "completed" ||
    status === "eligible" ||
    status === "seen"
  ) {
    return "success";
  }
  if (status === "en_route" || status === "routed_to_organization" || status === "routed_to_cluexp") {
    return "route";
  }
  if (status === "offer_sent" || status === "offer_expiring" || status === "customer_approval_needed" || status === "pending" || status === "sent") {
    return "alert";
  }
  if (
    status === "blocked_by_documents" ||
    status === "stale_location" ||
    status === "suspended" ||
    status === "expired" ||
    status === "failed_delivery" ||
    status === "cancelled" ||
    status === "escalated" ||
    status === "stalled"
  ) {
    return "danger";
  }
  return "muted";
}

function StatusIcon({ tone }: { tone: string }) {
  if (tone === "success") return <CheckCircle2 size={14} aria-hidden />;
  if (tone === "route") return <Navigation size={14} aria-hidden />;
  if (tone === "danger") return <ShieldAlert size={14} aria-hidden />;
  if (tone === "alert") return <Clock size={14} aria-hidden />;
  return <Bell size={14} aria-hidden />;
}

export function StatusChip({ status }: { status: StatusLike }) {
  const tone = statusTone(status);
  return (
    <span className={`cx-chip ${tone}`}>
      <StatusIcon tone={tone} />
      {statusLabels[status]}
    </span>
  );
}

export function OfferStatusChip({ status }: { status: OfferStatus }) {
  return <StatusChip status={status} />;
}

export function TrustStateChip({ trustState }: { trustState: TrustState }) {
  return <span className="cx-chip trust">Trust: {trustState}</span>;
}

export function UrgencyTag({ urgency }: { urgency: Urgency }) {
  const tone = urgency === "critical" ? "critical" : urgency === "high" ? "alert" : "muted";
  return <span className={`cx-chip ${tone}`}>{urgency} urgency</span>;
}

export function SafetyFlagBadge({ flag }: { flag: SafetyFlagType }) {
  const tone = flag.severity === "critical" ? "critical" : flag.severity === "warning" ? "alert" : "muted";
  return (
    <span className={`cx-chip ${tone}`}>
      <AlertTriangle size={14} aria-hidden />
      {flag.label}
    </span>
  );
}

export function Shell({
  activePath,
  children,
  mode,
  modeBadge,
  nav = defaultNav,
  surfaceLabel
}: {
  activePath?: string;
  children: ReactNode;
  mode: ConsoleMode;
  modeBadge: string;
  nav?: NavItem[];
  surfaceLabel: string;
}) {
  return (
    <div className={`cx-shell cx-shell-${mode}`}>
      <TopBar modeBadge={modeBadge} surfaceLabel={surfaceLabel} />
      <div className="cx-frame">
        <LeftNav activePath={activePath} nav={nav} />
        <main className="cx-content">{children}</main>
      </div>
    </div>
  );
}

export function TopBar({ modeBadge, surfaceLabel }: { modeBadge: string; surfaceLabel: string }) {
  return (
    <header className="cx-topbar">
      <div className="cx-brand">
        <div className="cx-brand-mark" aria-hidden>
          C
        </div>
        <div>
          <div className="cx-wordmark">CLUEXP</div>
          <div className="cx-subtitle">{surfaceLabel}</div>
        </div>
      </div>
      <label>
        <span className="sr-only">Search jobs, technicians, organizations</span>
        <div style={{ position: "relative" }}>
          <Search size={16} aria-hidden style={{ position: "absolute", left: 12, top: 14, color: "var(--muted)" }} />
          <input className="cx-search" style={{ paddingLeft: 36 }} placeholder="Search job, customer safe-name, technician, area" />
        </div>
      </label>
      <div className="cx-toolbar">
        <span className="cx-mode-badge">{modeBadge}</span>
        <button className="cx-button ghost" type="button" aria-label="Help">
          <HelpCircle size={16} aria-hidden />
        </button>
        <button className="cx-button ghost" type="button" aria-label="Account">
          <UserRound size={16} aria-hidden />
        </button>
      </div>
    </header>
  );
}

export function LeftNav({ activePath = "/queue", nav }: { activePath?: string; nav: NavItem[] }) {
  return (
    <nav className="cx-leftnav" aria-label="Console navigation">
      {nav.map((item) => {
        const Icon = item.icon;
        const isActive = activePath === item.href || (item.href !== "/" && activePath.startsWith(item.href));
        return (
          <a className={`cx-nav-link ${isActive ? "is-active" : ""}`} href={item.href} key={item.href}>
            <Icon size={17} aria-hidden />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

export function Panel({ children, title, actions, className = "" }: { actions?: ReactNode; children: ReactNode; className?: string; title: string }) {
  return (
    <section className={`cx-panel ${className}`}>
      <div className="cx-panel-header">
        <div className="cx-panel-title">{title}</div>
        {actions}
      </div>
      <div className="cx-panel-body">{children}</div>
    </section>
  );
}

export function ScreenHeader({ actions, kicker, subtitle, title }: { actions?: ReactNode; kicker: string; subtitle: string; title: string }) {
  return (
    <div className="cx-screen-header">
      <div className="cx-screen-title">
        <div className="cx-kicker">{kicker}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions ? <div className="cx-actions">{actions}</div> : null}
    </div>
  );
}

export function Button({
  children,
  tone = "ghost"
}: {
  children: ReactNode;
  tone?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <button className={`cx-button ${tone}`} type="button">
      {children}
    </button>
  );
}

export function FilterBar({ filters }: { filters: string[] }) {
  return (
    <div className="cx-filterbar">
      {filters.map((filter) => (
        <span className="cx-chip muted" key={filter}>
          {filter}
        </span>
      ))}
    </div>
  );
}

export function QueueRow({ job }: { job: Job }) {
  return (
    <article className="cx-row" tabIndex={0}>
      <div>
        <div className="cx-row-title">{job.id}</div>
        <div className="cx-meta">
          {job.customer_display} · {job.situation}
        </div>
      </div>
      <div className="cx-meta">{job.area}</div>
      <StatusChip status={job.console_status} />
      <div className="cx-toolbar">
        <TrustStateChip trustState={job.trust_state} />
        <UrgencyTag urgency={job.urgency} />
      </div>
      <div className="cx-actions">
        <a className="cx-button ghost" href={`/jobs/${job.id}`}>Open</a>
        <a className="cx-button secondary" href={`/jobs/${job.id}/assign`}>Assign</a>
        <Button><Phone size={14} aria-hidden />Call</Button>
      </div>
    </article>
  );
}

export function TechnicianRow({ mode, technician }: { mode: ConsoleMode; technician: Technician }) {
  const blocked = technician.eligibility !== "eligible";
  return (
    <article className="cx-tech-row">
      <div className="cx-avatar">{technician.initials}</div>
      <div>
        <div className="cx-tech-name">{technician.display_name}</div>
        <div className="cx-meta">
          {technician.provider_type} · {technician.service_area} · ETA {technician.eta_min ?? "--"} min · {technician.distance_mi ?? "--"} mi
        </div>
        <div className="cx-toolbar" style={{ marginTop: 7 }}>
          <StatusChip status={technician.eligibility} />
          <span className="cx-chip muted">Docs: {technician.document_status}</span>
          <span className="cx-chip muted">Workload {technician.workload}</span>
          {technician.direct_dispatch_allowed && mode === "cluexp" ? <span className="cx-chip direct">DIRECT-RELEASE · planned</span> : null}
          {technician.skills.map((skill) => (
            <span className="cx-chip muted" key={skill}>{skill}</span>
          ))}
        </div>
        {technician.blocking_reason ? <div className="cx-micro" style={{ marginTop: 6 }}>{technician.blocking_reason}</div> : null}
      </div>
      <div className="cx-actions">
        {blocked ? <Button tone="danger">Override Block</Button> : <Button tone="primary">Assign</Button>}
        {!blocked ? <Button tone="secondary">Send Offer</Button> : null}
        <Button>Hold</Button>
        <Button>View Profile</Button>
      </div>
    </article>
  );
}

export function OrganizationRow({ organization }: { organization: Organization }) {
  const blocked = organization.status !== "eligible";
  return (
    <article className="cx-org-row">
      <div className="cx-avatar"><Home size={19} aria-hidden /></div>
      <div>
        <div className="cx-org-name">{organization.display_name}</div>
        <div className="cx-meta">
          {organization.description} · {organization.distance_mi ?? "--"} mi · avg response {organization.avg_response_min ?? "--"} min
        </div>
        <div className="cx-toolbar" style={{ marginTop: 7 }}>
          <StatusChip status={organization.status} />
          <span className="cx-chip muted">Docs: {organization.document_status}</span>
          <span className="cx-chip muted">Workload: {organization.workload}</span>
          <span className="cx-chip muted">Rating {organization.rating ?? "--"}</span>
        </div>
        {organization.blocking_reason ? <div className="cx-micro" style={{ marginTop: 6 }}>{organization.blocking_reason}</div> : null}
      </div>
      <div className="cx-actions">
        {blocked ? <span className="cx-chip danger">Actions locked</span> : <Button tone="primary">Route to Organization</Button>}
        {!blocked ? <Button tone="secondary">Route to Team</Button> : null}
        <Button>View Profile</Button>
      </div>
    </article>
  );
}

export function DataTable({
  columns,
  rows
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
}) {
  return (
    <div className="cx-table-wrap">
      <table className="cx-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`row-${index}`}>{row.map((cell, cellIndex) => <td key={`cell-${cellIndex}`}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cx-metric">
      <strong>{value}</strong>
      <span className="cx-meta">{label}</span>
    </div>
  );
}

export function Countdown({ expiresAt }: { expiresAt: string }) {
  const expires = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = Math.max(0, expires - now);
  const seconds = Math.floor(remaining / 1000);
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");

  return <span className={`cx-chip ${remaining <= 0 ? "danger" : "alert"}`}>{remaining <= 0 ? "Expired" : `${minutesPart}:${secondsPart}`}</span>;
}

export function MapPanel({ jobs, technicians }: { jobs: Job[]; technicians: Technician[] }) {
  const jobMarkers = jobs.slice(0, 4);
  const techMarkers = technicians.slice(0, 4);
  return (
    <div className="cx-map" aria-label="Static operations map">
      <div className="cx-service-area" aria-hidden />
      {jobMarkers.map((job, index) => (
        <span className="cx-marker job" key={job.id} style={{ left: `${18 + index * 16}%`, top: `${24 + index * 10}%` }}>
          J
        </span>
      ))}
      {techMarkers.map((tech, index) => (
        <span className="cx-marker tech" key={tech.id} style={{ left: `${34 + index * 13}%`, top: `${58 - index * 9}%` }}>
          T
        </span>
      ))}
      <div className="cx-map-legend">
        <span className="cx-chip alert">J Job marker</span>
        <span className="cx-chip route">T Technician marker</span>
        <span className="cx-chip muted">Service area outline</span>
        <span className="cx-chip danger">Stale location: 18 min</span>
      </div>
    </div>
  );
}

export function Timeline({ events }: { events: Array<{ actor_display: string; at: string; event: string; reason?: string; trust_state?: TrustState }> }) {
  return (
    <div className="cx-timeline">
      {events.map((event) => (
        <div className="cx-timeline-item" key={`${event.at}-${event.event}`}>
          <div className="cx-card-title">{event.event}</div>
          <div className="cx-meta">
            {event.actor_display} · {new Date(event.at).toLocaleString()}
          </div>
          <div className="cx-toolbar">
            {event.trust_state ? <TrustStateChip trustState={event.trust_state} /> : null}
            {event.reason ? <span className="cx-chip muted">{event.reason}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ComplianceStatus({ entry }: { entry: ComplianceEntry }) {
  return (
    <div className="cx-toolbar">
      <span className={`cx-chip ${entry.blocking ? "danger" : entry.document_status === "verified" ? "success" : "alert"}`}>
        {entry.document_status}
      </span>
      {entry.blocking ? <span className="cx-chip danger">Blocking</span> : null}
    </div>
  );
}

export function AccessIcon({ accessType }: { accessType: Job["access_type"] }) {
  if (accessType === "business") return <Briefcase size={14} aria-hidden />;
  if (accessType === "home") return <Home size={14} aria-hidden />;
  return <KeyRound size={14} aria-hidden />;
}

export function RouteArrow() {
  return <ArrowRight size={14} aria-hidden />;
}

export function TruckIcon() {
  return <Truck size={14} aria-hidden />;
}

export function XIcon() {
  return <XCircle size={14} aria-hidden />;
}
