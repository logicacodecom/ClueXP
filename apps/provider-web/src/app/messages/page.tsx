"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { AlertTriangle, CircleHelp, MessageSquare, RefreshCw, Send, UserRound } from "lucide-react";
import { AppFrame } from "../frame";

type ProviderJob = {
  id: string;
  status: string;
  address: string | null;
  situation: string | null;
  urgency?: string | null;
  fulfillment_technician_id?: string | null;
  offer_active?: boolean;
  last_issue?: string | null;
  finished_at?: string | null;
  technician_display_name?: string | null;
};

type JobMessage = {
  id: string;
  sender_type: string;
  body: string | null;
  template_code?: string | null;
  created_at: string | null;
  delivery_state?: string | null;
};

type MessageThreadResponse = {
  messages?: JobMessage[];
  unread_count?: number;
};

type InboxChannel = "customer" | "operations";
type InboxFilter = "all" | InboxChannel | "help";

type InboxThread = {
  channel: InboxChannel;
  job: ProviderJob;
  latest: JobMessage | null;
  messages: JobMessage[];
  unreadCount: number;
  helpRequested: boolean;
};

type ProviderAlert = {
  id: string;
  organization_id: string;
  job_id: string | null;
  alert_type: string;
  severity: string;
  status: "open" | "acknowledged" | "resolved";
  payload?: Record<string, unknown> | null;
  created_at: string | null;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending_dispatch: "Pending dispatch",
  assigned: "Assigned",
  en_route: "En route",
  arrived: "Arrived",
  in_progress: "In progress",
  disputed: "Disputed",
  completed_pending_customer: "Awaiting confirmation",
  completed_confirmed: "Confirmed",
  completed_auto_closed: "Auto-closed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

const STATUS_VARIANTS: Record<string, "success" | "warn" | "danger" | "outline"> = {
  pending_dispatch: "outline",
  assigned: "outline",
  en_route: "warn",
  arrived: "warn",
  in_progress: "warn",
  completed_pending_customer: "warn",
  disputed: "danger",
  completed_confirmed: "success",
  completed_auto_closed: "success",
  cancelled: "danger",
  no_show: "danger",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

function messageAuthor(sender: string): string {
  if (sender === "customer") return "Customer";
  if (sender === "technician") return "Technician";
  if (sender === "provider_admin") return "Operations";
  if (sender === "dispatcher") return "Dispatcher";
  if (sender === "system") return "System";
  return sender.replaceAll("_", " ");
}

function customerTemplateLabel(code: string | null | undefined): string {
  const labels: Record<string, string> = {
    on_my_way: "I'm on my way",
    arrived: "I'm here",
    running_late: "Running late",
    need_more_details: "Need more details",
    customer_unavailable: "Cannot reach customer",
    work_complete: "Work complete",
    please_confirm: "Please confirm",
  };
  return code ? (labels[code] ?? code.replaceAll("_", " ")) : "";
}

function messagePreview(message: JobMessage | null): string {
  if (!message) return "No messages yet";
  return message.body || customerTemplateLabel(message.template_code) || "Message";
}

function alertLabel(alertType: string): string {
  const labels: Record<string, string> = {
    customer_help_request: "Customer help request",
    delivery_failure: "Delivery failure",
    new_job: "New job",
    safety_flag: "Safety flag",
    stalled_job: "Stalled job",
    stuck_offer: "Stuck offer",
  };
  return labels[alertType] ?? alertType.replaceAll("_", " ");
}

function latestTimestamp(thread: InboxThread): number {
  const value = thread.latest?.created_at;
  return value ? new Date(value).getTime() || 0 : 0;
}

function dedupeJobs(jobs: ProviderJob[]): ProviderJob[] {
  const seen = new Set<string>();
  const deduped: ProviderJob[] = [];
  for (const job of jobs) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    deduped.push(job);
  }
  return deduped;
}

async function fetchThread(job: ProviderJob, channel: InboxChannel): Promise<InboxThread> {
  const response = await fetch(`/api/provider/jobs/${encodeURIComponent(job.id)}/messages?channel=${channel}`, { cache: "no-store" });
  const body = response.ok ? ((await response.json()) as MessageThreadResponse) : {};
  const messages = body.messages ?? [];
  return {
    channel,
    job,
    latest: messages.at(-1) ?? null,
    messages,
    unreadCount: body.unread_count ?? 0,
    helpRequested: messages.some((message) => message.sender_type === "customer" && message.template_code === "need_more_details"),
  };
}

function MessageInbox() {
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [alerts, setAlerts] = useState<ProviderAlert[]>([]);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [alertActionId, setAlertActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [activeRes, historyRes, alertsRes] = await Promise.all([
        fetch("/api/provider/jobs", { cache: "no-store" }),
        fetch("/api/provider/jobs/history", { cache: "no-store" }),
        fetch("/api/provider/alerts?status=open", { cache: "no-store" }),
      ]);
      if (!activeRes.ok) throw new Error(`Could not load active jobs (${activeRes.status})`);
      const activeJobs = ((await activeRes.json()) as ProviderJob[]).map((job) => ({ ...job, finished_at: null }));
      const historyJobs = historyRes.ok ? ((await historyRes.json()) as ProviderJob[]) : [];
      const alertsBody = alertsRes.ok ? ((await alertsRes.json()) as { alerts?: ProviderAlert[] }) : {};
      const jobs = dedupeJobs([...activeJobs, ...historyJobs]).slice(0, 40);
      const loadedThreads = (await Promise.all(
        jobs.flatMap((job) => [fetchThread(job, "customer"), fetchThread(job, "operations")])
      ))
        .filter((thread) => thread.messages.length > 0 || thread.unreadCount > 0)
        .sort((a, b) => {
          if (a.helpRequested !== b.helpRequested) return a.helpRequested ? -1 : 1;
          if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
          return latestTimestamp(b) - latestTimestamp(a);
        });
      setThreads(loadedThreads);
      setAlerts(alertsBody.alerts ?? []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load messages");
      setState("error");
    }
  }, []);

  const updateAlert = useCallback(async (alertId: string, action: "ack" | "resolve") => {
    setAlertActionId(alertId);
    setError(null);
    try {
      const response = await fetch(`/api/provider/alerts/${encodeURIComponent(alertId)}/${action}`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail?.message || body.detail || `Could not ${action} alert`);
      setAlerts((current) => current.filter((alert) => alert.id !== alertId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} alert`);
    } finally {
      setAlertActionId(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshVisibleInbox = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = window.setInterval(refreshVisibleInbox, 30_000);
    document.addEventListener("visibilitychange", refreshVisibleInbox);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refreshVisibleInbox);
    };
  }, [load]);

  const filteredThreads = useMemo(() => {
    if (filter === "all") return threads;
    if (filter === "help") return threads.filter((thread) => thread.helpRequested);
    return threads.filter((thread) => thread.channel === filter);
  }, [filter, threads]);

  const unreadTotal = threads.reduce((total, thread) => total + thread.unreadCount, 0);
  const helpTotal = threads.filter((thread) => thread.helpRequested).length;
  const customerTotal = threads.filter((thread) => thread.channel === "customer").length;
  const customerHelpAlerts = alerts.filter((alert) => alert.alert_type === "customer_help_request");
  const loading = state === "loading";

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="CRM"
        title="Messages"
        description="Dispatcher inbox for job-scoped customer and technician threads. Opening a job marks that thread read."
        actions={
          <Button disabled={loading} onClick={() => void load()} variant="outline">
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={MessageSquare} label="Open threads" value={loading ? "-" : String(threads.length)} />
        <StatCard icon={CircleHelp} intent={customerHelpAlerts.length > 0 || helpTotal > 0 ? "warn" : "neutral"} label="Help requests" value={loading ? "-" : String(Math.max(helpTotal, customerHelpAlerts.length))} />
        <StatCard icon={UserRound} label="Customer threads" value={loading ? "-" : String(customerTotal)} />
        <StatCard icon={Send} intent={unreadTotal > 0 ? "info" : "neutral"} label="Unread" value={loading ? "-" : String(unreadTotal)} />
      </div>

      {customerHelpAlerts.length > 0 ? (
        <Card className="border-warn/40 bg-warn/10">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4" />Open customer help alerts</CardTitle>
              <CardDescription>Durable alerts created from customer help requests. Acknowledge when dispatch has picked it up; resolve after reply or closure.</CardDescription>
            </div>
            <Badge variant="warn">{customerHelpAlerts.length} open</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {customerHelpAlerts.map((alert) => (
              <div className="flex flex-col gap-3 rounded-md border border-warn/35 bg-background p-3 sm:flex-row sm:items-center sm:justify-between" key={alert.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warn">{alertLabel(alert.alert_type)}</Badge>
                    <Badge variant="outline">{alert.severity}</Badge>
                    <span className="text-xs text-muted-foreground">{alert.created_at ? new Date(alert.created_at).toLocaleString() : "No timestamp"}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">Customer asked dispatch for help on this job.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {alert.job_id ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/jobs/${encodeURIComponent(alert.job_id)}`}>Open job</Link>
                    </Button>
                  ) : null}
                  <Button disabled={alertActionId === alert.id} onClick={() => void updateAlert(alert.id, "ack")} size="sm" variant="outline">
                    {alertActionId === alert.id ? "Saving" : "Acknowledge"}
                  </Button>
                  <Button disabled={alertActionId === alert.id} onClick={() => void updateAlert(alert.id, "resolve")} size="sm">
                    {alertActionId === alert.id ? "Saving" : "Resolve"}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Thread inbox</CardTitle>
            <CardDescription>Latest job messages across active and recent work. Reply from the job detail screen.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["help", "Help"],
              ["customer", "Customer"],
              ["operations", "Operations"],
            ] as const).map(([value, label]) => (
              <Button
                aria-pressed={filter === value}
                key={value}
                onClick={() => setFilter(value)}
                size="sm"
                variant={filter === value ? "default" : "outline"}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && threads.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading message threads...</div>
          ) : filteredThreads.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No message threads match this view.</div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredThreads.map((thread) => {
                const latest = thread.latest;
                const channelLabel = thread.channel === "customer" ? "Customer" : "Operations";
                const fromLabel = latest ? messageAuthor(latest.sender_type) : channelLabel;
                const href = `/jobs/${encodeURIComponent(thread.job.id)}`;
                return (
                  <li key={`${thread.job.id}:${thread.channel}`}>
                    <Link
                      className={`block px-4 py-4 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6 ${thread.helpRequested ? "bg-warn/10" : ""}`}
                      href={href}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={thread.channel === "customer" ? "info" : "outline"}>{channelLabel}</Badge>
                            {thread.unreadCount > 0 ? <Badge variant="info">{thread.unreadCount} unread</Badge> : null}
                            {thread.helpRequested ? <Badge variant="warn"><CircleHelp className="size-3" />Dispatch help requested</Badge> : null}
                            <Badge variant={STATUS_VARIANTS[thread.job.status] ?? "outline"}>{statusLabel(thread.job.status)}</Badge>
                          </div>
                          <div className="mt-3 font-semibold text-foreground">{thread.job.address || `Job ${thread.job.id.slice(0, 8)}`}</div>
                          <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">{fromLabel}:</span> {messagePreview(latest)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-row items-center justify-between gap-4 text-xs text-muted-foreground lg:min-w-48 lg:flex-col lg:items-end">
                          <span>{latest?.created_at ? new Date(latest.created_at).toLocaleString() : "No timestamp"}</span>
                          <span className="capitalize">{(thread.job.situation || "Service request").replaceAll("_", " ")}</span>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function MessagesPage() {
  return <AppFrame><MessageInbox /></AppFrame>;
}
