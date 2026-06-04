"use client";

import { AppShell, MockAuthBoundary } from "@cluexp/console-ui";
import { platformSession } from "@cluexp/api-client";
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
    const activeRole = session.roles?.find((role) => role === "platform_admin") ?? fallback.active_role;
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
  const [session, setSession] = useState<AuthSession>(platformSession);
  useEffect(() => setSession(sessionFromStorage(platformSession)), []);
  return (
    <AppShell
      activePath={pathname}
      mode="cluexp"
      modeBadge="NETWORK OPS"
      session={session}
      surfaceLabel="PLATFORM OPERATIONS"
    >
      <MockAuthBoundary allowedRoles={["platform_admin"]} session={session}>
        {children}
      </MockAuthBoundary>
    </AppShell>
  );
}
