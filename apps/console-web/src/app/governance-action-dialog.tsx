"use client";

import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@cluexp/console-ui";
import type { ReactNode } from "react";
import { useState } from "react";

export function GovernanceActionDialog({
  children,
  confirmLabel,
  description,
  disabled,
  onConfirm,
  reasonLabel = "Reason",
  reasonRequired = false,
  title,
  variant = "default"
}: {
  children: ReactNode;
  confirmLabel: string;
  description: string;
  disabled?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
  reasonLabel?: string;
  reasonRequired?: boolean;
  title: string;
  variant?: "default" | "destructive";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsReason = reasonRequired && reason.trim().length < 3;

  async function confirm() {
    if (needsReason) {
      setError("Enter a clear reason before continuing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason("");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete this action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <SheetTrigger asChild disabled={disabled}>{children}</SheetTrigger>
      <SheetContent className="max-w-lg">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-6">
          <label className="block text-sm font-medium">
            {reasonLabel}{reasonRequired ? " required" : ""}
            <textarea
              className="mt-2 min-h-28 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              maxLength={280}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonRequired ? "Explain why this governance action is needed." : "Optional note for this action."}
              value={reason}
            />
          </label>
          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={busy} onClick={() => setOpen(false)} variant="outline">Cancel</Button>
            <Button disabled={busy || needsReason} onClick={() => void confirm()} variant={variant === "destructive" ? "destructive" : "default"}>
              {busy ? "Working..." : confirmLabel}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
