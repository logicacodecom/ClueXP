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
import { ArrowLeft, Ban, FileText, ShieldCheck, Star, Users, UserMinus, XCircle } from "lucide-react";
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
  team_memberships: Array<{ team_id: string; name: string | null; role: string | null }>;
  reviews: { company: ReviewSummary; global: ReviewSummary };
  documents: TechnicianDocument[];
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function ratingValue(summary: ReviewSummary): string {
  if (summary.average == null) return summary.count > 0 ? "—" : "No reviews";
  return `${summary.average.toFixed(1)} (${summary.count})`;
}

export default function ProviderTechnicianProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [technician, setTechnician] = useState<TechnicianDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not_found">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/technicians/${params.id}`, { cache: "no-store" });
    if (response.status === 404) {
      setStatus("not_found");
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || "Unable to load technician");
    setTechnician(body as TechnicianDetail);
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
