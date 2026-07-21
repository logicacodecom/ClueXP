"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetShell><div className="text-sm text-muted-foreground">Loading reset link...</div></ResetShell>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-3 grid size-10 place-items-center rounded-md border border-border bg-secondary text-primary">
            <KeyRound className="size-5" />
          </div>
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>Choose a new password for this ClueXP account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </main>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  async function resetPassword() {
    setBusy(true);
    setMessage(null);
    try {
      if (!token) throw new Error("Reset token is missing.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (password !== confirm) throw new Error("Passwords do not match.");
      const response = await fetch("/api/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, new_password: password })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to reset password");
      setComplete(true);
      setMessage("Password updated. You can sign in with the new password.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to reset password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResetShell>
      <Input autoComplete="new-password" disabled={complete} placeholder="New password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <Input autoComplete="new-password" disabled={complete} placeholder="Confirm new password" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      {message ? <div className={`rounded-md border p-3 text-sm ${complete ? "border-success/35 bg-success/10 text-success" : "border-destructive/35 bg-destructive/10 text-destructive"}`} role="status">{message}</div> : null}
      {complete ? (
        <Button asChild className="w-full"><Link href="/signin">Go to sign in</Link></Button>
      ) : (
        <Button className="w-full" disabled={busy || !token || !password || !confirm} onClick={() => void resetPassword()}>{busy ? "Updating" : "Update password"}</Button>
      )}
    </ResetShell>
  );
}
