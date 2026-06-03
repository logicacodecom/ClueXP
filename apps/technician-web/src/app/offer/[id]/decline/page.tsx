import { jobById, technicianOfferById } from "@cluexp/api-client";
import { Clock, MapPin, ShieldX, X } from "lucide-react";
import { AppFrame, MiniStat, Pill, PrimaryButton, Screen, Section } from "@/components/mobile";

export const dynamic = "force-dynamic";

const reasons = [
  { label: "Too far away", icon: MapPin },
  { label: "Busy with current job", icon: Clock },
  { label: "Wrong skill or equipment", icon: ShieldX }
];

export default async function DeclineOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = technicianOfferById(id) ?? technicianOfferById("offer-a-1");
  const job = jobById(offer?.job_id) ?? jobById("JOB-A-2201");
  if (!offer || !job) return null;

  return (
    <AppFrame nav={false} title="Decline Offer">
      <Screen>
        <Section
          action={<Pill tone="warn">Mock reason</Pill>}
          subtitle="Production will send this reason to dispatch before the offer is released to another technician."
          title="Why decline?"
        >
          <div className="mb-4 grid grid-cols-3 gap-2">
            <MiniStat label="Area" value={job.area} />
            <MiniStat label="ETA" value={`${offer.eta_min}m`} tone="info" />
            <MiniStat label="Pay" value={offer.estimated_earnings ?? "TBD"} tone="warn" />
          </div>
          <div className="space-y-2">
            {reasons.map((reason) => {
              const Icon = reason.icon;
              return (
                <a
                  className="touch-target flex items-center gap-3 rounded-xl border border-border bg-card-strong p-3 text-sm font-bold transition hover:border-primary/45"
                  href="/jobs"
                  key={reason.label}
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-card">
                    <Icon className="size-5 text-primary" />
                  </span>
                  <span className="flex-1">{reason.label}</span>
                </a>
              );
            })}
          </div>
        </Section>
        <PrimaryButton href={`/offer/${offer.offer_id}`} tone="secondary">
          <X className="size-5" />
          Back to offer
        </PrimaryButton>
      </Screen>
    </AppFrame>
  );
}
