"use client";

import type { ServiceCategory } from "@cluexp/api-client";
import { DEFAULT_SERVICE_CATALOG } from "@cluexp/api-client";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, SkillSelect } from "@cluexp/console-ui";
import { Building2, Check, Copy, CreditCard, Link2, Save, TimerReset, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface DispatchSettingField {
  value: number;
  is_override: boolean;
  platform_default: number;
}

interface DispatchStringSettingField {
  value: string;
  is_override: boolean;
  platform_default: string;
}

interface DispatchSettings {
  ack_sla_minutes: DispatchSettingField;
  stalled_minutes: DispatchSettingField;
  distance_unit: DispatchStringSettingField;
}

interface FinancialSettings {
  max_line_items: DispatchSettingField;
  tax_rate_basis_points: DispatchSettingField;
  card_fee_basis_points: DispatchSettingField;
  card_fee_fixed_cents: DispatchSettingField;
}

// Stored values are integers (basis points / cents) for exact money math, but the
// UI takes and shows human units — enter 7.25 for 7.25%, 0.30 for $0.30. `scale`
// converts between the two: stored = round(input * scale), display = stored / scale.
const FINANCIAL_LABELS: Record<keyof FinancialSettings, { label: string; help: string; scale: number; suffix: string; step: string }> = {
  max_line_items: {
    label: "Max closeout line items",
    help: "How many receipt rows a technician may add before customer confirmation.",
    scale: 1, suffix: "", step: "1"
  },
  tax_rate_basis_points: {
    label: "Tax rate (%)",
    help: "Sales tax applied to closeout receipts. Enter 7.25 for 7.25%. Technicians cannot edit this per job.",
    scale: 100, suffix: "%", step: "0.01"
  },
  card_fee_basis_points: {
    label: "Card fee (%)",
    help: "Percentage fee applied only to card-like payment methods. Enter 2.9 for 2.9%.",
    scale: 100, suffix: "%", step: "0.01"
  },
  card_fee_fixed_cents: {
    label: "Fixed card fee ($)",
    help: "Flat fee applied only to card-like payment methods. Enter 0.30 for $0.30.",
    scale: 100, suffix: "$", step: "0.01"
  }
};

function financialToHuman(value: number, field: keyof FinancialSettings): string {
  const { scale } = FINANCIAL_LABELS[field];
  return scale === 1 ? String(value) : String(value / scale);
}

function financialToStored(input: string, field: keyof FinancialSettings): number {
  return Math.round(Number(input) * FINANCIAL_LABELS[field].scale);
}

function financialDefaultLabel(value: number, field: keyof FinancialSettings): string {
  const { scale, suffix } = FINANCIAL_LABELS[field];
  const human = scale === 1 ? value : value / scale;
  return suffix === "$" ? `$${human}` : `${human}${suffix}`;
}

const INTAKE_BASE = (process.env.NEXT_PUBLIC_INTAKE_BASE_URL || "https://intake.cluexp.com").replace(/\/$/, "");

export default function SettingsPage() {
  const [form, setForm] = useState({
    display_name: "", legal_name: "", description: "", phone: "", email: "",
    contact_name: "", contact_title: "", contact_email: "", contact_phone: "",
    address_line1: "", address_line2: "", city: "", region: "", postal_code: "", country_code: "",
    website: "", customer_care_phone: "", google_profile_url: "", google_review_url: "",
    service_area_radius_km: ""
  });
  const [postalCodes, setPostalCodes] = useState<string[]>([]);
  const [postalInput, setPostalInput] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMessage, setLogoMessage] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [intakeMessage, setIntakeMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [dispatchSettings, setDispatchSettings] = useState<DispatchSettings | null>(null);
  const [ackSlaInput, setAckSlaInput] = useState("");
  const [stalledInput, setStalledInput] = useState("");
  const [distanceUnitInput, setDistanceUnitInput] = useState<"mi" | "km">("mi");
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
      setDistanceUnitInput(settings.distance_unit.value === "km" ? "km" : "mi");
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
        max_line_items: financialToHuman(settings.max_line_items.value, "max_line_items"),
        tax_rate_basis_points: financialToHuman(settings.tax_rate_basis_points.value, "tax_rate_basis_points"),
        card_fee_basis_points: financialToHuman(settings.card_fee_basis_points.value, "card_fee_basis_points"),
        card_fee_fixed_cents: financialToHuman(settings.card_fee_fixed_cents.value, "card_fee_fixed_cents")
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
      setLogoUrl(organization.logo_url ?? null);
      setPostalCodes(Array.isArray(organization.service_postal_codes) ? organization.service_postal_codes : []);
      setForm({
        display_name: organization.display_name ?? "",
        legal_name: organization.legal_name ?? "",
        description: organization.description ?? "",
        phone: organization.phone ?? "",
        email: organization.email ?? "",
        contact_name: organization.contact_name ?? "",
        contact_title: organization.contact_title ?? "",
        contact_email: organization.contact_email ?? "",
        contact_phone: organization.contact_phone ?? "",
        address_line1: organization.address_line1 ?? "",
        address_line2: organization.address_line2 ?? "",
        city: organization.city ?? "",
        region: organization.region ?? "",
        postal_code: organization.postal_code ?? "",
        country_code: organization.country_code ?? "",
        website: organization.website ?? "",
        customer_care_phone: organization.customer_care_phone ?? "",
        google_profile_url: organization.google_profile_url ?? "",
        google_review_url: organization.google_review_url ?? "",
        service_area_radius_km: organization.service_area_radius_km?.toString() ?? ""
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
      // Profile-only payload. dispatch_mode / fulfillment_policy are saved separately
      // (operational settings), and logo_url is set only via the logo upload.
      const response = await fetch("/api/workspace", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: form.display_name.trim(),
          legal_name: form.legal_name,
          description: form.description,
          contact_name: form.contact_name,
          contact_title: form.contact_title,
          contact_email: form.contact_email,
          contact_phone: form.contact_phone,
          address_line1: form.address_line1,
          address_line2: form.address_line2,
          city: form.city,
          region: form.region,
          postal_code: form.postal_code,
          country_code: form.country_code,
          phone: form.phone,
          email: form.email,
          website: form.website,
          customer_care_phone: form.customer_care_phone,
          google_profile_url: form.google_profile_url,
          google_review_url: form.google_review_url,
          service_postal_codes: postalCodes,
          service_area_radius_km: form.service_area_radius_km ? Number(form.service_area_radius_km) : null
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save company profile");
      setMessage("Company profile saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save company profile");
    } finally {
      setBusy(false);
    }
  }

  function addPostalCode() {
    const code = postalInput.trim().toUpperCase();
    if (!code) return;
    if (!postalCodes.includes(code)) setPostalCodes([...postalCodes, code]);
    setPostalInput("");
  }

  function removePostalCode(code: string) {
    setPostalCodes(postalCodes.filter((existing) => existing !== code));
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setLogoMessage(null);
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/provider/organization/logo", { method: "POST", body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to upload logo");
      setLogoUrl(body.logo_url ?? null);
      setLogoMessage("Logo uploaded.");
    } catch (cause) {
      setLogoMessage(cause instanceof Error ? cause.message : "Unable to upload logo");
    } finally {
      setLogoBusy(false);
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
          stalled_minutes: Number(stalledInput),
          distance_unit: distanceUnitInput
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save dispatch settings");
      const settings = body as DispatchSettings;
      setDispatchSettings(settings);
      setAckSlaInput(String(settings.ack_sla_minutes.value));
      setStalledInput(String(settings.stalled_minutes.value));
      setDistanceUnitInput(settings.distance_unit.value === "km" ? "km" : "mi");
      setDispatchMessage("Dispatch settings saved.");
    } catch (cause) {
      setDispatchMessage(cause instanceof Error ? cause.message : "Unable to save dispatch settings");
    } finally {
      setDispatchBusy(false);
    }
  }

  async function resetDispatchField(field: keyof DispatchSettings) {
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
      setDistanceUnitInput(settings.distance_unit.value === "km" ? "km" : "mi");
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
          max_line_items: financialToStored(financialInputs.max_line_items, "max_line_items"),
          tax_rate_basis_points: financialToStored(financialInputs.tax_rate_basis_points, "tax_rate_basis_points"),
          card_fee_basis_points: financialToStored(financialInputs.card_fee_basis_points, "card_fee_basis_points"),
          card_fee_fixed_cents: financialToStored(financialInputs.card_fee_fixed_cents, "card_fee_fixed_cents")
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save financial settings");
      const settings = body as FinancialSettings;
      setFinancialSettings(settings);
      setFinancialInputs({
        max_line_items: financialToHuman(settings.max_line_items.value, "max_line_items"),
        tax_rate_basis_points: financialToHuman(settings.tax_rate_basis_points.value, "tax_rate_basis_points"),
        card_fee_basis_points: financialToHuman(settings.card_fee_basis_points.value, "card_fee_basis_points"),
        card_fee_fixed_cents: financialToHuman(settings.card_fee_fixed_cents.value, "card_fee_fixed_cents")
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
        max_line_items: financialToHuman(settings.max_line_items.value, "max_line_items"),
        tax_rate_basis_points: financialToHuman(settings.tax_rate_basis_points.value, "tax_rate_basis_points"),
        card_fee_basis_points: financialToHuman(settings.card_fee_basis_points.value, "card_fee_basis_points"),
        card_fee_fixed_cents: financialToHuman(settings.card_fee_fixed_cents.value, "card_fee_fixed_cents")
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
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-5 text-primary" />Company profile</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground">Company identity</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm"><span className="font-medium">Display name</span><Input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Legal name</span><Input value={form.legal_name} onChange={(event) => setForm({ ...form, legal_name: event.target.value })} /></label>
              </div>
              <label className="space-y-1.5 text-sm"><span className="font-medium">Description</span>
                <textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </label>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground">Contact person in charge</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm"><span className="font-medium">Name</span><Input value={form.contact_name} onChange={(event) => setForm({ ...form, contact_name: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Title</span><Input value={form.contact_title} onChange={(event) => setForm({ ...form, contact_title: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Email</span><Input type="email" value={form.contact_email} onChange={(event) => setForm({ ...form, contact_email: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Phone</span><Input value={form.contact_phone} onChange={(event) => setForm({ ...form, contact_phone: event.target.value })} /></label>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground">Company address</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm md:col-span-2"><span className="font-medium">Address line 1</span><Input value={form.address_line1} onChange={(event) => setForm({ ...form, address_line1: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm md:col-span-2"><span className="font-medium">Address line 2</span><Input value={form.address_line2} onChange={(event) => setForm({ ...form, address_line2: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">City</span><Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Region / State</span><Input value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Postal code</span><Input value={form.postal_code} onChange={(event) => setForm({ ...form, postal_code: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Country code (ISO 2)</span><Input maxLength={2} placeholder="US" value={form.country_code} onChange={(event) => setForm({ ...form, country_code: event.target.value.toUpperCase() })} /></label>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground">Contact &amp; web</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm"><span className="font-medium">Company phone</span><Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Company email</span><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Customer-care phone</span><Input value={form.customer_care_phone} onChange={(event) => setForm({ ...form, customer_care_phone: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Website (https://)</span><Input type="url" placeholder="https://" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Google profile URL</span><Input type="url" placeholder="https://" value={form.google_profile_url} onChange={(event) => setForm({ ...form, google_profile_url: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Google review URL</span><Input type="url" placeholder="https://" value={form.google_review_url} onChange={(event) => setForm({ ...form, google_review_url: event.target.value })} /></label>
              </div>
              <p className="text-xs text-muted-foreground">Customer-care phone, branding, and Google links are stored for upcoming customer-facing features and are not shown publicly yet.</p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Company logo</h3>
              <div className="flex items-center gap-4">
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary">
                  {logoUrl ? <img src={logoUrl} alt="Company logo" className="size-full object-contain" /> : <Building2 className="size-8 text-muted-foreground" />}
                </div>
                <div className="space-y-1.5">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium">
                    <Upload className="size-4" />{logoBusy ? "Uploading…" : "Upload logo"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={logoBusy}
                      onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.target.value = ""; }} />
                  </label>
                  <p className="text-xs text-muted-foreground">PNG, JPEG, or WebP · up to 2 MB · 64–2048px.</p>
                  {logoMessage ? <div className="text-xs" role="status">{logoMessage}</div> : null}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Service coverage (postal codes)</h3>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input placeholder="Add a postal code" value={postalInput}
                  onChange={(event) => setPostalInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addPostalCode(); } }} />
                <Button type="button" variant="outline" className="shrink-0" onClick={addPostalCode}>Add</Button>
              </div>
              {postalCodes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {postalCodes.map((code) => (
                    <Badge key={code} variant="outline" className="gap-1.5">
                      {code}
                      <button type="button" aria-label={`Remove ${code}`} className="text-muted-foreground hover:text-foreground" onClick={() => removePostalCode(code)}>×</button>
                    </Badge>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">No service postal codes yet.</p>}
            </div>

            <label className="space-y-1.5 text-sm block max-w-xs"><span className="font-medium">Service radius (km)</span><Input inputMode="decimal" value={form.service_area_radius_km} onChange={(event) => setForm({ ...form, service_area_radius_km: event.target.value })} /></label>

            {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
            <Button disabled={busy || !form.display_name.trim()} onClick={() => void save()}><Save className="size-4" />{busy ? "Saving…" : "Save company profile"}</Button>
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
                      inputMode="decimal"
                      min={0}
                      step={meta.step}
                      type="number"
                      value={financialInputs[field]}
                      onChange={(event) => setFinancialInputs((current) => ({ ...current, [field]: event.target.value }))}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">{meta.help}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {setting?.is_override
                        ? <>Overridden — platform default is {financialDefaultLabel(setting.platform_default, field)}.</>
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
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="distance-unit">Distance unit</label>
                <select
                  id="distance-unit"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={distanceUnitInput}
                  onChange={(event) => setDistanceUnitInput(event.target.value === "km" ? "km" : "mi")}
                >
                  <option value="mi">Miles (mi)</option>
                  <option value="km">Kilometers (km)</option>
                </select>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {dispatchSettings?.distance_unit.is_override
                    ? <>Overridden — platform default is {dispatchSettings.distance_unit.platform_default}.</>
                    : <>Using the platform default.</>}
                  {dispatchSettings?.distance_unit.is_override ? (
                    <Button
                      variant="ghost" className="h-auto px-1.5 py-0.5 text-xs"
                      disabled={dispatchBusy} onClick={() => void resetDispatchField("distance_unit")}
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
      </div>
    </AppFrame>
  );
}
