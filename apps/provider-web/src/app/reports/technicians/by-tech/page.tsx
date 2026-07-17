"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppFrame } from "../../../frame";
import { TechnicianDetailReport } from "../detail-report";

function ByTechRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const technicianId = searchParams.get("technician_id");
  return (
    <TechnicianDetailReport
      technicianId={technicianId}
      onTechnicianChange={(id) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("technician_id", id);
        router.replace(`/reports/technicians/by-tech?${params.toString()}`);
      }}
    />
  );
}

export default function ByTechPage() {
  return (
    <AppFrame>
      <Suspense fallback={null}>
        <ByTechRoute />
      </Suspense>
    </AppFrame>
  );
}
