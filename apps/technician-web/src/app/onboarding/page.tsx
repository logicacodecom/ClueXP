import { AppFrame, PrimaryButton, Screen, Section, icons } from "@/components/mobile";

export default function OnboardingPage() {
  return (
    <AppFrame nav={false} title="Welcome">
      <Screen>
        <div className="flex min-h-[720px] flex-col justify-end">
          <Section title="ClueXP Technician" subtitle="Set availability, keep GPS active, receive offer alarms, and work only from backend-confirmed assignments.">
            <div className="space-y-2 text-sm leading-5 text-muted">
              <p>1. Enable location tracking.</p>
              <p>2. Enable dispatch alarm sound.</p>
              <p>3. Verify documents before going online.</p>
            </div>
          </Section>
          <PrimaryButton href="/signin"><icons.CheckCircle2 className="size-5" />Continue</PrimaryButton>
        </div>
      </Screen>
    </AppFrame>
  );
}
