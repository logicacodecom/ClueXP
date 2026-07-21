"use client";

import { LanguageToggle, sessionRequest, useLocale } from "@cluexp/app-core";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AppFrame, Screen } from "@/components/mobile";

export default function SignInPage() {
  const { t } = useLocale();
  const [identifier, setIdentifier] = useState("jordan@cluexp.example");
  const [password, setPassword] = useState("123456");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sessionRequest("/api/session", {
        method: "POST",
        body: JSON.stringify({ identifier, password })
      });
      // Hard navigation (not router.replace) so the auth gate reads the freshly-set
      // session cookie on a full load — a soft client transition can land on a
      // stale session and bounce back here.
      window.location.assign("/jobs");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("unableToConnect"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppFrame nav={false} title={t("signIn")} topbar={false}>
      <Screen>
        <div className="flex min-h-[calc(100svh-90px)] flex-col justify-between py-5">
          <div className="flex items-center justify-between">
            <img alt="ClueXP" className="h-6 w-auto object-contain" src="/logo.png" />
            <LanguageToggle />
          </div>
          <form className="space-y-5" onSubmit={submit}>
            <div>
              <div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck className="size-6" /></div>
              <h1 className="text-3xl font-black">{t("signIn")}</h1>
              <p className="mt-2 text-sm leading-5 text-muted">Secure access for verified ClueXP technicians.</p>
            </div>
            <label className="block text-sm font-bold">
              {t("identifier")}
              <input className="mt-2 min-h-12 w-full rounded-xl border border-border bg-card-strong px-4 text-base outline-none focus:border-primary" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
            </label>
            <label className="block text-sm font-bold">
              {t("password")}
              <input className="mt-2 min-h-12 w-full rounded-xl border border-border bg-card-strong px-4 text-base outline-none focus:border-primary" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {error ? <p className="rounded-xl border border-danger/35 bg-danger/10 p-3 text-sm font-semibold text-danger" role="alert">{error}</p> : null}
            <button className="touch-target min-h-[54px] w-full rounded-2xl bg-primary px-4 text-base font-black text-primary-foreground disabled:opacity-50" disabled={busy || !identifier || !password} type="submit">
              {busy ? t("loading") : t("signIn")}
            </button>
            <a className="touch-target flex min-h-11 items-center justify-center text-sm font-bold text-muted" href="/signup">{t("signUp")}</a>
          </form>
        </div>
      </Screen>
    </AppFrame>
  );
}
