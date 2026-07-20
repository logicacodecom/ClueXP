"use client";

import {
  AlertTriangle,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Image as ImageIcon,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldCheck,
  Wrench,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { GoogleMapView, type MapPoint } from "./google-map";
import { activeJobActionItems } from "./technician-app-chrome";

const PAYMENT_METHODS = [
  { value: "credit_card", label: "Card reader" },
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "zelle", label: "Zelle" },
  { value: "other", label: "Other" }
];

const CLOSEOUT_ITEM_TYPES = [
  { value: "service_fee", label: "Service fee", taxable: true },
  { value: "labor", label: "Labor", taxable: true },
  { value: "diagnostic", label: "Diagnostic", taxable: true },
  { value: "physical_part", label: "Physical part", taxable: true, requiresProvidedBy: true },
  { value: "hardware", label: "Hardware", taxable: true, requiresProvidedBy: true },
  { value: "key_code_purchase", label: "Key code purchase", taxable: false, requiresProvidedBy: true, requiresNote: true },
  { value: "third_party_service", label: "Third-party service", taxable: false, requiresProvidedBy: true, requiresNote: true },
  { value: "other", label: "Other", taxable: true, requiresProvidedBy: true, requiresNote: true }
];

type CloseoutLineDraft = {
  id: string;
  item_type_code: string;
  description: string;
  quantity: string;
  unit_amount: string;
  taxable: boolean;
  provided_by: string;
  note: string;
};

export type IntakePhoto = { url: string; label?: string | null };
export type RecordedCollectionItem = { description: string; amount?: number | null; provided_by?: string | null };

export type TechnicianJob = {
  id: string;
  status: "assigned" | "en_route" | "arrived" | "in_progress" | "completed_pending_customer" | "completed_confirmed" | "completed_auto_closed" | "disputed";
  access_type?: string | null;
  situation?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  // Optional display fields. The active-job BFF route (`/api/active-job`) passes the
  // backend body through unchanged, so each renders as soon as the API includes it —
  // and stays silently absent until then. See the Codex handoff note for the contract.
  service_type?: string | null; // canonical service / job type
  eta_min?: number | null; // ETA to the customer
  eta_max?: number | null; // ETA upper bound (ETA is a range, not a point)
  distance_mi?: number | null; // distance away (miles)
  distance_km?: number | null; // distance away (km fallback)
  intake_photos?: IntakePhoto[] | null; // customer-uploaded intake photos
  collection_items?: RecordedCollectionItem[] | null; // server-recorded collection lines
  collection_total?: number | null;
  collection_currency?: string | null; // ISO currency for collection amounts
  approval_status?: "pending" | "approved" | "disputed" | "expired" | null; // customer approval
  approval_url?: string | null; // customer approval / tracking link
  technician_location_updated_at?: string | null; // when the server last received a fix
  technician_location_is_fresh?: boolean | null; // server's view of location freshness
  customer_name?: string | null;
  customer_phone?: string | null;
  detail?: Record<string, unknown> | null;
};

function humanizeCode(value: string) {
  const text = value.replaceAll("_", " ").replace(/\s+/g, " ").trim().toLowerCase();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function serviceLabel(job: TechnicianJob) {
  const raw = job.service_type?.trim() || job.situation || "Service request";
  return raw.split(".").filter(Boolean).map(humanizeCode).join(" · ");
}

function distanceLabel(job: TechnicianJob) {
  if (job.distance_mi != null) return `${job.distance_mi} mi`;
  if (job.distance_km != null) return `${job.distance_km.toFixed(1)} km`;
  return null;
}

function etaLabel(job: TechnicianJob) {
  if (job.eta_min == null) return null;
  if (job.eta_max != null && job.eta_max !== job.eta_min) return `${job.eta_min}–${job.eta_max} min`;
  return `${job.eta_min} min`;
}

function money(amount: number, currency?: string | null) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

type LocationState =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "ready"; lat: number; lng: number; accuracy: number; savedAt: string }
  | { state: "error"; detail: string };

type Sheet = "messages" | "call" | "safety" | "more" | null;

const stages: Array<{ status: TechnicianJob["status"]; label: string; heading: string }> = [
  { status: "assigned", label: "Depart", heading: "Ready to depart" },
  { status: "en_route", label: "En route", heading: "Driving to customer" },
  { status: "arrived", label: "On site", heading: "At the location" },
  { status: "in_progress", label: "Service", heading: "Service underway" },
  { status: "completed_pending_customer", label: "Review", heading: "Waiting for customer" }
];

function newCloseoutLine(itemType = "service_fee"): CloseoutLineDraft {
  const spec = CLOSEOUT_ITEM_TYPES.find((item) => item.value === itemType) ?? CLOSEOUT_ITEM_TYPES[0];
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    item_type_code: spec.value,
    description: "",
    quantity: "1",
    unit_amount: "",
    taxable: spec.taxable,
    provided_by: "",
    note: ""
  };
}

function moneyValue(value: string) {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? amount : 0;
}

function closeoutLineError(line: CloseoutLineDraft, index = 0) {
  const spec = CLOSEOUT_ITEM_TYPES.find((item) => item.value === line.item_type_code) ?? CLOSEOUT_ITEM_TYPES[0];
  if (!line.description.trim()) return `Item ${index + 1}: add a customer receipt description.`;
  if (moneyValue(line.quantity || "1") <= 0) return `${spec.label}: quantity must be greater than zero.`;
  if (!line.unit_amount.trim() || moneyValue(line.unit_amount) < 0) return `${spec.label}: enter an amount.`;
  if (spec.requiresProvidedBy && !line.provided_by) return `${spec.label}: choose who provided it.`;
  return null;
}

function closeoutFormError(lines: CloseoutLineDraft[], method: string) {
  const lineIssue = lines.map((line, index) => closeoutLineError(line, index)).find(Boolean);
  if (lineIssue) return lineIssue;
  if (!method) return "Choose how the money was collected.";
  return null;
}

function stringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nextStatus(status: TechnicianJob["status"]): TechnicianJob["status"] | null {
  if (status === "assigned") return "en_route";
  if (status === "arrived") return "in_progress";
  if (status === "in_progress") return "completed_pending_customer";
  return null;
}

function stageForJob(status: TechnicianJob["status"]) {
  return stages.find((item) => item.status === status) ?? stages[stages.length - 1];
}

function stageIndexForJob(status: TechnicianJob["status"]) {
  const index = stages.findIndex((item) => item.status === status);
  return index >= 0 ? index : stages.length - 1;
}

function formatSyncAge(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  return seconds < 60 ? `${seconds} s ago` : `${Math.floor(seconds / 60)} min ago`;
}

export function ActiveJobWorkflow({ initialJob }: { initialJob: TechnicianJob }) {
  const [job, setJob] = useState(initialJob);
  const [online, setOnline] = useState(true);
  const [location, setLocation] = useState<LocationState>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState("");
  const pinInput = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [issueKind, setIssueKind] = useState<string | null>(null);
  const [issueReason, setIssueReason] = useState("");
  const [issueDone, setIssueDone] = useState(false);
  const [closeoutOpen, setCloseoutOpen] = useState(false);
  const [collectMethod, setCollectMethod] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [closeoutLines, setCloseoutLines] = useState<CloseoutLineDraft[]>(() => [newCloseoutLine()]);
  const [collectDone, setCollectDone] = useState(() => Boolean(initialJob.collection_items?.length));
  const [refreshingLoc, setRefreshingLoc] = useState(false);
  const currentIndex = stageIndexForJob(job.status);
  const stage = stageForJob(job.status);

  const refreshJob = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) return window.location.assign("/signin");
      if (response.status === 404) return window.location.assign("/jobs");
      if (!response.ok) throw new Error(body.detail || "Unable to refresh this job");
      const nextJob = body as TechnicianJob;
      setJob(nextJob);
      if (nextJob.collection_items?.length) setCollectDone(true);
      setError(null);
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : "Unable to refresh this job");
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [job.id]);

  useEffect(() => {
    const syncOnline = () => setOnline(navigator.onLine);
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => void refreshJob(true), 15_000);
    const onFocus = () => void refreshJob(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshJob]);

  useEffect(() => {
    if (!pinMode) return;
    const id = window.setTimeout(() => pinInput.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [pinMode]);

  const shareLocation = useCallback(async (): Promise<boolean> => {
    if (!navigator.geolocation) {
      setLocation({ state: "error", detail: "Location is not available on this device." });
      return false;
    }
    setLocation({ state: "saving" });
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          const response = await fetch("/api/location", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.detail || "Location could not be saved");
          setLocation({
            state: "ready",
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            savedAt: body.last_location_at || new Date().toISOString()
          });
          resolve(true);
        } catch (cause) {
          setLocation({ state: "error", detail: cause instanceof Error ? cause.message : "Location could not be saved" });
          resolve(false);
        }
      }, (failure) => {
        const detail = failure.code === failure.PERMISSION_DENIED
          ? "Allow precise location access to start the route."
          : failure.code === failure.TIMEOUT
            ? "Location timed out. Move to an open area and retry."
            : "Your current location is unavailable.";
        setLocation({ state: "error", detail });
        resolve(false);
      }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 });
    });
  }, []);

  useEffect(() => {
    if (!["en_route", "arrived", "in_progress"].includes(job.status)) return;
    void shareLocation();
    const id = window.setInterval(() => void shareLocation(), 25_000);
    return () => window.clearInterval(id);
  }, [job.status, shareLocation]);

  // Manual location refresh: push a fresh fix, then re-pull the job so the
  // server-authoritative "dispatch sees your location" line updates.
  const refreshLocation = useCallback(async () => {
    if (refreshingLoc) return;
    setRefreshingLoc(true);
    try {
      await shareLocation();
      await refreshJob(true);
    } finally {
      setRefreshingLoc(false);
    }
  }, [refreshingLoc, shareLocation, refreshJob]);

  const points = useMemo(() => {
    const next: MapPoint[] = [];
    if (location.state === "ready") next.push({ lat: location.lat, lng: location.lng, kind: "tech", label: "Your shared location" });
    if (typeof job.lat === "number" && typeof job.lng === "number") next.push({ lat: job.lat, lng: job.lng, kind: "job", label: "Service address" });
    return next;
  }, [job.lat, job.lng, location]);

  const mapsHref = typeof job.lat === "number" && typeof job.lng === "number"
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${job.lat},${job.lng}`)}`
    : job.address
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}`
      : null;

  async function verifyArrival() {
    if (pin.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/arrival/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin })
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) return window.location.assign("/signin");
      if (!response.ok) throw new Error(body.detail || "PIN verification failed");
      setJob((current) => ({ ...current, status: "arrived" }));
      setPinMode(false);
      setPin("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PIN verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitIssue(kind = issueKind) {
    if (!kind || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/report-issue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, reason: issueReason.trim() })
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) return window.location.assign("/signin");
      if (!response.ok) throw new Error(body.detail || "Could not report the problem");
      setIssueDone(true);
      setIssueKind(null);
      setIssueReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not report the problem");
    } finally {
      setBusy(false);
    }
  }

  function updateCloseoutLine(id: string, patch: Partial<CloseoutLineDraft>) {
    setCloseoutLines((current) => current.map((line) => {
      if (line.id !== id) return line;
      const next = { ...line, ...patch };
      if (patch.item_type_code) {
        const spec = CLOSEOUT_ITEM_TYPES.find((item) => item.value === patch.item_type_code);
        if (spec) {
          next.description = "";
          next.taxable = spec.taxable;
          if (!spec.requiresProvidedBy) next.provided_by = "";
          if (!spec.requiresNote) next.note = "";
        }
      }
      return next;
    }));
  }

  const closeoutSubtotal = closeoutLines.reduce((sum, line) => sum + moneyValue(line.quantity || "1") * moneyValue(line.unit_amount), 0);

  async function reportCollection() {
    const validation = closeoutFormError(closeoutLines, collectMethod);
    if (validation) {
      setError(validation);
      return;
    }
    const lineItems = closeoutLines.map((line) => ({
      item_type_code: line.item_type_code,
      description: line.description.trim(),
      quantity: moneyValue(line.quantity || "1"),
      unit_amount: moneyValue(line.unit_amount),
      taxable: line.taxable,
      provided_by: line.provided_by || undefined,
      note: line.note.trim() || undefined
    }));
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/collection`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: collectMethod, tip_amount: moneyValue(tipAmount), line_items: lineItems })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Could not record the collection");
      setCollectDone(true);
      await refreshJob(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the collection");
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (busy) return;
    if (job.status === "en_route") {
      setPinMode(true);
      return;
    }
    if (job.status === "in_progress" && !closeoutOpen) {
      setCloseoutOpen(true);
      window.setTimeout(() => document.getElementById("closeout")?.scrollIntoView({ behavior: "smooth" }), 20);
      return;
    }
    const target = nextStatus(job.status);
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      if (job.status === "assigned" && !(await shareLocation())) return;
      const response = await fetch(`/api/tickets/${encodeURIComponent(job.id)}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: target })
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) return window.location.assign("/signin");
      if (!response.ok) throw new Error(body.detail || "The job could not be updated");
      setJob((current) => ({ ...current, status: target }));
      setCloseoutOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The job could not be updated");
    } finally {
      setBusy(false);
    }
  }

  const actionLabel = job.status === "assigned" ? "Start route"
    : job.status === "en_route" ? "Confirm arrival"
      : job.status === "arrived" ? "Start service"
        : job.status === "in_progress" && !closeoutOpen ? "Review and finish service"
          : job.status === "in_progress" ? "Submit for customer confirmation"
            : "Waiting for customer";

  const canSubmitCloseout = job.status !== "in_progress" || !closeoutOpen || collectDone;
  const mapVisible = job.status === "assigned" || job.status === "en_route";

  return (
    <div className="min-h-[100svh] bg-background pb-[178px]">
      <header className="safe-top flex min-h-12 items-center justify-between border-b border-border px-5 pb-2 font-condensed text-sm font-semibold uppercase tracking-[.08em]">
        <span className="flex items-center gap-2">
          <img className="h-5 w-auto object-contain" src="/logo.png" alt="ClueXP" />
          <span>Field</span>
        </span>
        <span className="flex items-center gap-2 text-muted"><span className={`size-2 rounded-full ${online ? "bg-success" : "bg-primary"}`} />{online ? "Online" : "Offline"}</span>
      </header>

      {mapVisible ? (
        <section className={`relative overflow-hidden border-b border-border bg-[#131417] ${job.status === "en_route" ? "h-[46svh] min-h-[340px]" : "h-[34svh] min-h-[270px]"}`}>
          <GoogleMapView points={points} connect={job.status === "en_route"} fallback={<MapFallback job={job} />} />
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-[5px] border border-border bg-background/95 px-3 py-2 text-xs font-semibold text-[#cfc8ba]">
            <span className={`size-2 rounded-full ${location.state === "ready" ? "bg-success" : location.state === "error" ? "bg-danger" : "bg-muted"}`} />
            {location.state === "ready"
              ? `GPS ±${Math.round(location.accuracy)} ft · synced ${formatSyncAge(location.savedAt)}`
              : location.state === "saving" ? "Getting precise location…" : location.state === "error" ? "Location unavailable" : "Location starts with route"}
          </div>
          {job.status === "en_route" && mapsHref ? (
            <div className="absolute bottom-3 left-3 right-3 grid grid-cols-[1fr_auto] gap-2">
              <a className="field-secondary-action" href={mapsHref} target="_blank" rel="noreferrer">Open in maps <ExternalLink className="size-4" /></a>
              <button className="field-secondary-action px-4" onClick={() => void shareLocation()} type="button" aria-label="Recenter map"><LocateFixed className="size-4" /></button>
            </div>
          ) : null}
        </section>
      ) : null}

      <main className="px-5 pt-5">
        <StageProgress current={currentIndex} />
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-condensed text-[2.2rem] font-bold uppercase leading-none tracking-[.02em]">{stage.heading}</h1>
            <p className="mt-2 text-[15px] leading-6 text-[#a39c8e]">{stageDetail(job.status)}</p>
          </div>
          <button className="touch-target flex size-11 shrink-0 items-center justify-center border border-border bg-card" disabled={busy} onClick={() => void refreshJob()} aria-label="Refresh job">
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>

        <JobTruth job={job} mapsHref={mapsHref} onRefreshLocation={refreshLocation} refreshingLoc={refreshingLoc} />
        <JobDetails job={job} />

        {location.state === "error" ? <OperationalAlert tone="danger" text={location.detail} /> : null}
        {error ? <OperationalAlert tone="danger" text={error} /> : null}
        {issueDone ? <OperationalAlert tone="success" text="Problem recorded by ClueXP. Dispatch has been notified." /> : null}

        {job.status === "arrived" ? (
          <div className="mt-4 border border-success/30 bg-success/8 p-3 text-sm text-success"><CheckCircle2 className="mr-2 inline size-4" />Arrival verified by customer PIN</div>
        ) : null}

        {job.collection_items && job.collection_items.length > 0 ? <RecordedCollection items={job.collection_items} total={job.collection_total} currency={job.collection_currency} /> : null}

        {job.status === "in_progress" && closeoutOpen ? (
          <CloseoutPanel
            id="closeout"
            lines={closeoutLines}
            subtotal={closeoutSubtotal}
            method={collectMethod}
            tip={tipAmount}
            done={collectDone}
            busy={busy}
            onAdd={() => setCloseoutLines((current) => [...current, newCloseoutLine()])}
            onRemove={(id) => setCloseoutLines((current) => current.filter((line) => line.id !== id))}
            onUpdate={updateCloseoutLine}
            onMethod={setCollectMethod}
            onTip={setTipAmount}
            onSave={() => void reportCollection()}
          />
        ) : null}

        {job.status === "completed_pending_customer" ? <PendingConfirmation job={job} /> : null}
        {job.status === "completed_confirmed" || job.status === "completed_auto_closed" || job.status === "disputed" ? <ResolvedJobState job={job} /> : null}
      </main>

      {job.status !== "completed_pending_customer" && job.status !== "completed_confirmed" && job.status !== "completed_auto_closed" && job.status !== "disputed" ? (
        <div className="fixed bottom-[86px] left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 bg-background px-4 pt-3">
          <button className="field-primary-action" disabled={busy || !canSubmitCloseout} onClick={() => void advance()} type="button">
            {busy ? <RefreshCw className="size-5 animate-spin" /> : <PrimaryActionIcon status={job.status} />}
            {busy ? "Updating…" : actionLabel}
          </button>
          {job.status === "in_progress" && closeoutOpen && !collectDone ? <p className="mt-2 text-center text-xs text-muted">Record the closeout before submitting.</p> : null}
        </div>
      ) : null}

      <ContextRail onOpen={setSheet} />
      {pinMode ? <PinSheet pin={pin} busy={busy} error={error} inputRef={pinInput} onPin={setPin} onClose={() => { setPinMode(false); setPin(""); setError(null); }} onConfirm={() => void verifyArrival()} /> : null}
      {sheet ? <ActionSheet sheet={sheet} job={job} busy={busy} issueDone={issueDone} issueKind={issueKind} issueReason={issueReason} onClose={() => setSheet(null)} onIssueKind={setIssueKind} onIssueReason={setIssueReason} onSubmitIssue={(kind) => void submitIssue(kind)} /> : null}
    </div>
  );
}

function stageDetail(status: TechnicianJob["status"]) {
  if (status === "assigned") return "Review the destination, then share your location and begin the route.";
  if (status === "en_route") return "Use your maps app for directions. Confirm arrival with the customer’s six-digit PIN.";
  if (status === "arrived") return "Review the request and authorization before beginning work.";
  if (status === "in_progress") return "Capture the work performed, then build an honest closeout record.";
  if (status === "completed_confirmed") return "The customer confirmed the closeout. You can return to available work.";
  if (status === "completed_auto_closed") return "The confirmation window expired and dispatch rules closed the job.";
  if (status === "disputed") return "The customer disputed the closeout. Dispatch must mediate before the job is resolved.";
  return "The receipt was submitted. You remain busy until the customer or dispatcher resolves it.";
}

function PrimaryActionIcon({ status }: { status: TechnicianJob["status"] }) {
  if (status === "assigned") return <Navigation className="size-5" />;
  if (status === "en_route") return <MapPin className="size-5" />;
  if (status === "arrived") return <Wrench className="size-5" />;
  return <CheckCircle2 className="size-5" />;
}

function StageProgress({ current }: { current: number }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span className="field-kicker">Stage {current + 1} of 5</span>
        <span className="flex flex-1 justify-end gap-1" aria-hidden>{stages.map((item, index) => <span className={`h-1 w-6 rounded-sm ${index <= current ? "bg-primary" : "bg-border"}`} key={item.status} />)}</span>
      </div>
    </div>
  );
}

function MapFallback({ job }: { job: TechnicianJob }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#131417]">
      <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(#1b1d21_1px,transparent_1px),linear-gradient(90deg,#1b1d21_1px,transparent_1px)] [background-size:46px_46px]" />
      <div className="absolute left-[-20%] top-[58%] h-4 w-[150%] -rotate-6 bg-[#1a1c20]" />
      <div className="absolute left-[34%] top-[-20%] h-[150%] w-3 rotate-6 bg-[#1a1c20]" />
      <div className="absolute bottom-4 left-4 right-4 border border-border bg-background/95 p-3">
        <div className="text-xs text-muted">Map unavailable — destination as text</div>
        <div className="mt-1 font-condensed text-xl font-bold uppercase">{job.address || "Address unavailable"}</div>
      </div>
    </div>
  );
}

function JobTruth({ job, mapsHref, onRefreshLocation, refreshingLoc }: { job: TechnicianJob; mapsHref: string | null; onRefreshLocation: () => void; refreshingLoc: boolean }) {
  const showTravelMeta = job.status === "assigned" || job.status === "en_route";
  const distance = showTravelMeta ? distanceLabel(job) : null;
  const eta = showTravelMeta ? etaLabel(job) : null;
  const hasMeta = eta != null || distance != null;
  const photos = job.intake_photos ?? [];
  return (
    <section className="mt-5 border-y border-border py-4">
      <div className="flex gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center bg-card-strong text-primary"><MapPin className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">Authorized service address</p>
          <p className="mt-1 text-[17px] font-semibold leading-5">{job.address || "Address unavailable"}</p>
          <p className="mt-2 text-sm capitalize text-[#8a8171]">{serviceLabel(job)}{job.access_type ? ` · ${job.access_type}` : ""}</p>
        </div>
      </div>
      {hasMeta ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {eta != null ? <MetaChip label="ETA" value={eta} /> : null}
          {distance != null ? <MetaChip label="Distance" value={distance} /> : null}
        </div>
      ) : null}
      {job.technician_location_updated_at ? <LocationFreshness fresh={job.technician_location_is_fresh} updatedAt={job.technician_location_updated_at} onRefresh={onRefreshLocation} refreshing={refreshingLoc} /> : null}
      {photos.length > 0 ? <IntakePhotos photos={photos} /> : null}
      {mapsHref ? <a className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 border border-border bg-card px-4 font-condensed text-base font-semibold uppercase tracking-[.04em]" href={mapsHref} target="_blank" rel="noreferrer">Open turn-by-turn navigation <ExternalLink className="size-4" /></a> : null}
    </section>
  );
}

function JobDetails({ job }: { job: TechnicianJob }) {
  const detail = recordValue(job.detail);
  const automotive = recordValue(detail.automotive);
  const customerName = job.customer_name || stringValue(detail.customer_name) || stringValue(detail.customerName);
  const customerPhone = job.customer_phone || stringValue(detail.customer_phone) || stringValue(detail.customerPhone);
  const notes = stringValue(detail.additional_details) || stringValue(detail.notes) || stringValue(detail.description);
  const vehicleParts = [
    stringValue(automotive.year),
    stringValue(automotive.color),
    stringValue(automotive.make),
    stringValue(automotive.model)
  ].filter(Boolean);
  const vehicle = vehicleParts.length > 0 ? vehicleParts.join(" ") : null;
  const keyType = stringValue(automotive.key_type) || stringValue(automotive.keyType);
  const rows = [
    customerName ? { label: "Customer", value: customerName } : null,
    customerPhone ? { label: "Phone", value: customerPhone, href: `tel:${customerPhone.replace(/[^\d+]/g, "")}` } : null,
    vehicle ? { label: "Vehicle", value: vehicle } : null,
    keyType ? { label: "Key type", value: keyType } : null,
    notes ? { label: "Job notes", value: notes } : null
  ].filter(Boolean) as Array<{ label: string; value: string; href?: string }>;

  if (rows.length === 0) return null;

  return (
    <section className="mt-4 border border-border bg-card p-4">
      <p className="field-kicker">Customer & job details</p>
      <dl className="mt-3 space-y-3">
        {rows.map((row) => (
          <div className="grid gap-1" key={row.label}>
            <dt className="text-[11px] font-black uppercase tracking-[.08em] text-muted">{row.label}</dt>
            <dd className="text-sm leading-5 text-[#dfd8ca]">
              {row.href ? <a className="font-semibold text-primary underline-offset-4 hover:underline" href={row.href}>{row.value}</a> : row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LocationFreshness({ fresh, updatedAt, onRefresh, refreshing }: { fresh?: boolean | null; updatedAt: string; onRefresh: () => void; refreshing: boolean }) {
  return (
    <div className="mt-4 flex items-center gap-2">
      <div className="flex flex-1 flex-wrap items-center gap-1.5 text-xs">
        <span className={`size-2 rounded-full ${fresh ? "bg-success" : "bg-primary"}`} />
        <span className="text-muted">Dispatch sees your location:</span>
        <span className={fresh ? "text-success" : "text-primary"}>{fresh ? "fresh" : "stale"}</span>
        <span className="text-muted">· updated {formatSyncAge(updatedAt)}</span>
      </div>
      <button
        className="touch-target flex shrink-0 items-center gap-1.5 border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted disabled:opacity-50"
        disabled={refreshing}
        onClick={onRefresh}
        type="button"
      >
        <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
        Refresh
      </button>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-border bg-card px-2.5 py-1">
      <span className="text-[10px] font-black uppercase tracking-[.08em] text-muted">{label}</span>
      <span className="font-condensed text-sm font-bold tabular-nums">{value}</span>
    </span>
  );
}

function IntakePhotos({ photos }: { photos: IntakePhoto[] }) {
  return (
    <div className="mt-4">
      <p className="field-kicker flex items-center gap-1.5"><ImageIcon className="size-3.5" />Customer intake photos</p>
      <div className="mt-2 flex gap-2 overflow-x-auto">
        {photos.map((photo, index) => (
          <a
            className="block size-20 shrink-0 overflow-hidden border border-border bg-card"
            href={photo.url}
            key={`${photo.url}-${index}`}
            rel="noreferrer"
            target="_blank"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={photo.label || `Intake photo ${index + 1}`} className="size-full object-cover" loading="lazy" src={photo.url} />
          </a>
        ))}
      </div>
    </div>
  );
}

function RecordedCollection({ items, total, currency }: { items: RecordedCollectionItem[]; total?: number | null; currency?: string | null }) {
  return (
    <section className="mt-4 border border-border bg-card p-4">
      <p className="field-kicker">Recorded collection</p>
      <ul className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li className="flex items-baseline justify-between gap-3 text-sm" key={`${item.description}-${index}`}>
            <span className="min-w-0">
              <span className="font-semibold">{item.description}</span>
              {item.provided_by ? <span className="ml-2 text-xs text-muted">provided by {item.provided_by}</span> : null}
            </span>
            {item.amount != null ? <span className="shrink-0 font-condensed text-base tabular-nums">{money(item.amount, currency)}</span> : null}
          </li>
        ))}
      </ul>
      {total != null ? (
        <div className="mt-3 flex justify-between border-t border-border pt-3">
          <span className="text-muted">Total recorded</span>
          <strong className="font-condensed text-xl tabular-nums">{money(total, currency)}</strong>
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-muted">ClueXP records this collection; it does not process payment or determine payout.</p>
    </section>
  );
}

function OperationalAlert({ tone, text }: { tone: "danger" | "success"; text: string }) {
  return <div className={`mt-4 flex gap-3 border p-3 text-sm ${tone === "danger" ? "border-danger/40 bg-danger/10 text-[#edd9d9]" : "border-success/30 bg-success/8 text-success"}`} role="status">{tone === "danger" ? <AlertTriangle className="size-5 shrink-0 text-danger" /> : <CheckCircle2 className="size-5 shrink-0" />}<p>{text}</p></div>;
}

function ContextRail({ onOpen }: { onOpen: (sheet: Exclude<Sheet, null>) => void }) {
  return (
    <nav className="safe-bottom fixed bottom-0 left-1/2 z-40 grid w-full max-w-[480px] -translate-x-1/2 grid-cols-4 gap-2 border-t border-border bg-background px-3 pt-2" aria-label="Active job actions">
      {activeJobActionItems.map(({ label, icon: Icon, key, danger }) => <button className={`field-rail-action ${danger ? "border-danger/40 text-danger" : ""}`} key={key} onClick={() => onOpen(key)} type="button"><Icon className="size-4" />{label}</button>)}
    </nav>
  );
}

function PinSheet({ pin, busy, error, inputRef, onPin, onClose, onConfirm }: { pin: string; busy: boolean; error: string | null; inputRef: RefObject<HTMLInputElement | null>; onPin: (value: string) => void; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-background" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <div className="mx-auto flex min-h-[100svh] w-full max-w-[480px] flex-col px-5 safe-top safe-bottom">
        <button className="touch-target ml-auto flex size-11 items-center justify-center border border-border" onClick={onClose} aria-label="Close arrival verification"><X className="size-5" /></button>
        <StageProgress current={2} />
        <h2 className="mt-3 font-condensed text-4xl font-bold uppercase" id="pin-title">Verify arrival</h2>
        <p className="mt-2 text-base leading-6 text-[#cfc8ba]">Ask the customer for the six-digit PIN on their ClueXP tracking page.</p>
        <label className="relative mt-8 block cursor-text" onClick={() => inputRef.current?.focus()}>
          <span className="sr-only">Customer arrival PIN</span>
          <span className="grid grid-cols-6 gap-2" aria-hidden>{Array.from({ length: 6 }, (_, index) => <span className={`flex h-[60px] items-center justify-center border bg-card font-condensed text-3xl font-bold ${index === pin.length ? "border-2 border-primary" : error ? "border-danger/70" : "border-border"}`} key={index}>{pin[index] || ""}</span>)}</span>
          <input ref={inputRef} className="absolute inset-0 opacity-0" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin} onChange={(event) => onPin(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        </label>
        <p className="mt-3 text-center text-sm text-muted">The button enables after six digits.</p>
        {error ? <OperationalAlert tone="danger" text={error} /> : null}
        <div className="mt-auto pt-8">
          <button className="field-primary-action" disabled={busy || pin.length !== 6} onClick={onConfirm} type="button">{busy ? <RefreshCw className="size-5 animate-spin" /> : <Check className="size-5" />}{busy ? "Verifying…" : "Confirm arrival"}</button>
          <p className="mt-4 text-center text-sm text-muted">Can’t get a PIN? Close this screen and use More → Report problem.</p>
        </div>
      </div>
    </div>
  );
}

function ActionSheet({ sheet, job, busy, issueDone, issueKind, issueReason, onClose, onIssueKind, onIssueReason, onSubmitIssue }: { sheet: Exclude<Sheet, null>; job: TechnicianJob; busy: boolean; issueDone: boolean; issueKind: string | null; issueReason: string; onClose: () => void; onIssueKind: (value: string) => void; onIssueReason: (value: string) => void; onSubmitIssue: (kind?: string) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" role="dialog" aria-modal="true">
      <section className={`safe-bottom max-h-[88svh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl border-t bg-[#121110] px-5 pb-5 ${sheet === "safety" ? "border-danger" : "border-border"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between bg-[#121110] py-3"><span className="h-1 w-11 rounded-full bg-border" /><button className="touch-target flex size-11 items-center justify-center" onClick={onClose} aria-label="Close"><X className="size-5" /></button></div>
        {sheet === "messages" ? <UnavailableAction title="Job messages" text="Job-scoped messaging is not enabled on this pilot environment yet. No delivery status will be fabricated." /> : null}
        {sheet === "call" ? <UnavailableAction title="Call" text="Private call routing is not enabled on this pilot environment yet. Contact dispatch through your approved operational channel." /> : null}
        {sheet === "safety" ? (
          <div>
            <h2 className="font-condensed text-4xl font-bold uppercase text-danger">Safety</h2>
            <p className="mt-2 text-[15px] leading-6 text-[#cfc8ba]">For unsafe conditions at or near this job. An alert is recorded against this job and sent to dispatch.</p>
            <button className="mt-5 flex min-h-[62px] w-full items-center justify-center bg-danger px-4 font-condensed text-xl font-semibold uppercase text-[#fff6f0] disabled:opacity-50" disabled={busy || issueDone} onClick={() => onSubmitIssue("unsafe")} type="button"><AlertTriangle className="mr-2 size-5" />{busy ? "Sending alert…" : issueDone ? "Alert sent" : "I feel unsafe — alert dispatch"}</button>
            <a className="mt-3 flex min-h-14 w-full items-center justify-center border-2 border-danger font-condensed text-xl font-semibold uppercase text-danger" href="tel:911">Call 911</a>
            <p className="mt-5 border border-danger/30 bg-danger/8 p-4 text-sm leading-6 text-[#b8a9a9]">If there is immediate danger, call 911 first. Reporting here is not a replacement for emergency services.</p>
          </div>
        ) : null}
        {sheet === "more" ? (
          <div>
            <p className="field-kicker">More → Report problem</p>
            <h2 className="mt-2 font-condensed text-4xl font-bold uppercase">Report a problem</h2>
            <p className="mt-2 text-sm leading-5 text-muted">Non-emergency blockers for job {job.id.slice(0, 8)}. Dispatch decides what happens next.</p>
            <div className="mt-5 space-y-2">{[["customer_unavailable", "Customer unavailable"], ["wrong_address", "Wrong address"], ["cannot_access", "Cannot access the work area"], ["job_differs", "Job differs from the request"], ["cannot_complete", "Cannot complete the work"]].map(([value, label]) => <button className={`touch-target flex min-h-[52px] w-full items-center justify-between border px-4 text-left ${issueKind === value ? "border-primary bg-primary/8 font-semibold" : "border-border bg-card"}`} key={value} onClick={() => onIssueKind(value)} type="button">{label}{issueKind === value ? <span className="size-2 rounded-full bg-primary" /> : null}</button>)}</div>
            <label className="mt-4 block text-sm text-muted">What is blocking you?<textarea className="mt-2 min-h-24 w-full resize-y border border-border bg-card p-3 text-foreground" value={issueReason} onChange={(event) => onIssueReason(event.target.value)} placeholder="Add useful detail for dispatch" /></label>
            <p className="mt-3 border border-border bg-card p-3 text-sm leading-5 text-muted">Submitting records the issue and notifies dispatch. It does not automatically reassign or cancel this job.</p>
            <button className="field-primary-action mt-4" disabled={!issueKind || busy || issueDone} onClick={() => onSubmitIssue()} type="button"><ArrowUp className="size-5" />{busy ? "Submitting…" : issueDone ? "Problem submitted" : "Submit to dispatch"}</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function UnavailableAction({ title, text }: { title: string; text: string }) {
  return <div><h2 className="font-condensed text-4xl font-bold uppercase">{title}</h2><div className="mt-4 border border-primary/35 bg-primary/8 p-4"><p className="font-semibold">Not enabled in this pilot</p><p className="mt-2 text-sm leading-6 text-muted">{text}</p></div></div>;
}

function CloseoutPanel({ id, lines, subtotal, method, tip, done, busy, onAdd, onRemove, onUpdate, onMethod, onTip, onSave }: { id: string; lines: CloseoutLineDraft[]; subtotal: number; method: string; tip: string; done: boolean; busy: boolean; onAdd: () => void; onRemove: (id: string) => void; onUpdate: (id: string, patch: Partial<CloseoutLineDraft>) => void; onMethod: (value: string) => void; onTip: (value: string) => void; onSave: () => void }) {
  if (done) return <section className="mt-5 border border-success/30 bg-success/8 p-4" id={id}><p className="font-semibold text-success"><CheckCircle2 className="mr-2 inline size-5" />Closeout recorded by ClueXP</p><p className="mt-2 text-sm text-muted">Review it once more, then submit it for customer confirmation.</p></section>;
  const validation = closeoutFormError(lines, method);
  return (
    <section className="mt-6 scroll-mt-4" id={id}>
      <div className="flex items-center justify-between"><div><p className="field-kicker">Closeout record</p><h2 className="mt-1 font-condensed text-3xl font-bold uppercase">What did you complete?</h2></div><ChevronDown className="size-5 text-muted" /></div>
      <p className="mt-2 text-sm leading-5 text-muted">Record what actually happened. ClueXP records this collection; it does not process payment or determine payout.</p>
      <div className="mt-4 space-y-3">{lines.map((line, index) => {
        const spec = CLOSEOUT_ITEM_TYPES.find((item) => item.value === line.item_type_code) ?? CLOSEOUT_ITEM_TYPES[0];
        return <div className="border border-border bg-card p-3" key={line.id}>
          <div className="flex items-center justify-between"><span className="field-kicker">Item {index + 1}</span>{lines.length > 1 ? <button className="text-sm font-semibold text-danger" onClick={() => onRemove(line.id)} type="button">Remove</button> : null}</div>
          <label className="mt-3 block">
            <span className="field-kicker">Line type</span>
            <select className="field-input mt-1" value={line.item_type_code} onChange={(event) => onUpdate(line.id, { item_type_code: event.target.value })}>{CLOSEOUT_ITEM_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          </label>
          <label className="mt-2 block">
            <span className="field-kicker">Customer receipt description</span>
            <input className="field-input mt-1" value={line.description} onChange={(event) => onUpdate(line.id, { description: event.target.value })} placeholder={`Describe this ${spec.label.toLowerCase()}`} />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="field-kicker">Quantity</span>
              <input className="field-input mt-1" inputMode="decimal" value={line.quantity} onChange={(event) => onUpdate(line.id, { quantity: event.target.value.replace(/[^0-9.]/g, "") })} placeholder="1" />
            </label>
            <label className="block">
              <span className="field-kicker">Amount</span>
              <input className="field-input mt-1" inputMode="decimal" value={line.unit_amount} onChange={(event) => onUpdate(line.id, { unit_amount: event.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" />
            </label>
          </div>
          {spec.requiresProvidedBy ? (
            <label className="mt-2 block">
              <span className="field-kicker">Provided by</span>
              <select className="field-input mt-1" value={line.provided_by} onChange={(event) => onUpdate(line.id, { provided_by: event.target.value })}><option value="">Choose provider…</option><option value="company">Company</option><option value="technician">Technician</option><option value="customer">Customer</option><option value="third_party">Third party</option></select>
            </label>
          ) : null}
          {spec.requiresNote ? (
            <label className="mt-2 block">
              <span className="field-kicker">Optional note</span>
              <input className="field-input mt-1" value={line.note} onChange={(event) => onUpdate(line.id, { note: event.target.value })} placeholder="Add context if needed" />
            </label>
          ) : null}
        </div>;
      })}</div>
      <button className="mt-3 min-h-12 w-full border border-dashed border-border font-semibold text-muted" onClick={onAdd} type="button">+ Add service or part</button>
      <div className="mt-4 border border-border bg-card p-4">
        <div className="flex justify-between"><span className="text-muted">Total recorded</span><strong className="font-condensed text-2xl">${subtotal.toFixed(2)}</strong></div>
        <select className="field-input mt-3" value={method} onChange={(event) => onMethod(event.target.value)}><option value="">How was this collected?</option>{PAYMENT_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <input className="field-input mt-2" inputMode="decimal" value={tip} onChange={(event) => onTip(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="Tip received (optional)" />
      </div>
      {validation ? <p className="mt-3 text-center text-xs text-primary">{validation}</p> : null}
      <button className="field-primary-action mt-3" disabled={busy || validation != null} onClick={onSave} type="button"><ShieldCheck className="size-5" />{busy ? "Saving…" : "Record closeout"}</button>
    </section>
  );
}

function PendingConfirmation({ job }: { job: TechnicianJob }) {
  const approval = job.approval_status;
  const approvalLabel =
    approval === "approved" ? "Approved by customer" :
    approval === "disputed" ? "Disputed — dispatch mediating" :
    approval === "expired" ? "Confirmation window expired" :
    "Awaiting confirmation";
  const approvalTone = approval === "approved" ? "text-success" : approval === "disputed" ? "text-danger" : "text-primary";
  return (
    <section className="py-10 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full border-2 border-dashed border-primary/50 font-condensed text-2xl font-bold text-primary">…</div>
      <p className="mt-5 field-kicker">Job {job.id.slice(0, 8)}</p>
      <p className="mt-2 text-[15px] leading-6 text-[#cfc8ba]">The customer must confirm the receipt. You cannot complete this job yourself, and you remain busy until it is resolved.</p>
      <div className="mt-6 border border-border bg-card p-4 text-left text-sm">
        <div className="flex justify-between gap-4"><span className="text-muted">Customer approval</span><span className={approvalTone}>{approvalLabel}</span></div>
        <div className="mt-3 flex justify-between gap-4"><span className="text-muted">Your status</span><span className="text-primary">Busy · no new offers</span></div>
      </div>
      {job.approval_url && /^https?:\/\//.test(job.approval_url) ? (
        <a className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 border border-border bg-card px-4 font-condensed text-base font-semibold uppercase tracking-[.04em]" href={job.approval_url} target="_blank" rel="noreferrer">
          View approval status <ExternalLink className="size-4" />
        </a>
      ) : null}
    </section>
  );
}

function ResolvedJobState({ job }: { job: TechnicianJob }) {
  const isDisputed = job.status === "disputed";
  const isExpired = job.status === "completed_auto_closed";
  const label = isDisputed ? "Disputed" : isExpired ? "Expired closure" : "Approved";
  const detail = isDisputed
    ? "Dispatch must resolve the dispute. Do not collect additional payment through ClueXP."
    : isExpired
      ? "The customer confirmation window expired and the job was closed by policy."
      : "The customer approved the closeout. This job is no longer awaiting customer action.";
  return (
    <section className={`mt-6 border p-4 ${isDisputed ? "border-danger/40 bg-danger/10" : "border-success/30 bg-success/8"}`}>
      <p className="field-kicker">Customer approval</p>
      <h2 className={`mt-1 font-condensed text-3xl font-bold uppercase ${isDisputed ? "text-danger" : "text-success"}`}>{label}</h2>
      <p className="mt-2 text-sm leading-5 text-muted">{detail}</p>
      {job.approval_url && /^https?:\/\//.test(job.approval_url) ? (
        <a className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 border border-border bg-card px-4 font-condensed text-base font-semibold uppercase tracking-[.04em]" href={job.approval_url} target="_blank" rel="noreferrer">
          Open customer tracking <ExternalLink className="size-4" />
        </a>
      ) : null}
    </section>
  );
}
