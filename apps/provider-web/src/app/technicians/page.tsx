"use client";

import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, Input,
  PageHeader, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@cluexp/console-ui";
import { AlertTriangle, Check, Copy, Search, ShieldCheck, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";

interface DirectoryTech {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  profile_photo_url?: string | null;
  profile_photo_status?: string | null;
  status: string;
  vetting_status: string | null;
  skills: string[];
  availability: "free" | "busy" | "offline";
  rating: number | null;
  location_updated_at: string | null;
  completed_jobs: number;
  affiliation: {
    status: string;
    affiliation_type: string;
    affiliated_at: string | null;
    is_pending_invite: boolean;
  };
  compliance: {
    total: number; verified: number; pending: number; rejected: number;
    expired: string[]; expiring: string[]; summary: string;
  };
}

const STATUS_VARIANT: Record<string, "success" | "warn" | "danger" | "neutral"> = {
  active: "success", pending_vetting: "warn", pending_invite: "warn",
  suspended: "danger", rejected: "danger", inactive: "neutral",
};
const AVAIL_VARIANT: Record<string, "success" | "danger" | "neutral"> = {
  free: "success", busy: "danger", offline: "neutral",
};
const COMPLIANCE_VARIANT: Record<string, "success" | "warn" | "danger" | "neutral"> = {
  compliant: "success", attention: "warn", action_required: "danger", no_documents: "neutral",
};
const COMPLIANCE_LABEL: Record<string, string> = {
  compliant: "Compliant", attention: "Review soon", action_required: "Action required", no_documents: "No documents",
};

function affiliationStatus(t: DirectoryTech): string {
  // Affiliation state takes precedence (pending invite / suspended); else the
  // technician's global account status.
  if (t.affiliation.is_pending_invite) return "pending_invite";
  if (t.affiliation.status === "suspended") return "suspended";
  return t.status;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export default function TechniciansPage() {
  const [techs, setTechs] = useState<DirectoryTech[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [skillFilter, setSkillFilter] = useState("all");
  const [availFilter, setAvailFilter] = useState("all");
  const [complianceFilter, setComplianceFilter] = useState("all");

  // Invite flow
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/technicians", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || "Unable to load technicians");
    setTechs(body.technicians ?? []);
  }, []);
  useEffect(() => { void refresh().catch((e) => setError(e.message)); }, [refresh]);

  const skills = useMemo(() => {
    const set = new Set<string>();
    (techs ?? []).forEach((t) => t.skills.forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }, [techs]);

  const filtered = useMemo(() => {
    return (techs ?? []).filter((t) => {
      if (query && !(t.display_name ?? "").toLowerCase().includes(query.toLowerCase())
        && !(t.email ?? "").toLowerCase().includes(query.toLowerCase())) return false;
      if (statusFilter !== "all" && affiliationStatus(t) !== statusFilter) return false;
      if (availFilter !== "all" && t.availability !== availFilter) return false;
      if (skillFilter !== "all" && !t.skills.includes(skillFilter)) return false;
      if (complianceFilter === "expiring" && t.compliance.expiring.length === 0 && t.compliance.expired.length === 0) return false;
      if (complianceFilter !== "all" && complianceFilter !== "expiring" && t.compliance.summary !== complianceFilter) return false;
      return true;
    });
  }, [techs, query, statusFilter, availFilter, skillFilter, complianceFilter]);

  const counts = useMemo(() => {
    const list = techs ?? [];
    return {
      total: list.length,
      free: list.filter((t) => t.availability === "free").length,
      attention: list.filter((t) => t.compliance.summary === "attention" || t.compliance.summary === "action_required").length,
      pending: list.filter((t) => affiliationStatus(t) === "pending_invite").length,
    };
  }, [techs]);

  async function sendInvite() {
    setInviteBusy(true);
    setInviteMessage(null);
    setInviteLink(null);
    try {
      const response = await fetch("/api/technicians/invite", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to create invite");
      if (body.mode === "existing_technician") {
        setInviteMessage(`Pending invite created for ${body.display_name ?? inviteEmail}. No email is sent yet; ask them to sign in to the technician app and accept it from their profile.`);
        await refresh();
      } else {
        if (!body.invite?.token) throw new Error("Invite was created, but no signup token was returned.");
        const base = (process.env.NEXT_PUBLIC_TECHNICIAN_BASE_URL || "https://tech.cluexp.com").replace(/\/$/, "");
        setInviteLink(`${base}/signup?invite=${body.invite.token}`);
        setInviteMessage("Signup link created. Email is not automatic yet; copy this link and send it to the technician.");
      }
      setInviteEmail("");
    } catch (cause) {
      setInviteMessage(cause instanceof Error ? cause.message : "Unable to create invite");
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* manual copy fallback */ }
  }

  return (
    <AppFrame>
      <PageHeader
        kicker="Workforce"
        title="Technicians"
        description="Your company's affiliated technicians — status, availability, jobs, and compliance."
        actions={<Button onClick={() => setInviteOpen((v) => !v)}><UserPlus className="size-4" />Invite technician</Button>}
      />

      {inviteOpen ? (
        <Card className="mb-6 border-primary/30">
          <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-5 text-primary" />Invite a technician</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter the technician's email. Existing ClueXP technicians get a pending invite in their portal. New technicians get a signup link you can copy and send manually — email delivery is not automatic yet.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input className="sm:max-w-sm" type="email" placeholder="technician@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <Button disabled={inviteBusy || !inviteEmail.trim()} onClick={() => void sendInvite()}>{inviteBusy ? "Creating…" : "Create invite"}</Button>
            </div>
            {inviteMessage ? <div className="text-sm text-muted-foreground" role="status">{inviteMessage}</div> : null}
            {inviteLink ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-secondary px-3 py-2.5 text-sm" title={inviteLink}>{inviteLink}</code>
                <Button className="shrink-0" variant="outline" onClick={() => void copyInviteLink()}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy link"}</Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <StatCard icon={Users} label="Affiliated" value={techs ? String(counts.total) : "—"} />
        <StatCard label="Free now" intent="success" value={techs ? String(counts.free) : "—"} />
        <StatCard icon={ShieldCheck} label="Compliance attention" intent="warn" value={techs ? String(counts.attention) : "—"} />
        <StatCard label="Pending invites" value={techs ? String(counts.pending) : "—"} />
      </div>

      <Card className="mb-6">
        <CardContent className="grid gap-3 p-4 md:grid-cols-5">
          <div className="relative md:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="pending_invite">Pending invite</option>
            <option value="pending_vetting">Pending vetting</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
          <select className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" value={availFilter} onChange={(e) => setAvailFilter(e.target.value)}>
            <option value="all">All availability</option>
            <option value="free">Free</option>
            <option value="busy">Busy</option>
            <option value="offline">Offline</option>
          </select>
          <select className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)}>
            <option value="all">All skills</option>
            {skills.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" value={complianceFilter} onChange={(e) => setComplianceFilter(e.target.value)}>
            <option value="all">All compliance</option>
            <option value="compliant">Compliant</option>
            <option value="attention">Review soon</option>
            <option value="action_required">Action required</option>
            <option value="expiring">Has expiring/expired docs</option>
            <option value="no_documents">No documents</option>
          </select>
        </CardContent>
      </Card>

      {error ? <div className="mb-4 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Technician</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Skills</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead>Affiliated</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead className="text-right">Profile</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {techs === null ? (
                <TableRow><TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  {(techs.length === 0) ? "No technicians affiliated yet. Use “Invite technician” to add one." : "No technicians match the current filters."}
                </TableCell></TableRow>
              ) : filtered.map((t) => {
                const aStatus = affiliationStatus(t);
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {t.profile_photo_url ? (
                          <img alt="" className="size-9 rounded-full object-cover" src={t.profile_photo_url} />
                        ) : (
                          <div className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                            {(t.display_name ?? "?").slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium">{t.display_name ?? "—"}</div>
                          <div className="truncate text-xs text-muted-foreground">{t.email ?? t.phone ?? "—"}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[aStatus] ?? "neutral"}>{aStatus.replaceAll("_", " ")}</Badge></TableCell>
                    <TableCell><Badge variant={AVAIL_VARIANT[t.availability]}>{t.availability}</Badge></TableCell>
                    <TableCell>{t.completed_jobs}</TableCell>
                    <TableCell>{t.rating != null ? t.rating.toFixed(1) : "—"}</TableCell>
                    <TableCell className="max-w-[200px]"><div className="truncate text-xs text-muted-foreground" title={t.skills.join(", ")}>{t.skills.join(", ") || "—"}</div></TableCell>
                    <TableCell>
                      <Badge variant={COMPLIANCE_VARIANT[t.compliance.summary] ?? "neutral"}>{COMPLIANCE_LABEL[t.compliance.summary] ?? t.compliance.summary}</Badge>
                      {t.compliance.expired.length > 0 ? (
                        <div className="mt-1 flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="size-3" />{t.compliance.expired.length} expired</div>
                      ) : t.compliance.expiring.length > 0 ? (
                        <div className="mt-1 text-xs text-muted-foreground">{t.compliance.expiring.length} expiring soon</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(t.affiliation.affiliated_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{timeAgo(t.location_updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/technicians/${t.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppFrame>
  );
}
