import { jobById } from "@cluexp/api-client";
import {
  ActionList,
  ActiveJobHeader,
  AppFrame,
  ChatPreview,
  MockMap,
  Pill,
  Screen,
  Section,
  Stepper,
  icons
} from "@/components/mobile";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;
  return (
    <AppFrame title="Active Job">
      <Screen>
        <ActiveJobHeader job={job} stage="En route" />
        <Stepper active={1} />
        <MockMap job={job} />
        <Section title="Job controls" subtitle="Every action is a UI mock state. Backend events remain the source of truth.">
          <ActionList
            items={[
              { href: `/jobs/${job.id}/navigate`, icon: icons.Navigation, label: "Navigate to customer", sub: `${job.eta_min ?? 7} min ETA · GPS live` },
              { href: `/jobs/${job.id}/arrival`, icon: icons.CheckCircle2, label: "Mark arrival", sub: "Requires customer PIN or dispatcher override" },
              { href: `/jobs/${job.id}/chat`, icon: icons.MessageCircle, label: "Message customer", sub: "Masked chat through ClueXP" },
              { href: `/jobs/${job.id}/call`, icon: icons.Phone, label: "Internet voice call", sub: "Mediated call placeholder" }
            ]}
          />
        </Section>
        <Section action={<Pill tone="success" icon={icons.ShieldCheck}>Privacy safe</Pill>} title="Customer messages">
          <ChatPreview />
        </Section>
      </Screen>
    </AppFrame>
  );
}
