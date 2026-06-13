"use client";

import { AppFrame, Pill, Screen, Section, icons } from "@/components/mobile";
import { LanguageSettings, useSession } from "@cluexp/app-core";
import { LocateFixed, Power } from "lucide-react";
import { useState } from "react";

export default function SettingsPage() {
  const { session, refresh } = useSession();
  const [online, setOnline] = useState(Boolean(session?.technician?.is_available));
  const [gpsState, setGpsState] = useState<"idle" | "saving" | "live" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function setAvailability(next: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/availability", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_available: next })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to update availability");
      setOnline(Boolean(body.is_available));
      await refresh();
      setMessage(body.is_available ? "You are online for dispatch." : "Offer delivery is paused.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to update availability");
    } finally {
      setBusy(false);
    }
  }

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
        <Section action={<Pill tone={online ? "success" : "muted"} icon={icons.BellRing}>{online ? "Online" : "Offline"}</Pill>} title="Dispatch status">
          <div className="grid grid-cols-2 gap-3">
            <button className="touch-target min-h-24 rounded-xl border border-border bg-card-strong p-3 text-left font-black" disabled={busy} onClick={() => void setAvailability(!online)} type="button">
              <Power className={`mb-2 size-5 ${online ? "text-success" : "text-muted"}`} />
              {online ? "Go offline" : "Go online"}
            </button>
            <button className="touch-target min-h-24 rounded-xl border border-border bg-card-strong p-3 text-left font-black" disabled={gpsState === "saving"} onClick={() => void shareLocation()} type="button">
              <LocateFixed className={`mb-2 size-5 ${gpsState === "live" ? "text-success" : "text-primary"}`} />
              {gpsState === "saving" ? "Updating GPS…" : gpsState === "live" ? "GPS updated" : "Update GPS"}
            </button>
          </div>
          {message ? <p className="mt-3 rounded-xl border border-border bg-card p-3 text-sm text-muted" role="status">{message}</p> : null}
        </Section>
        <p className="pb-5 text-xs leading-5 text-muted">Location is shared only when you update GPS or start a route. Continuous background tracking is not enabled.</p>
      </Screen>
    </AppFrame>
  );
}
