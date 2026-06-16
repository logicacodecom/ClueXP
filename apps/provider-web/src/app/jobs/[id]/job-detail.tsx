"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
} from "@cluexp/console-ui";
import { RefreshCw, Star } from "lucide-react";

type PaymentReport = { amount: number; currency: string; method: string } | null;

type ActiveJob = {
  id: string; status: string; address: string | null; situation: string | null;
  urgency: string | null; fulfillment_technician_id: string | null;
  offer_active: boolean; last_issue?: string | null;
};

type HistoryJob = {
  id: string; status: string; address: string | null; situation: string | null;
  finished_at: string | null; technician_display_name: string | null;
  review: { rating: number | null; comment: string | null } | null;
  payments: { technician: PaymentReport; customer: PaymentReport };
};

type TimelineEvent = { event: string; at: string | null };
type Note = { id: string; author_name: string | null; body: string; created_at: string | null };

const STATUS_LABELS: Record<string, string> = {
  pending_dispatch: "Pending dispatch", assigned: "Assigned", en_route: "En route",
  arrived: "Arrived", in_progress: "In progress", disputed: "Disputed",
  completed_pending_customer: "Awaiting confirmation", completed_confirmed: "Confirmed",
  completed_auto_closed: "Auto-closed", cancelled: "Cancelled", no_show: "No-show",
};

const STATUS_VARIANTS: Record<string, "success" | "warn" | "danger" | "outline"> = {
  pending_dispatch: "outline", assigned: "outline", en_route: "warn", arrived: "warn",
  in_progress: "warn", completed_pending_customer: "warn", disputed: "danger",
  completed_confirmed: "success", completed_auto_closed: "success",
  cancelled: "danger", no_show: "danger",
};

function statusLabel(s: string): string { return STATUS_LABELS[s] ?? s.replaceAll("_", " "); }
function eventLabel(ev: string): { action: string; detail: string } {
  const i = ev.indexOf(":");
  return i === -1 ? { action: ev, detail: "" } : { action: ev.slice(0, i), detail: ev.slice(i + 1) };
}

export function JobDetailView({ jobId, kicker = "Job detail" }: { jobId: string; kicker?: string }) {
  const [active, setActive] = useState<ActiveJob | null>(null);
  const [history, setHistory] = useState<HistoryJob | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "notfound">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [jobsRes, histRes, tlRes, notesRes] = await Promise.all([
        fetch("/api/provider/jobs", { cache: "no-store" }),
        fetch("/api/provider/jobs/history", { cache: "no-store" }),
        fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/timeline`, { cache: "no-store" }),
        fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/notes`, { cache: "no-store" }),
      ]);
      // The timeline endpoint is tenant-gated: a 404 means the job is not this org's.
      if (tlRes.status === 404) { setState("notfound"); return; }
      const activeJobs = jobsRes.ok ? ((await jobsRes.json()) as ActiveJob[]) : [];
      const historyJobs = histRes.ok ? ((await histRes.json()) as HistoryJob[]) : [];
      setActive(activeJobs.find((j) => j.id === jobId) ?? null);
      setHistory(historyJobs.find((j) => j.id === jobId) ?? null);
      setTimeline(tlRes.ok ? ((await tlRes.json()) as TimelineEvent[]) : []);
      setNotes(notesRes.ok ? ((await notesRes.json()) as Note[]) : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the job");
      setState("error");
    }
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  if (state === "notfound") {
    return (
      <Card><CardContent className="space-y-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">This job was not found in your organization.</p>
        <Button asChild variant="outline"><Link href="/recovery">Back to recovery</Link></Button>
      </CardContent></Card>
    );
  }

  const summary = active ?? history;
  const status = summary?.status ?? null;
  const technician = active
    ? (active.fulfillment_technician_id ? `${active.fulfillment_technician_id.slice(0, 8)}…` : "—")
    : (history?.technician_display_name || "—");

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={kicker}
        title={summary?.address || `Job ${jobId.slice(0, 8)}`}
        description={summary?.situation ? summary.situation.replaceAll("_", " ") : "Service request"}
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={state === "loading"}>
            <RefreshCw className={state === "loading" ? "animate-spin" : undefined} />
            {state === "loading" ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      {state === "error" ? (
        <Card><CardContent className="py-8 text-center text-sm text-destructive">{error}</CardContent></Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Status" value={status ? statusLabel(status) : "—"} intent={status ? (STATUS_VARIANTS[status] === "outline" ? "neutral" : STATUS_VARIANTS[status]) : "neutral"} />
        <StatCard label="Technician" value={state === "loading" ? "—" : technician} />
        <StatCard label="Offer" value={active?.offer_active ? "Active" : "—"} intent={active?.offer_active ? "warn" : "neutral"} />
        <StatCard
          label="Review"
          value={history?.review?.rating ? `${history.review.rating}/5` : "—"}
          intent={history?.review?.rating ? "success" : "neutral"}
        />
      </div>

      {active?.last_issue ? (
        <Card>
          <CardHeader><CardTitle>Reported issue</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-destructive">⚠ {active.last_issue}</p></CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div><CardTitle>Audit timeline</CardTitle><CardDescription>Append-only lifecycle events.</CardDescription></div>
            <Badge variant="outline">{timeline.length}</Badge>
          </CardHeader>
          <CardContent>
            {state === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events recorded.</p>
            ) : (
              <ol className="space-y-3">
                {timeline.map((e, i) => {
                  const { action, detail } = eventLabel(e.event);
                  return (
                    <li key={i} className="flex items-start gap-3 border-l-2 border-border pl-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{action.replaceAll("_", " ")}</Badge>
                          <span className="text-xs text-muted-foreground">{e.at ? new Date(e.at).toLocaleString() : ""}</span>
                        </div>
                        {detail ? <p className="mt-1 break-words text-sm text-muted-foreground">{detail}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div><CardTitle>Internal notes</CardTitle><CardDescription>Dispatcher-only; never shown to customers or technicians.</CardDescription></div>
            <Badge variant="outline">{notes.length}</Badge>
          </CardHeader>
          <CardContent>
            {state === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet. Add notes from the recovery workspace.</p>
            ) : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{n.author_name ?? "Dispatcher"}</span>
                      <span>{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</span>
                    </div>
                    <p className="mt-1 text-sm">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {history?.review?.comment ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Star className="size-4 text-warn" />Customer review</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">&quot;{history.review.comment}&quot;</p></CardContent>
        </Card>
      ) : null}
    </div>
  );
}
