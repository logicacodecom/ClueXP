"use client";

import { AppShell } from "@cluexp/console-ui";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AppShell
      activePath={pathname}
      mode="cluexp"
      modeBadge="CLUEXP MODE"
      surfaceLabel="OPERATIONS CONSOLE"
    >
      {children}
    </AppShell>
  );
}
