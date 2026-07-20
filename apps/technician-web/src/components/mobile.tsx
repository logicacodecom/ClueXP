import type { Job, TechnicianAppOffer, TechnicianAppProfile } from "@cluexp/api-client";
import {
  activeTechnicianJobIds,
  currentTechnician,
  jobById,
  technicianAppProfile,
  technicianSession
} from "@cluexp/api-client";
import {
  AlertTriangle,
  BellRing,
  BriefcaseBusiness,
  Car,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileCheck2,
  FileText,
  Headphones,
  Home,
  KeyRound,
  LocateFixed,
  MessageCircle,
  Mic,
  Navigation,
  Phone,
  Radio,
  Route,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  Users,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AvailabilityToggle, Countdown, TechnicianBottomNav } from "./client-widgets";
import { GoogleMapView } from "./google-map";
import type { MapPoint } from "./google-map";
import { activeJobActionItems } from "./technician-app-chrome";

type PillTone = "default" | "success" | "warn" | "danger" | "info" | "muted";
type JobPhase = "accepted" | "en_route" | "arrived" | "in_progress" | "completed";

const statusSteps: Array<{ key: JobPhase; label: string }> = [
  { key: "accepted", label: "Accepted" },
  { key: "en_route", label: "En route" },
  { key: "arrived", label: "Arrived" },
  { key: "in_progress", label: "Work started" },
  { key: "completed", label: "Completed" }
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toneClass(tone: PillTone) {
  if (tone === "success") return "border-success/30 bg-success/10 text-success";
  if (tone === "warn") return "border-primary/35 bg-primary/12 text-primary";
  if (tone === "danger") return "border-danger/35 bg-danger/10 text-danger";
  if (tone === "info") return "border-info/30 bg-info/10 text-info";
  if (tone === "muted") return "border-border bg-card-strong text-muted";
  return "border-primary/35 bg-primary/12 text-primary";
}

function urgencyTone(urgency?: Job["urgency"]): PillTone {
  if (urgency === "critical") return "danger";
  if (urgency === "high") return "warn";
  if (urgency === "medium") return "info";
  return "muted";
}

function phaseFromStatus(status: Job["console_status"]): JobPhase {
  if (status === "completed") return "completed";
  if (status === "in_service") return "in_progress";
  if (status === "arrived") return "arrived";
  if (status === "en_route") return "en_route";
  return "accepted";
}

function stageLabel(phase: JobPhase) {
  const item = statusSteps.find((step) => step.key === phase);
  return item?.label ?? "Accepted";
}

function nextAction(job: Job) {
  const phase = phaseFromStatus(job.console_status);
  if (phase === "accepted") return { href: `/jobs/${job.id}/arrival`, label: "Go to arrival", icon: Navigation };
  if (phase === "en_route") return { href: `/jobs/${job.id}/arrival`, label: "Mark arrived", icon: CheckCircle2 };
  if (phase === "arrived") return { href: `/jobs/${job.id}/service`, label: "Start service", icon: KeyRound };
  if (phase === "in_progress") return { href: `/jobs/${job.id}/service`, label: "Service in progress", icon: KeyRound };
  return { href: `/jobs/${job.id}/approval`, label: "Awaiting approval", icon: ShieldCheck };
}

export function TechnicianShell({
  children,
  nav = true,
  topbar = true,
  title = "ClueXP Tech"
}: {
  children: ReactNode;
  nav?: boolean;
  topbar?: boolean;
  title?: string;
}) {
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-[480px] flex-col overflow-hidden bg-background text-foreground shadow-[0_30px_120px_rgba(0,0,0,.42)] md:my-6 md:min-h-[920px] md:rounded-[28px] md:border md:border-border">
      {topbar ? <TechnicianTopBar title={title} /> : null}
      <div className={cx("min-h-0 flex-1 overflow-hidden", nav && "pb-[92px]")}>{children}</div>
      {nav ? <TechnicianBottomNav /> : null}
    </main>
  );
}

export const AppFrame = TechnicianShell;

export function Screen({
  children,
  flush = false,
  padBottom = true
}: {
  children: ReactNode;
  flush?: boolean;
  padBottom?: boolean;
}) {
  return (
    <div className={cx("min-h-full overflow-y-auto", flush ? "" : "px-4 pt-3", padBottom && "safe-bottom")}>
      {children}
    </div>
  );
}

export function TechnicianTopBar({
  profile = technicianAppProfile,
  title = "ClueXP Tech"
}: {
  profile?: TechnicianAppProfile;
  title?: string;
}) {
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-border/80 bg-background/96 px-4 pb-3 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <img className="h-6 w-auto object-contain" src="/logo.png" alt="ClueXP" />
          <div className="truncate font-condensed text-lg font-bold uppercase leading-tight">{title}</div>
        </div>
        <div className="flex items-center gap-2.5">
          <AvailabilityToggle profile={profile} />
          <Link className="touch-target flex items-center justify-center rounded-full border border-border bg-card" href="/profile" aria-label="Open account">
            <Users className="size-5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PhoneStatus({ title }: { title: string }) {
  return <TechnicianTopBar title={title} />;
}

export function Section({
  action,
  children,
  subtitle,
  title
}: {
  action?: ReactNode;
  children: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="mb-4 rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black leading-tight">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm leading-5 text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Pill({
  children,
  icon: Icon,
  tone = "default"
}: {
  children: ReactNode;
  icon?: LucideIcon;
  tone?: PillTone;
}) {
  return (
    <span className={cx("inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase leading-none", toneClass(tone))}>
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </span>
  );
}

type PrimaryButtonProps = {
  children: ReactNode;
  tone?: "primary" | "secondary" | "danger";
} & (
  | { href: string; onClick?: never; disabled?: never }
  | { href?: never; onClick: () => void | Promise<void>; disabled?: boolean }
);

export function PrimaryButton({ children, tone = "primary", href, onClick, disabled }: PrimaryButtonProps) {
  const className = cx(
    "touch-target inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[15px] font-black transition active:scale-[.99]",
    tone === "primary" && "bg-primary text-primary-foreground hover:bg-[#ffd15f]",
    tone === "secondary" && "border border-border bg-card-strong text-foreground hover:border-primary/45",
    tone === "danger" && "bg-danger text-[#250606] hover:bg-[#ff8c8c]",
    disabled && "opacity-60 pointer-events-none"
  );
  if (href) {
    return <Link className={className} href={href}>{children}</Link>;
  }
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function FieldMapPanel({ job, compact = false, mode = "route" }: { compact?: boolean; job?: Job; mode?: "route" | "fleet" }) {
  const points: MapPoint[] = [];
  if (typeof job?.lat === "number" && typeof job?.lng === "number") {
    if (mode === "route") points.push({ lat: job.lat + 0.012, lng: job.lng - 0.014, kind: "tech", label: "You" });
    points.push({ lat: job.lat, lng: job.lng, kind: "job", label: job.customer_display });
  }
  return (
    <div className={cx("relative overflow-hidden border border-border bg-[#0e141c]", compact ? "h-[260px] rounded-2xl" : "h-[clamp(320px,42svh,430px)] rounded-b-[28px]")}>
      <GoogleMapView points={points} connect={mode === "route"} fallback={<MockMapVisual />} />
      <div className="absolute left-4 top-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-background/92 px-3 py-2 text-xs font-black backdrop-blur">
        <LocateFixed className="size-4 text-success" />
        GPS live
      </div>
      <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-border bg-background/94 p-3.5 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[.08em] text-muted">{mode === "fleet" ? "Dispatch area" : "Next stop"}</div>
            <div className="truncate text-base font-black">{job?.area ?? "Downtown"} · {job?.eta_min ?? 7} min ETA</div>
          </div>
          <Route className="size-5 shrink-0 text-primary" />
        </div>
      </div>
    </div>
  );
}

function MockMapVisual() {
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 opacity-90 [background-image:linear-gradient(135deg,rgba(129,145,168,.18)_1px,transparent_1px),linear-gradient(45deg,rgba(245,181,61,.12)_1px,transparent_1px)] [background-size:48px_48px,32px_32px]" />
      <div className="absolute left-[-8%] top-[58%] h-2 w-[72%] rotate-[-19deg] rounded-full bg-primary" />
      <div className="absolute right-[-14%] top-[34%] h-2 w-[70%] rotate-[13deg] rounded-full bg-info/85" />
      <div className="absolute left-[22%] top-[63%] flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20">
        <Navigation className="size-5" />
      </div>
      <div className="absolute right-[20%] top-[24%] flex size-11 items-center justify-center rounded-full bg-card text-primary ring-4 ring-primary/20">
        <KeyRound className="size-5" />
      </div>
    </div>
  );
}

export function JobOfferCard({ offer }: { offer: TechnicianAppOffer }) {
  const job = jobById(offer.job_id);
  const superseded = offer.status === "superseded";
  return (
    <article className={cx("rounded-[22px] border bg-card p-4", superseded ? "border-danger/40 opacity-75" : "border-border")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Pill tone={urgencyTone(job?.urgency)} icon={job?.urgency === "critical" ? ShieldAlert : Timer}>
              {job?.urgency ?? "standard"}
            </Pill>
            <Pill tone="muted" icon={offer.source === "cluexp" ? Headphones : BriefcaseBusiness}>
              {offer.source_label}
            </Pill>
          </div>
          <h2 className="mt-4 text-[22px] font-black leading-7">{job?.situation ?? "Service request"}</h2>
          <p className="mt-1 text-sm font-semibold leading-5 text-muted">{job?.area ?? "Service area"} · exact address after accept</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-condensed text-4xl font-bold leading-none tabular-nums">{offer.eta_min}</div>
          <div className="text-[11px] font-black uppercase text-muted">min ETA</div>
        </div>
      </div>
      {!superseded ? (
        <div className="mt-4">
          <Countdown expiresAt={offer.expires_at} />
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-danger/35 bg-danger/10 p-3 text-sm font-black text-danger">
          {offer.superseded_by ?? "Offer closed"}
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="Distance" value={`${offer.distance_mi} mi`} />
        <MiniStat label="Value" value={offer.estimated_earnings ?? "TBD"} tone="warn" />
        <MiniStat label="Area" value={job?.area ?? "--"} />
      </div>
      <div className="mt-4 grid grid-cols-[.72fr_1.28fr] gap-3">
        <PrimaryButton href={`/offer/${offer.offer_id}/decline`} tone="secondary"><X className="size-5" />Decline</PrimaryButton>
        <PrimaryButton href={`/jobs/${offer.job_id}`}><Check className="size-5" />Accept</PrimaryButton>
      </div>
    </article>
  );
}

export const OfferCard = JobOfferCard;

export function ActiveJobCard({ job }: { job: Job }) {
  const action = nextAction(job);
  const ActionIcon = action.icon;
  const phase = phaseFromStatus(job.console_status);
  return (
    <article className="rounded-[22px] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Pill tone="success" icon={ShieldCheck}>{stageLabel(phase)}</Pill>
          <h2 className="mt-3 text-[22px] font-black leading-7">{job.customer_display}</h2>
          <p className="mt-1 text-sm font-semibold leading-5 text-muted">{job.situation}</p>
        </div>
        <JobAccessIcon accessType={job.access_type} />
      </div>
      <div className="mt-4 rounded-2xl border border-border bg-card-strong p-3">
        <div className="text-[11px] font-black uppercase text-muted">Address</div>
        <div className="mt-1 text-base font-black leading-5">{job.address}</div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="ETA" value={`${job.eta_min ?? "--"} min`} tone="info" />
        <MiniStat label="Age" value={`${job.age_min} min`} />
        <MiniStat label="Value" value={job.price_quote ?? "$95 est."} tone="warn" />
      </div>
      <div className="mt-4">
        <PrimaryButton href={action.href}><ActionIcon className="size-5" />{action.label}</PrimaryButton>
      </div>
    </article>
  );
}

export function JobActionSheet({ job, offer }: { job?: Job; offer?: TechnicianAppOffer }) {
  const action = job ? nextAction(job) : null;
  const ActionIcon = action?.icon ?? Check;
  return (
    <section className="sticky bottom-0 z-20 -mx-4 mt-[-18px] rounded-t-[28px] border-t border-border bg-background/98 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-18px_50px_rgba(0,0,0,.30)] backdrop-blur-xl">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden />
      {job ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[.08em] text-muted">Active job</div>
              <h1 className="mt-1 truncate text-[22px] font-black leading-7">{job.customer_display}</h1>
              <p className="truncate text-sm font-semibold text-muted">{job.situation} · {job.area}</p>
            </div>
            <div className="text-right">
              <div className="font-condensed text-4xl font-bold leading-none tabular-nums">{job.eta_min ?? "--"}</div>
              <div className="text-[10px] font-black uppercase tracking-[.08em] text-muted">min</div>
            </div>
          </div>
          <JobStatusTimeline job={job} compact />
          {action ? <PrimaryButton href={action.href}><ActionIcon className="size-5" />{action.label}</PrimaryButton> : null}
        </>
      ) : offer ? (
        <CompactOfferSheet offer={offer} />
      ) : (
        <EmptyJobState />
      )}
      {job ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {activeJobActionItems.map(({ key, icon, label }) => {
            const href = key === "messages" ? `/jobs/${job.id}/chat` : key === "call" ? `/jobs/${job.id}/call` : "/messages";
            return <SecondaryAction href={href} icon={icon} label={label} key={key} />;
          })}
        </div>
      ) : null}
    </section>
  );
}

function SecondaryAction({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link className="touch-target flex min-h-[58px] flex-col items-center justify-center rounded-2xl border border-border bg-card p-2 text-[11px] font-black text-muted transition hover:text-foreground active:scale-[.98]" href={href}>
      <Icon className="mb-1 size-5 text-foreground" />
      {label}
    </Link>
  );
}

function CompactOfferSheet({ offer }: { offer: TechnicianAppOffer }) {
  const job = jobById(offer.job_id);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[.08em] text-muted">Incoming offer</div>
          <h1 className="mt-1 truncate text-[22px] font-black leading-7">{job?.situation ?? "Service request"}</h1>
          <p className="truncate text-sm font-semibold text-muted">{job?.area ?? "Service area"} · {offer.distance_mi} mi</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-condensed text-4xl font-bold leading-none tabular-nums">{offer.eta_min}</div>
          <div className="text-[10px] font-black uppercase tracking-[.08em] text-muted">min</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[.72fr_1.28fr] gap-3">
        <PrimaryButton href={`/offer/${offer.offer_id}/decline`} tone="secondary"><X className="size-5" />Decline</PrimaryButton>
        <PrimaryButton href={`/jobs/${offer.job_id}`}><Check className="size-5" />Accept</PrimaryButton>
      </div>
    </div>
  );
}

export function JobStatusTimeline({
  compact = false,
  job,
  timestamps
}: {
  compact?: boolean;
  job: Job;
  timestamps?: Partial<Record<JobPhase, string>>;
}) {
  const current = phaseFromStatus(job.console_status);
  const currentIndex = statusSteps.findIndex((step) => step.key === current);
  return (
    <div className={cx("my-4", compact ? "grid grid-cols-5 gap-1.5" : "space-y-0")}>
      {statusSteps.map((step, index) => {
        const done = index <= currentIndex;
        if (compact) {
          return (
            <div key={step.key} className="min-w-0">
              <div className={cx("h-1.5 rounded-full", done ? "bg-primary" : "bg-card-strong")} />
              <div className={cx("mt-1 truncate text-center text-[9px] font-black uppercase", done ? "text-primary" : "text-muted")}>{step.label.split(" ")[0]}</div>
            </div>
          );
        }
        return (
          <div className="grid grid-cols-[24px_1fr] gap-3" key={step.key}>
            <div className="flex flex-col items-center">
              <span className={cx("mt-1 size-3 rounded-full ring-4", done ? "bg-primary ring-primary/20" : "bg-card-strong ring-border/60")} />
              {index < statusSteps.length - 1 ? <span className={cx("h-9 w-px", index < currentIndex ? "bg-primary" : "bg-border")} /> : null}
            </div>
            <div className="pb-4">
              <div className={cx("text-sm font-black", done ? "text-foreground" : "text-muted")}>{step.label}</div>
              <div className="mt-0.5 text-xs font-semibold text-muted">{timestamps?.[step.key] ?? (done ? "Timestamp pending sync" : "Waiting")}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EmergencySupportButton({ compact = false }: { compact?: boolean }) {
  if (compact) return <SecondaryAction href="/messages" icon={ShieldAlert} label="Issue" />;
  return (
    <Link className="touch-target inline-flex w-full items-center justify-center gap-2 rounded-xl border border-danger/35 bg-danger/10 px-4 py-3 text-sm font-black text-danger" href="/messages">
      <ShieldAlert className="size-5" />
      Report issue
    </Link>
  );
}

export function EmptyJobState() {
  return (
    <div className="rounded-[22px] border border-border bg-card p-5 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border bg-card-strong">
        <BriefcaseBusiness className="size-6 text-primary" />
      </div>
      <h2 className="mt-3 text-lg font-black">No active job</h2>
      <p className="mt-1 text-sm leading-5 text-muted">Stay online with GPS active to receive nearby service offers.</p>
    </div>
  );
}

export function OfflineState() {
  return (
    <div className="rounded-[22px] border border-border bg-card p-5">
      <Pill tone="muted" icon={LocateFixed}>Offline</Pill>
      <h2 className="mt-4 text-2xl font-black">You are unavailable</h2>
      <p className="mt-2 text-sm leading-5 text-muted">Go online when you are ready for dispatch. ClueXP will pause offer alerts while offline.</p>
      <div className="mt-4">
        <PrimaryButton href="/settings"><Check className="size-5" />Go online</PrimaryButton>
      </div>
    </div>
  );
}

export function LoadingJobSkeleton() {
  return (
    <div className="space-y-3 rounded-[22px] border border-border bg-card p-4">
      <div className="h-7 w-32 animate-pulse rounded-full bg-card-strong" />
      <div className="h-8 w-4/5 animate-pulse rounded bg-card-strong" />
      <div className="h-4 w-3/5 animate-pulse rounded bg-card-strong" />
      <div className="grid grid-cols-3 gap-2">
        <div className="h-16 animate-pulse rounded-xl bg-card-strong" />
        <div className="h-16 animate-pulse rounded-xl bg-card-strong" />
        <div className="h-16 animate-pulse rounded-xl bg-card-strong" />
      </div>
    </div>
  );
}

export function MiniStat({ label, tone = "muted", value }: { label: string; value: string; tone?: PillTone }) {
  return (
    <div className={cx("min-w-0 rounded-xl border p-3", toneClass(tone))}>
      <div className="truncate text-[10px] font-black uppercase opacity-80">{label}</div>
      <div className="mt-1 truncate text-base font-black leading-none">{value}</div>
    </div>
  );
}

export function ProfileStrip({ profile = technicianAppProfile }: { profile?: TechnicianAppProfile }) {
  const providerLabel = currentTechnician.provider_type === "affiliated" ? "Affiliated technician" : "Individual technician";
  return (
    <div className="mb-4 rounded-[22px] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Pill tone={profile.availability === "online" ? "success" : "muted"}>{profile.availability}</Pill>
          <h1 className="mt-3 text-3xl font-black leading-none">{currentTechnician.display_name}</h1>
          <p className="mt-1 text-sm text-muted">{providerLabel} · {currentTechnician.service_area}</p>
        </div>
        <div className="flex size-14 items-center justify-center rounded-2xl bg-card-strong text-xl font-black">{currentTechnician.initials}</div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="GPS" value={profile.gps_state === "tracking_active" ? "Live" : "Check"} tone="success" />
        <MiniStat label="Alarm" value={profile.alarm_state === "sound_enabled" ? "On" : "Muted"} tone="warn" />
        <MiniStat label="Auto" value={profile.auto_accept ? "On" : "Off"} />
      </div>
    </div>
  );
}

export function ControlsRow({ profile = technicianAppProfile }: { profile?: TechnicianAppProfile }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3">
      <button className="touch-target rounded-xl border border-success/30 bg-success/12 px-3 py-3 text-left text-sm font-black text-success">
        <LocateFixed className="mb-2 size-5" />
        GPS {profile.gps_state === "tracking_active" ? "live" : "check"}
      </button>
      <button className="touch-target rounded-xl border border-border bg-card px-3 py-3 text-left text-sm font-black">
        <Sparkles className="mb-2 size-5 text-primary" />
        Auto accept {profile.auto_accept ? "on" : "off"}
      </button>
    </div>
  );
}

export function JobAccessIcon({ accessType }: { accessType: Job["access_type"] }) {
  const Icon = accessType === "home" ? Home : accessType === "business" ? BriefcaseBusiness : Car;
  return (
    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-card-strong">
      <Icon className="size-6 text-primary" />
    </div>
  );
}

export function IncomingOffer({ offer, job }: { offer: TechnicianAppOffer; job: Job }) {
  const superseded = offer.status === "superseded";
  return (
    <div className="flex min-h-full flex-col bg-background px-4 pb-5 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <Pill tone={superseded ? "danger" : "warn"} icon={superseded ? AlertTriangle : BellRing}>
          {superseded ? "Offer closed" : "Incoming offer"}
        </Pill>
        <Pill tone="muted">First accept wins</Pill>
      </div>
      <FieldMapPanel job={job} compact />
      <div className="mt-4">
        <JobOfferCard offer={offer} />
      </div>
    </div>
  );
}

export function ActiveJobHeader({ job, stage }: { job: Job; stage: string }) {
  return (
    <div className="mb-4 rounded-[22px] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Pill tone="success" icon={ShieldCheck}>Matched customer</Pill>
          <h1 className="mt-3 text-3xl font-black leading-none">{stage}</h1>
          <p className="mt-2 text-sm leading-5 text-muted">{job.situation} · {job.customer_display}</p>
        </div>
        <JobAccessIcon accessType={job.access_type} />
      </div>
      <div className="mt-4 rounded-xl border border-border bg-card-strong p-3">
        <div className="text-xs font-black uppercase text-muted">Address</div>
        <div className="mt-1 text-base font-black">{job.address}</div>
      </div>
    </div>
  );
}

export function Stepper({ active }: { active: number }) {
  const steps = ["Accept", "Drive", "Arrive", "Service", "Approve", "Done"];
  return (
    <div className="mb-4 grid grid-cols-6 gap-1 rounded-xl border border-border bg-card p-2">
      {steps.map((step, index) => (
        <div className="min-w-0" key={step}>
          <div className={cx("h-1.5 rounded-full", index <= active ? "bg-primary" : "bg-card-strong")} />
          <div className={cx("mt-1 truncate text-center text-[10px] font-black", index <= active ? "text-primary" : "text-muted")}>{step}</div>
        </div>
      ))}
    </div>
  );
}

export function MockMap({ job, mode = "route" }: { job?: Job; mode?: "route" | "fleet" }) {
  return <FieldMapPanel job={job} mode={mode} compact />;
}

export function ActionList({ items }: { items: Array<{ href: string; icon: LucideIcon; label: string; sub?: string }> }) {
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link className="touch-target flex items-center gap-3 rounded-xl border border-border bg-card-strong p-3 transition hover:border-primary/45" href={item.href} key={item.href}>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card">
              <Icon className="size-5 text-primary" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black">{item.label}</span>
              {item.sub ? <span className="block truncate text-xs text-muted">{item.sub}</span> : null}
            </span>
            <ChevronRight className="size-5 text-muted" />
          </Link>
        );
      })}
    </div>
  );
}

export function ChatPreview({ full = false }: { full?: boolean }) {
  const rows = [
    ["Customer", "I am near the north garage entrance."],
    ["You", "Thanks. I can only contact you through ClueXP masked chat."],
    ["System", "Exact customer phone remains mediated for privacy."]
  ];
  return (
    <div className="space-y-3">
      {rows.map(([who, text], index) => (
        <div className={cx("max-w-[86%] rounded-2xl border p-3", who === "You" ? "ml-auto border-primary/35 bg-primary/15" : "border-border bg-card-strong")} key={index}>
          <div className="text-[10px] font-black uppercase text-muted">{who}</div>
          <div className="mt-1 text-sm leading-5">{text}</div>
        </div>
      ))}
      {full ? (
        <div className="sticky bottom-0 flex gap-2 rounded-2xl border border-border bg-card p-2">
          <div className="flex-1 rounded-xl bg-card-strong px-3 py-3 text-sm text-muted">Type masked message</div>
          <button className="touch-target flex items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-label="Send message">
            <MessageCircle className="size-5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CallPanel() {
  return (
    <div className="flex min-h-[620px] flex-col items-center justify-center rounded-[22px] border border-border bg-card p-5 text-center">
      <div className="flex size-24 items-center justify-center rounded-full border border-primary/30 bg-primary/15">
        <Phone className="size-10 text-primary" />
      </div>
      <h1 className="mt-6 text-3xl font-black leading-none">Masked Internet Call</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Demo call state. Production should use a provider such as Twilio/WebRTC and keep customer contact mediated.</p>
      <div className="mt-8 grid w-full grid-cols-3 gap-3">
        <button className="touch-target rounded-xl border border-border bg-card-strong p-3"><Mic className="mx-auto size-5" /><span className="mt-1 block text-xs font-black">Mute</span></button>
        <button className="touch-target rounded-xl bg-danger p-3 text-[#250606]"><Phone className="mx-auto size-5" /><span className="mt-1 block text-xs font-black">End</span></button>
        <button className="touch-target rounded-xl border border-border bg-card-strong p-3"><Radio className="mx-auto size-5" /><span className="mt-1 block text-xs font-black">Route</span></button>
      </div>
    </div>
  );
}

export function ComplianceRow({ label, status, date }: { date: string; label: string; status: "verified" | "expiring" | "pending" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card-strong p-3">
      <FileCheck2 className={cx("size-5", status === "verified" ? "text-success" : "text-warn")} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-black">{label}</div>
        <div className="text-xs text-muted">{date}</div>
      </div>
      <Pill tone={status === "verified" ? "success" : "warn"}>{status}</Pill>
    </div>
  );
}

export function EmptyState({ icon: Icon = AlertTriangle, text, title }: { icon?: LucideIcon; text: string; title: string }) {
  return (
    <div className="rounded-[22px] border border-border bg-card p-5 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-card-strong">
        <Icon className="size-6 text-primary" />
      </div>
      <h2 className="mt-3 text-lg font-black">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-muted">{text}</p>
    </div>
  );
}

export function ActiveJobShortcut() {
  const job = jobById(activeTechnicianJobIds()[0]);
  if (!job) return null;
  return <ActiveJobCard job={job} />;
}

export function humanStatus(status: Job["console_status"]) {
  return status.replaceAll("_", " ");
}

export function technicianStatus(status: Job["console_status"]) {
  const labels: Partial<Record<Job["console_status"], string>> = {
    accepted: "Accepted",
    en_route: "En route",
    arrived: "On site",
    in_service: "Service",
    completed: "Done",
    cancelled: "Closed"
  };
  return labels[status] ?? humanStatus(status);
}

export function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const icons = {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  Headphones,
  MessageCircle,
  Navigation,
  Phone,
  Route,
  ShieldCheck,
  Users
};

export { currentTechnician, technicianSession };
