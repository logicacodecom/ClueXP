import { headers } from "next/headers";
import type { Job } from "@cluexp/api-client";
import {
  ActiveJobHeader,
  FieldMapPanel,
  JobActionSheet,
  JobStatusTimeline,
  Pill,
  Screen,
  Section,
  TechnicianShell,
  icons
} from "@/components/mobile";

function opStatusToConsoleStatus(status: string): Job["console_status"] {
  if (status === "en_route") return "en_route";
  if (status === "arrived") return "arrived";
  if (status === "in_progress") return "in_service";
  if (status === "completed_pending_customer") return "customer_approval_needed";
  return "accepted";
}

function buildJob(id: string, data: Record<string, unknown>): Job {
  return {
    id,
    customer_display: "Customer",
    trust_state: "MATCHED",
    console_status: opStatusToConsoleStatus(String(data.status ?? "")),
    access_type: (data.access_type as Job["access_type"]) ?? "home",
    situation: String(data.situation ?? "Service request"),
    urgency: "medium",
    area: "",
    address: String(data.address ?? "Address on file"),
    routing_source: "ClueXP",
    safety_flags: [],
    age_min: 0,
    lat: typeof data.lat === "number" ? data.lat : undefined,
    lng: typeof data.lng === "number" ? data.lng : undefined,
  };
}

async function fetchJob(id: string): Promise<Job | null> {
  try {
    const headerList = await headers();
    const host = headerList.get("host");
    const protocol = headerList.get("x-forwarded-proto") ?? "http";
    if (!host) return null;
    const response = await fetch(`${protocol}://${host}/api/jobs/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: { cookie: headerList.get("cookie") ?? "" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return buildJob(id, data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await fetchJob(id);
  if (!job) {
    return (
      <TechnicianShell title="Active Job">
        <Screen>
          <div className="rounded-[22px] border border-border bg-card p-5 text-center">
            <p className="text-sm text-muted">Job details unavailable. Return to jobs list.</p>
          </div>
        </Screen>
      </TechnicianShell>
    );
  }
  return (
    <TechnicianShell title="Active Job">
      <Screen flush>
        <FieldMapPanel job={job} />
        <div className="px-4 pt-4">
          <ActiveJobHeader job={job} stage="Active job" />
          <Section action={<Pill tone="success" icon={icons.ShieldCheck}>Privacy safe</Pill>} title="Status timeline">
            <JobStatusTimeline job={job} timestamps={{}} />
          </Section>
        </div>
        <JobActionSheet job={job} />
      </Screen>
    </TechnicianShell>
  );
}
