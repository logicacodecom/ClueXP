import { jobById } from "@cluexp/api-client";
import { ActiveJobHeader, AppFrame, Pill, PrimaryButton, Screen, Section, Stepper, icons } from "@/components/mobile";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;
  return (
    <AppFrame title="Approval">
      <Screen>
        <ActiveJobHeader job={job} stage="Approval" />
        <Stepper active={4} />
        <Section action={<Pill tone="warn" icon={icons.Clock}>Waiting</Pill>} title="Customer approval">
          <div className="rounded-2xl border border-warn/35 bg-warn/10 p-5 text-center">
            <p className="text-sm font-bold uppercase text-warn">Customer confirmation needed</p>
            <h2 className="mt-2 font-condensed text-4xl font-bold uppercase leading-none">Review work</h2>
            <p className="mt-3 text-sm leading-6 text-muted">Completion cannot close until customer approval or authorized dispatcher override is recorded.</p>
          </div>
        </Section>
        <PrimaryButton href={`/jobs/${job.id}/complete`}><icons.CheckCircle2 className="size-5" />Approval received</PrimaryButton>
      </Screen>
    </AppFrame>
  );
}
