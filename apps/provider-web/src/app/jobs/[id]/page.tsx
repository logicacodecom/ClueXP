"use client";

import { useParams } from "next/navigation";
import { AppFrame } from "../../frame";
import { JobDetailView } from "./job-detail";

export default function JobPage() {
  const params = useParams();
  const id = String(params.id);
  return <AppFrame><JobDetailView jobId={id} kicker="Job detail" /></AppFrame>;
}
