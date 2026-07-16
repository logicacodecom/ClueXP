"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader } from "@cluexp/console-ui";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface GlobalSetting { key: string; value: number; description?: string | null }

interface CloseoutItemType {
  code: string;
  label: string;
  status: "draft" | "active" | "deprecated";
  default_taxable: boolean;
  default_compensation_eligible: boolean;
  default_reimbursement_eligible: boolean;
  requires_provided_by: boolean;
  requires_note: boolean;
  requires_receipt: boolean;
  sort_order: number;
}

const LIMIT_KEYS = ["max_users_per_org", "max_technicians_per_org"] as const;
const FINANCIAL_KEYS = [
  "closeout_max_line_items",
  "closeout_default_tax_rate_basis_points",
  "closeout_card_fee_basis_points",
  "closeout_card_fee_fixed_cents"
] as const;
const ALL_SETTING_KEYS = [...LIMIT_KEYS, ...FINANCIAL_KEYS] as const;
type SettingKey = (typeof ALL_SETTING_KEYS)[number];

const LABELS: Record<SettingKey, string> = {
  max_users_per_org: "Default max users per company",
  max_technicians_per_org: "Default max technicians per company",
  closeout_max_line_items: "Default max closeout line items",
  closeout_default_tax_rate_basis_points: "Default tax rate (basis points)",
  closeout_card_fee_basis_points: "Default card fee percent (basis points)",
  closeout_card_fee_fixed_cents: "Default fixed card fee (cents)"
};

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [itemTypes, setItemTypes] = useState<CloseoutItemType[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/global-settings", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(body.detail || "Unable to load settings"); return; }
    const settings: GlobalSetting[] = body.settings ?? [];
    const next: Record<string, string> = {};
    for (const key of ALL_SETTING_KEYS) {
      const found = settings.find((s) => s.key === key);
      if (found) next[key] = String(found.value);
    }
    setValues(next);
    const itemResponse = await fetch("/api/closeout-item-types", { cache: "no-store" });
    const itemBody = await itemResponse.json().catch(() => ({}));
    if (!itemResponse.ok) { setMessage(itemBody.detail || "Unable to load closeout item types"); return; }
    setItemTypes(Array.isArray(itemBody.item_types) ? itemBody.item_types : []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function save(key: SettingKey) {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(`/api/global-settings/${key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: Number(values[key]) })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save setting");
      setMessage("Platform default updated.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save setting");
    } finally {
      setBusy(null);
    }
  }

  async function saveItemType(item: CloseoutItemType) {
    setBusy(`item:${item.code}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/closeout-item-types/${encodeURIComponent(item.code)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save item type");
      setItemTypes((current) => current.map((row) => row.code === item.code ? body as CloseoutItemType : row));
      setMessage("Closeout item type updated.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save item type");
    } finally {
      setBusy(null);
    }
  }

  function updateItemType(code: string, patch: Partial<CloseoutItemType>) {
    setItemTypes((current) => current.map((row) => row.code === code ? { ...row, ...patch } : row));
  }

  function renderSettingInput(key: SettingKey) {
    return (
      <label className="block space-y-1.5 text-sm font-medium" key={key}>
        {LABELS[key]}
        <div className="flex gap-2">
          <Input
            min={key === "closeout_default_tax_rate_basis_points" || key === "closeout_card_fee_basis_points" || key === "closeout_card_fee_fixed_cents" ? 0 : 1}
            onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
            type="number"
            value={values[key] ?? ""}
          />
          <Button disabled={busy !== null} onClick={() => void save(key)}>{busy === key ? "Saving…" : "Save"}</Button>
        </div>
      </label>
    );
  }

  return (
    <AppFrame>
      <PageHeader kicker="Platform" title="Settings" description="Platform-wide defaults for new companies." />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Tenant limit defaults</CardTitle>
            <CardDescription>Applies to every company without its own override (set per-company on the Companies page).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {message ? <div className="rounded-md border border-border bg-secondary p-3 text-sm" role="status">{message}</div> : null}
            {LIMIT_KEYS.map(renderSettingInput)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Financial closeout defaults</CardTitle>
            <CardDescription>Fallbacks inherited by providers unless they set their own values. These do not process payments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {FINANCIAL_KEYS.map(renderSettingInput)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Closeout item type catalog</CardTitle>
            <CardDescription>Platform taxonomy for future itemized receipts and settlement calculations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              {itemTypes.map((item) => (
                <div className="rounded-lg border border-border bg-secondary/30 p-4" key={item.code}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded border border-border bg-background px-2 py-1 text-xs">{item.code}</code>
                        <Badge variant={item.status === "active" ? "success" : "outline"}>{item.status}</Badge>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_110px]">
                        <Input value={item.label} onChange={(event) => updateItemType(item.code, { label: event.target.value })} aria-label={`${item.code} label`} />
                        <select
                          className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
                          value={item.status}
                          onChange={(event) => updateItemType(item.code, { status: event.target.value as CloseoutItemType["status"] })}
                          aria-label={`${item.code} status`}
                        >
                          <option value="draft">Draft</option>
                          <option value="active">Active</option>
                          <option value="deprecated">Deprecated</option>
                        </select>
                        <Input
                          type="number"
                          value={String(item.sort_order)}
                          onChange={(event) => updateItemType(item.code, { sort_order: Number(event.target.value) })}
                          aria-label={`${item.code} sort order`}
                        />
                      </div>
                    </div>
                    <Button disabled={busy !== null || !item.label.trim()} onClick={() => void saveItemType(item)}>
                      {busy === `item:${item.code}` ? "Saving…" : "Save item"}
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                    {([
                      ["default_taxable", "Taxable by default"],
                      ["default_compensation_eligible", "Comp eligible"],
                      ["default_reimbursement_eligible", "Reimbursable"],
                      ["requires_provided_by", "Needs provided-by"],
                      ["requires_note", "Needs note"],
                      ["requires_receipt", "Needs receipt"]
                    ] as const).map(([field, label]) => (
                      <label className="flex items-center gap-2" key={field}>
                        <input
                          type="checkbox"
                          checked={Boolean(item[field])}
                          onChange={(event) => updateItemType(item.code, { [field]: event.target.checked } as Partial<CloseoutItemType>)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
