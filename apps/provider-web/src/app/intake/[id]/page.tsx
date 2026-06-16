"use client";

import { useParams } from "next/navigation";
import { AppFrame } from "../../frame";
import { JobDetailView } from "../../jobs/[id]/job-detail";

export default function IntakePage() {
  const params = useParams();
  const id = String(params.id);
  return <AppFrame><JobDetailView jobId={id} kicker="Request detail" /></AppFrame>;
}
