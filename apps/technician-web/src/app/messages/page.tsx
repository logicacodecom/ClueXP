import { activeTechnicianJobIds, jobById } from "@cluexp/api-client";
import { AppFrame, ChatPreview, Pill, Screen, Section, icons } from "@/components/mobile";

export default function MessagesPage() {
  const job = jobById(activeTechnicianJobIds[0]);
  return (
    <AppFrame title="Messages">
      <Screen>
        <Section action={<Pill tone="success" icon={icons.ShieldCheck}>Mediated</Pill>} subtitle="All customer contact is masked through ClueXP." title="Customer channel">
          <ChatPreview />
        </Section>
        <Section title="Dispatch channel">
          <div className="rounded-xl border border-border bg-card-strong p-3">
            <div className="text-xs font-bold uppercase text-muted">ClueXP Network</div>
            <div className="mt-1 text-sm">Keep GPS active for {job?.id ?? "current job"}. Arrival verification required before service.</div>
          </div>
        </Section>
      </Screen>
    </AppFrame>
  );
}
