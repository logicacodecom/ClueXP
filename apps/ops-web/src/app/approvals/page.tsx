"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@cluexp/console-ui";
import { Building2, Check, RefreshCw, ShieldCheck, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface PendingEntity {
  id: string;
  type: "technicians" | "organizations";
  display_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  created_at?: string;
}

function normalize(body: unknown): PendingEntity[] {
  if (!body || typeof body !== "object") return [];
  const value = body as { technicians?: PendingEntity[]; organizations?: PendingEntity[]; pending?: PendingEntity[] };
  if (Array.isArray(value.pending)) return value.pending;
  return [
    ...(value.technicians ?? []).map((item) => ({ ...item, type: "technicians" as const })),
    ...(value.organizations ?? []).map((item) => ({ ...item, type: "organizations" as const }))
  ];
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<PendingEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/approvals", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to load approvals (${response.status})`);
      setItems(normalize(body));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function decide(item: PendingEntity, decision: "approve" | "reject") {
    setBusy(item.id);
    try {
      const response = await fetch(`/api/approvals/${item.type}/${encodeURIComponent(item.id)}/${decision}`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${decision}`);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${decision}`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <AppFrame>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="text-xs font-semibold uppercase text-muted-foreground">Network governance</div><h1 className="mt-2 text-3xl font-semibold">Access approvals</h1><p className="mt-2 text-sm text-muted-foreground">Review pending individual technicians and provider organizations before activation.</p></div>
          <Button variant="outline" onClick={() => void load()}><RefreshCw className="size-4" />Refresh</Button>
        </header>
        {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div> : null}
        {loading ? <div className="space-y-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div> : null}
        {!loading && items.length === 0 ? (
          <Card><CardContent className="flex min-h-48 flex-col items-center justify-center text-center"><ShieldCheck className="size-8 text-success" /><h2 className="mt-4 text-lg font-semibold">No pending approvals</h2><p className="mt-1 text-sm text-muted-foreground">New registration requests will appear here.</p></CardContent></Card>
        ) : null}
        <div className="space-y-3">
          {items.map((item) => {
            const Icon = item.type === "technicians" ? UserRound : Building2;
            return (
              <Card key={`${item.type}:${item.id}`}>
                <CardHeader><div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-md bg-secondary"><Icon className="size-5 text-primary" /></div><div className="min-w-0 flex-1"><CardTitle>{item.display_name || item.name || "Pending applicant"}</CardTitle><CardDescription>{item.email || item.phone || item.id}</CardDescription></div><Badge variant="warn">Pending</Badge></div></CardHeader>
                <CardContent className="flex flex-wrap justify-end gap-2">
                  <Button disabled={busy === item.id} variant="outline" onClick={() => void decide(item, "reject")}><X className="size-4" />Reject</Button>
                  <Button disabled={busy === item.id} onClick={() => void decide(item, "approve")}><Check className="size-4" />Approve</Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppFrame>
  );
}
