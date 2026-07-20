import { headers } from "next/headers";
import { Screen, TechnicianShell } from "@/components/mobile";
import { ActiveJobWorkflow, type TechnicianJob } from "@/components/active-job-workflow";
import { LiveOffersFeed } from "@/components/live-offers";
import { WorkReadiness } from "@/components/readiness-bar";

type ActiveJobRead =
  | { state: "ready"; job: TechnicianJob }
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
    return { state: "ready", job: data as TechnicianJob };
  } catch {
    return { state: "error", detail: "Active job sync is offline. Retry when the network is available." };
  }
}

export default async function JobsPage() {
  const activeJobRead = await getActiveJobFromAPI();
  const activeJob = activeJobRead.state === "ready" ? activeJobRead.job : undefined;
  if (activeJob) {
    return (
      <TechnicianShell title="Active Job" nav={false} topbar={false}>
        <Screen flush padBottom={false}><ActiveJobWorkflow initialJob={activeJob} /></Screen>
      </TechnicianShell>
    );
  }
  return (
      <TechnicianShell>
      <Screen>
        <div className="pt-3">
          {activeJobRead.state === "unauthorized" || activeJobRead.state === "error" ? (
            <div className="mb-3 border border-danger/30 bg-danger/10 p-4">
              <div className="text-[11px] font-black uppercase text-danger">
                {activeJobRead.state === "unauthorized" ? "Session check" : "Sync interrupted"}
              </div>
              <p className="mt-2 text-sm leading-5 text-muted">{activeJobRead.detail}</p>
            </div>
          ) : null}
          <WorkReadiness>
            <div className="mt-3 space-y-3">
              <LiveOffersFeed />
              {activeJobRead.state === "empty" ? (
                <div className="border-y border-border py-5">
                  <p className="font-black">No active assignment</p>
                  <p className="mt-1 text-sm leading-5 text-muted">New offers will appear here when an Ops dispatcher selects you.</p>
                </div>
              ) : null}
            </div>
          </WorkReadiness>
        </div>
      </Screen>
    </TechnicianShell>
  );
}
