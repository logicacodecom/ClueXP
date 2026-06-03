import { jobById } from "@cluexp/api-client";
import { ActiveJobHeader, AppFrame, Pill, PrimaryButton, Screen, Section, Stepper, icons } from "@/components/mobile";

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;
  return (
    <AppFrame title="In Service">
      <Screen>
        <ActiveJobHeader job={job} stage="In service" />
        <Stepper active={3} />
        <Section action={<Pill tone="info" icon={icons.Clock}>00:18</Pill>} title="Service checklist">
          <div className="space-y-2">
            {["Verify customer authorization", "Inspect lock and document condition", "Complete access work", "Capture completion notes"].map((item, index) => (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card-strong p-3" key={item}>
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
                <span className="text-sm font-bold">{item}</span>
              </div>
            ))}
          </div>
        </Section>
        <PrimaryButton href={`/jobs/${job.id}/approval`}><icons.CheckCircle2 className="size-5" />Request customer approval</PrimaryButton>
      </Screen>
    </AppFrame>
  );
}
