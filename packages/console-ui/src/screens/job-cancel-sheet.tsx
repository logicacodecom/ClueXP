"use client";

import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui";
import { useState } from "react";

/** Controlled reason-required cancel sheet shared by the Live Queue and the
 * Copilot (operations) focused-action bar. POSTs to the existing tenant-scoped
 * {apiBase}/jobs/{id}/cancel, which cancels any pre-completion state
 * (pending_dispatch through in_progress), supersedes active offers, and revokes
 * the assigned technician. The caller owns the trigger + open state. */
export function JobCancelSheet({
  address,
  apiBase = "/api/provider",
  isRequest = true,
  jobId,
  onDone,
  onOpenChange,
  open,
}: {
  address?: string | null;
  apiBase?: string;
  isRequest?: boolean;
  jobId: string;
  onDone: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsReason = reason.trim().length < 3;
  const noun = isRequest ? "request" : "job";

  async function submit() {
    if (needsReason || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Cancel failed (${res.status})`);
      setReason("");
      onOpenChange(false);
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onOpenChange={(next) => !busy && onOpenChange(next)} open={open}>
      <SheetContent className="max-w-lg" onClick={(event) => event.stopPropagation()}>
        <SheetHeader>
          <SheetTitle>Cancel this {noun}?</SheetTitle>
          <SheetDescription>
            Cancels {address || `the ${noun}`}, supersedes any active offer, revokes assigned technician access, and removes it from the queue. Give a clear reason for the audit trail.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-6">
          <label className="block text-sm font-medium">
            Reason required
            <textarea
              className="mt-2 min-h-28 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              maxLength={280}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Customer called to cancel; duplicate request; unable to service."
              value={reason}
            />
          </label>
          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={busy} onClick={() => onOpenChange(false)} variant="outline">Keep {noun}</Button>
            <Button disabled={busy || needsReason} onClick={() => void submit()} variant="destructive">
              {busy ? "Cancelling…" : `Cancel ${noun}`}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
