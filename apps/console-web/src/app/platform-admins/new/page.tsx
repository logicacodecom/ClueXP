"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader } from "@cluexp/console-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppFrame } from "../../frame";

export default function NewPlatformAdminPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = displayName.trim() && (email.trim() || phone.trim()) && password.length >= 8;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to create platform admin");
      router.push("/platform-admins");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create platform admin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppFrame>
      <PageHeader kicker="Platform" title="Add platform admin" description="Grants full platform-admin access to this console — able to manage every company, technician, and user. Only give this to someone who should have it." />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Admin details</CardTitle>
          <CardDescription>They can sign in to the console immediately with this password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium">Name
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Email
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Phone
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Temporary password (min 8 characters)
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          <Button disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? "Creating…" : "Create platform admin"}</Button>
        </CardContent>
      </Card>
    </AppFrame>
  );
}
