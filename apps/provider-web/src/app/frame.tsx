"use client";

import { AppShell, MockAuthBoundary, defaultNav } from "@cluexp/console-ui";
import type { NavItem } from "@cluexp/console-ui";
import { useSession } from "@cluexp/app-core";
import { CheckCircle2, Layers, LineChart, PhoneCall, Radar, Receipt, RotateCcw, Users as UsersIcon, Wallet } from "lucide-react";
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
  // Nav item lookup from the shared default nav -- icons and the Workforce/Admin
  // groups come from there; provider labels and Dispatch/CRM groups are set here.
  // "Reports" is dropped: Financial (below) is the provider's reporting home.
  const byHref = (href: string) => defaultNav.find((item) => item.href === href) ?? defaultNav[0];
  const reportsNav = byHref("/reports");
  const providerNav: NavItem[] = [
    { ...defaultNav[0], label: "Dashboard", href: "/dashboard", group: undefined },
    // Dispatch
    { ...defaultNav[0], label: "Copilot", href: "/operations", icon: Radar, group: "Dispatch" },
    { ...byHref("/board"), label: "Jobs Board", group: "Dispatch" },
    { ...byHref("/queue"), label: "Live Queue", group: "Dispatch" },
    { ...byHref("/map"), label: "Coverage", group: "Dispatch" },
    { ...defaultNav[0], label: "Jobs Completed", href: "/completed", icon: CheckCircle2, group: "Dispatch" },
    { ...defaultNav[0], label: "Recovery", href: "/recovery", icon: RotateCcw, group: "Dispatch" },
    // CRM
    { ...defaultNav[0], label: "Call Intake", href: "/intake/new", icon: PhoneCall, group: "CRM" },
    { ...byHref("/escalations"), label: "Escalations", group: "CRM" },
    { ...byHref("/messages"), label: "Messages", group: "CRM" },
    // Workforce
    { ...byHref("/jobs/JOB-A-2201/assign"), label: "Technicians", href: "/technicians" },
    byHref("/teams"),
    byHref("/documents"),
    // Financial
    { ...reportsNav, label: "Overview", href: "/financial", icon: LineChart, group: "Financial" },
    { ...reportsNav, label: "Technicians", href: "/financial/technicians", icon: UsersIcon, group: "Financial" },
    { ...reportsNav, label: "Jobs", href: "/financial/jobs", icon: Receipt, group: "Financial" },
    { ...reportsNav, label: "Payments", href: "/financial/payments", icon: Wallet, group: "Financial" },
    { ...reportsNav, label: "Settlement runs", href: "/financial/settlements", icon: Layers, group: "Financial" },
    // Admin
    byHref("/settings"),
    byHref("/audit"),
    ...(session.user.roles.includes("provider_admin") ? [{ ...byHref("/settings"), label: "Users", href: "/users" }] : []),
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
