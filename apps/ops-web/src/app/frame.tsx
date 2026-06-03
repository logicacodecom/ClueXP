"use client";

import { Shell } from "@cluexp/console-ui";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <Shell
      activePath={pathname}
      mode="cluexp"
      modeBadge="CLUEXP MODE"
      surfaceLabel="OPERATIONS CONSOLE"
    >
      {children}
    </Shell>
  );
}
