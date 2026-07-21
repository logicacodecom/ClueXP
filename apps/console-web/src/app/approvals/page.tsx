"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input, PageHeader, StatCard } from "@cluexp/console-ui";
import { Building2, CalendarClock, Check, Eye, Mail, Phone, RefreshCw, Search, ShieldCheck, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";
import { GovernanceActionDialog } from "../governance-action-dialog";

type Decision = "approve" | "reject";

interface Registration {
  kind: "technician" | "organization";
  id: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  vetting_status?: string | null;
  created_at?: string | null;
}

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString();
}

function approvalPath(item: Registration) {
  return `/api/approvals/${item.kind === "technician" ? "technicians" : "organizations"}/${encodeURIComponent(item.id)}`;
}

function recordPath(item: Registration) {
  return item.kind === "technician" ? `/technicians/${item.id}` : `/companies/${item.id}`;
}

function matchesQuery(item: Registration, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [item.display_name, item.email, item.phone, item.status, item.vetting_status, item.id]
    .some((value) => String(value ?? "").toLowerCase().includes(normalized));
}

export default function ApprovalsPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/approvals", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load registrations");
      setRegistrations(body.registrations ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load registrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function decide(item: Registration, decision: Decision, reason = "") {
    setBusy(`${item.kind}:${item.id}:${decision}`);
    setMessage(null);
    try {
      const response = await fetch(`${approvalPath(item)}/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${decision}`);
      await refresh();
      setMessage(`${item.display_name} ${decision === "approve" ? "approved" : "declined"}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${decision}`);
    } finally {
      setBusy(null);
    }
  }

  const technicians = useMemo(
    () => registrations.filter((item) => item.kind === "technician" && matchesQuery(item, query)),
    [query, registrations]
  );
  const organizations = useMemo(
    () => registrations.filter((item) => item.kind === "organization" && matchesQuery(item, query)),
    [query, registrations]
  );
  const allTechnicians = registrations.filter((item) => item.kind === "technician").length;
  const allOrganizations = registrations.filter((item) => item.kind === "organization").length;

  return (
    <AppFrame>
      <PageHeader
        kicker="Network governance"
        title="Access Approvals"
        description="Review technician and company registrations separately. Each card has its own view, approve, and decline actions."
        actions={<Button disabled={loading} onClick={() => void refresh()} variant="outline"><RefreshCw className="size-4" />{loading ? "Refreshing" : "Refresh"}</Button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={ShieldCheck} intent={registrations.length ? "warn" : "success"} label="Pending total" value={String(registrations.length)} />
        <StatCard icon={UserRound} intent={allTechnicians ? "warn" : "neutral"} label="Technicians" value={String(allTechnicians)} />
        <StatCard icon={Building2} intent={allOrganizations ? "warn" : "neutral"} label="Companies" value={String(allOrganizations)} />
        <StatCard icon={ShieldCheck} label="Control" trend="confirmation required" value="Guarded" />
      </div>

      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative min-w-0 md:w-96">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search approvals" className="pl-9" placeholder="Search name, email, phone, or status" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {message ? <div className="rounded-md border border-border bg-card px-3 py-2 text-sm" role="status">{message}</div> : null}
      </div>

      {loading ? <div className="rounded-md border border-border p-5 text-sm text-muted-foreground">Loading approvals...</div> : null}
      {!loading && registrations.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No approvals waiting" description="New company and technician registrations will appear here." />
      ) : null}

      {!loading && registrations.length > 0 ? (
        <div className="grid gap-6 2xl:grid-cols-2">
          <ApprovalSection
            busy={busy}
            description="People requesting technician access and dispatch eligibility."
            emptyDescription="No technician approvals match the current search."
            icon={UserRound}
            items={technicians}
            onDecide={decide}
            title="Technician approvals"
          />
          <ApprovalSection
            busy={busy}
            description="Provider companies requesting network access."
            emptyDescription="No company approvals match the current search."
            icon={Building2}
            items={organizations}
            onDecide={decide}
            title="Company approvals"
          />
        </div>
      ) : null}
    </AppFrame>
  );
}

function ApprovalSection({
  busy,
  description,
  emptyDescription,
  icon: Icon,
  items,
  onDecide,
  title
}: {
  busy: string | null;
  description: string;
  emptyDescription: string;
  icon: typeof UserRound;
  items: Registration[];
  onDecide: (item: Registration, decision: Decision, reason?: string) => Promise<void>;
  title: string;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-condensed text-xl font-bold uppercase">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-border p-5 text-sm text-muted-foreground">{emptyDescription}</div>
      ) : items.map((item) => (
        <Card className="transition-colors hover:border-primary/35" key={`${item.kind}:${item.id}`}>
          <CardHeader>
            <div className="flex flex-wrap items-start gap-3">
              <div className="grid size-11 place-items-center rounded-md border border-border bg-secondary text-primary">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle>{item.display_name}</CardTitle>
                <CardDescription>{item.email || item.phone || "No contact method on file"}</CardDescription>
              </div>
              <Badge variant="warn">{item.status.replaceAll("_", " ")}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail icon={Mail} label="Email" value={item.email || "Not provided"} />
              <Detail icon={Phone} label="Phone" value={item.phone || "Not provided"} />
              <Detail icon={ShieldCheck} label="Vetting" value={item.vetting_status?.replaceAll("_", " ") || item.status.replaceAll("_", " ")} />
              <Detail icon={CalendarClock} label="Submitted" value={formatDate(item.created_at)} />
            </div>
            <div className="flex gap-2 border-t border-border pt-4 sm:justify-end">
              <Button aria-label={`View ${item.display_name}`} asChild className="size-11" size="icon" title="View" variant="outline">
                <Link href={recordPath(item)}><Eye className="size-4" /></Link>
              </Button>
              <GovernanceActionDialog
                confirmLabel={`Approve ${item.kind === "technician" ? "technician" : "company"}`}
                description={`Approve ${item.display_name} for production access.`}
                disabled={busy !== null}
                onConfirm={(reason) => onDecide(item, "approve", reason)}
                title={`Approve ${item.display_name}?`}
              >
                <Button aria-label={`Approve ${item.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Approve" variant="success"><Check className="size-4" /></Button>
              </GovernanceActionDialog>
              <GovernanceActionDialog
                confirmLabel={`Decline ${item.kind === "technician" ? "technician" : "company"}`}
                description={`Decline ${item.display_name}. A reason is required for the audit trail.`}
                disabled={busy !== null}
                onConfirm={(reason) => onDecide(item, "reject", reason)}
                reasonRequired
                title={`Decline ${item.display_name}?`}
                variant="destructive"
              >
                <Button aria-label={`Decline ${item.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Decline" variant="outline"><X className="size-4" /></Button>
              </GovernanceActionDialog>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-secondary/35 p-3">
      <div className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="mt-1 truncate text-foreground">{value}</div>
    </div>
  );
}
