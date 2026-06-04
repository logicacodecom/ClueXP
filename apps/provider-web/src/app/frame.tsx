"use client";

import { AppShell, defaultNav } from "@cluexp/console-ui";
import { providerSession } from "@cluexp/api-client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const providerNav = defaultNav.map((item) =>
    item.label === "Technicians" ? { ...item, href: "/jobs/JOB-B-2248/assign" } : item
  );
  return (
    <AppShell
      activePath={pathname}
      mode="org"
      modeBadge="ORGANIZATION MODE: METRO KEY PARTNERS"
      nav={providerNav}
      session={providerSession}
      surfaceLabel="PROVIDER CONSOLE"
    >
      {children}
    </AppShell>
  );
}
