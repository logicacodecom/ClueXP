"use client";

import { LanguageSelect, sessionRequest, useLocale } from "@cluexp/app-core";
import { useState } from "react";
import { AppFrame, Screen } from "@/components/mobile";

export default function SignUpPage() {
  const { locale, t } = useLocale();
  const [form, setForm] = useState({ display_name: "", email: "", phone: "", password: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await sessionRequest("/api/register", {
        method: "POST",
        body: JSON.stringify({ ...form, locale })
      });
      setMessage("Account request received. Dispatch will notify you after verification.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t("unableToConnect"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppFrame nav={false} title={t("signUp")} topbar={false}>
      <Screen>
        <div className="flex justify-end py-4"><LanguageSelect /></div>
        <form className="space-y-4 pb-8" onSubmit={submit}>
          <div><h1 className="text-3xl font-black">{t("signUp")}</h1><p className="mt-2 text-sm text-muted">Technician access requires identity and compliance verification.</p></div>
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
          {message ? <p className="rounded-xl border border-border bg-card p-3 text-sm" role="status">{message}</p> : null}
          <button className="touch-target min-h-[54px] w-full rounded-2xl bg-primary px-4 text-base font-black text-primary-foreground disabled:opacity-50" disabled={busy || !form.display_name || !form.email || !form.phone || form.password.length < 8} type="submit">{busy ? t("saving") : t("signUp")}</button>
          <a className="touch-target flex min-h-11 items-center justify-center text-sm font-bold text-muted" href="/signin">{t("signIn")}</a>
        </form>
      </Screen>
    </AppFrame>
  );
}
