import {
  activeTechnicianJobIds,
  jobById,
  technicianJobs
} from "@cluexp/api-client";
import {
  ActiveJobCard,
  FieldMapPanel,
  JobActionSheet,
  Screen,
  TechnicianShell
} from "@/components/mobile";
import { LiveOffersFeed } from "@/components/live-offers";

export default function JobsPage() {
  const activeJob = jobById(activeTechnicianJobIds[0]);
  const assignedJobs = technicianJobs().filter((job) => job.id !== activeJob?.id);
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
            {assignedJobs.map((job) => <ActiveJobCard key={job.id} job={job} />)}
          </div>
        </div>
        <JobActionSheet job={activeJob} />
      </Screen>
    </TechnicianShell>
  );
}
