import { jobById } from "@cluexp/api-client";
import { ActionList, ActiveJobHeader, AppFrame, MockMap, Pill, Screen, Section, Stepper, icons } from "@/components/mobile";

export default async function NavigatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;
  return (
    <AppFrame title="Navigation">
      <Screen>
        <ActiveJobHeader job={job} stage="Navigate" />
        <Stepper active={1} />
        <MockMap job={job} />
        <Section action={<Pill tone="success" icon={icons.Navigation}>GPS live</Pill>} title="Route guidance">
          <ActionList
            items={[
              { href: `/jobs/${job.id}/arrival`, icon: icons.CheckCircle2, label: "I have arrived", sub: "Ask customer for arrival PIN" },
              { href: `/jobs/${job.id}/chat`, icon: icons.MessageCircle, label: "Send ETA update", sub: "Masked message" },
              { href: `/jobs/${job.id}/call`, icon: icons.Phone, label: "Call customer", sub: "Internet call placeholder" }
            ]}
          />
        </Section>
      </Screen>
    </AppFrame>
  );
}
