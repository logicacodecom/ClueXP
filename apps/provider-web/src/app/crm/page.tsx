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
  Input,
  PageHeader,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cluexp/console-ui";
import {
  CalendarClock,
  CheckCircle2,
  Mail,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AppFrame } from "../frame";

type CrmJob = {
  id: string;
  operational_id: string | null;
  status: string;
  situation: string | null;
  address: string | null;
  created_at: string | null;
  finished_at: string | null;
  last_sms: SmsDelivery | null;
};

type SmsDelivery = {
  purpose: string;
  provider_status: string;
  created_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  error_code: string | null;
};

type NewsletterStatus = "unknown" | "subscribed" | "unsubscribed";

type CrmCustomer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  newsletter_status: NewsletterStatus;
  warranty_days: number;
  callback_at: string | null;
  follow_up_at: string | null;
  last_contacted_at: string | null;
  notes: string | null;
  sms_opted_out: boolean;
  jobs: CrmJob[];
};

type Segment = "all" | "due" | "warranty" | "newsletter";

const COMPLETED_STATUSES = new Set(["completed_pending_customer", "completed_confirmed", "completed_auto_closed"]);
const SMS_TEMPLATES = [
  {
    purpose: "crm_service_follow_up",
    label: "Service follow-up",
    preview: "Checks in after the customer's recent service and directs them to call if they still need help.",
  },
  {
    purpose: "crm_callback_confirmation",
    label: "Callback confirmation",
    preview: "Confirms that the callback request is scheduled and the company will contact them as planned.",
  },
  {
    purpose: "crm_warranty_reminder",
    label: "Warranty reminder",
    preview: "Reminds the customer that their recent service may still be covered by warranty.",
  },
  {
    purpose: "tracking_link_reminder",
    label: "Tracking link reminder",
    preview: "Resends the secure tracking link associated with the selected service job.",
  },
] as const;

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestService(customer: CrmCustomer): CrmJob | null {
  return customer.jobs.find((job) => COMPLETED_STATUSES.has(job.status) && asDate(job.finished_at)) ?? null;
}

function warranty(customer: CrmCustomer) {
  const service = latestService(customer);
  const finished = asDate(service?.finished_at);
  if (!service || !finished || customer.warranty_days <= 0) return { service, active: false, daysLeft: 0, progress: 0, endsAt: null as Date | null };
  const endsAt = new Date(finished);
  endsAt.setDate(endsAt.getDate() + customer.warranty_days);
  const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000));
  return {
    service,
    active: endsAt.getTime() >= Date.now(),
    daysLeft,
    progress: Math.max(0, Math.min(100, (daysLeft / customer.warranty_days) * 100)),
    endsAt,
  };
}

function dueAt(customer: CrmCustomer): Date | null {
  const candidates = [asDate(customer.callback_at), asDate(customer.follow_up_at)].filter((value): value is Date => Boolean(value));
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

function isDue(customer: CrmCustomer): boolean {
  const due = dueAt(customer);
  if (!due) return false;
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  return due < tomorrow;
}

function friendlyDate(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : asDate(value);
  if (!date) return "Not set";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function friendlyDateTime(value: string | null | undefined): string {
  const date = asDate(value);
  if (!date) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function datetimeLocal(value: string | null): string {
  const date = asDate(value);
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoFromLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serviceLabel(value: string | null): string {
  return (value || "Service request").replaceAll("_", " ");
}

function CustomerSheet({
  customer,
  onClose,
  onSaved,
}: {
  customer: CrmCustomer | null;
  onClose: () => void;
  onSaved: (customer: CrmCustomer) => void;
}) {
  const [draft, setDraft] = useState<CrmCustomer | null>(customer);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsPurpose, setSmsPurpose] = useState<(typeof SMS_TEMPLATES)[number]["purpose"]>("crm_service_follow_up");
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState<{ kind: "success" | "warn" | "error"; message: string } | null>(null);
  const [callStarting, setCallStarting] = useState(false);
  const [callResult, setCallResult] = useState<{ kind: "success" | "warn" | "error"; message: string } | null>(null);

  useEffect(() => {
    setDraft(customer);
    setError(null);
    setSaved(false);
    setSmsOpen(false);
    setSmsResult(null);
    setCallResult(null);
  }, [customer]);
  if (!draft) return null;

  const coverage = warranty(draft);
  const smsJob = coverage.service ?? draft.jobs[0] ?? null;
  const callJob = coverage.service ?? draft.jobs[0] ?? null;
  const selectedSmsTemplate = SMS_TEMPLATES.find((template) => template.purpose === smsPurpose) ?? SMS_TEMPLATES[0];

  async function sendSms() {
    if (!smsJob || !draft?.phone || draft.sms_opted_out) return;
    setSmsSending(true);
    setSmsResult(null);
    try {
      const response = await fetch("/api/provider/communications/sms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          job_id: smsJob.id,
          purpose: smsPurpose,
          recipient_type: "customer",
          client_message_id: `crm_${Date.now().toString(36)}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.detail || "Could not send the SMS");
      const delivery = body?.delivery as (SmsDelivery & { metadata?: { reason?: string } }) | undefined;
      const reason = delivery?.metadata?.reason;
      if (body?.sent) {
        const contactedAt = delivery?.sent_at || new Date().toISOString();
        const next = {
          ...draft,
          last_contacted_at: contactedAt,
          jobs: draft.jobs.map((job) => job.id === smsJob.id ? { ...job, last_sms: delivery ?? null } : job),
        };
        setDraft(next);
        onSaved(next);
        setSmsResult({ kind: "success", message: `SMS queued for ${draft.phone}. Delivery status: ${delivery?.provider_status || "queued"}.` });
      } else if (reason === "recipient_opted_out") {
        const next = { ...draft, sms_opted_out: true };
        setDraft(next);
        onSaved(next);
        setSmsResult({ kind: "warn", message: "SMS not sent because this customer opted out by replying STOP." });
      } else if (reason === "sms_disabled_or_a2p_unregistered") {
        setSmsResult({ kind: "warn", message: "SMS not sent. Enable transactional SMS and complete A2P registration in Communications settings." });
      } else if (reason === "missing_sms_number") {
        setSmsResult({ kind: "warn", message: "SMS not sent because the customer or provider SMS number is missing." });
      } else {
        setSmsResult({ kind: "error", message: "SMS was not sent. Check the communications provider configuration and try again." });
      }
    } catch (cause) {
      setSmsResult({ kind: "error", message: cause instanceof Error ? cause.message : "Could not send the SMS" });
    } finally {
      setSmsSending(false);
    }
  }

  async function startCustomerCall() {
    if (!callJob || !draft?.phone) return;
    setCallStarting(true);
    setCallResult(null);
    try {
      const response = await fetch(`/api/provider/jobs/${encodeURIComponent(callJob.id)}/calls/customer`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.detail?.message || body?.detail || "Could not start the call");
      if (body?.available) {
        const contactedAt = body?.call?.created_at || new Date().toISOString();
        const next = { ...draft, last_contacted_at: contactedAt };
        setDraft(next);
        onSaved(next);
        setCallResult({ kind: "success", message: "Call started. Answer your company phone to connect with the customer through the masked number." });
      } else {
        setCallResult({ kind: "warn", message: body?.message || "Masked calling is unavailable. Check Communications settings and the provider phone numbers." });
      }
    } catch (cause) {
      setCallResult({ kind: "error", message: cause instanceof Error ? cause.message : "Could not start the call" });
    } finally {
      setCallStarting(false);
    }
  }

  async function save(markContacted = false) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/provider/crm/customers/${draft!.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: draft!.email || null,
          newsletter_status: draft!.newsletter_status,
          warranty_days: Number(draft!.warranty_days),
          callback_at: draft!.callback_at,
          follow_up_at: draft!.follow_up_at,
          last_contacted_at: markContacted ? new Date().toISOString() : draft!.last_contacted_at,
          notes: draft!.notes || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.detail || "Could not save this customer");
      onSaved(body as CrmCustomer);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={Boolean(customer)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{draft.name}</SheetTitle>
          <SheetDescription>{draft.jobs.length} related job{draft.jobs.length === 1 ? "" : "s"} · Customer relationship record</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 p-6">
          <div className="grid grid-cols-3 gap-3">
            <Button variant="outline" disabled={!draft.phone || !callJob || callStarting} onClick={() => void startCustomerCall()}><PhoneCall />{callStarting ? "Calling…" : draft.phone ? "Call in app" : "No phone"}</Button>
            {draft.email ? <Button asChild variant="outline"><a href={`mailto:${draft.email}`}><Mail />Email</a></Button> : <Button disabled variant="outline"><Mail />No email</Button>}
            <Button variant={smsOpen ? "default" : "outline"} disabled={!draft.phone || draft.sms_opted_out || !smsJob} onClick={() => setSmsOpen((open) => !open)}><MessageSquareText />SMS</Button>
          </div>

          {callResult ? (
            <div className={`rounded-md border p-3 text-sm ${callResult.kind === "success" ? "border-success/35 bg-success/10 text-success" : callResult.kind === "warn" ? "border-amber-500/35 bg-amber-500/10 text-amber-500" : "border-destructive/35 bg-destructive/10 text-destructive"}`} role={callResult.kind === "error" ? "alert" : "status"}>
              <div>{callResult.message}</div>
              <Link href="/calls" className="mt-2 inline-block font-medium underline underline-offset-4">View call history</Link>
            </div>
          ) : null}

          {smsOpen ? (
            <section className="rounded-lg border border-border bg-muted/20 p-4" aria-label="Send transactional SMS">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Send transactional SMS</div>
                  <p className="mt-1 text-xs text-muted-foreground">Uses the approved company number and records delivery against {smsJob?.operational_id || "the latest service job"}.</p>
                </div>
                <Badge variant="outline">STOP enforced</Badge>
              </div>
              <label className="mt-4 block space-y-1.5 text-sm font-medium">
                Message template
                <select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" value={smsPurpose} onChange={(event) => { setSmsPurpose(event.target.value as typeof smsPurpose); setSmsResult(null); }}>
                  {SMS_TEMPLATES.map((template) => <option key={template.purpose} value={template.purpose}>{template.label}</option>)}
                </select>
              </label>
              <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What the template sends</div>
                <p className="mt-1 text-muted-foreground">{selectedSmsTemplate.preview} CRM templates include STOP opt-out instructions.</p>
              </div>
              {smsJob?.last_sms ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Last SMS:</span>
                  <Badge variant={smsJob.last_sms.provider_status === "delivered" ? "success" : smsJob.last_sms.failed_at ? "danger" : "outline"}>{smsJob.last_sms.provider_status.replaceAll("_", " ")}</Badge>
                  <span>{friendlyDateTime(smsJob.last_sms.created_at)}</span>
                </div>
              ) : null}
              {smsResult ? (
                <div className={`mt-3 rounded-md border p-3 text-sm ${smsResult.kind === "success" ? "border-success/35 bg-success/10 text-success" : smsResult.kind === "warn" ? "border-amber-500/35 bg-amber-500/10 text-amber-500" : "border-destructive/35 bg-destructive/10 text-destructive"}`} role={smsResult.kind === "error" ? "alert" : "status"}>
                  {smsResult.message}
                </div>
              ) : null}
              <div className="mt-4 flex justify-end">
                <Button disabled={smsSending || draft.sms_opted_out || !draft.phone || !smsJob} onClick={() => void sendSms()}><Send />{smsSending ? "Sending…" : `Send ${selectedSmsTemplate.label}`}</Button>
              </div>
            </section>
          ) : null}

          {draft.sms_opted_out ? <div className="rounded-md border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-500">This customer opted out of transactional SMS. They must reply START before messages can resume.</div> : null}

          <section className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Service warranty</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {coverage.service ? `${serviceLabel(coverage.service.situation)} · completed ${friendlyDate(coverage.service.finished_at)}` : "No completed service yet"}
                </p>
              </div>
              <Badge variant={coverage.active ? "success" : "outline"}>{coverage.active ? `${coverage.daysLeft} days left` : "Not active"}</Badge>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${coverage.progress.toFixed(0)} percent of warranty remaining`}>
              <div className="h-full rounded-full bg-success transition-[width] duration-200" style={{ width: `${coverage.progress}%` }} />
            </div>
            {coverage.endsAt ? <p className="mt-2 text-xs text-muted-foreground">Coverage ends {friendlyDate(coverage.endsAt)}</p> : null}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Email address
              <Input type="email" value={draft.email || ""} onChange={(event) => setDraft({ ...draft, email: event.target.value || null })} placeholder="customer@example.com" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Warranty term (days)
              <Input type="number" min={0} max={3650} value={draft.warranty_days} onChange={(event) => setDraft({ ...draft, warranty_days: Number(event.target.value) })} />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Callback
              <Input type="datetime-local" value={datetimeLocal(draft.callback_at)} onChange={(event) => setDraft({ ...draft, callback_at: isoFromLocal(event.target.value) })} />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Follow-up
              <Input type="datetime-local" value={datetimeLocal(draft.follow_up_at)} onChange={(event) => setDraft({ ...draft, follow_up_at: isoFromLocal(event.target.value) })} />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Newsletter consent
              <select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" value={draft.newsletter_status} onChange={(event) => setDraft({ ...draft, newsletter_status: event.target.value as NewsletterStatus })}>
                <option value="unknown">Consent not recorded</option>
                <option value="subscribed">Subscribed</option>
                <option value="unsubscribed">Unsubscribed</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Relationship notes
              <textarea className="min-h-28 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" maxLength={4000} value={draft.notes || ""} onChange={(event) => setDraft({ ...draft, notes: event.target.value || null })} placeholder="Preferences, context, or the next best action…" />
            </label>
          </div>

          {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div> : null}
          {saved ? <div className="flex items-center gap-2 rounded-md border border-success/35 bg-success/10 p-3 text-sm text-success" aria-live="polite"><CheckCircle2 className="size-4" />Customer saved</div> : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={saving} onClick={() => void save(true)}>Mark contacted</Button>
            <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save customer"}</Button>
          </div>

          <section>
            <div className="mb-3 text-sm font-semibold">Service & job history</div>
            <div className="space-y-2">
              {draft.jobs.map((job) => (
                <Link key={job.id} href={`/jobs/${job.id}`} className="block rounded-md border border-border p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium capitalize">{serviceLabel(job.situation)}</span>
                    <Badge variant={COMPLETED_STATUSES.has(job.status) ? "success" : "outline"}>{job.status.replaceAll("_", " ")}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{job.operational_id || job.id.slice(0, 8)} · {job.address || "Address unavailable"} · {friendlyDate(job.finished_at || job.created_at)}</div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CrmWorkspace() {
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [selected, setSelected] = useState<CrmCustomer | null>(null);
  const [segment, setSegment] = useState<Segment>("all");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const response = await fetch("/api/provider/crm/customers", { cache: "no-store" });
      const body = await response.json().catch(() => ([]));
      if (!response.ok) throw new Error(body?.detail || "Could not load customers");
      setCustomers(Array.isArray(body) ? body : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load customers");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    due: customers.filter(isDue).length,
    warranty: customers.filter((customer) => warranty(customer).active).length,
    newsletter: customers.filter((customer) => customer.newsletter_status === "subscribed" && customer.email).length,
  }), [customers]);
  const newsletterUrl = useMemo(() => {
    const recipients = customers
      .filter((customer) => customer.newsletter_status === "subscribed" && customer.email)
      .map((customer) => customer.email)
      .join(",");
    return `mailto:?bcc=${encodeURIComponent(recipients)}&subject=${encodeURIComponent("A service update from Metro Key Partners")}`;
  }, [customers]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers.filter((customer) => {
      if (segment === "due" && !isDue(customer)) return false;
      if (segment === "warranty" && !warranty(customer).active) return false;
      if (segment === "newsletter" && !(customer.newsletter_status === "subscribed" && customer.email)) return false;
      if (!query) return true;
      return [customer.name, customer.phone, customer.email, ...customer.jobs.flatMap((job) => [job.situation, job.address, job.operational_id])]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    });
  }, [customers, search, segment]);

  function customerSaved(customer: CrmCustomer) {
    setCustomers((current) => current.map((item) => item.id === customer.id ? customer : item));
    setSelected(customer);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="CRM"
        title="Customer relationships"
        description="Contacts, service history, warranty coverage, callbacks, follow-ups, and consent—all tied back to the original jobs."
        actions={<div className="flex flex-wrap gap-2">
          {counts.newsletter ? <Button asChild variant="outline"><a href={newsletterUrl}><Mail />Email audience</a></Button> : <Button variant="outline" disabled><Mail />Email audience</Button>}
          <Button variant="outline" onClick={() => void load()} disabled={state === "loading"}><RefreshCw className={state === "loading" ? "animate-spin" : undefined} />{state === "loading" ? "Refreshing" : "Refresh"}</Button>
        </div>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Customers" value={state === "loading" ? "—" : String(customers.length)} icon={Users} />
        <StatCard label="Due today" value={state === "loading" ? "—" : String(counts.due)} icon={CalendarClock} intent={counts.due ? "warn" : "neutral"} />
        <StatCard label="Under warranty" value={state === "loading" ? "—" : String(counts.warranty)} icon={ShieldCheck} intent="success" />
        <StatCard label="Newsletter audience" value={state === "loading" ? "—" : String(counts.newsletter)} icon={Mail} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Relationship desk</CardTitle>
            <CardDescription>Open a customer to schedule contact, record consent, adjust coverage, or review every related job.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers, jobs, or addresses" aria-label="Search customers" />
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Customer segments">
              {([
                ["all", `All ${customers.length}`],
                ["due", `Due ${counts.due}`],
                ["warranty", `Warranty ${counts.warranty}`],
                ["newsletter", `Newsletter ${counts.newsletter}`],
              ] as Array<[Segment, string]>).map(([value, label]) => (
                <Button key={value} size="sm" variant={segment === value ? "default" : "outline"} onClick={() => setSegment(value)}>{label}</Button>
              ))}
            </div>
          </div>

          {state === "error" ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div> : null}

          <div className="hidden overflow-x-auto rounded-md border border-border md:block">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Latest service</TableHead>
                  <TableHead>Warranty</TableHead>
                  <TableHead>Next action</TableHead>
                  <TableHead>Newsletter</TableHead>
                  <TableHead className="text-right">Jobs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state === "loading" ? (
                  <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">Loading customer relationships…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">{customers.length ? "No customers match this view." : "Customers will appear after their first job is created."}</TableCell></TableRow>
                ) : filtered.map((customer) => {
                  const coverage = warranty(customer);
                  const due = dueAt(customer);
                  return (
                    <TableRow key={customer.id} className="align-top">
                      <TableCell>
                        <button className="cursor-pointer text-left font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelected(customer)}>{customer.name}</button>
                        <div className="mt-1 text-xs text-muted-foreground">{customer.phone || "No phone"}{customer.email ? ` · ${customer.email}` : ""}</div>
                      </TableCell>
                      <TableCell>
                        <div className="capitalize">{serviceLabel(coverage.service?.situation ?? customer.jobs[0]?.situation ?? null)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{friendlyDate(coverage.service?.finished_at || customer.jobs[0]?.created_at)}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={coverage.active ? "success" : "outline"}>{coverage.active ? `${coverage.daysLeft} days left` : "Expired / none"}</Badge>
                        {coverage.active ? <div className="mt-2 h-1 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success" style={{ width: `${coverage.progress}%` }} /></div> : null}
                      </TableCell>
                      <TableCell>
                        <div className={due && isDue(customer) ? "font-medium text-warn" : ""}>{friendlyDateTime(due?.toISOString())}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Last contact {friendlyDate(customer.last_contacted_at)}</div>
                      </TableCell>
                      <TableCell><Badge variant={customer.newsletter_status === "subscribed" ? "success" : customer.newsletter_status === "unsubscribed" ? "outline" : "warn"}>{customer.newsletter_status === "unknown" ? "Consent needed" : customer.newsletter_status}</Badge></TableCell>
                      <TableCell className="text-right"><span className="font-semibold tabular-nums">{customer.jobs.length}</span></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {state === "loading" ? <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">Loading customer relationships…</div> : null}
            {state === "ready" && filtered.length === 0 ? <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">{customers.length ? "No customers match this view." : "Customers will appear after their first job is created."}</div> : null}
            {filtered.map((customer) => {
              const coverage = warranty(customer);
              const due = dueAt(customer);
              return (
                <button key={customer.id} className="w-full cursor-pointer rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelected(customer)}>
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="font-semibold">{customer.name}</div><div className="mt-1 text-xs text-muted-foreground">{customer.phone || customer.email || "Contact details needed"}</div></div>
                    <Badge variant={coverage.active ? "success" : "outline"}>{coverage.active ? `${coverage.daysLeft}d warranty` : `${customer.jobs.length} jobs`}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                    <div><div className="text-xs text-muted-foreground">Latest service</div><div className="mt-1 capitalize">{serviceLabel(coverage.service?.situation ?? customer.jobs[0]?.situation ?? null)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Next action</div><div className={`mt-1 ${due && isDue(customer) ? "text-warn" : ""}`}>{friendlyDateTime(due?.toISOString())}</div></div>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <CustomerSheet customer={selected} onClose={() => setSelected(null)} onSaved={customerSaved} />
    </div>
  );
}

export default function CrmPage() {
  return <AppFrame><CrmWorkspace /></AppFrame>;
}
