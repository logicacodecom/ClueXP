"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppFrame } from "../../../frame";
import { TechnicianDetailReport } from "../detail-report";

function TechnicianDetailRoute() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  return (
    <TechnicianDetailReport
      technicianId={params.id}
      onTechnicianChange={(id) => {
        const qs = searchParams.toString();
        router.push(`/reports/technicians/${id}${qs ? `?${qs}` : ""}`);
      }}
    />
  );
}

export default function TechnicianDetailPage() {
  return (
    <AppFrame>
      <Suspense fallback={null}>
        <TechnicianDetailRoute />
      </Suspense>
    </AppFrame>
  );
}
