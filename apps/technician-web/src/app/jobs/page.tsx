import {
  activeTechnicianJobIds,
  jobById,
  technicianAppOffers,
  technicianAppProfile,
  technicianJobs
} from "@cluexp/api-client";
import {
  ActiveJobCard,
  AppFrame,
  ControlsRow,
  EmptyState,
  OfferCard,
  Pill,
  ProfileStrip,
  Screen,
  Section,
  icons
} from "@/components/mobile";

export default function JobsPage() {
  const activeJob = jobById(activeTechnicianJobIds[0]);
  const assignedJobs = technicianJobs().filter((job) => job.id !== activeJob?.id);
  const openOffers = technicianAppOffers.filter((offer) => offer.status !== "superseded");
  return (
    <AppFrame>
      <Screen>
        <ProfileStrip profile={technicianAppProfile} />
        <ControlsRow profile={technicianAppProfile} />
        <Section
          action={<Pill tone="success" icon={icons.Clock}>Polling live</Pill>}
          subtitle="Offers are shown from backend polling. Push alarm is planned for a later backend sprint."
          title="Open offers"
        >
          {openOffers.map((offer) => <OfferCard key={offer.offer_id} offer={offer} />)}
          {technicianAppOffers.filter((offer) => offer.status === "superseded").map((offer) => <OfferCard key={offer.offer_id} offer={offer} />)}
        </Section>
        <Section subtitle="Active and assigned jobs only reveal customer details after backend assignment confirmation." title="Assigned work">
          {activeJob ? <ActiveJobCard job={activeJob} /> : <EmptyState title="No active job" text="Accepted assignments appear here after backend confirmation." />}
          {assignedJobs.map((job) => <ActiveJobCard key={job.id} job={job} />)}
        </Section>
      </Screen>
    </AppFrame>
  );
}
