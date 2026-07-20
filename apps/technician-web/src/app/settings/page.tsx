"use client";

import type { ReactNode } from "react";
import { AppFrame, Screen } from "@/components/mobile";
import { LanguageSettings } from "@cluexp/app-core";
import { LocateFixed, Lock, PhoneOff } from "lucide-react";
import { useState } from "react";

function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-2">
      <p className="field-kicker">{title}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

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
        <header className="border-b border-border pb-4">
          <h1 className="font-condensed text-3xl font-bold uppercase leading-none">Settings</h1>
        </header>

        <FieldSection title="Language"><LanguageSettings /></FieldSection>

        <FieldSection title="Location">
          <div className="border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-3">
              <LocateFixed className="size-5 text-primary" />
              <div>
                <div className="font-semibold">Location sharing</div>
                <div className="text-xs text-muted">Update your location for dispatch and navigation</div>
              </div>
            </div>
            <button
              className="field-secondary-action w-full"
              disabled={gpsState === "saving"}
              onClick={() => void shareLocation()}
              type="button"
            >
              {gpsState === "saving" ? "Updating GPS…" : gpsState === "live" ? "Location updated" : "Update GPS location"}
            </button>
            {message ? (
              <p className="mt-3 border border-border bg-card-strong p-3 text-xs text-muted" role="status">{message}</p>
            ) : null}
            <p className="mt-3 text-[11px] leading-4 text-muted">
              Location is shared only when you explicitly update it or start a route. Continuous background tracking is not enabled.
            </p>
          </div>
        </FieldSection>

        <FieldSection title="Privacy">
          <div className="divide-y divide-border border border-border bg-card">
            <div className="flex items-center gap-3 p-3">
              <PhoneOff className="size-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Masked calls &amp; messages</div>
                <div className="text-xs text-muted">Customer contact is always routed through ClueXP — your number stays private.</div>
              </div>
              <span className="shrink-0 text-xs font-semibold text-success">Always on</span>
            </div>
            <div className="flex items-center gap-3 p-3">
              <Lock className="size-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Location sharing scope</div>
                <div className="text-xs text-muted">Shared only while you have an active job or explicitly update it.</div>
              </div>
              <span className="shrink-0 text-xs font-semibold text-muted">On a job</span>
            </div>
          </div>
        </FieldSection>
      </Screen>
    </AppFrame>
  );
}
