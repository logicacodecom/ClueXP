"use client";

import type { ServiceCategory } from "@cluexp/api-client";
import { DEFAULT_SERVICE_CATALOG } from "@cluexp/api-client";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, SkillSelect } from "@cluexp/console-ui";
import { Check, Copy, CreditCard, Link2, Save, TimerReset } from "lucide-react";
import { useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface DispatchSettingField {
  value: number;
  is_override: boolean;
  platform_default: number;
}

interface DispatchSettings {
  ack_sla_minutes: DispatchSettingField;
  stalled_minutes: DispatchSettingField;
}

interface FinancialSettings {
  max_line_items: DispatchSettingField;
  tax_rate_basis_points: DispatchSettingField;
  card_fee_basis_points: DispatchSettingField;
  card_fee_fixed_cents: DispatchSettingField;
}

const FINANCIAL_LABELS: Record<keyof FinancialSettings, { label: string; help: string }> = {
  max_line_items: {
    label: "Max closeout line items",
    help: "How many receipt rows a technician may add before customer confirmation."
  },
  tax_rate_basis_points: {
    label: "Tax rate (basis points)",
    help: "725 means 7.25%. Technicians cannot edit this per job."
  },
  card_fee_basis_points: {
    label: "Card fee percent (basis points)",
    help: "Applied only to card-like payment methods. 290 means 2.9%."
  },
  card_fee_fixed_cents: {
    label: "Fixed card fee (cents)",
    help: "Applied only to card-like payment methods. 30 means $0.30."
  }
};

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

  const [dispatchSettings, setDispatchSettings] = useState<DispatchSettings | null>(null);
  const [ackSlaInput, setAckSlaInput] = useState("");
  const [stalledInput, setStalledInput] = useState("");
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [capabilitySkills, setCapabilitySkills] = useState<string[]>([]);
  const [capabilityCatalog, setCapabilityCatalog] = useState<ServiceCategory[]>(DEFAULT_SERVICE_CATALOG);
  const [capabilityMessage, setCapabilityMessage] = useState<string | null>(null);
  const [capabilityBusy, setCapabilityBusy] = useState(false);
  const [financialSettings, setFinancialSettings] = useState<FinancialSettings | null>(null);
  const [financialInputs, setFinancialInputs] = useState({
    max_line_items: "",
    tax_rate_basis_points: "",
    card_fee_basis_points: "",
    card_fee_fixed_cents: ""
  });
  const [financialMessage, setFinancialMessage] = useState<string | null>(null);
  const [financialBusy, setFinancialBusy] = useState(false);

  async function loadDispatchSettings() {
    try {
      const response = await fetch("/api/provider/settings/dispatch", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load dispatch settings");
      const settings = body as DispatchSettings;
      setDispatchSettings(settings);
      setAckSlaInput(String(settings.ack_sla_minutes.value));
      setStalledInput(String(settings.stalled_minutes.value));
    } catch (cause) {
      setDispatchMessage(cause instanceof Error ? cause.message : "Unable to load dispatch settings");
    }
  }

  async function loadCapabilities() {
    try {
      const response = await fetch("/api/provider/settings/capabilities", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load service capabilities");
      setCapabilitySkills(body.skills ?? []);
      setCapabilityCatalog(body.catalog ?? DEFAULT_SERVICE_CATALOG);
    } catch (cause) {
      setCapabilityMessage(cause instanceof Error ? cause.message : "Unable to load service capabilities");
    }
  }

  async function loadFinancialSettings() {
    try {
      const response = await fetch("/api/provider/settings/financial", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load financial settings");
      const settings = body as FinancialSettings;
      setFinancialSettings(settings);
      setFinancialInputs({
        max_line_items: String(settings.max_line_items.value),
        tax_rate_basis_points: String(settings.tax_rate_basis_points.value),
        card_fee_basis_points: String(settings.card_fee_basis_points.value),
        card_fee_fixed_cents: String(settings.card_fee_fixed_cents.value)
      });
    } catch (cause) {
      setFinancialMessage(cause instanceof Error ? cause.message : "Unable to load financial settings");
    }
  }

  useEffect(() => {
    void loadDispatchSettings();
    void loadCapabilities();
    void loadFinancialSettings();
  }, []);

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

  async function saveDispatchSettings() {
    setDispatchBusy(true);
    setDispatchMessage(null);
    try {
      const response = await fetch("/api/provider/settings/dispatch", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ack_sla_minutes: Number(ackSlaInput),
          stalled_minutes: Number(stalledInput)
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save dispatch settings");
      const settings = body as DispatchSettings;
      setDispatchSettings(settings);
      setAckSlaInput(String(settings.ack_sla_minutes.value));
      setStalledInput(String(settings.stalled_minutes.value));
      setDispatchMessage("Dispatch settings saved.");
    } catch (cause) {
      setDispatchMessage(cause instanceof Error ? cause.message : "Unable to save dispatch settings");
    } finally {
      setDispatchBusy(false);
    }
  }

  async function resetDispatchField(field: "ack_sla_minutes" | "stalled_minutes") {
    setDispatchBusy(true);
    setDispatchMessage(null);
    try {
      const response = await fetch("/api/provider/settings/dispatch", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: null })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to reset to platform default");
      const settings = body as DispatchSettings;
      setDispatchSettings(settings);
      setAckSlaInput(String(settings.ack_sla_minutes.value));
      setStalledInput(String(settings.stalled_minutes.value));
      setDispatchMessage("Reverted to the platform default.");
    } catch (cause) {
      setDispatchMessage(cause instanceof Error ? cause.message : "Unable to reset to platform default");
    } finally {
      setDispatchBusy(false);
    }
  }

  async function saveCapabilities() {
    setCapabilityBusy(true);
    setCapabilityMessage(null);
    try {
      const response = await fetch("/api/provider/settings/capabilities", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skills: capabilitySkills })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save service capabilities");
      setCapabilitySkills(body.skills ?? []);
      setCapabilityCatalog(body.catalog ?? capabilityCatalog);
      setCapabilityMessage("Company service capabilities saved.");
    } catch (cause) {
      setCapabilityMessage(cause instanceof Error ? cause.message : "Unable to save service capabilities");
    } finally {
      setCapabilityBusy(false);
    }
  }

  async function saveFinancialSettings() {
    setFinancialBusy(true);
    setFinancialMessage(null);
    try {
      const response = await fetch("/api/provider/settings/financial", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          max_line_items: Number(financialInputs.max_line_items),
          tax_rate_basis_points: Number(financialInputs.tax_rate_basis_points),
          card_fee_basis_points: Number(financialInputs.card_fee_basis_points),
          card_fee_fixed_cents: Number(financialInputs.card_fee_fixed_cents)
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save financial settings");
      const settings = body as FinancialSettings;
      setFinancialSettings(settings);
      setFinancialInputs({
        max_line_items: String(settings.max_line_items.value),
        tax_rate_basis_points: String(settings.tax_rate_basis_points.value),
        card_fee_basis_points: String(settings.card_fee_basis_points.value),
        card_fee_fixed_cents: String(settings.card_fee_fixed_cents.value)
      });
      setFinancialMessage("Financial closeout settings saved.");
    } catch (cause) {
      setFinancialMessage(cause instanceof Error ? cause.message : "Unable to save financial settings");
    } finally {
      setFinancialBusy(false);
    }
  }

  async function resetFinancialField(field: keyof FinancialSettings) {
    setFinancialBusy(true);
    setFinancialMessage(null);
    try {
      const response = await fetch("/api/provider/settings/financial", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: null })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to reset to platform default");
      const settings = body as FinancialSettings;
      setFinancialSettings(settings);
      setFinancialInputs({
        max_line_items: String(settings.max_line_items.value),
        tax_rate_basis_points: String(settings.tax_rate_basis_points.value),
        card_fee_basis_points: String(settings.card_fee_basis_points.value),
        card_fee_fixed_cents: String(settings.card_fee_fixed_cents.value)
      });
      setFinancialMessage("Reverted to the platform default.");
    } catch (cause) {
      setFinancialMessage(cause instanceof Error ? cause.message : "Unable to reset to platform default");
    } finally {
      setFinancialBusy(false);
    }
  }

  return (
    <AppFrame>
      <div className="space-y-6">
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
        <Card>
          <CardHeader><CardTitle>Company service capabilities</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select the active services this company offers. Dispatch checks this company list before a technician can be assigned.
            </p>
            <SkillSelect
              catalog={capabilityCatalog}
              selected={capabilitySkills}
              onChange={setCapabilitySkills}
              placeholder="Choose the services your company offers."
            />
            {capabilityMessage ? <div className="text-sm" role="status">{capabilityMessage}</div> : null}
            <Button disabled={capabilityBusy} onClick={() => void saveCapabilities()} variant="outline">
              <Save className="size-4" />{capabilityBusy ? "Saving…" : "Save service capabilities"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="size-5 text-primary" />Financial closeout defaults</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              These values prepare the future itemized closeout flow. They set receipt calculation defaults only; they do not process charges or pay technicians.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {(Object.keys(FINANCIAL_LABELS) as Array<keyof FinancialSettings>).map((field) => {
                const meta = FINANCIAL_LABELS[field];
                const setting = financialSettings?.[field];
                return (
                  <div className="space-y-1.5" key={field}>
                    <label className="text-sm font-medium" htmlFor={`financial-${field}`}>{meta.label}</label>
                    <Input
                      id={`financial-${field}`}
                      inputMode="numeric"
                      min={0}
                      type="number"
                      value={financialInputs[field]}
                      onChange={(event) => setFinancialInputs((current) => ({ ...current, [field]: event.target.value }))}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">{meta.help}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {setting?.is_override
                        ? <>Overridden — platform default is {setting.platform_default}.</>
                        : <>Using the platform default.</>}
                      {setting?.is_override ? (
                        <Button
                          variant="ghost"
                          className="h-auto px-1.5 py-0.5 text-xs"
                          disabled={financialBusy}
                          onClick={() => void resetFinancialField(field)}
                        >
                          <TimerReset className="size-3" />Reset
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {financialMessage ? <div className="text-sm" role="status">{financialMessage}</div> : null}
            <Button
              variant="outline"
              disabled={financialBusy || Object.values(financialInputs).some((value) => !value.trim())}
              onClick={() => void saveFinancialSettings()}
            >
              <Save className="size-4" />{financialBusy ? "Saving…" : "Save financial settings"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Dispatch queue thresholds</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              How long an unassigned job waits before your live queue flags it. Leave a field at
              the platform default unless your team needs a different pace.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="ack-sla-minutes">Acknowledgement SLA (minutes)</label>
                <Input
                  id="ack-sla-minutes" inputMode="numeric" value={ackSlaInput}
                  onChange={(event) => setAckSlaInput(event.target.value)}
                />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {dispatchSettings?.ack_sla_minutes.is_override
                    ? <>Overridden — platform default is {dispatchSettings.ack_sla_minutes.platform_default}m.</>
                    : <>Using the platform default.</>}
                  {dispatchSettings?.ack_sla_minutes.is_override ? (
                    <Button
                      variant="ghost" className="h-auto px-1.5 py-0.5 text-xs"
                      disabled={dispatchBusy} onClick={() => void resetDispatchField("ack_sla_minutes")}
                    >
                      <TimerReset className="size-3" />Reset to default
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="stalled-minutes">Stalled threshold (minutes)</label>
                <Input
                  id="stalled-minutes" inputMode="numeric" value={stalledInput}
                  onChange={(event) => setStalledInput(event.target.value)}
                />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {dispatchSettings?.stalled_minutes.is_override
                    ? <>Overridden — platform default is {dispatchSettings.stalled_minutes.platform_default}m.</>
                    : <>Using the platform default.</>}
                  {dispatchSettings?.stalled_minutes.is_override ? (
                    <Button
                      variant="ghost" className="h-auto px-1.5 py-0.5 text-xs"
                      disabled={dispatchBusy} onClick={() => void resetDispatchField("stalled_minutes")}
                    >
                      <TimerReset className="size-3" />Reset to default
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            {dispatchMessage ? <div className="text-sm" role="status">{dispatchMessage}</div> : null}
            <Button
              variant="outline" disabled={dispatchBusy || !ackSlaInput.trim() || !stalledInput.trim()}
              onClick={() => void saveDispatchSettings()}
            >
              <Save className="size-4" />{dispatchBusy ? "Saving…" : "Save dispatch settings"}
            </Button>
          </CardContent>
        </Card>
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
        <Button disabled={busy || !form.display_name.trim()} onClick={() => void save()}><Save className="size-4" />{busy ? "Saving…" : "Save settings"}</Button>
      </div>
    </AppFrame>
  );
}
