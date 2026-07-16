"use client";

import type {
  AuthSession,
  ComplianceEntry,
  ConsoleMode,
  ConsoleStatus,
  DispatchEvent,
  DocumentStatus,
  Job,
  OfferStatus,
  OrganizationEligibility,
  SafetyFlag as SafetyFlagType,
  Technician,
  TechnicianEligibility,
  TrustState,
  Urgency
} from "@cluexp/api-client";
import { organizationById, technicianById } from "@cluexp/api-client";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock,
  FileText,
  Gauge,
  History,
  Home,
  KeyRound,
  LayoutDashboard,
  Map,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Navigation,
  Phone,
  Route,
  Search,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Truck,
  UserRound,
  Users,
  XCircle
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTrigger,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "../ui";

type StatusLike = ConsoleStatus | TechnicianEligibility | OrganizationEligibility | OfferStatus | DocumentStatus;
type BadgeVariant = "neutral" | "info" | "success" | "warn" | "danger" | "critical" | "outline";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group?: "Operations" | "Workforce" | "Reports" | "Admin";
  cluexpOnly?: boolean;
}

export const defaultNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Operations" },
  { href: "/queue", label: "Live Queue", icon: Gauge, group: "Operations" },
  { href: "/board", label: "Dispatch Board", icon: ClipboardCheck, group: "Operations" },
  { href: "/map", label: "Map", icon: Map, group: "Operations" },
  { href: "/messages", label: "Messages", icon: MessageSquare, group: "Operations" },
  { href: "/escalations", label: "Escalations", icon: ShieldAlert, group: "Operations" },
  { href: "/jobs/JOB-A-2201/assign", label: "Technicians", icon: Users, group: "Workforce" },
  { href: "/teams", label: "Teams", icon: Briefcase, group: "Workforce" },
  { href: "/documents", label: "Documents", icon: FileText, group: "Workforce" },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck, group: "Admin", cluexpOnly: true },
  { href: "/reports", label: "Reports", icon: ClipboardCheck, group: "Reports" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Admin" },
  { href: "/audit", label: "Audit Log", icon: History, group: "Admin" }
];

const labels: Record<StatusLike, string> = {
  new_unrouted: "New",
  routed_to_cluexp: "Network routed",
  routed_to_organization: "Routed to org",
  awaiting_org_accept: "Awaiting org",
  awaiting_technician_assignment: "Awaiting assignment",
  offer_sent: "Offer sent",
  offer_expiring: "Offer expiring",
  accepted: "Assigned",
  en_route: "En route",
  arrived: "On site",
  in_service: "In service",
  customer_approval_needed: "Approval needed",
  completed: "Completed",
  cancelled: "Cancelled",
  escalated: "Escalated",
  stalled: "SLA risk",
  eligible: "Eligible",
  offline: "Offline",
  busy: "Busy",
  outside_service_area: "Outside area",
  missing_skill: "Missing skill",
  blocked_by_documents: "Docs blocked",
  stale_location: "GPS stale",
  suspended: "Suspended",
  manual_override_required: "Override needed",
  inactive: "Inactive",
  capacity_full: "Capacity full",
  dispatch_unavailable: "Unavailable",
  subscription_blocked: "Subscription blocked",
  pending: "Pending",
  sent: "Sent",
  seen: "Seen",
  declined: "Declined",
  expired: "Expired",
  superseded: "Superseded",
  failed_delivery: "Delivery failed",
  verified: "Verified",
  expiring: "Expiring",
  pending_review: "Pending review"
};

function variantFor(status: StatusLike): BadgeVariant {
  if (status === "completed" || status === "accepted" || status === "arrived" || status === "in_service" || status === "eligible" || status === "verified" || status === "seen") return "success";
  if (status === "en_route" || status === "routed_to_cluexp" || status === "routed_to_organization") return "info";
  if (status === "offer_sent" || status === "offer_expiring" || status === "customer_approval_needed" || status === "pending" || status === "sent" || status === "expiring" || status === "pending_review") return "warn";
  if (status === "stalled" || status === "escalated" || status === "blocked_by_documents" || status === "stale_location" || status === "suspended" || status === "expired" || status === "failed_delivery" || status === "cancelled") return "danger";
  return "neutral";
}

function StatusIcon({ status }: { status: StatusLike }) {
  const variant = variantFor(status);
  if (variant === "success") return <CheckCircle2 className="size-3" aria-hidden />;
  if (variant === "info") return <Navigation className="size-3" aria-hidden />;
  if (variant === "danger") return <ShieldAlert className="size-3" aria-hidden />;
  if (variant === "warn") return <Clock className="size-3" aria-hidden />;
  return <span className="size-1.5 rounded-full bg-current" aria-hidden />;
}

function organizationLabel(id?: string | null): string {
  if (!id) return "Not assigned";
  if (id === "platform-cluexp") return "ClueXP Platform";
  return organizationById(id)?.display_name ?? id;
}

function technicianLabel(id?: string): string {
  return technicianById(id)?.display_name ?? "No named technician yet";
}

function fulfillmentLabel(job: Job): string {
  if (job.fulfillment_technician_id) return technicianLabel(job.fulfillment_technician_id);
  if (job.fulfillment_org_id) return organizationLabel(job.fulfillment_org_id);
  return "Pending network assignment";
}

export function StatusBadge({ status, className }: { className?: string; status: StatusLike }) {
  return (
    <Badge className={className} variant={variantFor(status)}>
      <StatusIcon status={status} />
      {labels[status]}
    </Badge>
  );
}

export function TrustStateChip({ trustState }: { trustState: TrustState }) {
  return <Badge variant="outline">Trust: {trustState}</Badge>;
}

export function UrgencyTag({ urgency }: { urgency: Urgency }) {
  const variant: BadgeVariant = urgency === "critical" ? "critical" : urgency === "high" ? "warn" : "outline";
  return <Badge variant={variant}>{urgency} urgency</Badge>;
}

export function SafetyFlagBadge({ flag }: { flag: SafetyFlagType }) {
  return (
    <Badge variant={flag.severity === "critical" ? "critical" : flag.severity === "warning" ? "warn" : "outline"}>
      <AlertTriangle className="size-3" aria-hidden />
      {flag.label}
    </Badge>
  );
}

function BrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <img
      src={collapsed ? "/icon.png" : "/logo.png"}
      alt="ClueXP"
      className={cn("shrink-0 object-contain", collapsed ? "size-10" : "h-10 w-[148px]")}
    />
  );
}

export function AppShell({
  activePath,
  children,
  mode,
  modeBadge,
  nav = defaultNav,
  onSignOut,
  session,
  surfaceLabel
}: {
  activePath?: string;
  children: ReactNode;
  mode: ConsoleMode;
  modeBadge: string;
  nav?: NavItem[];
  onSignOut?: () => void;
  session?: AuthSession;
  surfaceLabel: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const scopedNav = mode === "org" ? nav.filter((item) => !item.cluexpOnly) : nav;
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Sidebar activePath={activePath} collapsed={collapsed} mode={mode} nav={scopedNav} onToggle={() => setCollapsed((value) => !value)} surfaceLabel={surfaceLabel} />
        <div className={cn("min-h-screen transition-[padding] duration-200 lg:pl-[264px]", collapsed && "lg:pl-[76px]")}>
          <Topbar activePath={activePath} modeBadge={modeBadge} nav={scopedNav} onSignOut={onSignOut} session={session} surfaceLabel={surfaceLabel} />
          <main className="mx-auto w-full max-w-[1760px] px-4 py-5 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export const Shell = AppShell;

export function MockAuthBoundary({
  allowedRoles,
  children,
  session
}: {
  allowedRoles: AuthSession["active_role"][];
  children: ReactNode;
  session?: AuthSession;
}) {
  const allowed = Boolean(session && allowedRoles.includes(session.active_role));
  if (allowed) return <>{children}</>;
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Session required"
      description="Sign in with an authorized account before opening this console."
      action={<Button asChild><Link href="/signin">Sign in</Link></Button>}
    />
  );
}

export function Sidebar({
  activePath = "/dashboard",
  collapsed,
  mode,
  nav,
  onToggle,
  surfaceLabel
}: {
  activePath?: string;
  collapsed: boolean;
  mode: ConsoleMode;
  nav: NavItem[];
  onToggle: () => void;
  surfaceLabel: string;
}) {
  const groups = ["Operations", "Workforce", "Reports", "Admin"] as const;
  return (
    <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 lg:flex", collapsed ? "w-[76px]" : "w-[264px]")}>
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <BrandMark collapsed={collapsed} />
        {!collapsed ? (
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold uppercase text-muted-foreground">{surfaceLabel}</div>
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => {
          const items = nav.filter((item) => (item.group ?? "Operations") === group);
          if (items.length === 0) return null;
          return (
            <div className="mb-5" key={group}>
              {!collapsed ? <div className="mb-2 px-2 text-[11px] font-semibold uppercase text-muted-foreground">{group}</div> : null}
              <div className="space-y-1">
                {items.map((item) => <SidebarItem activePath={activePath} collapsed={collapsed} item={item} key={item.href} />)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-sidebar-border p-3">
        <Button className="w-full justify-center" onClick={onToggle} size={collapsed ? "icon" : "sm"} variant="outline">
          {collapsed ? <ChevronRight className="size-4" /> : <><ChevronLeft className="size-4" /> Collapse</>}
        </Button>
        {!collapsed ? <div className="mt-3 rounded-md border border-border bg-card/60 p-3 text-xs text-muted-foreground">{mode === "cluexp" ? "Network operations, compliance, and trusted routing." : "Organization-scoped dispatch workspace."}</div> : null}
      </div>
    </aside>
  );
}

function SidebarItem({ activePath, collapsed, item }: { activePath: string; collapsed: boolean; item: NavItem }) {
  const Icon = item.icon;
  const active = activePath === item.href || (item.href !== "/" && activePath.startsWith(item.href));
  const link = (
    <Link
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1 before:h-7 before:w-0.5 before:rounded-full before:bg-primary",
        collapsed && "justify-center px-0"
      )}
      href={item.href}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function roleLabel(role?: string) {
  return role ? role.replaceAll("_", " ") : "mock session";
}

function initialsFor(name?: string) {
  return (name ?? "OP")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "OP";
}

export function Topbar({
  activePath = "/dashboard",
  modeBadge,
  nav = defaultNav,
  onSignOut,
  session,
  surfaceLabel
}: {
  activePath?: string;
  modeBadge: string;
  nav?: NavItem[];
  onSignOut?: () => void;
  session?: AuthSession;
  surfaceLabel: string;
}) {
  // The real org name comes from the session (session.organization_name, set by the
  // backend) — never fall back to the raw organization UUID, which means nothing to a user.
  const orgLabel = session?.active_organization_id
    ? (session.organization_name ?? "Organization")
    : "All network tenants";
  return (
    <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Open navigation" className="lg:hidden" size="icon" variant="outline"><Menu className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[70vh] overflow-y-auto">
          <DropdownMenuLabel>Console navigation</DropdownMenuLabel>
          {nav.map((item) => {
            const Icon = item.icon;
            const active = activePath === item.href || (item.href !== "/" && activePath.startsWith(item.href));
            return (
              <DropdownMenuItem asChild key={item.href}>
                <Link className={cn(active && "text-primary")} href={item.href}>
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold uppercase text-muted-foreground">{surfaceLabel}</div>
        <div className="truncate text-sm font-medium text-foreground">{orgLabel}</div>
      </div>
      <Badge variant="outline">Production</Badge>
      <Badge variant="neutral">{modeBadge}</Badge>
      <Badge className="hidden sm:inline-flex" variant="outline">{roleLabel(session?.active_role)}</Badge>
      <Button asChild aria-label="Open dashboard notifications" size="icon" variant="outline"><Link href="/dashboard"><Bell className="size-4" /></Link></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="gap-2" variant="ghost">
            <Avatar className="size-7"><AvatarFallback>{initialsFor(session?.user.display_name)}</AvatarFallback></Avatar>
            <span className="hidden text-sm md:inline">{session?.user.display_name ?? "Operations"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{surfaceLabel}</DropdownMenuLabel>
          <DropdownMenuItem>{orgLabel}</DropdownMenuItem>
          <DropdownMenuItem>{roleLabel(session?.active_role)}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link href="/account">Account</Link></DropdownMenuItem>
          <DropdownMenuItem onClick={onSignOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

export function PageHeader({ actions, description, kicker, title }: { actions?: ReactNode; description?: string; kicker?: string; title: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-4xl">
        {kicker ? <div className="mb-2 text-xs font-semibold uppercase text-primary/90">{kicker}</div> : null}
        <h1 className="font-condensed text-3xl font-bold uppercase tracking-normal text-foreground md:text-4xl">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({ delta, icon: Icon, intent = "neutral", label, trend, value }: { delta?: string; icon?: LucideIcon; intent?: BadgeVariant; label: string; trend?: string; value: string }) {
  return (
    <Card className="group transition-colors hover:border-primary/35">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
          </div>
          {Icon ? <div className="rounded-md border border-border bg-secondary p-2 text-muted-foreground group-hover:text-primary"><Icon className="size-4" /></div> : null}
        </div>
        {(delta || trend) ? (
          <div className="mt-3 flex items-center gap-2 text-xs">
            {delta ? <Badge variant={intent}>{delta}</Badge> : null}
            {trend ? <span className="text-muted-foreground">{trend}</span> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function FilterBar({ filters }: { filters: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => <Badge key={filter} variant="outline">{filter}</Badge>)}
    </div>
  );
}

export function DataTable({ columns, rows }: { columns: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <div className="overflow-auto rounded-md border border-border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>{columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell className="py-10 text-center text-muted-foreground" colSpan={columns.length}>No records match the current filters.</TableCell></TableRow>
          ) : (
            rows.map((row, index) => <TableRow key={`row-${index}`}>{row.map((cell, cellIndex) => <TableCell key={`cell-${cellIndex}`}>{cell}</TableCell>)}</TableRow>)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function RowActions({ items }: { items: string[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => <DropdownMenuItem key={item}>{item}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RequestTable({ jobs }: { jobs: Job[] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Requests</CardTitle>
        <CardDescription>Dense service-request table with trust-state separated from console status.</CardDescription>
        </div>
        <div className="flex items-center gap-2"><Input className="w-64" placeholder="Filter requests" /><Button variant="outline">Filters</Button></div>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable
          columns={["Request", "Customer", "Origin", "Customer Owner", "Fulfillment", "Status", "Trust", "Urgency", "Age", "Actions"]}
          rows={jobs.map((job) => [
            <div key={`${job.id}-req`}><div className="font-medium">{job.id}</div><div className="text-xs text-muted-foreground">{job.situation}</div></div>,
            job.customer_display,
            <div key={`${job.id}-origin`}><div>{organizationLabel(job.origin_org_id)}</div><div className="text-xs text-muted-foreground">{job.origin_channel ?? job.routing_source}</div></div>,
            organizationLabel(job.customer_owner_org_id),
            fulfillmentLabel(job),
            <StatusBadge key={`${job.id}-status`} status={job.console_status} />,
            <TrustStateChip key={`${job.id}-trust`} trustState={job.trust_state} />,
            <UrgencyTag key={`${job.id}-urgency`} urgency={job.urgency} />,
            <span className="tabular-nums" key={`${job.id}-age`}>{job.age_min}m</span>,
            <div className="flex items-center gap-1" key={`${job.id}-actions`}>
              <RequestDrawer job={job} />
              <RowActions items={["Assign", "Route", "Release to network", "Escalate", "Call customer", "Call technician"]} />
            </div>
          ])}
        />
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span>Showing {jobs.length} requests</span>
          <span>Page 1 of 1</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function DispatchQueue({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) return <EmptyState icon={ClipboardCheck} title="No active requests" description="Requests matching the current filters will appear here." />;
  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <div key={job.id} className={cn("flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/35", (job.console_status === "stalled" || job.urgency === "critical") && "border-destructive/45 bg-destructive/5")}>
          <div className={cn("h-10 w-1 rounded-full bg-muted", job.urgency === "critical" ? "bg-destructive" : job.urgency === "high" ? "bg-warn" : "bg-info")} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{job.id}</span><StatusBadge status={job.console_status} /><TrustStateChip trustState={job.trust_state} /></div>
            <div className="mt-1 truncate text-sm text-muted-foreground">{job.customer_display} · {job.situation} · {job.area}</div>
          </div>
          <SlaCountdown deadline={job.sla_deadline_at} targetMinutes={job.sla_min} />
          <RequestDrawer job={job} />
        </div>
      ))}
    </div>
  );
}

export function RequestDrawer({ job }: { job: Job }) {
  return (
    <Sheet>
      <SheetTrigger asChild><Button size="sm" variant="outline">Open</Button></SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <StatusBadge status={job.console_status} />
            <TrustStateChip trustState={job.trust_state} />
            <UrgencyTag urgency={job.urgency} />
          </div>
          <SheetTitle>{job.id} · {job.situation}</SheetTitle>
          <SheetDescription>{job.customer_display} · {job.address}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Age" value={`${job.age_min}m`} />
            <StatCard label="ETA" value={job.eta_min ? `${job.eta_min}m` : "Pending"} />
            <StatCard label="Origin" value={organizationLabel(job.origin_org_id)} />
            <StatCard label="Fulfillment" value={fulfillmentLabel(job)} />
          </div>
          <TrustSafety status={job.trust_state} flags={job.safety_flags} />
          <div className="flex flex-wrap gap-2">
            <Button>Assign</Button>
            <Button variant="secondary">Route</Button>
            <Button variant="outline">Message / Call</Button>
            <Button variant="destructive">Escalate</Button>
          </div>
          <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm text-info">Internal notes are separate from customer and technician messages. Organization acceptance does not create MATCHED.</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function TechnicianCard({ mode, technician }: { mode: ConsoleMode; technician: Technician }) {
  const blocked = technician.eligibility !== "eligible";
  return (
    <Card className={cn("transition-colors hover:border-primary/35", blocked && "border-destructive/35")}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar><AvatarFallback>{technician.initials}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium">{technician.display_name}</div>
              <StatusBadge status={technician.eligibility} />
              {technician.direct_dispatch_allowed && mode === "cluexp" ? <Badge variant="warn">Network routing eligible</Badge> : null}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{technician.provider_type} · {technician.service_area} · ETA {technician.eta_min ?? "--"}m · {technician.distance_mi ?? "--"}mi</div>
            <div className="mt-3 flex flex-wrap gap-2">{technician.skills.map((skill) => <Badge key={skill} variant="outline">{skill}</Badge>)}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-4">
              <span>Docs: {technician.document_status}</span>
              <span>Check: {technician.background_check ?? "verified"}</span>
              <span>Risk: {technician.payment_risk ?? "low"}</span>
              <span>No-show: {technician.no_show_history ?? 0}</span>
            </div>
            {technician.blocking_reason ? <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">{technician.blocking_reason}</div> : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {blocked ? <Button variant="destructive">Override Block</Button> : <Button>Assign</Button>}
          {!blocked ? <Button variant="secondary">Send Offer</Button> : null}
          <Button variant="outline">Hold</Button>
          <Button variant="ghost">View Profile</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function Timeline({ events }: { events: Pick<DispatchEvent, "actor_display" | "at" | "event" | "reason" | "trust_state" | "metadata">[] }) {
  return (
    <div className="space-y-4">
      {events.map((event) => (
        <div className="relative border-l border-border pl-4" key={`${event.at}-${event.event}`}>
          <span className="absolute -left-1.5 top-1 size-3 rounded-full border border-primary bg-card" />
          <div className="font-medium">{event.event}</div>
          <div className="mt-1 text-xs text-muted-foreground">{event.actor_display} · {new Date(event.at).toLocaleString()}</div>
          <div className="mt-2 flex flex-wrap gap-2">{event.trust_state ? <TrustStateChip trustState={event.trust_state} /> : null}{event.reason ? <Badge variant="outline">{event.reason}</Badge> : null}</div>
        </div>
      ))}
    </div>
  );
}

export function SlaCountdown({ deadline, targetMinutes }: { deadline?: string; targetMinutes?: number }) {
  const target = useMemo(() => deadline ? new Date(deadline).getTime() : Date.now() + (targetMinutes ?? 20) * 60 * 1000, [deadline, targetMinutes]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, target - now);
  const seconds = Math.floor(remaining / 1000);
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  const variant: BadgeVariant = remaining === 0 ? "danger" : seconds < 300 ? "warn" : "outline";
  return <Badge variant={variant}>{remaining === 0 ? "SLA Risk" : `${minutesPart}:${secondsPart}`}</Badge>;
}

export function MapCard({ jobs, technicians }: { jobs: Job[]; technicians: Technician[] }) {
  const jobMarkers = jobs.slice(0, 4);
  const techMarkers = technicians.slice(0, 4);
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Operations map</CardTitle>
          <CardDescription>Static placeholder with service area, job/technician markers and staleness indicators.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative h-[430px] overflow-hidden bg-[linear-gradient(135deg,rgba(96,165,250,.10)_1px,transparent_1px),linear-gradient(45deg,rgba(255,191,0,.08)_1px,transparent_1px)] bg-[length:58px_58px,44px_44px]">
          <div className="absolute inset-x-16 bottom-16 top-12 rotate-[-2deg] skew-x-[-10deg] border-2 border-dashed border-primary/45" />
          {jobMarkers.map((job, index) => (
            <span className="absolute flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-lg shadow-primary/20" key={job.id} style={{ left: `${18 + index * 16}%`, top: `${24 + index * 10}%` }}>J</span>
          ))}
          {techMarkers.map((tech, index) => (
            <span className="absolute flex size-7 items-center justify-center rounded-full bg-info text-xs font-bold text-info-foreground shadow-lg shadow-info/20" key={tech.id} style={{ left: `${34 + index * 13}%`, top: `${58 - index * 9}%` }}>T</span>
          ))}
          <div className="absolute bottom-4 right-4 space-y-2 rounded-md border border-border bg-background/90 p-3 text-xs backdrop-blur">
            <Badge variant="warn">J Job marker</Badge>
            <Badge variant="info">T Technician marker</Badge>
            <Badge variant="outline">Route ETA 7-18m</Badge>
            <Badge variant="danger">Stale GPS: 18m</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ action, description, icon: Icon = CircleHelp, title }: { action?: ReactNode; description: string; icon?: LucideIcon; title: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-md border border-border bg-secondary p-3 text-muted-foreground"><Icon className="size-5" /></div>
        <div className="font-condensed text-lg font-bold uppercase">{title}</div>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

export function TrustSafety({ flags = [], status, technician }: { flags?: SafetyFlagType[]; status?: TrustState; technician?: Technician }) {
  return (
    <Card>
      <CardHeader><CardTitle>Trust & safety</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {status ? <TrustStateChip trustState={status} /> : null}
          <Badge variant={technician?.verified === false ? "warn" : "success"}><ShieldCheck className="size-3" />Verified professional</Badge>
          <Badge variant={technician?.background_check === "expired" ? "danger" : "success"}>Background check</Badge>
          <Badge variant={technician?.insurance_status === "expired" ? "danger" : "success"}>Insurance status</Badge>
          <Badge variant={technician?.payment_risk === "high" ? "danger" : "outline"}>Payment risk {technician?.payment_risk ?? "low"}</Badge>
          <Badge variant="outline">No-show history {technician?.no_show_history ?? 0}</Badge>
          {flags.length ? flags.map((flag) => <SafetyFlagBadge flag={flag} key={flag.code} />) : <Badge variant="success">No safety flags</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

export function ComplianceStatus({ entry }: { entry: ComplianceEntry }) {
  return <div className="flex flex-wrap gap-2"><StatusBadge status={entry.document_status} />{entry.blocking ? <Badge variant="danger">Blocking</Badge> : null}</div>;
}

export function AccessIcon({ accessType }: { accessType: Job["access_type"] }) {
  if (accessType === "business") return <Briefcase className="size-4" aria-hidden />;
  if (accessType === "home") return <Home className="size-4" aria-hidden />;
  return <KeyRound className="size-4" aria-hidden />;
}

export function LoadingSkeleton() {
  return <div className="grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
}

export { Button, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input };
export { AlertTriangle, FileText, MessageSquare, Navigation, Phone, Route, Search, Sparkles, Truck, UserRound, XCircle };
export { GoogleMapView } from "./google-map";
export type { MapPoint } from "./google-map";
