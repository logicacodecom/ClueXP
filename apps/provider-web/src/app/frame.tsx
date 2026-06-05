"use client";

import { AppShell, MockAuthBoundary, defaultNav } from "@cluexp/console-ui";
import { providerSession } from "@cluexp/api-client";
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
    return null;
  }
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const storedSession = sessionFromStorage(providerSession);
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
  const providerNav = defaultNav.map((item) =>
    item.label === "Technicians" ? { ...item, href: "/jobs/JOB-B-2248/assign" } : item
  );
  return (
    <AppShell
      activePath={pathname}
      mode="org"
      modeBadge="ORGANIZATION MODE: METRO KEY PARTNERS"
      nav={providerNav}
      onSignOut={signOut}
      session={session ?? undefined}
      surfaceLabel="PROVIDER CONSOLE"
    >
      <MockAuthBoundary allowedRoles={["provider_admin", "dispatcher"]} session={session ?? undefined}>
        {children}
      </MockAuthBoundary>
    </AppShell>
  );
}
