"use client";

import { providerSession } from "@cluexp/api-client";
import { LanguageSelect, sessionRequest, useLocale } from "@cluexp/app-core";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignInPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [identifier, setIdentifier] = useState(providerSession.user.email ?? "");
  const [password, setPassword] = useState("123456");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await sessionRequest("/api/session", {
        method: "POST",
        body: JSON.stringify({ identifier, password })
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <LanguageSelect className="absolute right-6 top-6" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <div>
            <Badge variant="outline">Tenant auth</Badge>
            <CardTitle className="mt-4">Provider Console Sign In</CardTitle>
            <CardDescription>Organization-scoped session for dispatchers and provider admins.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input aria-label={t("identifier")} autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
          <Input aria-label={t("password")} autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          <Button className="min-h-11 w-full" disabled={busy || !identifier || !password} onClick={signIn}>{busy ? t("loading") : "Enter Provider Console"}</Button>
          <a className="block min-h-11 pt-3 text-center text-sm font-semibold text-muted-foreground hover:text-foreground" href="/signup">{t("signUp")}</a>
        </CardContent>
      </Card>
    </main>
  );
}
