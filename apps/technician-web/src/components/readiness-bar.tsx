"use client";

import { AlertTriangle, Bell, BellOff, LocateFixed, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type Tone = "success" | "warn" | "danger" | "muted";

type Cell = {
  key: string;
  label: string;
  tone: Tone;
  icon: LucideIcon;
  headline: string;
  detail: string;
  action?: { label: string; busy?: boolean; onClick: () => void };
};

// A location fix within ~5 minutes reads as fresh. Advisory only — dispatch can
// still fall back to the technician's service-area center without a live fix.
const LOCATION_FRESH_MS = 5 * 60 * 1000;
// Re-confirm availability/location with the server periodically while this
// screen is open, so "server-verified" has a real, recent backing fetch.
const VERIFY_POLL_MS = 20_000;

function ageLabel(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function toneDot(tone: Tone) {
  if (tone === "success") return "bg-success";
  if (tone === "warn") return "bg-primary";
  if (tone === "danger") return "bg-danger";
  return "bg-muted";
}

function toneText(tone: Tone) {
  if (tone === "success") return "text-success";
  if (tone === "warn") return "text-primary";
  if (tone === "danger") return "text-danger";
  return "text-muted";
}

function toneBorder(tone: Tone) {
  if (tone === "success") return "border-success";
  if (tone === "warn") return "border-primary";
  if (tone === "danger") return "border-danger";
  return "border-border";
}

/**
 * Persistent readiness bar (spec §5.3, design 1g/1h) — four independently
 * verified dimensions, each tap-to-expand into the exact cause and a real
 * one-tap fix. "Ready for offers" requires Available + Connection + having
 * shared a location fix at least once — matching the mock's blocking
 * behavior for "Location access is off". Freshness beyond that first fix is
 * advisory only (dispatch can still fall back to the technician's
 * service-area center), so staleness colors the cell amber without re-
 * blocking Ready every few minutes — this app has no background location,
 * only manual refresh, so a hard freshness gate would be a punishing loop.
 * Alerts stays a non-blocking advisory: this PWA relies on foreground
 * polling, not push, so it's a real enhancement (this component fires an
 * actual browser Notification on new offers when granted) rather than a
 * requirement.
 */
export function WorkReadiness({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [availBusy, setAvailBusy] = useState(false);
  const [locationAt, setLocationAt] = useState<string | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("default");
  const [verifiedAt, setVerifiedAt] = useState<number | null>(null);
  const [openCell, setOpenCell] = useState<string | null>(null);
  const [, tick] = useState(0);

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const tech = data?.session?.technician;
      if (typeof tech?.is_available === "boolean") setAvailable(tech.is_available);
      if (typeof tech?.location_updated_at === "string") setLocationAt(tech.location_updated_at);
      setVerifiedAt(Date.now());
    } catch {
      // Silent — the last-known values stay on screen rather than flashing an error.
    }
  }, []);

  useEffect(() => {
    void fetchSession();
    const id = window.setInterval(() => void fetchSession(), VERIFY_POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchSession]);

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
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifPermission("unsupported");
      return;
    }
    setNotifPermission(Notification.permission);
  }, []);

  // Keep "updated Xm ago" / "verified Xs ago" honest without extra fetches.
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const toggleAvailable = useCallback(async () => {
    if (availBusy || available === null) return;
    setAvailBusy(true);
    const next = !available;
    try {
      const response = await fetch("/api/availability", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_available: next })
      });
      if (response.ok) {
        setAvailable(next);
        setVerifiedAt(Date.now());
      }
    } finally {
      setAvailBusy(false);
    }
  }, [availBusy, available]);

  const refreshLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocError("Location is not available on this device.");
      return;
    }
    setLocBusy(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch("/api/location", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.detail || "Location could not be saved");
          setLocationAt(body.last_location_at || new Date().toISOString());
        } catch (cause) {
          setLocError(cause instanceof Error ? cause.message : "Location could not be saved");
        } finally {
          setLocBusy(false);
        }
      },
      (failure) => {
        setLocBusy(false);
        setLocError(
          failure.code === failure.PERMISSION_DENIED
            ? "Allow location access, then refresh again."
            : "Your current location is unavailable."
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  }, []);

  const requestAlerts = useCallback(async () => {
    if (notifPermission === "unsupported" || typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }, [notifPermission]);

  const locationFresh = locationAt ? Date.now() - new Date(locationAt).getTime() < LOCATION_FRESH_MS : false;
  const locationShared = locationAt !== null;

  // Named cause + real one-tap fix, in priority order — matches design 1h's
  // "NOT RECEIVING OFFERS" + cause + dominant fix pattern for every blocker.
  const blocker: { tone: Tone; icon: LucideIcon; cause: string; detail: string; action?: Cell["action"] } | null =
    !online
      ? {
          tone: "danger",
          icon: WifiOff,
          cause: "No connection",
          detail: "Reconnect to the internet — offers can't reach you until it's back.",
        }
      : !locationShared
        ? {
            tone: "warn",
            icon: LocateFixed,
            cause: "Location access is off",
            detail: locError || "ClueXP needs your location while you're available so companies can send offers near you.",
            action: { label: "Fix location access", busy: locBusy, onClick: refreshLocation }
          }
        : null;

  const cells: Cell[] = [
    {
      key: "available",
      label: "Available",
      tone: available === null ? "muted" : available ? "success" : "muted",
      icon: ShieldCheck,
      headline: available ? "You're marked available" : "You're offline",
      detail: available
        ? "Companies can see and offer you jobs."
        : "Go online to start receiving offers.",
      action: { label: available ? "Go offline" : "Go online", busy: availBusy, onClick: () => void toggleAvailable() }
    },
    {
      key: "location",
      label: "Location",
      tone: !locationAt ? "warn" : locationFresh ? "success" : "warn",
      icon: LocateFixed,
      headline: !locationAt ? "Location not shared yet" : locationFresh ? "Location fresh" : "Location stale",
      detail: locError
        ? locError
        : locationAt
          ? `Updated ${ageLabel(locationAt)}. A fresher fix helps match nearby work precisely.`
          : "Sharing a fix helps dispatch match you with nearby work precisely.",
      action: { label: "Refresh", busy: locBusy, onClick: refreshLocation }
    },
    {
      key: "alerts",
      label: "Alerts",
      tone: notifPermission === "granted" ? "success" : "warn",
      icon: notifPermission === "granted" ? Bell : BellOff,
      headline:
        notifPermission === "granted" ? "Alerts on" :
        notifPermission === "denied" ? "Alerts blocked" :
        notifPermission === "unsupported" ? "Alerts unsupported" : "Alerts off",
      detail:
        notifPermission === "granted"
          ? "You'll get a browser alert for new offers, even if this tab isn't focused."
          : notifPermission === "denied"
            ? "Blocked in your browser settings. Offers still appear here while this tab is open."
            : notifPermission === "unsupported"
              ? "This browser can't show alerts. Offers still appear here while this tab is open."
              : "Turn on so you don't miss an offer while looking away. Offers expire quickly.",
      action: notifPermission === "default" ? { label: "Enable", onClick: () => void requestAlerts() } : undefined
    },
    {
      key: "connection",
      label: "Connection",
      tone: online ? "success" : "danger",
      icon: online ? Wifi : WifiOff,
      headline: online ? "Connected" : "No connection",
      detail: online ? "Live sync with dispatch is working." : "Reconnect to the internet to receive offers.",
    }
  ];

  return (
    <div>
      <div className="grid grid-cols-4 divide-x divide-border border border-border bg-card">
        {cells.map((cell) => {
          const open = openCell === cell.key;
          return (
            <button
              className={`flex min-h-[58px] flex-col items-center justify-center gap-1 px-1 py-2 ${open ? "bg-card-strong" : ""}`}
              key={cell.key}
              onClick={() => setOpenCell(open ? null : cell.key)}
              type="button"
              aria-expanded={open}
            >
              <span className={`size-2 rounded-full ${toneDot(cell.tone)}`} />
              <span className="text-[11px] font-semibold text-muted">{cell.label}</span>
            </button>
          );
        })}
      </div>

      {openCell ? (() => {
        const cell = cells.find((c) => c.key === openCell);
        if (!cell) return null;
        const Icon = cell.icon;
        return (
          <div className="border-x border-b border-border bg-card-strong p-3">
            <div className="flex items-start gap-3">
              <Icon className={`mt-0.5 size-5 shrink-0 ${toneText(cell.tone)}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{cell.headline}</div>
                <div className="mt-1 text-xs leading-5 text-muted">{cell.detail}</div>
              </div>
            </div>
            {cell.action ? (
              <button className="field-secondary-action mt-3 w-full gap-1.5" disabled={cell.action.busy} onClick={cell.action.onClick} type="button">
                {cell.key === "location" ? <RefreshCw className={`size-4 ${cell.action.busy ? "animate-spin" : ""}`} /> : null}
                {cell.action.busy ? "Working…" : cell.action.label}
              </button>
            ) : null}
          </div>
        );
      })() : null}

      <div className="mt-5">
        {available === null || !available ? null : blocker ? (
          <div className="border-y border-border py-8 text-center">
            <div className={`mx-auto flex size-16 items-center justify-center rounded-full border-2 ${toneBorder(blocker.tone)} ${toneText(blocker.tone)}`}>
              <blocker.icon className="size-7" />
            </div>
            <div className={`mt-4 flex items-center justify-center gap-2 font-condensed text-2xl font-bold uppercase leading-none ${toneText(blocker.tone)}`}>
              <AlertTriangle className="size-5" />Not receiving offers
            </div>
            <p className="mt-3 text-sm font-semibold">{blocker.cause}</p>
            <p className="mx-auto mt-1 max-w-[18rem] text-sm leading-6 text-muted">{blocker.detail}</p>
            {blocker.action ? (
              <button className="field-primary-action mt-5" disabled={blocker.action.busy} onClick={blocker.action.onClick} type="button">
                {blocker.action.busy ? "Working…" : blocker.action.label}
              </button>
            ) : null}
            <button className="field-secondary-action mt-3 w-full" disabled={availBusy} onClick={() => void toggleAvailable()} type="button">
              {availBusy ? "Going offline…" : "Go offline"}
            </button>
          </div>
        ) : (
          <>
            <div className="border-y border-border py-4">
              <div className="flex items-center gap-2 font-condensed text-2xl font-bold uppercase leading-none text-success">
                <ShieldCheck className="size-5" />Ready for offers
              </div>
              {verifiedAt ? <p className="mt-1 font-mono text-[11px] text-success/80">server-verified · {ageLabel(new Date(verifiedAt).toISOString())}</p> : null}
              <button className="field-secondary-action mt-4 w-full" disabled={availBusy} onClick={() => void toggleAvailable()} type="button">
                {availBusy ? "Going offline…" : "Go offline"}
              </button>
            </div>
            {children}
          </>
        )}
      </div>
    </div>
  );
}
