import { AppFrame, MiniStat, Pill, PrimaryButton, Screen, Section, Stepper, icons } from "@/components/mobile";

export default async function CompletePage() {
  return (
    <AppFrame title="Complete">
      <Screen>
        <Stepper active={5} />
        <Section action={<Pill tone="success" icon={icons.CheckCircle2}>Done</Pill>} title="Closeout summary">
          <div className="rounded-2xl border border-success/35 bg-success/10 p-5 text-center">
            <icons.CheckCircle2 className="mx-auto size-8 text-success" />
            <h2 className="mt-3 font-condensed text-3xl font-bold uppercase leading-none text-success">Job complete</h2>
            <p className="mt-2 text-sm leading-5 text-muted">
              Customer has confirmed. Final earnings are settled by your provider agreement.
            </p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniStat label="Status" value="Confirmed" tone="success" />
            <MiniStat label="Docs" value="Saved" tone="info" />
            <MiniStat label="Pay" value="Pending" tone="warn" />
          </div>
        </Section>
        <PrimaryButton href="/jobs"><icons.CheckCircle2 className="size-5" />Return to jobs</PrimaryButton>
      </Screen>
    </AppFrame>
  );
}
