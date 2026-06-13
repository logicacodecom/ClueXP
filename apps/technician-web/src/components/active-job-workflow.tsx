"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldCheck,
  Wrench
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GoogleMapView, type MapPoint } from "./google-map";

export type TechnicianJob = {
  id: string;
  status: "assigned" | "en_route" | "arrived" | "in_progress" | "completed_pending_customer";
  access_type?: string | null;
  situation?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type LocationState =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "ready"; lat: number; lng: number; savedAt: string }
  | { state: "error"; detail: string };

const stages: Array<{ status: TechnicianJob["status"]; label: string }> = [
  { status: "assigned", label: "Accepted" },
  { status: "en_route", label: "En route" },
  { status: "arrived", label: "Arrived" },
  { status: "in_progress", label: "In service" },
  { status: "completed_pending_customer", label: "Customer review" }
];

function statusCopy(status: TechnicianJob["status"]) {
  if (status === "assigned") return { eyebrow: "Ready to depart", title: "Start route", detail: "Share your current location and begin the trip." };
  if (status === "en_route") return { eyebrow: "Driving to customer", title: "Confirm arrival", detail: "Only confirm after reaching the service address." };
  if (status === "arrived") return { eyebrow: "At the location", title: "Start service", detail: "Verify authorization before beginning work." };
  if (status === "in_progress") return { eyebrow: "Service underway", title: "Finish service", detail: "Send the job to the customer for confirmation." };
  return { eyebrow: "Work submitted", title: "Awaiting customer", detail: "This job closes only after customer confirmation, Ops resolution, or timeout." };
}

function nextStatus(status: TechnicianJob["status"]) {
  if (status === "assigned") return "en_route";
  if (status === "en_route") return "arrived";
  if (status === "arrived") return "in_progress";
  if (status === "in_progress") return "completed_pending_customer";
  return null;
}

function actionLabel(status: TechnicianJob["status"]) {
  if (status === "assigned") return "Start route";
  if (status === "en_route") return "Confirm arrival";
  if (status === "arrived") return "Start service";
  if (status === "in_progress") return "Request customer confirmation";
  return "Waiting for customer";
}

function ActionIcon({ status }: { status: TechnicianJob["status"] }) {
  if (status === "assigned") return <Navigation className="size-5" />;
  if (status === "en_route") return <MapPin className="size-5" />;
  if (status === "arrived") return <Wrench className="size-5" />;
  return <CheckCircle2 className="size-5" />;
}

export function ActiveJobWorkflow({ initialJob }: { initialJob: TechnicianJob }) {
  const [job, setJob] = useState(initialJob);
  const [location, setLocation] = useState<LocationState>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = statusCopy(job.status);
  const currentIndex = stages.findIndex((stage) => stage.status === job.status);

  const refreshJob = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.assign("/signin");
        return;
      }
      if (response.status === 404) {
        window.location.assign("/jobs");
        return;
      }
      if (!response.ok) throw new Error(body.detail || "Unable to refresh this job");
      setJob(body as TechnicianJob);
      setError(null);
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : "Unable to refresh this job");
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [job.id]);

  useEffect(() => {
    const id = window.setInterval(() => void refreshJob(true), 15_000);
    const onFocus = () => void refreshJob(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshJob]);

  const points = useMemo(() => {
    const next: MapPoint[] = [];
    if (location.state === "ready") next.push({ lat: location.lat, lng: location.lng, kind: "tech", label: "Your shared location" });
    if (typeof job.lat === "number" && typeof job.lng === "number") {
      next.push({ lat: job.lat, lng: job.lng, kind: "job", label: "Service address" });
    }
    return next;
  }, [job.lat, job.lng, location]);

  async function shareLocation(): Promise<boolean> {
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
            savedAt: body.last_location_at || new Date().toISOString()
          });
          resolve(true);
        } catch (cause) {
          setLocation({ state: "error", detail: cause instanceof Error ? cause.message : "Location could not be saved" });
          resolve(false);
        }
      }, (failure) => {
        const detail =
          failure.code === failure.PERMISSION_DENIED ? "Allow location access to start the route." :
          failure.code === failure.TIMEOUT ? "Location timed out. Move to an open area and retry." :
          "Your current location is unavailable.";
        setLocation({ state: "error", detail });
        resolve(false);
      }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 });
    });
  }

  async function advance() {
    const target = nextStatus(job.status);
    if (!target || busy) return;
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
      if (response.status === 401) {
        window.location.assign("/signin");
        return;
      }
      if (!response.ok) throw new Error(body.detail || "The job could not be updated");
      setJob((current) => ({ ...current, status: target }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The job could not be updated");
    } finally {
      setBusy(false);
    }
  }

  const mapsHref =
    typeof job.lat === "number" && typeof job.lng === "number"
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${job.lat},${job.lng}`)}`
      : job.address
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}`
        : null;

  return (
    <div className="min-h-full bg-background pb-28">
      <section className="relative h-[42svh] min-h-[310px] overflow-hidden border-b border-border bg-[#10151b]">
        <GoogleMapView
          points={points}
          connect={false}
          fallback={
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div>
                <MapPin className="mx-auto size-8 text-primary" />
                <p className="mt-3 font-bold">{points.length ? "Map unavailable" : "Location not shared"}</p>
                <p className="mt-1 text-sm leading-5 text-muted">
                  {points.length ? "Use the address or open external navigation." : "Start the route to share your position."}
                </p>
              </div>
            </div>
          }
        />
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-2 text-xs font-black">
          <span className={`size-2 rounded-full ${location.state === "ready" ? "bg-success" : "bg-muted"}`} />
          {location.state === "ready" ? "Location shared" : location.state === "saving" ? "Locating..." : "Location idle"}
        </div>
        <button
          className="touch-target absolute bottom-4 right-4 flex size-12 items-center justify-center rounded-full border border-border bg-background text-foreground disabled:opacity-50"
          disabled={location.state === "saving"}
          onClick={() => void shareLocation()}
          type="button"
          aria-label="Update current location"
        >
          <LocateFixed className="size-5" />
        </button>
      </section>

      <div className="px-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[.12em] text-primary">{copy.eyebrow}</p>
            <h1 className="mt-1 font-condensed text-[2.45rem] font-bold uppercase leading-[.95]">{copy.title}</h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted">{copy.detail}</p>
          </div>
          <button className="touch-target flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card" disabled={busy} onClick={() => void refreshJob()} aria-label="Refresh job">
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-5 gap-1.5" aria-label="Job progress">
          {stages.map((stage, index) => (
            <div key={stage.status} className="min-w-0">
              <div className={`h-1.5 ${index <= currentIndex ? "bg-primary" : "bg-card-strong"}`} />
              <div className={`mt-1 truncate text-center text-[9px] font-black uppercase ${index <= currentIndex ? "text-primary" : "text-muted"}`}>{stage.label}</div>
            </div>
          ))}
        </div>

        <section className="mt-6 border-y border-border py-4">
          <div className="flex gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center bg-card-strong text-primary"><MapPin className="size-5" /></div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[.1em] text-muted">Service address</p>
              <p className="mt-1 text-base font-black leading-5">{job.address || "Address unavailable"}</p>
              <p className="mt-1 text-sm capitalize text-muted">{job.access_type || "Service"} · {(job.situation || "Service request").replaceAll("_", " ")}</p>
            </div>
          </div>
          {mapsHref ? (
            <a className="touch-target mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 border border-border bg-card-strong px-4 text-sm font-black" href={mapsHref} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />Open turn-by-turn navigation
            </a>
          ) : null}
        </section>

        {location.state === "error" ? (
          <div className="mt-4 flex gap-3 border border-danger/35 bg-danger/10 p-3 text-sm text-danger" role="alert">
            <AlertTriangle className="size-5 shrink-0" />
            <p>{location.detail}</p>
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 flex gap-3 border border-danger/35 bg-danger/10 p-3 text-sm text-danger" role="alert">
            <AlertTriangle className="size-5 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        {job.status === "completed_pending_customer" ? (
          <div className="mt-5 flex gap-3 border border-warn/35 bg-warn/10 p-4">
            <Clock3 className="size-5 shrink-0 text-warn" />
            <div><p className="font-black">Customer confirmation pending</p><p className="mt-1 text-sm leading-5 text-muted">You cannot close this job yourself. This screen will refresh automatically.</p></div>
          </div>
        ) : null}
      </div>

      <div className="safe-bottom fixed bottom-[82px] left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 border-t border-border bg-background/98 px-4 pt-3">
        <button
          className="touch-target flex min-h-[58px] w-full items-center justify-center gap-2 bg-primary px-4 text-base font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-55"
          disabled={busy || job.status === "completed_pending_customer"}
          onClick={() => void advance()}
          type="button"
        >
          {busy ? <RefreshCw className="size-5 animate-spin" /> : <ActionIcon status={job.status} />}
          {busy ? "Updating..." : actionLabel(job.status)}
        </button>
        <p className="mt-2 text-center text-[11px] font-semibold text-muted">
          <ShieldCheck className="mr-1 inline size-3.5 text-success" />
          Status changes are recorded by ClueXP
        </p>
      </div>
    </div>
  );
}
