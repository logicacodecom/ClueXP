"use client";

import { LanguageSettings } from "@cluexp/app-core";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { Check, Copy, Link2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { AppFrame } from "../frame";

const INTAKE_BASE = (process.env.NEXT_PUBLIC_INTAKE_BASE_URL || "https://intake.cluexp.com").replace(/\/$/, "");

export default function SettingsPage() {
  const [form, setForm] = useState({
    display_name: "", legal_name: "", description: "", phone: "", email: "",
    service_area_radius_km: "", dispatch_mode: "organization_managed",
    fulfillment_policy: "owner_first_then_network"
  });
  const [slug, setSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [intakeMessage, setIntakeMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/workspace", { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load organization");
      const organization = body.organization ?? {};
      setSlug(organization.slug ?? null);
      setForm({
        display_name: organization.display_name ?? "",
        legal_name: organization.legal_name ?? "",
        description: organization.description ?? "",
        phone: organization.phone ?? "",
        email: organization.email ?? "",
        service_area_radius_km: organization.service_area_radius_km?.toString() ?? "",
        dispatch_mode: organization.dispatch_mode ?? "organization_managed",
        fulfillment_policy: organization.fulfillment_policy ?? "owner_first_then_network"
      });
    }).catch((error) => setMessage(error.message));
  }, []);

  const intakeUrl = slug ? `${INTAKE_BASE}/o/${slug}` : null;

  async function copyIntakeLink() {
    if (!intakeUrl) return;
    try {
      await navigator.clipboard.writeText(intakeUrl);
      setCopied(true);
      setIntakeMessage("Intake link copied to clipboard.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setIntakeMessage("Could not copy automatically — select and copy the link manually.");
    }
  }

  async function generateIntakeLink() {
    setGenerating(true);
    setIntakeMessage(null);
    try {
      const response = await fetch("/api/provider/intake-channel", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to generate intake link");
      setSlug(body.slug);
      setIntakeMessage("Branded intake link is ready.");
    } catch (cause) {
      setIntakeMessage(cause instanceof Error ? cause.message : "Unable to generate intake link");
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          service_area_radius_km: form.service_area_radius_km ? Number(form.service_area_radius_km) : null
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save organization");
      setMessage("Organization settings saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save organization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppFrame>
      <div className="space-y-6">
        <LanguageSettings className="rounded-md border border-border bg-card p-6" />
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="size-5 text-primary" />Your intake link</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Share this branded link with your customers. Requests submitted here are routed to your company.</p>
            {intakeUrl ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-secondary px-3 py-2.5 text-sm" title={intakeUrl}>{intakeUrl}</code>
                <Button className="shrink-0" variant="outline" onClick={() => void copyIntakeLink()}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-secondary/40 p-4">
                <div className="text-sm font-medium">No intake link yet</div>
                <p className="mt-1 text-sm text-muted-foreground">Generate a branded intake link so customers can request service directly from your company.</p>
                <Button className="mt-3" disabled={generating} onClick={() => void generateIntakeLink()}>{generating ? "Generating…" : "Generate intake link"}</Button>
              </div>
            )}
            {intakeMessage ? <div className="text-sm text-muted-foreground" role="status">{intakeMessage}</div> : null}
            {slug ? <Badge variant="outline">slug: {slug}</Badge> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Organization profile</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Input placeholder="Display name" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} />
            <Input placeholder="Legal name" value={form.legal_name} onChange={(event) => setForm({ ...form, legal_name: event.target.value })} />
            <Input placeholder="Contact email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            <Input placeholder="Contact phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            <Input placeholder="Service radius (km)" inputMode="decimal" value={form.service_area_radius_km} onChange={(event) => setForm({ ...form, service_area_radius_km: event.target.value })} />
            <Input placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Dispatch policy</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm font-medium">Dispatch manager<select className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3" value={form.dispatch_mode} onChange={(event) => setForm({ ...form, dispatch_mode: event.target.value })}><option value="organization_managed">Organization managed</option><option value="platform_managed">ClueXP managed</option></select></label>
            <label className="space-y-2 text-sm font-medium">Fulfillment policy<select className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3" value={form.fulfillment_policy} onChange={(event) => setForm({ ...form, fulfillment_policy: event.target.value })}><option value="private_owner_only">Private roster only</option><option value="owner_first_then_network">Roster first, then network</option><option value="network_open">Verified network open</option></select></label>
          </CardContent>
        </Card>
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
        <Button disabled={busy || !form.display_name.trim()} onClick={() => void save()}><Save className="size-4" />{busy ? "Saving…" : "Save settings"}</Button>
      </div>
    </AppFrame>
  );
}
