"use client";

import { AppShell, MockAuthBoundary, defaultNav } from "@cluexp/console-ui";
import { useSession } from "@cluexp/app-core";
import { Receipt, UserRound, Users as UsersIcon, Wallet } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { error, loading, session, signOut } = useSession();
  // A company that is not yet `active` (pending review / suspended / rejected / closed)
  // cannot use the console — it is sent to the onboarding/status screen instead.
  // A non-active company (pending review / suspended / rejected / closed) cannot use
  // the console — it is sent to /onboarding. /documents stays reachable so a pending
  // company can upload required docs while it waits for Ops review.
  const orgGated = Boolean(session?.organization_status && session.organization_status !== "active");
  const gatedHere = orgGated && pathname !== "/documents";
  useEffect(() => {
    if (loading) return;
    if (!session) { router.replace("/signin"); return; }
    if (gatedHere) router.replace("/onboarding");
  }, [loading, session, gatedHere, router]);
  if (loading) return <div className="min-h-screen bg-background" aria-busy="true" />;
  if (error) return <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">{error}</main>;
  if (!session || gatedHere) return null;
  const mappedNav = defaultNav.map((item) =>
    item.label === "Technicians" ? { ...item, href: "/technicians" } : item
  );
  const reportsNav = defaultNav.find((item) => item.href === "/reports") ?? defaultNav[0];
  const adminNav = defaultNav.find((item) => item.href === "/settings") ?? defaultNav[0];
  const providerNav = [
    ...mappedNav,
    { ...defaultNav[0], label: "Recovery", href: "/recovery" },
    { ...reportsNav, label: "Completed", href: "/completed" },
    { ...reportsNav, label: "All Technicians", href: "/reports/technicians", icon: UsersIcon, group: "Financial" as const },
    { ...reportsNav, label: "By Tech", href: "/reports/technicians/by-tech", icon: UserRound, group: "Financial" as const },
    { ...reportsNav, label: "By Job", href: "/reports/jobs", icon: Receipt, group: "Financial" as const },
    { ...reportsNav, label: "Payments", href: "/reports/payments", icon: Wallet, group: "Financial" as const },
    ...(session.user.roles.includes("provider_admin") ? [{ ...adminNav, label: "Users", href: "/users" }] : []),
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
