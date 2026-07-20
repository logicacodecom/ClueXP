"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cluexp/console-ui";
import { AlertTriangle, FileText, History, RefreshCw } from "lucide-react";
import { AppFrame } from "../frame";

type RecoveryJob = {
  id: string;
  status: string;
  address: string | null;
  access_type: string | null;
  situation: string | null;
  urgency: string | null;
  fulfillment_technician_id: string | null;
  offer_active: boolean;
  offer_id: string | null;
  offer_expires_at?: string | null;
  last_issue?: string | null;
};

type Note = { id: string; author_name: string | null; body: string; created_at: string | null };
type TimelineEvent = { event: string; at: string | null };
type Action = "cancel" | "release" | "no-show" | "confirm-receipt" | "recall-offer" | "resolve";

const ASSIGNED = new Set(["assigned", "en_route", "arrived", "in_progress"]);
const CANCELLABLE = new Set(["pending_dispatch", "assigned", "en_route", "arrived", "in_progress"]);
const NO_SHOW_OK = new Set(["assigned", "en_route", "arrived"]);

const ACTION_LABEL: Record<Action, string> = {
  cancel: "Cancel job",
  release: "Release technician",
  "no-show": "Mark no-show",
  "confirm-receipt": "Confirm receipt",
  "recall-offer": "Recall offer",
  resolve: "Resolve dispute",
};

const ACTION_HELP: Record<Action, string> = {
  cancel: "Cancels the job, revokes technician access, and supersedes any active offer.",
  release: "Returns the job to the provider queue so another technician can be assigned.",
  "no-show": "Closes the job as no-show and removes the technician from the active job.",
  "confirm-receipt": "Use after phone confirmation from the customer. Closes the job and releases the technician.",
  "recall-offer": "Pulls back an active offer before the technician accepts.",
  resolve: "Closes a disputed job with an internal resolution note.",
};

const STATUS_LABELS: Record<string, string> = {
  pending_dispatch: "Pending dispatch",
  assigned: "Assigned",
  en_route: "En route",
  arrived: "Arrived",
  in_progress: "In progress",
  disputed: "Disputed",
};

function availableActions(job: RecoveryJob): Action[] {
  const actions: Action[] = [];
  if (CANCELLABLE.has(job.status)) actions.push("cancel");
  if (ASSIGNED.has(job.status)) actions.push("release");
  if (NO_SHOW_OK.has(job.status)) actions.push("no-show");
  if (job.status === "completed_pending_customer") actions.push("confirm-receipt");
  if (job.status === "pending_dispatch" && job.offer_active) actions.push("recall-offer");
  if (job.status === "disputed") actions.push("resolve");
  return actions;
}

function statusVariant(status: string): "success" | "warn" | "danger" | "info" | "outline" {
  if (status === "disputed") return "danger";
  if (status === "pending_dispatch") return "warn";
  if (status === "assigned" || status === "en_route") return "info";
  if (status === "arrived" || status === "in_progress") return "success";
  if (status === "completed_pending_customer") return "warn";
  return "outline";
}

function actionVariant(action: Action): "outline" | "destructive" {
  return action === "cancel" || action === "no-show" ? "destructive" : "outline";
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "-";
}

function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

function RecoveryWorkspace() {
  const [jobs, setJobs] = useState<RecoveryJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ jobId: string; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [timelineFor, setTimelineFor] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/provider/jobs", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load jobs (${res.status})`);
      setJobs(await res.json());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load jobs");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function submit() {
    if (!pending || reason.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const path = pending.action === "resolve" ? "resolve" : pending.action === "confirm-receipt" ? "completion/confirm" : pending.action;
      const payload = pending.action === "resolve"
        ? { action: "close", note: reason.trim() }
        : { reason: reason.trim() };
      const res = await fetch(`/api/provider/jobs/${encodeURIComponent(pending.jobId)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Action failed (${res.status})`);
      setPending(null);
      setReason("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function openNotes(jobId: string) {
    if (notesFor === jobId) { setNotesFor(null); return; }
    setNotesFor(jobId);
    setNotes([]);
    setNewNote("");
    try {
      const res = await fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/notes`, { cache: "no-store" });
      if (res.ok) setNotes(await res.json());
    } catch {
      setError("Could not load notes");
    }
  }

  async function openTimeline(jobId: string) {
    if (timelineFor === jobId) { setTimelineFor(null); return; }
    setTimelineFor(jobId);
    setTimeline([]);
    try {
      const res = await fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/timeline`, { cache: "no-store" });
      if (res.ok) setTimeline(await res.json());
    } catch {
      setError("Could not load timeline");
    }
  }

  async function addNote(jobId: string) {
    if (newNote.trim().length < 1 || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: newNote.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Could not add note (${res.status})`);
      setNotes((current) => [...current, body as Note]);
      setNewNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add note");
    } finally {
      setBusy(false);
    }
  }

  const loadedJobs = jobs ?? [];
  const recoverableCount = loadedJobs.filter((job) => availableActions(job).length > 0).length;
  const activeOffers = loadedJobs.filter((job) => job.offer_active).length;
  const issueCount = loadedJobs.filter((job) => job.last_issue || job.status === "disputed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Operations"
        title="Recovery Workspace"
        description="Provider-scoped exception handling for active jobs. Every recovery action requires a reason and is written to the audit trail."
        actions={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Active jobs" value={jobs ? String(jobs.length) : "-"} />
        <StatCard label="Needs action" value={jobs ? String(recoverableCount) : "-"} intent={recoverableCount ? "warn" : "neutral"} />
        <StatCard label="Active offers" value={jobs ? String(activeOffers) : "-"} intent={activeOffers ? "info" : "neutral"} />
        <StatCard label="Issues / disputes" value={jobs ? String(issueCount) : "-"} intent={issueCount ? "danger" : "success"} />
      </div>

      {error ? (
        <Card className="border-destructive/35 bg-destructive/10">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recoverable active jobs</CardTitle>
            <CardDescription>Cancel, release, recall, mark no-show, resolve disputes, and record internal notes without database intervention.</CardDescription>
          </div>
          <Badge variant="outline">Refreshes every 30s</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>Recovery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs === null ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Loading active jobs...</TableCell></TableRow>
                ) : jobs.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No active jobs need recovery.</TableCell></TableRow>
                ) : (
                  jobs.map((job) => {
                    const actions = availableActions(job);
                    const isPending = pending?.jobId === job.id;
                    return (
                      <TableRow key={job.id} className="align-top">
                        <TableCell>
                          <div className="font-mono text-xs">{shortId(job.id)}</div>
                          <div className="mt-1 text-xs capitalize text-muted-foreground">{job.situation?.replaceAll("_", " ") ?? "Service request"}</div>
                          {job.urgency ? <Badge className="mt-2" variant={job.urgency === "critical" ? "critical" : "outline"}>{job.urgency}</Badge> : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={statusVariant(job.status)}>{formatStatus(job.status)}</Badge>
                            {job.last_issue ? <Badge variant="warn" title={job.last_issue}>Issue reported</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <div>{job.address ?? "-"}</div>
                          {job.access_type ? <div className="mt-1 text-xs capitalize text-muted-foreground">{job.access_type.replaceAll("_", " ")}</div> : null}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{shortId(job.fulfillment_technician_id)}</TableCell>
                        <TableCell>
                          {job.offer_active ? (
                            <div className="space-y-1">
                              <Badge variant="info">Offer active</Badge>
                              {job.offer_expires_at ? <div className="text-xs text-muted-foreground">Expires {new Date(job.offer_expires_at).toLocaleTimeString()}</div> : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[360px]">
                          {isPending ? (
                            <div className="rounded-md border border-border bg-card/80 p-3">
                              <div className="font-medium">{ACTION_LABEL[pending.action]}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{ACTION_HELP[pending.action]}</div>
                              <Input
                                className="mt-3"
                                placeholder="Reason required for audit trail"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                              />
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button size="sm" variant="ghost" onClick={() => { setPending(null); setReason(""); }}>Keep job unchanged</Button>
                                <Button size="sm" disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>
                                  {busy ? "Working..." : "Confirm action"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {actions.length === 0 ? <Badge variant="outline">No recovery action</Badge> : null}
                              {actions.map((action) => (
                                <Button
                                  key={action}
                                  size="sm"
                                  variant={actionVariant(action)}
                                  onClick={() => { setPending({ jobId: job.id, action }); setReason(""); setError(null); }}
                                >
                                  {ACTION_LABEL[action]}
                                </Button>
                              ))}
                              <Button size="sm" variant="ghost" onClick={() => void openNotes(job.id)}>
                                <FileText />
                                {notesFor === job.id ? "Hide notes" : "Notes"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => void openTimeline(job.id)}>
                                <History />
                                {timelineFor === job.id ? "Hide timeline" : "Timeline"}
                              </Button>
                            </div>
                          )}

                          {timelineFor === job.id ? (
                            <Card className="mt-3">
                              <CardHeader className="px-3 py-2"><CardTitle>Audit timeline</CardTitle></CardHeader>
                              <CardContent className="space-y-2 p-3">
                                {timeline.length === 0 ? <p className="text-xs text-muted-foreground">No events.</p> : timeline.map((event, index) => (
                                  <div key={`${event.event}-${index}`} className="text-xs">
                                    <span className="text-muted-foreground">{event.at ? new Date(event.at).toLocaleString() : ""}</span>
                                    <span className="mx-2 text-muted-foreground">-</span>
                                    <span>{event.event}</span>
                                  </div>
                                ))}
                              </CardContent>
                            </Card>
                          ) : null}

                          {notesFor === job.id ? (
                            <Card className="mt-3">
                              <CardHeader className="px-3 py-2"><CardTitle>Internal notes</CardTitle></CardHeader>
                              <CardContent className="space-y-3 p-3">
                                <div className="space-y-2">
                                  {notes.length === 0 ? <p className="text-xs text-muted-foreground">No notes yet.</p> : notes.map((note) => (
                                    <div key={note.id} className="rounded-md border border-border p-2 text-xs">
                                      <div className="font-medium">{note.author_name ?? "Dispatcher"}</div>
                                      {note.created_at ? <div className="text-muted-foreground">{new Date(note.created_at).toLocaleString()}</div> : null}
                                      <div className="mt-1">{note.body}</div>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex gap-2">
                                  <Input className="flex-1" placeholder="Add an internal note" value={newNote} onChange={(event) => setNewNote(event.target.value)} />
                                  <Button size="sm" disabled={busy || newNote.trim().length < 1} onClick={() => void addNote(job.id)}>Add</Button>
                                </div>
                              </CardContent>
                            </Card>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RecoveryPage() {
  return <AppFrame><RecoveryWorkspace /></AppFrame>;
}
