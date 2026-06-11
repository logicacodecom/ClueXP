import { assignedTechnicianJobIds, jobById } from "@cluexp/api-client";
import { headers } from "next/headers";
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
  | { state: "ready"; id: string; status: string | null }
  | { state: "empty" }
  | { state: "unauthorized"; detail: string }
  | { state: "error"; detail: string };

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
    return { state: "ready", id: data.id, status: data.status ?? null };
  } catch {
    return { state: "error", detail: "Active job sync is offline. Retry when the network is available." };
  }
}

export default async function JobsPage() {
  const activeJobRead = await getActiveJobFromAPI();
  const activeJobId = activeJobRead.state === "ready" ? activeJobRead.id : null;
  const activeJob = activeJobId ? jobById(activeJobId) : undefined;
  const assignedJobIds = assignedTechnicianJobIds();
  const assignedJobs = assignedJobIds
    .map((id) => jobById(id))
    .filter((job): job is NonNullable<typeof job> => job != null && job.id !== activeJob?.id);
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
            {!activeJob && activeJobRead.state === "ready" ? (
              <div className="rounded-[22px] border border-primary/30 bg-primary/10 p-4">
                <div className="text-[11px] font-black uppercase text-primary">Active job restored</div>
                <h2 className="mt-2 text-xl font-black leading-tight">Real job {activeJobRead.id.slice(0, 8)}</h2>
                <p className="mt-1 text-sm leading-5 text-muted">
                  Status: {activeJobRead.status ?? "active"}. Full job details will appear when the production job read model is available.
                </p>
              </div>
            ) : null}
            {!activeJob && activeJobRead.state === "empty" ? <EmptyJobState /> : null}
            {!activeJob && (activeJobRead.state === "unauthorized" || activeJobRead.state === "error") ? (
              <div className="rounded-[22px] border border-danger/30 bg-danger/10 p-4">
                <div className="text-[11px] font-black uppercase text-danger">
                  {activeJobRead.state === "unauthorized" ? "Session check" : "Sync interrupted"}
                </div>
                <p className="mt-2 text-sm leading-5 text-muted">{activeJobRead.detail}</p>
              </div>
            ) : null}
            {assignedJobs.map((job) => <ActiveJobCard key={job.id} job={job} />)}
          </div>
        </div>
        <JobActionSheet job={activeJob} />
      </Screen>
    </TechnicianShell>
  );
}
