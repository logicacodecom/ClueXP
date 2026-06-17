"use client";

import { AppFrame, Screen, Section } from "@/components/mobile";
import { LanguageSettings } from "@cluexp/app-core";
import { LocateFixed } from "lucide-react";
import { useState } from "react";

export default function SettingsPage() {
  const [gpsState, setGpsState] = useState<"idle" | "saving" | "live" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function shareLocation() {
    if (!navigator.geolocation) {
      setMessage("GPS is not available in this browser.");
      setGpsState("error");
      return;
    }
    setGpsState("saving");
    setMessage(null);
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await fetch("/api/location", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.detail || "Unable to update GPS");
        setGpsState("live");
        setMessage("Location updated for dispatch.");
      } catch (cause) {
        setGpsState("error");
        setMessage(cause instanceof Error ? cause.message : "Unable to update GPS");
      }
    }, () => {
      setGpsState("error");
      setMessage("Location permission was not granted.");
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 });
  }

  return (
    <AppFrame title="Settings">
      <Screen>
        <Section title="Language"><LanguageSettings /></Section>
        <Section title="Location">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-3">
              <LocateFixed className="size-5 text-primary" />
              <div>
                <div className="font-bold">Location sharing</div>
                <div className="text-xs text-muted">
                  Update your location for dispatch and navigation
                </div>
              </div>
            </div>
            <button
              className="touch-target w-full rounded-xl border border-border bg-card-strong py-3 text-sm font-black transition active:scale-[.98]"
              disabled={gpsState === "saving"}
              onClick={() => void shareLocation()}
              type="button"
            >
              {gpsState === "saving" ? "Updating GPS…" : gpsState === "live" ? "Location updated" : "Update GPS location"}
            </button>
            {message ? (
              <p className="mt-3 rounded-xl border border-border bg-card p-3 text-xs text-muted" role="status">
                {message}
              </p>
            ) : null}
            <p className="mt-3 text-[11px] leading-4 text-muted">
              Location is shared only when you explicitly update it or start a route. Continuous background tracking is not enabled.
            </p>
          </div>
        </Section>
      </Screen>
    </AppFrame>
  );
}
