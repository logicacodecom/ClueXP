"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, StatCard } from "@cluexp/console-ui";
import { AlertTriangle, Building2, FileWarning, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";

type Severity = "critical" | "warn" | "info";

interface Registration {
  kind: "organization" | "technician";
  id: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  vetting_status?: string | null;
  created_at?: string | null;
}

interface CompanyRow {
  id: string;
  display_name: string;
  status: string;
}

interface TechnicianRow {
  id: string;
  display_name: string;
  status: string;
  vetting_status: string;
}

interface CompanyDetail {
  id: string;
  display_name: string;
  documents: { id: string; document_type: string; status: string; expires_at?: string | null }[];
}

interface TechnicianDetail {
  id: string;
  display_name: string;
  profile_photo_status: string;
  documents: { id: string; document_type: string; status: string; expiration_date?: string | null }[];
}

const REQUIRED_COMPANY_DOCS = ["business_license", "insurance"] as const;
const REQUIRED_TECH_DOCS = ["background_check", "license", "insurance"] as const;

function daysUntil(value?: string | null) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / 86400000);
}

function statusVariant(severity: Severity) {
  if (severity === "critical") return "danger" as const;
  if (severity === "warn") return "warn" as const;
  return "info" as const;
}

async function readJson<T>(url: string, fallback: T): Promise<{ data: T; error?: string }> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { data: fallback, error: body.detail || `Unable to load ${url}` };
    return { data: body, error: undefined };
  } catch (cause) {
    return { data: fallback, error: cause instanceof Error ? cause.message : `Unable to load ${url}` };
  }
}

export default function DashboardPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianRow[]>([]);
  const [companyDetails, setCompanyDetails] = useState<CompanyDetail[]>([]);
  const [technicianDetails, setTechnicianDetails] = useState<TechnicianDetail[]>([]);
  const [documentQueues, setDocumentQueues] = useState({ provider: 0, technician: 0, photos: 0 });
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const nextErrors: string[] = [];
    const [approvals, orgs, techs, providerDocs, techDocs, photos] = await Promise.all([
      readJson<{ registrations?: Registration[] }>("/api/approvals", {}),
      readJson<{ organizations?: CompanyRow[] }>("/api/organizations", {}),
      readJson<{ technicians?: TechnicianRow[] }>("/api/technicians", {}),
      readJson<{ documents?: unknown[] }>("/api/documents", {}),
      readJson<{ documents?: unknown[] }>("/api/technician-documents", {}),
      readJson<{ photos?: unknown[] }>("/api/technician-photos", {})
    ]);
    for (const item of [approvals, orgs, techs, providerDocs, techDocs, photos]) {
      if (item.error) nextErrors.push(item.error);
    }
    const nextCompanies = orgs.data.organizations ?? [];
    const nextTechnicians = techs.data.technicians ?? [];
    setRegistrations(approvals.data.registrations ?? []);
    setCompanies(nextCompanies);
    setTechnicians(nextTechnicians);
    setDocumentQueues({
      provider: providerDocs.data.documents?.length ?? 0,
      technician: techDocs.data.documents?.length ?? 0,
      photos: photos.data.photos?.length ?? 0
    });

    const details = await Promise.allSettled([
      ...nextCompanies.slice(0, 25).map((row) => readJson<CompanyDetail | null>(`/api/organizations/${row.id}`, null)),
      ...nextTechnicians.slice(0, 25).map((row) => readJson<TechnicianDetail | null>(`/api/technicians/${row.id}`, null))
    ]);
    const nextCompanyDetails: CompanyDetail[] = [];
    const nextTechnicianDetails: TechnicianDetail[] = [];
    for (const item of details) {
      if (item.status !== "fulfilled") continue;
      if (item.value.error) nextErrors.push(item.value.error);
      const data = item.value.data;
      if (!data) continue;
      if ("profile_photo_status" in data) nextTechnicianDetails.push(data);
      else nextCompanyDetails.push(data);
    }
    setCompanyDetails(nextCompanyDetails);
    setTechnicianDetails(nextTechnicianDetails);
    setErrors(Array.from(new Set(nextErrors)));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const alerts = useMemo(() => {
    const items: { id: string; title: string; description: string; href: string; severity: Severity }[] = [];
    for (const company of companyDetails) {
      const docs = new Set(company.documents.map((doc) => doc.document_type));
      const missing = REQUIRED_COMPANY_DOCS.filter((type) => !docs.has(type));
      if (missing.length) {
        items.push({
          id: `company:${company.id}:missing`,
          title: company.display_name,
          description: `Missing ${missing.map((item) => item.replaceAll("_", " ")).join(", ")}`,
          href: `/companies/${company.id}`,
          severity: "critical"
        });
      }
      for (const doc of company.documents) {
        const remaining = daysUntil(doc.expires_at);
        if (remaining !== null && remaining <= 30) {
          items.push({
            id: `company:${company.id}:${doc.id}`,
            title: company.display_name,
            description: `${doc.document_type.replaceAll("_", " ")} ${remaining < 0 ? "expired" : `expires in ${remaining} days`}`,
            href: `/companies/${company.id}`,
            severity: remaining < 0 ? "critical" : "warn"
          });
        }
      }
    }
    for (const technician of technicianDetails) {
      const docs = new Set(technician.documents.map((doc) => doc.document_type));
      const missing = REQUIRED_TECH_DOCS.filter((type) => !docs.has(type));
      if (missing.length || technician.profile_photo_status !== "approved") {
        items.push({
          id: `tech:${technician.id}:missing`,
          title: technician.display_name,
          description: [
            missing.length ? `Missing ${missing.map((item) => item.replaceAll("_", " ")).join(", ")}` : null,
            technician.profile_photo_status !== "approved" ? `Photo ${technician.profile_photo_status}` : null
          ].filter(Boolean).join("; "),
          href: `/technicians/${technician.id}`,
          severity: "critical"
        });
      }
      for (const doc of technician.documents) {
        const remaining = daysUntil(doc.expiration_date);
        if (remaining !== null && remaining <= 30) {
          items.push({
            id: `tech:${technician.id}:${doc.id}`,
            title: technician.display_name,
            description: `${doc.document_type.replaceAll("_", " ")} ${remaining < 0 ? "expired" : `expires in ${remaining} days`}`,
            href: `/technicians/${technician.id}`,
            severity: remaining < 0 ? "critical" : "warn"
          });
        }
      }
    }
    return items.slice(0, 12);
  }, [companyDetails, technicianDetails]);

  const pendingCompanies = registrations.filter((item) => item.kind === "organization").length;
  const pendingTechnicians = registrations.filter((item) => item.kind === "technician").length;
  const reviewDocs = documentQueues.provider + documentQueues.technician + documentQueues.photos;

  return (
    <AppFrame>
      <PageHeader
        kicker="Operations"
        title="Dashboard"
        description="Approval and compliance work that needs platform attention."
        actions={<Button onClick={() => void refresh()} variant="outline">{loading ? "Refreshing" : "Refresh"}</Button>}
      />
      {errors.length ? (
        <div className="mb-4 rounded-md border border-warn/35 bg-warn/10 p-3 text-sm text-warn" role="status">
          Some dashboard feeds are unavailable: {errors.join("; ")}
        </div>
      ) : null}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={ShieldCheck} intent={pendingCompanies + pendingTechnicians ? "warn" : "success"} label="Pending approvals" value={String(pendingCompanies + pendingTechnicians)} />
        <StatCard icon={FileWarning} intent={reviewDocs ? "warn" : "success"} label="Docs to review" value={String(reviewDocs)} />
        <StatCard icon={AlertTriangle} intent={alerts.length ? "danger" : "success"} label="Compliance alerts" value={String(alerts.length)} />
        <StatCard icon={Building2} label="Network size" value={`${companies.length} / ${technicians.length}`} trend="companies / technicians" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>Needs approval</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {registrations.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No approvals waiting" description="New company and technician registrations will appear here." />
            ) : registrations.slice(0, 8).map((item) => (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-4" key={`${item.kind}:${item.id}`}>
                {item.kind === "organization" ? <Building2 className="size-5 text-primary" /> : <UserRound className="size-5 text-primary" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.display_name}</div>
                  <div className="truncate text-sm text-muted-foreground">{item.email || item.phone || item.id}</div>
                </div>
                <Badge variant="warn">{item.kind === "organization" ? "company" : "technician"}</Badge>
                <Button asChild size="sm"><Link href={item.kind === "organization" ? `/companies/${item.id}` : `/technicians/${item.id}`}>Review</Link></Button>
              </div>
            ))}
            {registrations.length > 8 ? <Button asChild variant="outline"><Link href="/approvals">Open full approval queue</Link></Button> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Compliance alerts</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {alerts.length === 0 ? (
              <EmptyState icon={FileWarning} title="No compliance alerts" description="Missing, rejected, expired, and near-expiry documents will appear here." />
            ) : alerts.map((item) => (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-4" key={item.id}>
                <Badge variant={statusVariant(item.severity)}>{item.severity}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.title}</div>
                  <div className="text-sm text-muted-foreground">{item.description}</div>
                </div>
                <Button asChild size="sm" variant="outline"><Link href={item.href}>Open</Link></Button>
              </div>
            ))}
            {reviewDocs ? <Button asChild variant="outline"><Link href="/documents">Open document review</Link></Button> : null}
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
