"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cluexp/console-ui";
import { CreditCard, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface BillingStatus {
  state: "disabled" | "entitled" | "grace" | "blocked";
  subscription_status: string;
  current_period_end: string | null;
  grace_ends_at: string | null;
  cancel_at_period_end: boolean;
  billing_enabled: boolean;
  can_manage: boolean;
  has_customer: boolean;
}

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    const response = await fetch("/api/provider/billing", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || "Unable to load billing");
    setStatus(body);
  }

  useEffect(() => { void load().catch((cause) => setError(cause.message)); }, []);

  async function openHosted(path: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Unable to open billing");
      window.location.assign(body.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open billing");
      setBusy(false);
    }
  }

  const date = (value: string | null) => value ? new Date(value).toLocaleDateString() : "Not available";
  const canStart = status ? ["none", "canceled", "incomplete_expired"].includes(status.subscription_status) : false;
  return (
    <AppFrame>
      <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
        <header><h1 className="text-2xl font-semibold">Billing</h1><p className="mt-1 text-sm text-muted-foreground">Provider Access subscription and invoices</p></header>
        {error ? <div className="flex items-center justify-between gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load().catch((cause) => setError(cause.message))}><RefreshCw className="size-4" />Retry</Button></div> : null}
        <Card>
          <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>ClueXP Provider Access</CardTitle><CardDescription>$419 USD monthly, with a 30-day trial at checkout</CardDescription></div><Badge>{status?.subscription_status ?? "Loading"}</Badge></div></CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div><div className="text-sm text-muted-foreground">Current period ends</div><div className="mt-1 font-medium">{date(status?.current_period_end ?? null)}</div></div>
            <div><div className="text-sm text-muted-foreground">Grace period ends</div><div className="mt-1 font-medium">{date(status?.grace_ends_at ?? null)}</div></div>
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              {status?.can_manage && status.billing_enabled && canStart ? <Button disabled={busy} onClick={() => void openHosted("/api/provider/billing/checkout-session")}><CreditCard className="size-4" />{status.subscription_status === "none" ? "Start subscription" : "Restart subscription"}</Button> : null}
              {status?.can_manage && status.billing_enabled && status.has_customer ? <Button disabled={busy} onClick={() => void openHosted("/api/provider/billing/portal-session")}><ExternalLink className="size-4" />Manage in Stripe</Button> : null}
              {status && !status.billing_enabled ? <p className="text-sm text-muted-foreground">Sandbox billing is not enabled in this environment.</p> : null}
              {status && !status.can_manage ? <p className="text-sm text-muted-foreground">A provider administrator can manage this subscription.</p> : null}
            </div>
          </CardContent>
        </Card>
      </main>
    </AppFrame>
  );
}
