"use client";

import { AppShell, MockAuthBoundary, defaultNav } from "@cluexp/console-ui";
import { useSession } from "@cluexp/app-core";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { error, loading, session, signOut } = useSession();
  useEffect(() => {
    if (!loading && !session) router.replace("/signin");
  }, [loading, router, session]);
  if (loading) return <div className="min-h-screen bg-background" aria-busy="true" />;
  if (error) return <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">{error}</main>;
  if (!session) return null;
  const mappedNav = defaultNav.map((item) =>
    item.label === "Technicians" ? { ...item, href: "/jobs/JOB-B-2248/assign" } : item
  );
  const providerNav = [
    ...mappedNav,
    { ...defaultNav[0], label: "Recovery", href: "/recovery" },
    { ...defaultNav[0], label: "Completed", href: "/completed" },
  ];
  return (
    <AppShell
      activePath={pathname}
      mode="org"
      modeBadge="ORGANIZATION MODE: METRO KEY PARTNERS"
      nav={providerNav}
      onSignOut={() => void signOut().then(() => router.replace("/signin"))}
      session={session ?? undefined}
      surfaceLabel="PROVIDER CONSOLE"
    >
      <MockAuthBoundary allowedRoles={["provider_admin", "dispatcher"]} session={session}>
        {children}
      </MockAuthBoundary>
    </AppShell>
  );
}
