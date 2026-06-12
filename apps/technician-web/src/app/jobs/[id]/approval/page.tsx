"use client";

import { useParams } from "next/navigation";
import { AppFrame, PrimaryButton, Screen, Section, Stepper, icons } from "@/components/mobile";

export default function ApprovalPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <AppFrame title="Awaiting Approval">
      <Screen>
        <Stepper active={4} />
        <Section title="Customer approval">
          <div className="rounded-2xl border border-warn/35 bg-warn/10 p-5 text-center">
            <p className="text-sm font-bold uppercase text-warn">Customer confirmation needed</p>
            <h2 className="mt-2 font-condensed text-4xl font-bold uppercase leading-none">Waiting</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              The customer has been notified on their tracking link. Once they confirm, the job closes automatically.
            </p>
            <p className="mt-2 text-xs text-muted">If the customer verbally confirmed, tap below to continue.</p>
          </div>
        </Section>
        <PrimaryButton href={`/jobs/${id}/complete`}>
          <icons.CheckCircle2 className="size-5" />Customer confirmed — continue
        </PrimaryButton>
      </Screen>
    </AppFrame>
  );
}
