"use client";

import { LocaleProvider } from "@cluexp/app-core";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <LocaleProvider persistAuthenticated>{children}</LocaleProvider>;
}
