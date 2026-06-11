import { activeTechnicianJobIds, jobById, technicianJobs } from "@cluexp/api-client";
import { AppFrame, MockMap, Pill, Screen, Section, ActiveJobCard, icons } from "@/components/mobile";

export default function MapPage() {
  const activeJob = jobById(activeTechnicianJobIds()[0]);
  return (
    <AppFrame title="Field Map">
      <Screen>
        <Section action={<Pill tone="success" icon={icons.Navigation}>GPS live</Pill>} subtitle="Map is static mock data; no fabricated movement or routes." title="Field map">
          <MockMap job={activeJob} mode="fleet" />
        </Section>
        <Section title="Nearby assigned work">
          {technicianJobs().map((job) => <ActiveJobCard job={job} key={job.id} />)}
        </Section>
      </Screen>
    </AppFrame>
  );
}
