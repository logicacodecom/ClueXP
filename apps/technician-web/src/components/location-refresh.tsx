"use client";

import { LocateFixed, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// A fix within ~5 minutes is treated as fresh. This is a technician-facing hint;
// the server remains the authority for "dispatch sees you" on the active job.
const FRESH_MS = 5 * 60 * 1000;

function ageLabel(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * Work-tab location freshness + manual refresh. Privacy-safe: a fix is taken only
 * when the technician taps Refresh (or starts a route) — never silently in the
 * background.
 */
export function LocationRefresh() {
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  // Seed freshness from the technician's last stored fix.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const at = data?.session?.technician?.location_updated_at;
        if (!cancelled && typeof at === "string") setUpdatedAt(at);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // Keep the "updated Xm ago" age honest without a network call.
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(() => {
    if (!navigator.geolocation) {
      setState("error");
      setError("Location is not available on this device.");
      return;
    }
    setState("saving");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch("/api/location", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude })
          });
          const body = await response.json().catch(() => ({}));
          if (response.status === 401) { window.location.assign("/signin"); return; }
          if (!response.ok) throw new Error(body.detail || "Location could not be saved");
          setUpdatedAt(body.last_location_at || new Date().toISOString());
          setState("idle");
        } catch (cause) {
          setState("error");
          setError(cause instanceof Error ? cause.message : "Location could not be saved");
        }
      },
      (failure) => {
        setState("error");
        setError(
          failure.code === failure.PERMISSION_DENIED
            ? "Allow location access to share your position."
            : "Your current location is unavailable."
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  }, []);

  const fresh = updatedAt ? Date.now() - new Date(updatedAt).getTime() < FRESH_MS : false;
  const dotClass = state === "saving" ? "text-muted" : !updatedAt ? "text-muted" : fresh ? "text-success" : "text-primary";

  return (
    <div className="flex items-center justify-between gap-3 border border-border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <LocateFixed className={`size-5 shrink-0 ${dotClass}`} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {state === "saving" ? "Getting location…" : !updatedAt ? "Location not shared yet" : fresh ? "Location fresh" : "Location stale"}
          </div>
          <div className="text-xs leading-4 text-muted">
            {error ? error : updatedAt ? `Updated ${ageLabel(updatedAt)}` : "Refresh so dispatch can match you with nearby work."}
          </div>
        </div>
      </div>
      <button className="field-secondary-action shrink-0 gap-1.5 px-3" disabled={state === "saving"} onClick={refresh} type="button">
        <RefreshCw className={`size-4 ${state === "saving" ? "animate-spin" : ""}`} />
        Refresh
      </button>
    </div>
  );
}
