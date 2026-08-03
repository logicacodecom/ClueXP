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
import { MessageSquare, RefreshCw, Send, Star } from "lucide-react";
import { ProviderActionDialog } from "../../provider-action-dialog";

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
type JobMessage = {
  id: string;
  sender_type: string;
  body: string | null;
  template_code?: string | null;
  created_at: string | null;
  delivery_state?: string | null;
};

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

const CUSTOMER_MESSAGE_TEMPLATES = [
  "on_my_way",
  "arrived",
  "running_late",
  "need_more_details",
  "customer_unavailable",
  "work_complete",
  "please_confirm",
] as const;

function statusLabel(s: string): string { return STATUS_LABELS[s] ?? s.replaceAll("_", " "); }
function eventLabel(ev: string): { action: string; detail: string } {
  const i = ev.indexOf(":");
  return i === -1 ? { action: ev, detail: "" } : { action: ev.slice(0, i), detail: ev.slice(i + 1) };
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

export function JobDetailView({ jobId, kicker = "Job detail" }: { jobId: string; kicker?: string }) {
  const [active, setActive] = useState<ActiveJob | null>(null);
  const [history, setHistory] = useState<HistoryJob | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [messages, setMessages] = useState<JobMessage[]>([]);
  const [customerMessages, setCustomerMessages] = useState<JobMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error" | "notfound">("loading");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendingCustomerTemplate, setSendingCustomerTemplate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [jobsRes, histRes, tlRes, notesRes, messagesRes, customerMessagesRes] = await Promise.all([
        fetch("/api/provider/jobs", { cache: "no-store" }),
        fetch("/api/provider/jobs/history", { cache: "no-store" }),
        fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/timeline`, { cache: "no-store" }),
        fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/notes`, { cache: "no-store" }),
        fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/messages?channel=operations`, { cache: "no-store" }),
        fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/messages?channel=customer`, { cache: "no-store" }),
      ]);
      // The timeline endpoint is tenant-gated: a 404 means the job is not this org's.
      if (tlRes.status === 404) { setState("notfound"); return; }
      const activeJobs = jobsRes.ok ? ((await jobsRes.json()) as ActiveJob[]) : [];
      const historyJobs = histRes.ok ? ((await histRes.json()) as HistoryJob[]) : [];
      setActive(activeJobs.find((j) => j.id === jobId) ?? null);
      setHistory(historyJobs.find((j) => j.id === jobId) ?? null);
      setTimeline(tlRes.ok ? ((await tlRes.json()) as TimelineEvent[]) : []);
      setNotes(notesRes.ok ? ((await notesRes.json()) as Note[]) : []);
      setMessages(messagesRes.ok ? (((await messagesRes.json()) as { messages?: JobMessage[] }).messages ?? []) : []);
      setCustomerMessages(customerMessagesRes.ok ? (((await customerMessagesRes.json()) as { messages?: JobMessage[] }).messages ?? []) : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the job");
      setState("error");
    }
  }, [jobId]);

  async function confirmReceipt(reason: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/completion/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Could not confirm receipt");
      setMessage("Customer receipt confirmed by provider.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm receipt");
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  async function sendOperationsMessage() {
    const body = messageDraft.trim();
    if (!body || sendingMessage) return;
    setSendingMessage(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "operations",
          body,
          client_message_id: `provider_${Date.now().toString(36)}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail?.message || result.detail || "Could not send message");
      const created = (result as { message?: JobMessage }).message;
      if (created) setMessages((current) => [...current, created]);
      setMessageDraft("");
      setMessage("Operations message sent to the technician.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send message");
    } finally {
      setSendingMessage(false);
    }
  }

  async function sendCustomerTemplate(templateCode: string) {
    setSendingCustomerTemplate(templateCode);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "customer",
          template_code: templateCode,
          client_message_id: `provider_customer_${Date.now().toString(36)}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail?.message || result.detail || "Could not send customer-visible message");
      const created = (result as { message?: JobMessage }).message;
      if (created) setCustomerMessages((current) => [...current, created]);
      setMessage("Customer-visible template sent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send customer-visible message");
    } finally {
      setSendingCustomerTemplate(null);
    }
  }

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
          <div className="flex flex-wrap gap-2">
            {active?.status === "completed_pending_customer" ? (
              <ProviderActionDialog
                confirmLabel="Confirm receipt"
                description="Use only after the customer confirms receipt by phone. This closes the job and releases the technician."
                disabled={busy}
                onConfirm={confirmReceipt}
                reasonMode="required"
                title="Confirm customer receipt?"
              >
                <Button disabled={busy}>Confirm receipt by phone</Button>
              </ProviderActionDialog>
            ) : null}
            <Button variant="outline" onClick={() => void load()} disabled={state === "loading"}>
              <RefreshCw className={state === "loading" ? "animate-spin" : undefined} />
              {state === "loading" ? "Refreshing" : "Refresh"}
            </Button>
          </div>
        }
      />

      {message ? <Card className="border-success/35 bg-success/10"><CardContent className="py-3 text-sm text-success">{message}</CardContent></Card> : null}

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
            <div>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="size-4" />Operations messages</CardTitle>
              <CardDescription>Visible to the assigned technician. Internal notes stay separate.</CardDescription>
            </div>
            <Badge variant="outline">{messages.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {state === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : messages.length === 0 ? (
              <p className="rounded-md border border-border bg-secondary/20 p-3 text-sm text-muted-foreground">No operations messages yet.</p>
            ) : (
              <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {messages.map((item) => {
                  const fromProvider = item.sender_type === "provider_admin" || item.sender_type === "dispatcher";
                  return (
                    <li key={item.id} className={`rounded-md border p-3 ${fromProvider ? "border-primary/35 bg-primary/10" : "border-border bg-secondary/20"}`}>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{messageAuthor(item.sender_type)}</span>
                        <span>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.body || item.template_code || ""}</p>
                      {item.delivery_state ? <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.delivery_state}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="space-y-2 rounded-md border border-border bg-background p-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="operations-message">Reply to technician</label>
              <textarea
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                id="operations-message"
                onChange={(event) => setMessageDraft(event.target.value)}
                placeholder="Add an operational update, arrival instruction, or support note"
                value={messageDraft}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Do not include card data or private customer access codes.</p>
                <Button disabled={!messageDraft.trim() || sendingMessage} onClick={() => void sendOperationsMessage()}>
                  <Send className="size-4" />
                  {sendingMessage ? "Sending" : "Send"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="size-4" />Customer messages</CardTitle>
              <CardDescription>Customer-visible template thread. Operations and internal notes are hidden from customers.</CardDescription>
            </div>
            <Badge variant="outline">{customerMessages.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {state === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : customerMessages.length === 0 ? (
              <p className="rounded-md border border-border bg-secondary/20 p-3 text-sm text-muted-foreground">No customer-visible messages yet.</p>
            ) : (
              <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {customerMessages.map((item) => {
                  const fromProvider = item.sender_type === "provider_admin" || item.sender_type === "dispatcher";
                  return (
                    <li key={item.id} className={`rounded-md border p-3 ${fromProvider ? "border-primary/35 bg-primary/10" : "border-border bg-secondary/20"}`}>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{messageAuthor(item.sender_type)}</span>
                        <span>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.body || customerTemplateLabel(item.template_code)}</p>
                      {item.delivery_state ? <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.delivery_state}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="space-y-2 rounded-md border border-border bg-background p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Send customer-visible template</div>
              <div className="flex flex-wrap gap-2">
                {CUSTOMER_MESSAGE_TEMPLATES.map((code) => (
                  <Button
                    disabled={Boolean(sendingCustomerTemplate)}
                    key={code}
                    onClick={() => void sendCustomerTemplate(code)}
                    size="sm"
                    variant="outline"
                  >
                    {sendingCustomerTemplate === code ? "Sending" : customerTemplateLabel(code)}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Templates only for MVP. Do not send customer-specific free text from this panel.</p>
            </div>
          </CardContent>
        </Card>

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
