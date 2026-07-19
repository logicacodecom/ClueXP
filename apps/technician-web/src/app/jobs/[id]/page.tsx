import { headers } from "next/headers";
import { ActiveJobWorkflow, type TechnicianJob } from "@/components/active-job-workflow";
import { Screen, TechnicianShell } from "@/components/mobile";

async function fetchJob(id: string): Promise<TechnicianJob | null> {
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
    return data as TechnicianJob;
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
    <TechnicianShell title="Active Job" nav={false} topbar={false}>
      <Screen flush padBottom={false}><ActiveJobWorkflow initialJob={job} /></Screen>
    </TechnicianShell>
  );
}
