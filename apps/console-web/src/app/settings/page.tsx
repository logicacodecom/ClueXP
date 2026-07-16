"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader } from "@cluexp/console-ui";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface GlobalSetting { key: string; value: number; description?: string | null }

const LIMIT_KEYS = ["max_users_per_org", "max_technicians_per_org"] as const;
const LABELS: Record<(typeof LIMIT_KEYS)[number], string> = {
  max_users_per_org: "Default max users per company",
  max_technicians_per_org: "Default max technicians per company"
};

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/global-settings", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(body.detail || "Unable to load settings"); return; }
    const settings: GlobalSetting[] = body.settings ?? [];
    const next: Record<string, string> = {};
    for (const key of LIMIT_KEYS) {
      const found = settings.find((s) => s.key === key);
      if (found) next[key] = String(found.value);
    }
    setValues(next);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function save(key: (typeof LIMIT_KEYS)[number]) {
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
            {LIMIT_KEYS.map((key) => (
              <label className="block space-y-1.5 text-sm font-medium" key={key}>
                {LABELS[key]}
                <div className="flex gap-2">
                  <Input
                    min={1}
                    onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    type="number"
                    value={values[key] ?? ""}
                  />
                  <Button disabled={busy !== null} onClick={() => void save(key)}>{busy === key ? "Saving…" : "Save"}</Button>
                </div>
              </label>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
