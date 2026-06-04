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
  Headphones,
  Home,
  KeyRound,
  LocateFixed,
  LockKeyhole,
  MessageCircle,
  Mic,
  Navigation,
  Phone,
  Radio,
  Route,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav, Countdown } from "./client-widgets";
import { GoogleMapView } from "./google-map";
import type { MapPoint } from "./google-map";

type PillTone = "default" | "success" | "warn" | "danger" | "info" | "muted";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toneClass(tone: PillTone) {
  if (tone === "success") return "border-success/30 bg-success/12 text-success";
  if (tone === "warn") return "border-warn/35 bg-warn/12 text-warn";
  if (tone === "danger") return "border-danger/35 bg-danger/12 text-danger";
  if (tone === "info") return "border-info/35 bg-info/12 text-info";
  if (tone === "muted") return "border-border bg-card-strong text-muted";
  return "border-primary/35 bg-primary/14 text-primary";
}

export function AppFrame({
  children,
  nav = true,
  title = "ClueXP Tech"
}: {
  children: ReactNode;
  nav?: boolean;
  title?: string;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[460px] flex-col bg-background shadow-[0_0_0_1px_rgba(255,255,255,.05),0_36px_120px_rgba(0,0,0,.55)] md:my-6 md:min-h-[920px] md:overflow-hidden md:rounded-[2rem]">
      <PhoneStatus title={title} />
      <div className={cx("flex-1 overflow-hidden", nav && "pb-[88px]")}>{children}</div>
      {nav ? <BottomNav /> : null}
    </main>
  );
}

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

export function PhoneStatus({ title }: { title: string }) {
  return (
    <div className="safe-top sticky top-0 z-30 border-b border-white/5 bg-background/94 px-4 pb-3 backdrop-blur">
      <div className="mb-3 flex items-center justify-between text-[11px] font-semibold text-muted">
        <span>9:41</span>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-[2px] border border-muted/70">
            <span className="block h-full w-3 rounded-[1px] bg-success" />
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LockKeyhole className="size-5" />
          </div>
          <div>
            <div className="font-condensed text-xl font-bold uppercase leading-none">{title}</div>
            <div className="text-[11px] font-semibold uppercase text-muted">{technicianAppProfile.workspace_label} · {technicianSession.active_role}</div>
          </div>
        </div>
        <Link className="touch-target flex items-center justify-center rounded-full border border-border bg-card" href="/settings" aria-label="Settings">
          <SlidersHorizontal className="size-5 text-muted" />
        </Link>
      </div>
    </div>
  );
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
    <section className="mb-4 rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-condensed text-xl font-bold uppercase leading-none">{title}</h2>
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
    <span className={cx("inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold", toneClass(tone))}>
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </span>
  );
}

export function PrimaryButton({
  children,
  href,
  tone = "primary"
}: {
  children: ReactNode;
  href: string;
  tone?: "primary" | "secondary" | "danger";
}) {
  return (
    <Link
      className={cx(
        "touch-target inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition",
        tone === "primary" && "bg-primary text-primary-foreground hover:bg-[#ffd34f]",
        tone === "secondary" && "border border-border bg-card-strong text-foreground hover:border-primary/45",
        tone === "danger" && "bg-danger text-[#250606] hover:bg-[#ff8c8c]"
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

export function ProfileStrip({ profile = technicianAppProfile }: { profile?: TechnicianAppProfile }) {
  const providerLabel = currentTechnician.provider_type === "affiliated" ? "Affiliated technician" : "Individual technician";
  return (
    <div className="mb-4 rounded-2xl border border-primary/20 bg-[linear-gradient(140deg,rgba(255,191,0,.16),rgba(27,31,38,.88)_42%,rgba(98,168,255,.10))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-primary">{profile.availability === "online" ? "Ready for dispatch" : profile.availability}</p>
          <h1 className="mt-1 font-condensed text-4xl font-bold uppercase leading-none">{currentTechnician.display_name}</h1>
          <p className="mt-1 text-sm text-muted">{providerLabel} · {currentTechnician.service_area} service area</p>
        </div>
        <div className="flex size-14 items-center justify-center rounded-2xl bg-card-strong text-xl font-bold">{currentTechnician.initials}</div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="GPS" value={profile.gps_state === "tracking_active" ? "Live" : "Check"} tone="success" />
        <MiniStat label="Alarm" value={profile.alarm_state === "sound_enabled" ? "On" : "Muted"} tone="warn" />
        <MiniStat label="Auto" value={profile.auto_accept ? "On" : "Off"} tone="muted" />
      </div>
    </div>
  );
}

export function MiniStat({ label, tone = "muted", value }: { label: string; value: string; tone?: PillTone }) {
  return (
    <div className={cx("rounded-xl border p-3", toneClass(tone))}>
      <div className="text-[10px] font-bold uppercase opacity-80">{label}</div>
      <div className="mt-1 text-lg font-bold leading-none">{value}</div>
    </div>
  );
}

export function ControlsRow({ profile = technicianAppProfile }: { profile?: TechnicianAppProfile }) {
  const gpsLive = profile.gps_state === "tracking_active";
  const autoAccept = profile.auto_accept;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3">
      <button className={cx("touch-target rounded-xl border px-3 py-3 text-left text-sm font-bold", gpsLive ? "border-success/30 bg-success/12 text-success" : "border-warn/35 bg-warn/12 text-warn")}>
        <LocateFixed className="mb-2 size-5" />
        GPS {gpsLive ? "tracking active" : "needs check"}
      </button>
      <button className={cx("touch-target rounded-xl border px-3 py-3 text-left text-sm font-bold", autoAccept ? "border-primary/35 bg-primary/14 text-primary" : "border-border bg-card text-foreground")}>
        <Sparkles className="mb-2 size-5 text-primary" />
        Auto accept {autoAccept ? "on" : "off"}
      </button>
    </div>
  );
}

export function OfferCard({ offer }: { offer: TechnicianAppOffer }) {
  const job = jobById(offer.job_id);
  const superseded = offer.status === "superseded";
  return (
    <Link
      className={cx(
        "mb-3 block rounded-xl border bg-card p-4 transition hover:border-primary/50",
        superseded ? "border-danger/35 opacity-75" : "border-border"
      )}
      href={`/offer/${offer.offer_id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Pill tone={offer.source === "cluexp" ? "default" : "info"} icon={offer.source === "cluexp" ? Headphones : BriefcaseBusiness}>
              {offer.source_label}
            </Pill>
            {offer.team_label ? <Pill tone="muted" icon={Users}>{offer.team_label}</Pill> : null}
          </div>
          <h3 className="mt-3 text-lg font-bold">{job?.access_type ?? "access"} · {job?.area ?? "Service area"}</h3>
          <p className="mt-1 text-sm text-muted">{superseded ? offer.superseded_by : "Customer detail hidden until backend confirms assignment."}</p>
        </div>
        <ChevronRight className="mt-1 size-5 shrink-0 text-muted" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="Distance" value={`${offer.distance_mi}mi`} />
        <MiniStat label="ETA" value={`${offer.eta_min}m`} />
        <MiniStat label="Earnings" value={offer.estimated_earnings ?? "TBD"} tone="warn" />
      </div>
    </Link>
  );
}

export function ActiveJobCard({ job }: { job: Job }) {
  return (
    <Link className="mb-3 block rounded-xl border border-primary/30 bg-card p-4 transition hover:border-primary" href={`/jobs/${job.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Pill tone="success" icon={Navigation}>Active · {humanStatus(job.console_status)}</Pill>
          <h3 className="mt-3 text-xl font-bold">{job.situation}</h3>
          <p className="mt-1 text-sm text-muted">{job.customer_display} · {job.address}</p>
        </div>
        <JobAccessIcon accessType={job.access_type} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="ETA" value={`${job.eta_min ?? "--"}m`} tone="info" />
        <MiniStat label="Status" value={technicianStatus(job.console_status)} tone="success" />
        <MiniStat label="Age" value={`${job.age_min}m`} />
      </div>
    </Link>
  );
}

export function JobAccessIcon({ accessType }: { accessType: Job["access_type"] }) {
  const Icon = accessType === "home" ? Home : accessType === "business" ? BriefcaseBusiness : Car;
  return (
    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-card-strong">
      <Icon className="size-6 text-primary" />
    </div>
  );
}

export function IncomingOffer({ offer, job }: { offer: TechnicianAppOffer; job: Job }) {
  const superseded = offer.status === "superseded";
  if (superseded) {
    return (
      <div className="flex min-h-full flex-col bg-[radial-gradient(circle_at_top,rgba(255,100,100,.20),transparent_21rem),#0b0d10] px-4 pb-5 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <Pill tone="danger" icon={AlertTriangle}>Offer closed</Pill>
          <Pill tone="muted">First accept wins</Pill>
        </div>
        <div className="flex flex-1 flex-col justify-center">
          <div className="rounded-[1.5rem] border border-danger/35 bg-card/92 p-5 shadow-2xl shadow-danger/10">
            <div className="flex size-16 items-center justify-center rounded-2xl border border-danger/35 bg-danger/12 text-danger">
              <X className="size-8" />
            </div>
            <h1 className="mt-5 font-condensed text-5xl font-bold uppercase leading-none">Another tech accepted first</h1>
            <p className="mt-3 text-base leading-6 text-muted">{offer.superseded_by ?? "This offer was closed by the backend before you accepted."}</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <MiniStat label="Area" value={job.area} />
              <MiniStat label="ETA" value={`${offer.eta_min}m`} tone="muted" />
              <MiniStat label="Pay" value={offer.estimated_earnings ?? "TBD"} tone="muted" />
            </div>
            <div className="mt-5 rounded-xl border border-border bg-card-strong p-3 text-sm leading-5 text-muted">
              The backend prevents duplicate assignment. Return to Jobs for the next available offer.
            </div>
          </div>
        </div>
        <div className="mt-4">
          <PrimaryButton href="/jobs"><ChevronRight className="size-5" />Back to jobs</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-[radial-gradient(circle_at_top,rgba(255,191,0,.20),transparent_21rem),#0b0d10] px-4 pb-5 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <Pill tone="warn" icon={BellRing}>Incoming offer</Pill>
        <Pill tone="muted">Backend timer</Pill>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <div className="rounded-[1.5rem] border border-primary/35 bg-card/92 p-5 shadow-2xl shadow-primary/10">
          <Countdown expiresAt={offer.expires_at} />
          <div className="mt-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase text-primary">{offer.source_label}</p>
              <h1 className="mt-2 font-condensed text-5xl font-bold uppercase leading-none">{job.access_type} lockout</h1>
              <p className="mt-3 text-base leading-6 text-muted">{job.situation} · {job.area}</p>
            </div>
            <JobAccessIcon accessType={job.access_type} />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <MiniStat label="Distance" value={`${offer.distance_mi}mi`} tone="info" />
            <MiniStat label="ETA" value={`${offer.eta_min}m`} tone="success" />
            <MiniStat label="Pay" value={offer.estimated_earnings ?? "TBD"} tone="warn" />
          </div>
          <div className="mt-5 rounded-xl border border-info/35 bg-info/10 p-3 text-sm leading-5 text-info">
            Customer name, exact address, and contact stay hidden until the backend confirms you are the assigned technician.
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_1fr] gap-3">
        <PrimaryButton href={`/offer/${offer.offer_id}/decline`} tone="secondary"><X className="size-5" />Decline</PrimaryButton>
        <PrimaryButton href={`/jobs/${offer.job_id}`}><Check className="size-5" />Accept</PrimaryButton>
      </div>
    </div>
  );
}

export function ActiveJobHeader({ job, stage }: { job: Job; stage: string }) {
  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Pill tone="success" icon={ShieldCheck}>Matched customer</Pill>
          <h1 className="mt-3 font-condensed text-4xl font-bold uppercase leading-none">{stage}</h1>
          <p className="mt-2 text-sm leading-5 text-muted">{job.situation} · {job.customer_display}</p>
        </div>
        <JobAccessIcon accessType={job.access_type} />
      </div>
      <div className="mt-4 rounded-xl border border-border bg-card-strong p-3">
        <div className="text-xs font-bold uppercase text-muted">Address</div>
        <div className="mt-1 text-base font-bold">{job.address}</div>
      </div>
    </div>
  );
}

export function Stepper({ active }: { active: number }) {
  const steps = ["Accept", "Drive", "Arrive", "Service", "Approve", "Done"];
  return (
    <div className="mb-4 flex items-center gap-1 overflow-hidden rounded-xl border border-border bg-card p-2">
      {steps.map((step, index) => (
        <div className="min-w-0 flex-1" key={step}>
          <div className={cx("h-1.5 rounded-full", index <= active ? "bg-primary" : "bg-card-strong")} />
          <div className={cx("mt-1 truncate text-center text-[10px] font-bold uppercase", index <= active ? "text-primary" : "text-muted")}>{step}</div>
        </div>
      ))}
    </div>
  );
}

// Decorative mock-map layer — the fallback shown when no browser Maps key is
// configured (or the Maps script fails to load). No overlay here; MockMap owns it.
function MockMapVisual() {
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 opacity-80 [background-image:linear-gradient(135deg,rgba(98,168,255,.13)_1px,transparent_1px),linear-gradient(45deg,rgba(255,191,0,.10)_1px,transparent_1px)] [background-size:46px_46px,32px_32px]" />
      <div className="absolute left-10 right-8 top-28 h-1 rotate-[-18deg] rounded-full bg-primary" />
      <div className="absolute left-28 right-14 top-48 h-1 rotate-[10deg] rounded-full bg-info/80" />
      <span className="absolute left-[20%] top-[62%] flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25">
        <Navigation className="size-5" />
      </span>
      <span className="absolute right-[20%] top-[22%] flex size-10 items-center justify-center rounded-full bg-info text-[#05192e] shadow-lg shadow-info/25">
        <KeyRound className="size-5" />
      </span>
    </div>
  );
}

export function MockMap({ job, mode = "route" }: { job?: Job; mode?: "route" | "fleet" }) {
  // Build map points from the job's coordinates. In route mode, place a technician
  // origin offset from the destination (mock GPS — no live position yet, no fake movement).
  const points: MapPoint[] = [];
  if (typeof job?.lat === "number" && typeof job?.lng === "number") {
    if (mode === "route") {
      points.push({ lat: job.lat + 0.012, lng: job.lng - 0.014, kind: "tech", label: "You" });
    }
    points.push({ lat: job.lat, lng: job.lng, kind: "job", label: job.customer_display });
  }
  return (
    <div className="relative mb-4 h-[310px] overflow-hidden rounded-2xl border border-border bg-[#101720]">
      <GoogleMapView points={points} connect={mode === "route"} fallback={<MockMapVisual />} />
      <div className="absolute bottom-3 left-3 right-3 rounded-xl border border-border bg-background/90 p-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase text-muted">{mode === "fleet" ? "Field map" : "Next stop"}</div>
            <div className="font-bold">{job?.area ?? "Downtown"} · {job?.eta_min ?? 7} min ETA</div>
          </div>
          <Pill tone="success" icon={LocateFixed}>GPS live</Pill>
        </div>
      </div>
    </div>
  );
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
              <span className="block text-sm font-bold">{item.label}</span>
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
          <div className="text-[10px] font-bold uppercase text-muted">{who}</div>
          <div className="mt-1 text-sm leading-5">{text}</div>
        </div>
      ))}
      {full ? (
        <div className="sticky bottom-0 flex gap-2 rounded-2xl border border-border bg-card p-2">
          <div className="flex-1 rounded-xl bg-card-strong px-3 py-3 text-sm text-muted">Type masked message</div>
          <button className="touch-target flex items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-label="Send message">
            <Send className="size-5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CallPanel() {
  return (
    <div className="flex min-h-[620px] flex-col items-center justify-center rounded-[1.5rem] border border-border bg-[radial-gradient(circle_at_top,rgba(98,168,255,.16),transparent_20rem),#15181d] p-5 text-center">
      <div className="flex size-24 items-center justify-center rounded-full border border-primary/30 bg-primary/15">
        <Phone className="size-10 text-primary" />
      </div>
      <h1 className="mt-6 font-condensed text-4xl font-bold uppercase leading-none">Masked Internet Call</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Demo call state. Production should use a provider such as Twilio/WebRTC and keep customer contact mediated.</p>
      <div className="mt-8 grid w-full grid-cols-3 gap-3">
        <button className="touch-target rounded-xl border border-border bg-card-strong p-3"><Mic className="mx-auto size-5" /><span className="mt-1 block text-xs font-bold">Mute</span></button>
        <button className="touch-target rounded-xl bg-danger p-3 text-[#250606]"><Phone className="mx-auto size-5" /><span className="mt-1 block text-xs font-bold">End</span></button>
        <button className="touch-target rounded-xl border border-border bg-card-strong p-3"><Radio className="mx-auto size-5" /><span className="mt-1 block text-xs font-bold">Route</span></button>
      </div>
    </div>
  );
}

export function ComplianceRow({ label, status, date }: { date: string; label: string; status: "verified" | "expiring" | "pending" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card-strong p-3">
      <FileCheck2 className={cx("size-5", status === "verified" ? "text-success" : "text-warn")} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{label}</div>
        <div className="text-xs text-muted">{date}</div>
      </div>
      <Pill tone={status === "verified" ? "success" : "warn"}>{status}</Pill>
    </div>
  );
}

export function EmptyState({ icon: Icon = AlertTriangle, text, title }: { icon?: LucideIcon; text: string; title: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-card-strong">
        <Icon className="size-6 text-primary" />
      </div>
      <h2 className="mt-3 text-lg font-bold">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-muted">{text}</p>
    </div>
  );
}

export function ActiveJobShortcut() {
  const job = jobById(activeTechnicianJobIds[0]);
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
  Headphones,
  MessageCircle,
  Navigation,
  Phone,
  Route,
  ShieldCheck,
  Users
};

export { currentTechnician };
