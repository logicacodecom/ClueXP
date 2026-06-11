import { jobById } from "@cluexp/api-client";
import { ActiveJobHeader, AppFrame, MiniStat, Pill, PrimaryButton, Screen, Section, Stepper, icons } from "@/components/mobile";

export default async function CompletePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;

  return (
    <AppFrame title="Complete">
      <Screen>
        <ActiveJobHeader job={job} stage="Complete" />
        <Stepper active={5} />
        <Section action={<Pill tone="success" icon={icons.CheckCircle2}>Ready</Pill>} title="Closeout summary">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Time" value="42m" tone="success" />
            <MiniStat label="Docs" value="Saved" tone="info" />
            <MiniStat label="Pay" value="$92" tone="warn" />
          </div>
          <p className="mt-3 text-sm leading-5 text-muted">Mock summary. Final amount is backend/provider-settlement controlled.</p>
        </Section>
        <PrimaryButton href="/jobs"><icons.CheckCircle2 className="size-5" />Return to jobs</PrimaryButton>
      </Screen>
    </AppFrame>
  );
}
