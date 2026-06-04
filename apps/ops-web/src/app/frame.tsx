"use client";

import { AppShell, MockAuthBoundary } from "@cluexp/console-ui";
import { platformSession } from "@cluexp/api-client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AppShell
      activePath={pathname}
      mode="cluexp"
      modeBadge="NETWORK OPS"
      session={platformSession}
      surfaceLabel="PLATFORM OPERATIONS"
    >
      <MockAuthBoundary allowedRoles={["platform_admin"]} session={platformSession}>
        {children}
      </MockAuthBoundary>
    </AppShell>
  );
}
