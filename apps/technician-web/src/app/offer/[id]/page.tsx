import { jobById, technicianOfferById } from "@cluexp/api-client";
import { AppFrame, IncomingOffer } from "@/components/mobile";

export const dynamic = "force-dynamic";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = technicianOfferById(id) ?? technicianOfferById("offer-a-1");
  const job = jobById(offer?.job_id) ?? jobById("JOB-A-2201");
  if (!offer || !job) return null;
  return (
    <AppFrame nav={false} title="ClueXP Alert">
      <IncomingOffer offer={offer} job={job} />
    </AppFrame>
  );
}
