"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { jobById, updateTechnicianJobStatus } from "@cluexp/api-client";
import { ActiveJobHeader, AppFrame, Pill, PrimaryButton, Screen, Section, Stepper, icons } from "@/components/mobile";

export default function ServicePage() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const { id } = useParams<{ id: string }>();
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;

  const handleStatusChange = async (status: "in_progress" | "completed_pending_customer") => {
    setLoading(status);
    try {
      await updateTechnicianJobStatus(job.id, status);
      router.push(`/jobs/${job.id}/${status === "in_progress" ? "approval" : "complete"}`);
    } catch (err) {
      console.error(`Failed to set status to ${status}:`, err);
      alert("Failed to update status. Please try again.");
    } finally {
      setLoading(null);
    }
  };

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
        <div className="space-y-3">
          <PrimaryButton href={`/jobs/${job.id}/arrival`}><icons.Navigation className="size-5" />Arrived</PrimaryButton>
          <PrimaryButton onClick={() => handleStatusChange("in_progress")} disabled={loading === "in_progress"}>
            {loading === "in_progress" ? "Updating..." : <><icons.CheckCircle2 className="size-5" />In progress</>}
          </PrimaryButton>
          <PrimaryButton onClick={() => handleStatusChange("completed_pending_customer")} disabled={loading === "completed_pending_customer"}>
            {loading === "completed_pending_customer" ? "Updating..." : <><icons.CheckCircle2 className="size-5" />Request customer approval</>}
          </PrimaryButton>
        </div>
      </Screen>
    </AppFrame>
  );
}
