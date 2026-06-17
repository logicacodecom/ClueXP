"use client";

import { LanguageSelect, sessionRequest, useLocale } from "@cluexp/app-core";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { Building2, ShieldCheck } from "lucide-react";
import { useState } from "react";

export default function SignUpPage() {
  const { locale, t } = useLocale();
  const [form, setForm] = useState({
    organization_name: "", legal_name: "", phone: "",
    admin_display_name: "", admin_email: "", password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = form.organization_name.trim() && form.admin_display_name.trim()
    && form.admin_email.trim() && form.password.length >= 8;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await sessionRequest("/api/register", { method: "POST", body: JSON.stringify({ ...form, locale }) });
      // Hard navigation so the freshly-set session cookie is read on a full load.
      window.location.assign("/onboarding");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("unableToConnect"));
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <LanguageSelect className="absolute right-6 top-6" />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div>
            <Badge variant="outline" className="gap-1"><Building2 className="size-3" />Provider company signup</Badge>
            <CardTitle className="mt-3">Create your company account</CardTitle>
            <CardDescription>
              Register your company to dispatch your own technicians on ClueXP. After signup your
              account is <strong>pending Ops review</strong> — you can upload required documents
              while you wait, and a platform admin will approve, reject, or follow up.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</p>
            <Input aria-label="Company name" autoComplete="organization" placeholder="Company name *"
              value={form.organization_name} onChange={(e) => setForm({ ...form, organization_name: e.target.value })} />
            <Input aria-label="Legal name" placeholder="Legal/registered name (optional)"
              value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
            <Input aria-label="Company phone" autoComplete="tel" placeholder="Company phone (optional)"
              value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Administrator</p>
            <Input aria-label="Full name" autoComplete="name" placeholder="Your full name *"
              value={form.admin_display_name} onChange={(e) => setForm({ ...form, admin_display_name: e.target.value })} />
            <Input aria-label="Email" autoComplete="email" type="email" placeholder="Work email *"
              value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} />
            <Input aria-label={t("password")} autoComplete="new-password" type="password" placeholder="Password (min 8 characters) *"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>

          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

          <div className="flex items-start gap-2 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            <span>Ops reviews every company before it can dispatch. You&apos;ll see your status
              (pending review → active) inside the console after signup.</span>
          </div>

          <Button className="min-h-11 w-full" disabled={busy || !canSubmit} onClick={submit}>
            {busy ? t("saving") : "Create company account"}
          </Button>
          <a className="block min-h-11 pt-2 text-center text-sm font-semibold text-muted-foreground hover:text-foreground" href="/signin">{t("signIn")}</a>
        </CardContent>
      </Card>
    </main>
  );
}
