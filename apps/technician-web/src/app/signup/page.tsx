"use client";

import { LanguageToggle, sessionRequest, useLocale, useServiceCatalog } from "@cluexp/app-core";
import { SkillSelect } from "@cluexp/console-ui";
import { useEffect, useState } from "react";
import { AppFrame, Screen } from "@/components/mobile";

export default function SignUpPage() {
  const { locale, t } = useLocale();
  const [form, setForm] = useState({ display_name: "", email: "", phone: "", password: "" });
  const [skills, setSkills] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteOrg, setInviteOrg] = useState<string | null>(null);
  const { catalog, error: catalogError } = useServiceCatalog();

  // Company-invite signup: read ?invite=<token> and resolve the inviting company
  // so the technician knows who they'll be affiliated with. On submit the token
  // is forwarded so the backend links them as a pending affiliation.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;
    setInviteToken(token);
    void fetch(`/api/invite/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return;
        setInviteOrg(body.organization_name ?? "your inviting company");
        if (body.email) setForm((f) => ({ ...f, email: f.email || body.email }));
      })
      .catch(() => { /* invalid invite → plain signup */ });
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await sessionRequest<{ session?: { technician?: { id?: string } } }>("/api/register", {
        method: "POST",
        body: JSON.stringify({
          ...form, locale, skills,
          ...(inviteToken ? { invite_token: inviteToken } : {})
        })
      });
      setMessage(`Account request received. Registration ID: ${result.session?.technician?.id ?? "pending assignment"}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t("unableToConnect"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppFrame nav={false} title={t("signUp")} topbar={false}>
      <Screen>
        <div className="flex justify-end py-4"><LanguageToggle /></div>
        <form className="space-y-4 pb-8" onSubmit={submit}>
          <div><h1 className="text-3xl font-black">{t("signUp")}</h1><p className="mt-2 text-sm text-muted">Technician access requires identity and compliance verification.</p></div>
          {inviteOrg ? <p className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm font-bold" role="status">You were invited by {inviteOrg}. After signup you'll be linked to them for dispatch (pending your acceptance).</p> : null}
          {[
            ["display_name", "Full name", "name", "text"],
            ["email", "Email", "email", "email"],
            ["phone", "Phone", "tel", "tel"],
            ["password", t("password"), "new-password", "password"]
          ].map(([key, label, autoComplete, type]) => (
            <label className="block text-sm font-bold" key={key}>
              {label}
              <input className="mt-2 min-h-12 w-full rounded-xl border border-border bg-card-strong px-4 text-base outline-none focus:border-primary" autoComplete={autoComplete} type={type} value={form[key as keyof typeof form]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
            </label>
          ))}
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 text-sm font-bold">Skills</div>
            <SkillSelect
              catalog={catalog}
              selected={skills}
              onChange={setSkills}
              placeholder="Choose the services you want to receive offers for."
            />
            {catalogError ? <div className="mt-2 text-xs text-muted" role="status">{catalogError}; showing the seeded catalog.</div> : null}
          </div>
          {message ? <p className="rounded-xl border border-border bg-card p-3 text-sm" role="status">{message}</p> : null}
          <button className="touch-target min-h-[54px] w-full rounded-2xl bg-primary px-4 text-base font-black text-primary-foreground disabled:opacity-50" disabled={busy || !form.display_name || !form.email || !form.phone || form.password.length < 8} type="submit">{busy ? t("saving") : t("signUp")}</button>
          <a className="touch-target flex min-h-11 items-center justify-center text-sm font-bold text-muted" href="/signin">{t("signIn")}</a>
        </form>
      </Screen>
    </AppFrame>
  );
}
