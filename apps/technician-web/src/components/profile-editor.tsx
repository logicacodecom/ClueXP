"use client";

import { SkillSelect } from "@cluexp/console-ui";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";

export function ProfileEditor({
  initialName,
  initialPhone,
  initialRadius,
  initialSkills
}: {
  initialName: string;
  initialPhone: string;
  initialRadius: number | null;
  initialSkills: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    display_name: initialName,
    phone: initialPhone,
    service_area_radius_km: initialRadius?.toString() ?? "",
    skills: initialSkills
  });

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: form.display_name,
          phone: form.phone,
          service_area_radius_km: form.service_area_radius_km ? Number(form.service_area_radius_km) : undefined,
          skills: form.skills
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Profile could not be saved");
      setMessage("Profile updated.");
      setEditing(false);
      window.location.reload();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Profile could not be saved");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button className="touch-target flex min-h-12 w-full items-center justify-center gap-2 border border-border bg-card-strong px-4 font-black" onClick={() => setEditing(true)} type="button">
        <Pencil className="size-4" />Edit profile
      </button>
    );
  }

  return (
    <div className="border border-border bg-card p-4">
      <div className="grid gap-4">
        <label className="text-sm font-bold">Display name<input className="mt-2 min-h-12 w-full border border-border bg-card-strong px-3 text-base outline-none focus:border-primary" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label>
        <label className="text-sm font-bold">Phone<input className="mt-2 min-h-12 w-full border border-border bg-card-strong px-3 text-base outline-none focus:border-primary" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <div className="text-sm font-bold">
          Skills
          <div className="mt-2 rounded-xl border border-border bg-card-strong p-3">
            <SkillSelect
              selected={form.skills}
              onChange={(skills) => setForm({ ...form, skills })}
              placeholder="Choose the services you want to receive offers for."
            />
          </div>
        </div>
        <label className="text-sm font-bold">Service radius (km)<input className="mt-2 min-h-12 w-full border border-border bg-card-strong px-3 text-base outline-none focus:border-primary" inputMode="decimal" value={form.service_area_radius_km} onChange={(event) => setForm({ ...form, service_area_radius_km: event.target.value })} /></label>
      </div>
      {message ? <p className="mt-3 text-sm text-danger" role="status">{message}</p> : null}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button className="touch-target flex min-h-12 items-center justify-center gap-2 border border-border bg-card-strong font-black" disabled={busy} onClick={() => setEditing(false)} type="button"><X className="size-4" />Cancel</button>
        <button className="touch-target flex min-h-12 items-center justify-center gap-2 bg-primary font-black text-primary-foreground disabled:opacity-50" disabled={busy || form.display_name.trim().length < 2 || form.phone.trim().length < 7} onClick={() => void save()} type="button"><Check className="size-4" />{busy ? "Saving..." : "Save"}</button>
      </div>
    </div>
  );
}
