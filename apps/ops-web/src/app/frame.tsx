"use client";

import { AppShell, MockAuthBoundary } from "@cluexp/console-ui";
import { platformSession } from "@cluexp/api-client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AuthSession } from "@cluexp/api-client";

function sessionFromStorage(fallback: AuthSession): AuthSession | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("cluexp_access_token");
  const raw = window.localStorage.getItem("cluexp_session");
  if (!token || !raw) return null;
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
    return null;
  }
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const storedSession = sessionFromStorage(platformSession);
    setSession(storedSession);
    setHydrated(true);
    if (!storedSession) router.replace("/signin");
  }, [router]);
  function signOut() {
    window.localStorage.removeItem("cluexp_access_token");
    window.localStorage.removeItem("cluexp_session");
    setSession(null);
    router.replace("/signin");
  }
  if (!hydrated) return null;
  return (
    <AppShell
      activePath={pathname}
      mode="cluexp"
      modeBadge="NETWORK OPS"
      onSignOut={signOut}
      session={session ?? undefined}
      surfaceLabel="PLATFORM OPERATIONS"
    >
      <MockAuthBoundary allowedRoles={["platform_admin"]} session={session ?? undefined}>
        {children}
      </MockAuthBoundary>
    </AppShell>
  );
}
