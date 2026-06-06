"use client";

import { LanguageSelect, sessionRequest, useLocale } from "@cluexp/app-core";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { useState } from "react";

export default function SignUpPage() {
  const { locale, t } = useLocale();
  const [form, setForm] = useState({ admin_display_name: "", admin_email: "", password: "", organization_name: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sessionRequest<{ session?: { active_organization_id?: string } }>("/api/register", {
        method: "POST",
        body: JSON.stringify({ ...form, locale })
      });
      setMessage(`Account request received. Registration ID: ${result.session?.active_organization_id ?? "pending assignment"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("unableToConnect"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <LanguageSelect className="absolute right-6 top-6" />
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>{t("signUp")}</CardTitle><CardDescription>Create a provider organization access request.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <Input aria-label="Full name" autoComplete="name" placeholder="Full name" value={form.admin_display_name} onChange={(event) => setForm({ ...form, admin_display_name: event.target.value })} />
          <Input aria-label="Organization" autoComplete="organization" placeholder="Organization" value={form.organization_name} onChange={(event) => setForm({ ...form, organization_name: event.target.value })} />
          <Input aria-label="Email" autoComplete="email" placeholder="Email" type="email" value={form.admin_email} onChange={(event) => setForm({ ...form, admin_email: event.target.value })} />
          <Input aria-label={t("password")} autoComplete="new-password" placeholder={t("password")} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          {message ? <p className="rounded-md border border-border p-3 text-sm" role="status">{message}</p> : null}
          <Button className="min-h-11 w-full" disabled={busy || !form.admin_display_name || !form.organization_name || !form.admin_email || form.password.length < 8} onClick={submit}>{busy ? t("saving") : t("signUp")}</Button>
          <a className="block min-h-11 pt-3 text-center text-sm font-semibold" href="/signin">{t("signIn")}</a>
        </CardContent>
      </Card>
    </main>
  );
}
