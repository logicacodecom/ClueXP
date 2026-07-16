"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
  skillLabel
} from "@cluexp/console-ui";
import { ArrowLeft, Ban, DollarSign, FileText, Plus, Save, ShieldCheck, Star, Trash2, Users, UserMinus, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../../frame";
import { ProviderActionDialog } from "../../provider-action-dialog";

interface ReviewSummary {
  count: number;
  average: number | null;
}

interface TechnicianDocument {
  id: string;
  document_type: string;
  document_number?: string | null;
  status: string;
  rejected_reason?: string | null;
  expiration_date?: string | null;
  uploaded_at?: string | null;
}

interface TechnicianDetail {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  profile_photo_url?: string | null;
  status: string;
  vetting_status: string | null;
  skills: string[];
  rating: number | null;
  location_updated_at: string | null;
  affiliation: {
    status: string;
    affiliation_type: string | null;
    exclusivity: string | null;
    dispatch_allowed: boolean;
    affiliated_at: string | null;
    is_pending_invite: boolean;
  };
  agreement: Agreement | null;
  team_memberships: Array<{ team_id: string; name: string | null; role: string | null }>;
  reviews: { company: ReviewSummary; global: ReviewSummary };
  documents: TechnicianDocument[];
}

interface Agreement {
  id: string | null;
  status: string;
  effective_from: string | null;
  effective_until: string | null;
  default_labor_cut_basis_points: number;
  tip_policy: string;
  tip_cut_basis_points: number;
  card_fee_policy: string;
  minimum_payout_cents: number;
  flat_job_bonus_cents: number;
  service_area_counties: string[];
  service_area_zipcodes: string[];
  service_hours: Record<string, unknown>;
  rules: { skill_cuts?: Record<string, number>; category_cuts?: Record<string, number>; targets?: unknown[] };
}

type SkillCutDraft = { skill_code: string; cut_percent: string };
type ServiceHourDraft = { day: string; enabled: boolean; start: string; end: string };

const DAYS: Array<{ key: string; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" }
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function ratingValue(summary: ReviewSummary): string {
  if (summary.average == null) return summary.count > 0 ? "—" : "No reviews";
  return `${summary.average.toFixed(1)} (${summary.count})`;
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(value: string): number {
  const parsed = Number.parseFloat(value || "0");
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function skillCutsToRows(cuts: Record<string, number> | undefined): SkillCutDraft[] {
  return Object.entries(cuts ?? {}).map(([skill_code, basisPoints]) => ({
    skill_code,
    cut_percent: (basisPoints / 100).toString()
  }));
}

function rowsToSkillCuts(rows: SkillCutDraft[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const code = row.skill_code.trim();
    if (!code) return acc;
    const percent = Number(row.cut_percent || 0);
    if (!Number.isFinite(percent)) return acc;
    acc[code] = Math.round(percent * 100);
    return acc;
  }, {});
}

function serviceHoursToRows(hours: Record<string, unknown> | undefined): ServiceHourDraft[] {
  return DAYS.map((day) => {
    const raw = (hours ?? {})[day.key];
    if (raw && typeof raw === "object") {
      const value = raw as { start?: unknown; end?: unknown; enabled?: unknown };
      return {
        day: day.key,
        enabled: value.enabled !== false,
        start: typeof value.start === "string" ? value.start : "08:00",
        end: typeof value.end === "string" ? value.end : "18:00"
      };
    }
    return { day: day.key, enabled: false, start: "08:00", end: "18:00" };
  });
}

function rowsToServiceHours(rows: ServiceHourDraft[]): Record<string, { start: string; end: string; enabled: boolean }> {
  return rows.reduce<Record<string, { start: string; end: string; enabled: boolean }>>((acc, row) => {
    acc[row.day] = { start: row.start, end: row.end, enabled: row.enabled };
    return acc;
  }, {});
}

export default function ProviderTechnicianProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [technician, setTechnician] = useState<TechnicianDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not_found">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreementDraft, setAgreementDraft] = useState({
    status: "draft",
    default_labor_cut_percent: "50",
    tip_policy: "tech_keeps",
    tip_cut_percent: "100",
    card_fee_policy: "company_pays",
    minimum_payout: "0.00",
    flat_job_bonus: "0.00",
    counties: "",
    zipcodes: ""
  });
  const [skillCutRows, setSkillCutRows] = useState<SkillCutDraft[]>([]);
  const [serviceHourRows, setServiceHourRows] = useState<ServiceHourDraft[]>(serviceHoursToRows({}));

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/technicians/${params.id}`, { cache: "no-store" });
    if (response.status === 404) {
      setStatus("not_found");
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || "Unable to load technician");
    setTechnician(body as TechnicianDetail);
    const agreement = (body as TechnicianDetail).agreement;
    if (agreement) {
      setAgreementDraft({
        status: agreement.status,
        default_labor_cut_percent: (agreement.default_labor_cut_basis_points / 100).toString(),
        tip_policy: agreement.tip_policy,
        tip_cut_percent: (agreement.tip_cut_basis_points / 100).toString(),
        card_fee_policy: agreement.card_fee_policy,
        minimum_payout: centsToDollars(agreement.minimum_payout_cents),
        flat_job_bonus: centsToDollars(agreement.flat_job_bonus_cents),
        counties: agreement.service_area_counties.join(", "),
        zipcodes: agreement.service_area_zipcodes.join(", ")
      });
      setSkillCutRows(skillCutsToRows(agreement.rules?.skill_cuts));
      setServiceHourRows(serviceHoursToRows(agreement.service_hours));
    }
    setStatus("ready");
  }, [params.id]);

  useEffect(() => {
    void refresh().catch((cause) => {
      setMessage(cause instanceof Error ? cause.message : "Unable to load technician");
      setStatus("not_found");
    });
  }, [refresh]);

  async function mutateAffiliation(action: "suspend" | "end", reason: string) {
    if (!technician) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/technicians/${technician.id}/affiliation/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to update affiliation");
      if (action === "end") {
        router.push("/technicians");
        return;
      }
      setMessage("Affiliation suspended.");
      await refresh();
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Unable to update affiliation");
      setMessage(error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function saveAgreement() {
    if (!technician) return;
    setBusy(true);
    setMessage(null);
    try {
      const serviceHours = rowsToServiceHours(serviceHourRows);
      const skillCuts = rowsToSkillCuts(skillCutRows);
      const response = await fetch(`/api/technicians/${technician.id}/agreement`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: agreementDraft.status,
          default_labor_cut_basis_points: Math.round(Number(agreementDraft.default_labor_cut_percent || 0) * 100),
          tip_policy: agreementDraft.tip_policy,
          tip_cut_basis_points: Math.round(Number(agreementDraft.tip_cut_percent || 0) * 100),
          card_fee_policy: agreementDraft.card_fee_policy,
          minimum_payout_cents: dollarsToCents(agreementDraft.minimum_payout),
          flat_job_bonus_cents: dollarsToCents(agreementDraft.flat_job_bonus),
          service_area_counties: agreementDraft.counties.split(",").map((item) => item.trim()).filter(Boolean),
          service_area_zipcodes: agreementDraft.zipcodes.split(",").map((item) => item.trim()).filter(Boolean),
          service_hours: serviceHours,
          rules: { skill_cuts: skillCuts, category_cuts: {}, targets: [] }
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save agreement");
      setTechnician((current) => current ? { ...current, agreement: body as Agreement } : current);
      setMessage("Agreement saved. Future settlement reports will use these rules.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save agreement");
    } finally {
      setBusy(false);
    }
  }

  function updateSkillCut(index: number, patch: Partial<SkillCutDraft>) {
    setSkillCutRows((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  function removeSkillCut(index: number) {
    setSkillCutRows((rows) => rows.filter((_, i) => i !== index));
  }

  function updateServiceHour(day: string, patch: Partial<ServiceHourDraft>) {
    setServiceHourRows((rows) => rows.map((row) => row.day === day ? { ...row, ...patch } : row));
  }

  const pending = technician?.affiliation.is_pending_invite ?? false;

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader
          kicker="Workforce"
          title={technician?.display_name ?? (status === "not_found" ? "Technician not found" : "Technician profile")}
          description="Read-only company view of an affiliated technician. The technician owns and edits the global profile."
          actions={
            <Button asChild variant="outline">
              <Link href="/technicians"><ArrowLeft className="size-4" />Back</Link>
            </Button>
          }
        />

        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}

        {status === "loading" ? (
          <Card><CardContent className="p-8 text-sm text-muted-foreground">Loading technician…</CardContent></Card>
        ) : status === "not_found" || !technician ? (
          <Card><CardContent className="p-8 text-sm text-muted-foreground">This technician is not affiliated with your company, or the affiliation is no longer visible.</CardContent></Card>
        ) : (
          <>
            <Card>
              <CardContent className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4">
                  {technician.profile_photo_url ? (
                    <img alt="" className="size-20 rounded-full object-cover" src={technician.profile_photo_url} />
                  ) : (
                    <div className="flex size-20 items-center justify-center rounded-full bg-muted text-2xl font-bold text-muted-foreground">
                      {(technician.display_name ?? "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="text-xl font-semibold">{technician.display_name ?? "Unnamed technician"}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{technician.email ?? technician.phone ?? "No contact shown"}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant={technician.affiliation.status === "active" ? "success" : "warn"}>{technician.affiliation.status.replaceAll("_", " ")}</Badge>
                      <Badge variant="outline">{(technician.affiliation.affiliation_type ?? "unknown").replaceAll("_", " ")}</Badge>
                      <Badge variant={technician.vetting_status === "verified" ? "success" : "warn"}>{technician.vetting_status ?? "unknown vetting"}</Badge>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pending ? (
                    <ProviderActionDialog
                      confirmLabel="Revoke invite"
                      description={`Revoke the pending company invitation for ${technician.display_name ?? "this technician"}. Their global profile will not be changed.`}
                      disabled={busy}
                      onConfirm={(reason) => mutateAffiliation("end", reason)}
                      reasonMode="required"
                      title={`Revoke invite for ${technician.display_name ?? "this technician"}?`}
                      variant="destructive"
                    >
                      <Button variant="destructive"><XCircle className="size-4" />Revoke invite</Button>
                    </ProviderActionDialog>
                  ) : technician.affiliation.status === "active" ? (
                    <>
                      <ProviderActionDialog
                        confirmLabel="Suspend affiliation"
                        description={`Temporarily stop ${technician.display_name ?? "this technician"} from receiving work through your company. Their global profile is not changed.`}
                        disabled={busy}
                        onConfirm={(reason) => mutateAffiliation("suspend", reason)}
                        reasonMode="required"
                        title={`Suspend ${technician.display_name ?? "this technician"}?`}
                        variant="destructive"
                      >
                        <Button variant="outline"><Ban className="size-4" />Suspend</Button>
                      </ProviderActionDialog>
                      <ProviderActionDialog
                        confirmLabel="End affiliation"
                        description={`End your company's affiliation with ${technician.display_name ?? "this technician"}. History is preserved and they can be invited again later.`}
                        disabled={busy}
                        onConfirm={(reason) => mutateAffiliation("end", reason)}
                        reasonMode="required"
                        title={`End affiliation with ${technician.display_name ?? "this technician"}?`}
                        variant="destructive"
                      >
                        <Button variant="destructive"><UserMinus className="size-4" />End affiliation</Button>
                      </ProviderActionDialog>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-4">
              <StatCard icon={Star} label="Company reviews" value={ratingValue(technician.reviews.company)} />
              <StatCard icon={Star} label="Global reviews" value={ratingValue(technician.reviews.global)} />
              <StatCard icon={Star} label="Global rating" value={technician.rating != null ? technician.rating.toFixed(1) : "—"} />
              <StatCard label="Affiliated since" value={formatDate(technician.affiliation.affiliated_at)} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><DollarSign className="size-5 text-primary" />Agreement and settlement rules</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Company-specific agreement for this technician. It is scoped to this affiliation only, so the same technician can safely work under different rules for another company.
                </p>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="space-y-1 text-sm font-medium">
                    Status
                    <select className="w-full rounded-md border border-border bg-background px-3 py-2" value={agreementDraft.status} onChange={(e) => setAgreementDraft((d) => ({ ...d, status: e.target.value }))}>
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="archived">Archived</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Default service cut %
                    <input className="w-full rounded-md border border-border bg-background px-3 py-2" inputMode="decimal" value={agreementDraft.default_labor_cut_percent} onChange={(e) => setAgreementDraft((d) => ({ ...d, default_labor_cut_percent: e.target.value }))} />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Minimum payout $
                    <input className="w-full rounded-md border border-border bg-background px-3 py-2" inputMode="decimal" value={agreementDraft.minimum_payout} onChange={(e) => setAgreementDraft((d) => ({ ...d, minimum_payout: e.target.value }))} />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Flat job bonus $
                    <input className="w-full rounded-md border border-border bg-background px-3 py-2" inputMode="decimal" value={agreementDraft.flat_job_bonus} onChange={(e) => setAgreementDraft((d) => ({ ...d, flat_job_bonus: e.target.value }))} />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="space-y-1 text-sm font-medium">
                    Tip policy
                    <select className="w-full rounded-md border border-border bg-background px-3 py-2" value={agreementDraft.tip_policy} onChange={(e) => setAgreementDraft((d) => ({ ...d, tip_policy: e.target.value }))}>
                      <option value="tech_keeps">Tech keeps</option>
                      <option value="company_keeps">Company keeps</option>
                      <option value="split">Split by percent</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Tip cut %
                    <input className="w-full rounded-md border border-border bg-background px-3 py-2" inputMode="decimal" value={agreementDraft.tip_cut_percent} onChange={(e) => setAgreementDraft((d) => ({ ...d, tip_cut_percent: e.target.value }))} />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Card fee policy
                    <select className="w-full rounded-md border border-border bg-background px-3 py-2" value={agreementDraft.card_fee_policy} onChange={(e) => setAgreementDraft((d) => ({ ...d, card_fee_policy: e.target.value }))}>
                      <option value="company_pays">Company pays</option>
                      <option value="deduct_from_company">Deduct from company share</option>
                      <option value="split">Split later</option>
                    </select>
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm font-medium">
                    Service counties
                    <input className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="Orange, Seminole" value={agreementDraft.counties} onChange={(e) => setAgreementDraft((d) => ({ ...d, counties: e.target.value }))} />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    ZIP codes
                    <input className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="32801, 32803" value={agreementDraft.zipcodes} onChange={(e) => setAgreementDraft((d) => ({ ...d, zipcodes: e.target.value }))} />
                  </label>
                </div>
                <div className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">Skill-specific cuts</h3>
                        <p className="mt-1 text-xs text-muted-foreground">Override the default service cut for selected skills only.</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSkillCutRows((rows) => [...rows, { skill_code: technician.skills[0] ?? "", cut_percent: agreementDraft.default_labor_cut_percent }])}
                      >
                        <Plus className="size-4" />Add skill
                      </Button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {skillCutRows.length === 0 ? (
                        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">No overrides. The default service cut applies to every skill.</p>
                      ) : skillCutRows.map((row, index) => (
                        <div className="grid gap-2 rounded-md border border-border bg-background p-2 md:grid-cols-[1fr_120px_auto]" key={`${row.skill_code}-${index}`}>
                          <label className="space-y-1 text-xs font-medium text-muted-foreground">
                            Skill
                            <input
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                              list="technician-skills"
                              placeholder="locksmith.vehicle_key_programming"
                              value={row.skill_code}
                              onChange={(e) => updateSkillCut(index, { skill_code: e.target.value })}
                            />
                          </label>
                          <label className="space-y-1 text-xs font-medium text-muted-foreground">
                            Cut %
                            <input
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                              inputMode="decimal"
                              value={row.cut_percent}
                              onChange={(e) => updateSkillCut(index, { cut_percent: e.target.value })}
                            />
                          </label>
                          <Button type="button" variant="outline" onClick={() => removeSkillCut(index)} aria-label="Remove skill cut">
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <datalist id="technician-skills">
                      {technician.skills.map((skill) => <option key={skill} value={skill}>{skillLabel(skill)}</option>)}
                    </datalist>
                  </div>

                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <h3 className="text-sm font-semibold">Service hours</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Used for dispatch guidance and agreement review. It does not change the technician-owned availability toggle.</p>
                    <div className="mt-3 space-y-2">
                      {serviceHourRows.map((row) => {
                        const day = DAYS.find((item) => item.key === row.day);
                        return (
                          <div className="grid grid-cols-[68px_1fr_1fr] items-center gap-2 rounded-md border border-border bg-background p-2" key={row.day}>
                            <label className="flex items-center gap-2 text-sm font-medium">
                              <input
                                checked={row.enabled}
                                className="size-4"
                                type="checkbox"
                                onChange={(e) => updateServiceHour(row.day, { enabled: e.target.checked })}
                              />
                              {day?.label ?? row.day}
                            </label>
                            <input
                              aria-label={`${day?.label ?? row.day} start time`}
                              className="rounded-md border border-border bg-background px-2 py-2 text-sm disabled:opacity-45"
                              disabled={!row.enabled}
                              type="time"
                              value={row.start}
                              onChange={(e) => updateServiceHour(row.day, { start: e.target.value })}
                            />
                            <input
                              aria-label={`${day?.label ?? row.day} end time`}
                              className="rounded-md border border-border bg-background px-2 py-2 text-sm disabled:opacity-45"
                              disabled={!row.enabled}
                              type="time"
                              value={row.end}
                              onChange={(e) => updateServiceHour(row.day, { end: e.target.value })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">Parts and key-code purchases are excluded from commission; tech-provided eligible items become reimbursement lines in settlement reports.</p>
                  <Button disabled={busy || pending} onClick={() => void saveAgreement()}><Save className="size-4" />{busy ? "Saving…" : "Save agreement"}</Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-5 text-primary" />Team memberships</CardTitle></CardHeader>
                <CardContent>
                  {technician.team_memberships.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {technician.team_memberships.map((m) => (
                        <Badge key={m.team_id} variant="outline">{m.name ?? "Unnamed team"}{m.role ? ` · ${m.role}` : ""}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not a member of any team. Add them from the Teams page.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Skills</CardTitle></CardHeader>
                <CardContent>
                  {technician.skills.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {technician.skills.map((skill) => <Badge key={skill} variant="outline">{skillLabel(skill)}</Badge>)}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No skills selected by the technician.</p>
                  )}
                  <p className="mt-4 text-xs text-muted-foreground">Skills are part of the technician-owned global profile and cannot be edited by providers.</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" />Certifications and compliance</CardTitle></CardHeader>
              <CardContent>
                {technician.documents.length > 0 ? (
                  <div className="divide-y divide-border">
                    {technician.documents.map((doc) => (
                      <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <FileText className="size-4 text-muted-foreground" />
                            {doc.document_type.replaceAll("_", " ")}
                            {doc.document_number ? <span className="text-xs text-muted-foreground">· {doc.document_number}</span> : null}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {doc.expiration_date ? `Expires ${formatDate(doc.expiration_date)}` : "No expiry on file"}
                            {doc.rejected_reason ? ` · ${doc.rejected_reason}` : ""}
                          </div>
                        </div>
                        <Badge variant={doc.status === "approved" ? "success" : doc.status === "rejected" ? "danger" : "warn"}>{doc.status.replaceAll("_", " ")}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No certifications or compliance documents on file for this technician.</p>
                )}
                <p className="mt-4 text-xs text-muted-foreground">Document upload and verification are technician-owned / Ops actions — not provider profile actions.</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppFrame>
  );
}
