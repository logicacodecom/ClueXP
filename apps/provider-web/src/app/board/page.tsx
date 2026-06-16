"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@cluexp/console-ui";
import { RefreshCw } from "lucide-react";
import { AppFrame } from "../frame";

type BoardJob = {
  id: string;
  status: string;
  address: string | null;
  situation: string | null;
  urgency: string | null;
  fulfillment_technician_id: string | null;
  offer_active: boolean;
  last_issue?: string | null;
};

type Lane = {
  key: string;
  label: string;
  variant: "outline" | "warn" | "danger" | "success";
  match: (job: BoardJob) => boolean;
};

// Each job lands in the first matching lane (attention takes priority over status),
// so a job never appears twice.
const LANES: Lane[] = [
  { key: "attention", label: "Needs attention", variant: "danger", match: (j) => Boolean(j.last_issue) || j.status === "disputed" },
  { key: "pending", label: "Pending dispatch", variant: "outline", match: (j) => j.status === "pending_dispatch" && !j.offer_active },
  { key: "offered", label: "Offer sent", variant: "warn", match: (j) => j.offer_active },
  { key: "en_route", label: "En route", variant: "warn", match: (j) => j.status === "en_route" },
  { key: "on_site", label: "On site", variant: "warn", match: (j) => j.status === "arrived" || j.status === "in_progress" },
  { key: "awaiting", label: "Awaiting customer", variant: "success", match: (j) => j.status === "completed_pending_customer" },
];

function laneFor(job: BoardJob): string {
  return (LANES.find((lane) => lane.match(job)) ?? LANES[LANES.length - 1]).key;
}

function DispatchBoard() {
  const [jobs, setJobs] = useState<BoardJob[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/provider/jobs", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load jobs (${res.status})`);
      const body = (await res.json()) as BoardJob[];
      setJobs(Array.isArray(body) ? body : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the board");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const loading = state === "loading";

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Operations"
        title="Dispatch Board"
        description="Your company's active jobs by operational stage. Jobs needing attention surface first. Refreshes every 30s."
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

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1140px] grid-cols-6 gap-3">
          {LANES.map((lane) => {
            const cards = jobs.filter((job) => laneFor(job) === lane.key);
            return (
              <Card className="min-h-[420px]" key={lane.key}>
                <CardHeader className="px-3 py-3">
                  <CardTitle className="flex w-full items-center justify-between text-xs">
                    <span>{lane.label}</span>
                    <Badge variant={cards.length > 0 ? lane.variant : "outline"}>{loading ? "—" : cards.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-3">
                  {!loading && cards.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None.</p>
                  ) : null}
                  {cards.map((job) => (
                    <Link
                      key={job.id}
                      href={lane.key === "pending" || lane.key === "offered" ? "/queue" : "/recovery"}
                      className="block rounded-md border border-border bg-secondary/40 p-3 transition-colors hover:border-primary/40"
                    >
                      <div className="truncate font-medium">{job.address || "Address unavailable"}</div>
                      <div className="mt-1 truncate text-xs capitalize text-muted-foreground">{(job.situation || "Service request").replaceAll("_", " ")}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {job.urgency === "critical" ? <Badge variant="danger">Critical</Badge> : null}
                        {job.last_issue ? <Badge variant="danger" title={job.last_issue}>⚠ issue</Badge> : null}
                        {job.offer_active ? <Badge variant="warn">Offer active</Badge> : null}
                      </div>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function BoardPage() {
  return <AppFrame><DispatchBoard /></AppFrame>;
}
