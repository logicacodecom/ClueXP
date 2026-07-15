"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader } from "@cluexp/console-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppFrame } from "../../frame";

export default function NewCompanyPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    organization_name: "", legal_name: "", phone: "",
    admin_display_name: "", admin_email: "", password: ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const canSubmit =
    form.organization_name.trim() && form.admin_display_name.trim() &&
    form.admin_email.trim() && form.password.length >= 8;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_name: form.organization_name.trim(),
          legal_name: form.legal_name.trim() || undefined,
          phone: form.phone.trim() || undefined,
          admin_display_name: form.admin_display_name.trim(),
          admin_email: form.admin_email.trim(),
          password: form.password
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to create company");
      const orgId = body.active_organization_id;
      router.push(orgId ? `/companies/${orgId}` : "/companies");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create company");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppFrame>
      <PageHeader kicker="Network" title="Add company" description="Registers a new provider organization. It lands pending review, same as self-signup — this does not skip approval." />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Company details</CardTitle>
          <CardDescription>The admin account signs in to provider-web once the company is approved.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium">Company name
            <Input value={form.organization_name} onChange={(e) => set("organization_name", e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Legal name (optional)
            <Input value={form.legal_name} onChange={(e) => set("legal_name", e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Phone (optional)
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Admin name
            <Input value={form.admin_display_name} onChange={(e) => set("admin_display_name", e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Admin email
            <Input type="email" value={form.admin_email} onChange={(e) => set("admin_email", e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Temporary password (min 8 characters)
            <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
          </label>
          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          <Button disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? "Creating…" : "Create company"}</Button>
        </CardContent>
      </Card>
    </AppFrame>
  );
}
