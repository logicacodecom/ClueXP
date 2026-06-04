"use client";

import { providerSession } from "@cluexp/api-client";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignInPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState(providerSession.user.email ?? "");
  const [password, setPassword] = useState("demo-password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_CLUEXP_API_BASE_URL || "";
      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Sign in failed: ${response.status}`);
      window.localStorage.setItem("cluexp_access_token", body.access_token);
      window.localStorage.setItem("cluexp_session", JSON.stringify(body.session));
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div>
            <Badge variant="outline">Tenant auth</Badge>
            <CardTitle className="mt-4">Provider Console Sign In</CardTitle>
            <CardDescription>Organization-scoped session for dispatchers and provider admins.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          <Button className="w-full" disabled={busy} onClick={signIn}>{busy ? "Signing in..." : "Enter Provider Console"}</Button>
        </CardContent>
      </Card>
    </main>
  );
}
