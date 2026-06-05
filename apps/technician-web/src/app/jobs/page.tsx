import {
  activeTechnicianJobIds,
  jobById,
  technicianAppOffers,
  technicianJobs
} from "@cluexp/api-client";
import {
  ActiveJobCard,
  EmptyJobState,
  FieldMapPanel,
  JobActionSheet,
  JobOfferCard,
  Screen,
  TechnicianShell
} from "@/components/mobile";

export default function JobsPage() {
  const activeJob = jobById(activeTechnicianJobIds[0]);
  const assignedJobs = technicianJobs().filter((job) => job.id !== activeJob?.id);
  const openOffers = technicianAppOffers.filter((offer) => offer.status !== "superseded");
  const primaryOffer = openOffers[0];
  const offerJob = jobById(primaryOffer?.job_id);
  return (
    <TechnicianShell>
      <Screen flush>
        <FieldMapPanel job={activeJob ?? offerJob} />
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
            {primaryOffer ? <JobOfferCard offer={primaryOffer} /> : activeJob ? <ActiveJobCard job={activeJob} /> : <EmptyJobState />}
            {openOffers.slice(1).map((offer) => <JobOfferCard key={offer.offer_id} offer={offer} />)}
            {assignedJobs.map((job) => <ActiveJobCard key={job.id} job={job} />)}
          </div>
        </div>
        <JobActionSheet job={activeJob} offer={primaryOffer} />
      </Screen>
    </TechnicianShell>
  );
}
