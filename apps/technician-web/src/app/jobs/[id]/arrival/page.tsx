import { jobById } from "@cluexp/api-client";
import { ActiveJobHeader, AppFrame, Pill, PrimaryButton, Screen, Section, Stepper, icons } from "@/components/mobile";

export default async function ArrivalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;
  return (
    <AppFrame title="Arrival">
      <Screen>
        <ActiveJobHeader job={job} stage="Arrival check" />
        <Stepper active={2} />
        <Section action={<Pill tone="warn" icon={icons.AlertTriangle}>Verification required</Pill>} title="Customer arrival PIN">
          <div className="grid grid-cols-4 gap-2">
            {["4", "8", "2", "1"].map((digit) => <div className="rounded-xl border border-border bg-card-strong p-5 text-center text-3xl font-bold" key={digit}>{digit}</div>)}
          </div>
          <p className="mt-3 text-sm leading-5 text-muted">Mock PIN entry. Production should support PIN, QR, and dispatcher override with audit reason.</p>
        </Section>
        <PrimaryButton href={`/jobs/${job.id}/service`}><icons.CheckCircle2 className="size-5" />Confirm arrival</PrimaryButton>
      </Screen>
    </AppFrame>
  );
}
