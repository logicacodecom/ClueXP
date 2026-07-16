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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cluexp/console-ui";
import { RefreshCw, Inbox, Send, AlertTriangle, Users, CheckCircle2, FileCheck2 } from "lucide-react";
import { AppFrame } from "../frame";
import { buildCompanyCompliance, complianceCounts, type ProviderDocument } from "../compliance";

type ActiveJob = {
  id: string;
  status: string;
  address: string | null;
  situation: string | null;
  urgency: string | null;
  fulfillment_technician_id: string | null;
  offer_active: boolean;
  last_issue?: string | null;
};

type FleetTech = {
  id: string;
  display_name: string | null;
  is_available: boolean;
  active_job: { id: string; status: string } | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending_dispatch: "Pending dispatch",
  assigned: "Assigned",
  en_route: "En route",
  arrived: "Arrived",
  in_progress: "In progress",
  completed_pending_customer: "Awaiting confirmation",
  disputed: "Disputed",
};

const STATUS_VARIANTS: Record<string, "success" | "warn" | "danger" | "outline"> = {
  pending_dispatch: "outline",
  assigned: "outline",
  en_route: "warn",
  arrived: "warn",
  in_progress: "warn",
  completed_pending_customer: "warn",
  disputed: "danger",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

function ProviderDashboard() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [queue, setQueue] = useState<ActiveJob[]>([]);
  const [fleet, setFleet] = useState<FleetTech[]>([]);
  const [completedCount, setCompletedCount] = useState<number | null>(null);
  const [companyDocuments, setCompanyDocuments] = useState<ProviderDocument[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [jobsRes, queueRes, fleetRes, historyRes, workspaceRes] = await Promise.all([
        fetch("/api/provider/jobs", { cache: "no-store" }),
        fetch("/api/provider/queue", { cache: "no-store" }),
        fetch("/api/provider/fleet", { cache: "no-store" }),
        fetch("/api/provider/jobs/history", { cache: "no-store" }),
        fetch("/api/workspace", { cache: "no-store" }).catch(() => null),
      ]);
      if (!jobsRes.ok) throw new Error(`Could not load active jobs (${jobsRes.status})`);
      const jobsBody = (await jobsRes.json()) as ActiveJob[];
      setJobs(Array.isArray(jobsBody) ? jobsBody : []);
      setQueue(queueRes.ok ? ((await queueRes.json()) as ActiveJob[]) : []);
      setFleet(fleetRes.ok ? ((await fleetRes.json()) as FleetTech[]) : []);
      setCompletedCount(historyRes.ok ? ((await historyRes.json()) as unknown[]).length : null);
      if (workspaceRes?.ok) {
        const workspace = await workspaceRes.json() as { documents?: ProviderDocument[] };
        setCompanyDocuments(workspace.documents ?? []);
      } else {
        setCompanyDocuments(null);
      }
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the dashboard");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const loading = state === "loading";
  const techNames = new Map(fleet.map((t) => [t.id, t.display_name]));
  const pendingCount = queue.length;
  const activeOffers = jobs.filter((j) => j.offer_active).length;
  const issueCount = jobs.filter((j) => j.last_issue).length;
  const disputedCount = jobs.filter((j) => j.status === "disputed").length;
  const availableTechs = fleet.filter((t) => t.is_available).length;
  const stat = (n: number) => (loading ? "—" : String(n));
  const compliance = companyDocuments === null ? null : complianceCounts(buildCompanyCompliance(companyDocuments));

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Overview"
        title="Dashboard"
        description="Your company's live operational state — active jobs, dispatch queue, fleet, and finished work. Refreshes every 30s."
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      {state === "error" ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {state === "ready" && compliance && (compliance.blocking > 0 || compliance.pending > 0 || compliance.expiring > 0) ? (
        <Card className={compliance.blocking > 0 ? "border-destructive/40" : "border-amber-500/35"}>
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${compliance.blocking > 0 ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-500"}`}>
              {compliance.blocking > 0 ? <AlertTriangle className="size-5" /> : <FileCheck2 className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{compliance.blocking > 0 ? "Company documents need attention" : compliance.pending > 0 ? "Company documents are under review" : "Company documents expire soon"}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {[
                  compliance.blocking > 0 ? `${compliance.blocking} missing, rejected, or expired` : null,
                  compliance.pending > 0 ? `${compliance.pending} pending review` : null,
                  compliance.expiring > 0 ? `${compliance.expiring} expiring within 30 days` : null,
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button asChild variant={compliance.blocking > 0 ? "default" : "outline"}><Link href="/documents">Review documents</Link></Button>
          </CardContent>
        </Card>
      ) : state === "ready" && compliance === null ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          <span>Company compliance status is temporarily unavailable.</span>
          <Button asChild size="sm" variant="ghost"><Link href="/documents">Open documents</Link></Button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Active jobs" value={stat(jobs.length)} icon={Inbox} />
        <StatCard label="Pending dispatch" value={stat(pendingCount)} icon={Send} intent={pendingCount > 0 ? "warn" : "neutral"} />
        <StatCard label="Active offers" value={stat(activeOffers)} icon={Send} />
        <StatCard label="Flagged issues" value={stat(issueCount + disputedCount)} icon={AlertTriangle} intent={issueCount + disputedCount > 0 ? "danger" : "neutral"} />
        <StatCard label="Technicians available" value={loading ? "—" : `${availableTechs}/${fleet.length}`} icon={Users} />
        <StatCard label="Completed (all time)" value={completedCount === null ? "—" : String(completedCount)} icon={CheckCircle2} intent="success" />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Active jobs</CardTitle>
            <CardDescription>Live jobs owned by your company. Manage stuck or problem jobs in the recovery workspace.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/queue">Dispatch queue</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/recovery">Recovery</Link></Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : jobs.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No active jobs.</TableCell></TableRow>
                ) : (
                  jobs.map((job) => (
                    <TableRow key={job.id} className="align-top">
                      <TableCell>
                        <div className="font-medium">{job.address || "Address unavailable"}</div>
                        <div className="mt-1 text-xs capitalize text-muted-foreground">{(job.situation || "Service request").replaceAll("_", " ")}</div>
                      </TableCell>
                      <TableCell><Badge variant={STATUS_VARIANTS[job.status] ?? "outline"}>{statusLabel(job.status)}</Badge></TableCell>
                      <TableCell>{job.fulfillment_technician_id ? (techNames.get(job.fulfillment_technician_id) || `${job.fulfillment_technician_id.slice(0, 8)}…`) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{job.offer_active ? <Badge variant="warn">Offer active</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {job.last_issue ? <Badge variant="danger" title={job.last_issue}>⚠ issue</Badge> : null}
                        {job.status === "disputed" ? <Badge variant="danger">Disputed</Badge> : null}
                        {!job.last_issue && job.status !== "disputed" ? <span className="text-muted-foreground">—</span> : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return <AppFrame><ProviderDashboard /></AppFrame>;
}
