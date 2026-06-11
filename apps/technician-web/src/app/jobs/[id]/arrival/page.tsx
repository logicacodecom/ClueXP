"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { jobById, updateTechnicianJobStatus } from "@cluexp/api-client";
import { ActiveJobHeader, AppFrame, Pill, PrimaryButton, Screen, Section, Stepper, icons } from "@/components/mobile";

export default function ArrivalPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { id } = useParams<{ id: string }>();
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;

  const handleConfirmArrival = async () => {
    setLoading(true);
    try {
      await updateTechnicianJobStatus(job.id, "arrived");
      router.push(`/jobs/${job.id}/service`);
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
        <ActiveJobHeader job={job} stage="Arrival check" />
        <Stepper active={2} />
        <Section action={<Pill tone="warn" icon={icons.AlertTriangle}>Verification required</Pill>} title="Customer arrival PIN">
          <div className="grid grid-cols-4 gap-2">
            {["4", "8", "2", "1"].map((digit) => <div className="rounded-xl border border-border bg-card-strong p-5 text-center text-3xl font-bold" key={digit}>{digit}</div>)}
          </div>
          <p className="mt-3 text-sm leading-5 text-muted">Mock PIN entry. Production should support PIN, QR, and dispatcher override with audit reason.</p>
        </Section>
        <PrimaryButton onClick={handleConfirmArrival} disabled={loading}>
          {loading ? "Confirming..." : <><icons.CheckCircle2 className="size-5" />Confirm arrival</>}
        </PrimaryButton>
      </Screen>
    </AppFrame>
  );
}
