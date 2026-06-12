"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { updateTechnicianJobStatus } from "@cluexp/api-client";
import { AppFrame, PrimaryButton, Screen, Section, Stepper, icons } from "@/components/mobile";

export default function ArrivalPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { id } = useParams<{ id: string }>();

  const handleConfirmArrival = async () => {
    setLoading(true);
    try {
      await updateTechnicianJobStatus(id, "arrived");
      router.push(`/jobs/${id}/service`);
    } catch (err) {
      console.error("Failed to confirm arrival:", err);
      alert("Failed to confirm arrival. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppFrame title="Arrival">
      <Screen>
        <Stepper active={2} />
        <Section title="Confirm arrival">
          <div className="rounded-2xl border border-border bg-card-strong p-5 text-center">
            <p className="text-sm font-bold uppercase text-muted">At the location</p>
            <h2 className="mt-2 font-condensed text-4xl font-bold uppercase leading-none">Mark arrived</h2>
            <p className="mt-3 text-sm leading-6 text-muted">Tap below once you are physically at the job site and ready to begin.</p>
          </div>
        </Section>
        <PrimaryButton onClick={handleConfirmArrival} disabled={loading}>
          {loading ? "Confirming..." : <><icons.CheckCircle2 className="size-5" />Confirm arrival</>}
        </PrimaryButton>
      </Screen>
    </AppFrame>
  );
}
