"use client";

import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { GovernanceActionDialog } from "./governance-action-dialog";

type Mode = "set_temp_password" | "generate_temp_password" | "reset_link";

export function PasswordResetCard({
  userId,
  displayName,
  helperText = "Use a temporary password for a direct handoff, or generate a reset link to send later."
}: {
  userId: string;
  displayName: string;
  helperText?: string;
}) {
  const [temporary, setTemporary] = useState("");
  const [busy, setBusy] = useState<Mode | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function resetPassword(mode: Mode) {
    setBusy(mode);
    setMessage(null);
    setResult(null);
    setCopied(false);
    try {
      const response = await fetch(`/api/users/${userId}/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, password: mode === "set_temp_password" ? temporary : undefined })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to reset password");
      if (body.temporary_password) setResult({ label: "Temporary password", value: body.temporary_password });
      else if (body.reset_url) setResult({ label: "Reset link", value: body.reset_url });
      else setMessage("Temporary password set.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to reset password");
    } finally {
      setBusy(null);
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Could not copy automatically — select and copy the value manually.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password reset</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-start gap-3 rounded-md border border-info/30 bg-info/5 p-3 text-info">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          <div>{helperText}</div>
        </div>
        <label className="block space-y-1.5 font-medium">
          Set temporary password
          <Input type="text" value={temporary} onChange={(event) => setTemporary(event.target.value)} placeholder="Minimum 8 characters" />
        </label>
        <div className="flex flex-wrap gap-2">
          <GovernanceActionDialog confirmLabel="Set password" description={`Set a temporary password for ${displayName}. Share it through a secure channel.`} disabled={busy !== null || temporary.length < 8} onConfirm={() => resetPassword("set_temp_password")} title={`Set password for ${displayName}?`}>
            <Button disabled={busy !== null || temporary.length < 8} variant="outline">Set temporary</Button>
          </GovernanceActionDialog>
          <GovernanceActionDialog confirmLabel="Generate password" description={`Generate a temporary password for ${displayName}. It will be shown once here.`} disabled={busy !== null} onConfirm={() => resetPassword("generate_temp_password")} title={`Generate password for ${displayName}?`}>
            <Button disabled={busy !== null} variant="outline">Generate temporary</Button>
          </GovernanceActionDialog>
          <GovernanceActionDialog confirmLabel="Generate reset link" description={`Generate a 24-hour reset link for ${displayName}. You can send it later.`} disabled={busy !== null} onConfirm={() => resetPassword("reset_link")} title={`Generate reset link for ${displayName}?`}>
            <Button disabled={busy !== null}>Generate reset link</Button>
          </GovernanceActionDialog>
        </div>
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
        {result ? (
          <div className="flex items-start gap-2 rounded-md border border-success/35 bg-success/10 p-3 text-sm text-success">
            <div className="min-w-0 flex-1 break-all" role="status">
              <span className="font-medium">{result.label}:</span> {result.value}
            </div>
            <Button className="shrink-0" onClick={() => void copyResult()} size="sm" variant="outline">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
