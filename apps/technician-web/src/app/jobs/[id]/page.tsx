import { jobById } from "@cluexp/api-client";
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

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;
  return (
    <TechnicianShell title="Active Job">
      <Screen flush>
        <FieldMapPanel job={job} />
        <div className="px-4 pt-4">
          <ActiveJobHeader job={job} stage="En route" />
          <Section action={<Pill tone="success" icon={icons.ShieldCheck}>Privacy safe</Pill>} title="Status timeline">
            <JobStatusTimeline
              job={job}
              timestamps={{
                accepted: "2:44 PM",
                en_route: "2:47 PM"
              }}
            />
          </Section>
        </div>
        <JobActionSheet job={job} />
      </Screen>
    </TechnicianShell>
  );
}
