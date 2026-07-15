"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader, SkillSelect } from "@cluexp/console-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppFrame } from "../../frame";

export default function NewTechnicianPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = displayName.trim() && (email.trim() || phone.trim()) && password.length >= 8;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/technicians", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password,
          skills
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to create technician");
      router.push("/technicians");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create technician");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppFrame>
      <PageHeader kicker="Network" title="Add technician" description="Registers a new technician profile. It lands pending vetting, same as self-signup — this does not skip approval." />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Technician details</CardTitle>
          <CardDescription>The technician signs in to technician-web once approved.</CardDescription>
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
          <div className="space-y-1.5 text-sm font-medium">
            Skills
            <SkillSelect selected={skills} onChange={setSkills} />
          </div>
          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          <Button disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? "Creating…" : "Create technician"}</Button>
        </CardContent>
      </Card>
    </AppFrame>
  );
}
