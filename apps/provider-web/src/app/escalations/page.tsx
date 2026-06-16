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
  EmptyState,
  PageHeader,
  StatCard,
} from "@cluexp/console-ui";
import { RefreshCw, ShieldCheck, AlertTriangle, MessageSquareWarning } from "lucide-react";
import { AppFrame } from "../frame";

type EscalationJob = {
  id: string;
  status: string;
  address: string | null;
  situation: string | null;
  urgency: string | null;
  fulfillment_technician_id: string | null;
  last_issue?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending_dispatch: "Pending dispatch", assigned: "Assigned", en_route: "En route",
  arrived: "Arrived", in_progress: "In progress", disputed: "Disputed",
  completed_pending_customer: "Awaiting confirmation",
};

function EscalationQueue() {
  const [jobs, setJobs] = useState<EscalationJob[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/provider/jobs", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load jobs (${res.status})`);
      const body = (await res.json()) as EscalationJob[];
      setJobs(Array.isArray(body) ? body : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load escalations");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const loading = state === "loading";
  const disputed = jobs.filter((j) => j.status === "disputed");
  const flagged = jobs.filter((j) => j.last_issue && j.status !== "disputed");
  const critical = jobs.filter((j) => j.urgency === "critical");
  // Deduped, disputes first, then technician-flagged issues.
  const escalated = [...disputed, ...flagged];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Operations"
        title="Escalations"
        description="Jobs that need a dispatcher decision — customer disputes and technician-reported field issues. Resolve them in the recovery workspace. Refreshes every 30s."
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      {state === "error" ? (
        <Card><CardContent className="py-8 text-center text-sm text-destructive">{error}</CardContent></Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open disputes" value={loading ? "—" : String(disputed.length)} icon={MessageSquareWarning} intent={disputed.length > 0 ? "danger" : "neutral"} />
        <StatCard label="Technician issues" value={loading ? "—" : String(flagged.length)} icon={AlertTriangle} intent={flagged.length > 0 ? "warn" : "neutral"} />
        <StatCard label="Critical urgency" value={loading ? "—" : String(critical.length)} icon={AlertTriangle} intent={critical.length > 0 ? "warn" : "neutral"} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>Disputes and reported issues, newest concerns first.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm"><Link href="/recovery">Recovery workspace</Link></Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : escalated.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Nothing escalated" description="No disputes or technician-reported issues on active jobs right now." />
          ) : (
            escalated.map((job) => (
              <Link
                key={job.id}
                href="/recovery"
                className="flex items-start justify-between gap-4 rounded-md border border-border p-4 transition-colors hover:border-primary/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{job.address || "Address unavailable"}</span>
                    <Badge variant={job.status === "disputed" ? "danger" : "warn"}>{STATUS_LABELS[job.status] ?? job.status}</Badge>
                    {job.urgency === "critical" ? <Badge variant="danger">Critical</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs capitalize text-muted-foreground">{(job.situation || "Service request").replaceAll("_", " ")}</p>
                  {job.last_issue ? <p className="mt-2 text-sm text-destructive">⚠ {job.last_issue}</p> : null}
                  {job.status === "disputed" ? <p className="mt-2 text-sm text-destructive">Customer raised a dispute — resolve or close with an audited reason.</p> : null}
                </div>
                <span className="shrink-0 text-xs font-medium text-primary">Manage →</span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EscalationsPage() {
  return <AppFrame><EscalationQueue /></AppFrame>;
}
