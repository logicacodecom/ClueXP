import { headers } from "next/headers";
import type { Job } from "@cluexp/api-client";
import {
  ActiveJobCard,
  EmptyJobState,
  FieldMapPanel,
  JobActionSheet,
  Screen,
  TechnicianShell
} from "@/components/mobile";
import { LiveOffersFeed } from "@/components/live-offers";

type ActiveJobRead =
  | { state: "ready"; job: Job }
  | { state: "empty" }
  | { state: "unauthorized"; detail: string }
  | { state: "error"; detail: string };

function opStatusToConsoleStatus(status: string): Job["console_status"] {
  if (status === "en_route") return "en_route";
  if (status === "arrived") return "arrived";
  if (status === "in_progress") return "in_service";
  if (status === "completed_pending_customer") return "customer_approval_needed";
  return "accepted"; // assigned or unknown
}

function buildJob(data: Record<string, unknown>): Job {
  return {
    id: String(data.id),
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

async function getActiveJobFromAPI(): Promise<ActiveJobRead> {
  try {
    const headerList = await headers();
    const host = headerList.get("host");
    const protocol = headerList.get("x-forwarded-proto") ?? "http";
    if (!host) return { state: "error", detail: "Cannot resolve local technician API" };

    const response = await fetch(`${protocol}://${host}/api/active-job`, {
      cache: "no-store",
      headers: {
        cookie: headerList.get("cookie") ?? ""
      }
    });
    const data = await response.json();
    if (response.status === 401 || response.status === 403) {
      return { state: "unauthorized", detail: data.detail ?? "Sign in to restore your active job." };
    }
    if (!response.ok) {
      return { state: "error", detail: data.detail ?? `Active job sync failed (${response.status})` };
    }
    if (!data.id) return { state: "empty" };
    return { state: "ready", job: buildJob(data as Record<string, unknown>) };
  } catch {
    return { state: "error", detail: "Active job sync is offline. Retry when the network is available." };
  }
}

export default async function JobsPage() {
  const activeJobRead = await getActiveJobFromAPI();
  const activeJob = activeJobRead.state === "ready" ? activeJobRead.job : undefined;
  return (
    <TechnicianShell>
      <Screen flush>
        <FieldMapPanel job={activeJob} />
        <div className="px-4 pt-4">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase text-muted">Dispatch feed</div>
              <h1 className="text-2xl font-black leading-tight">Nearby work</h1>
            </div>
            <div className="rounded-full border border-success/30 bg-success/12 px-3 py-1.5 text-xs font-black text-success">
              Polling live
            </div>
          </div>
          <div className="space-y-3">
            <LiveOffersFeed />
            {activeJob ? <ActiveJobCard job={activeJob} /> : null}
            {!activeJob && activeJobRead.state === "empty" ? <EmptyJobState /> : null}
            {!activeJob && (activeJobRead.state === "unauthorized" || activeJobRead.state === "error") ? (
              <div className="rounded-[22px] border border-danger/30 bg-danger/10 p-4">
                <div className="text-[11px] font-black uppercase text-danger">
                  {activeJobRead.state === "unauthorized" ? "Session check" : "Sync interrupted"}
                </div>
                <p className="mt-2 text-sm leading-5 text-muted">{activeJobRead.detail}</p>
              </div>
            ) : null}
          </div>
        </div>
        <JobActionSheet job={activeJob} />
      </Screen>
    </TechnicianShell>
  );
}
