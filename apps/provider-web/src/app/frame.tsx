"use client";

import { AppShell, MockAuthBoundary, defaultNav } from "@cluexp/console-ui";
import { providerSession } from "@cluexp/api-client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AuthSession } from "@cluexp/api-client";

function sessionFromStorage(fallback: AuthSession): AuthSession {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem("cluexp_session");
  if (!raw) return fallback;
  try {
    const session = JSON.parse(raw) as {
      user?: { id?: string; email?: string; phone?: string; display_name?: string };
      roles?: AuthSession["active_role"][];
      active_organization_id?: string;
    };
    const activeRole = session.roles?.find((role) => role === "provider_admin" || role === "dispatcher") ?? fallback.active_role;
    return {
      ...fallback,
      active_role: activeRole,
      active_organization_id: session.active_organization_id ?? fallback.active_organization_id,
      user: {
        ...fallback.user,
        id: session.user?.id ?? fallback.user.id,
        email: session.user?.email ?? fallback.user.email,
        phone: session.user?.phone ?? fallback.user.phone,
        display_name: session.user?.display_name ?? fallback.user.display_name,
        roles: session.roles ?? fallback.user.roles,
        organization_ids: session.active_organization_id ? [session.active_organization_id] : fallback.user.organization_ids
      }
    };
  } catch {
    return fallback;
  }
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<AuthSession>(providerSession);
  useEffect(() => setSession(sessionFromStorage(providerSession)), []);
  const providerNav = defaultNav.map((item) =>
    item.label === "Technicians" ? { ...item, href: "/jobs/JOB-B-2248/assign" } : item
  );
  return (
    <AppShell
      activePath={pathname}
      mode="org"
      modeBadge="ORGANIZATION MODE: METRO KEY PARTNERS"
      nav={providerNav}
      session={session}
      surfaceLabel="PROVIDER CONSOLE"
    >
      <MockAuthBoundary allowedRoles={["provider_admin", "dispatcher"]} session={session}>
        {children}
      </MockAuthBoundary>
    </AppShell>
  );
}
