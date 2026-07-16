"use client";

import { AppShell, MockAuthBoundary } from "@cluexp/console-ui";
import type { NavItem } from "@cluexp/console-ui";
import { useSession } from "@cluexp/app-core";
import { Building2, FileText, LayoutDashboard, Settings, ShieldCheck, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

const consoleNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Operations" },
  { href: "/companies", label: "Companies", icon: Building2, group: "Workforce" },
  { href: "/technicians", label: "Technicians", icon: UserRound, group: "Workforce" },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck, group: "Workforce" },
  { href: "/documents", label: "Documents", icon: FileText, group: "Workforce" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Admin" },
  { href: "/account", label: "Account", icon: UserRound, group: "Admin" }
];

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
  return (
    <AppShell
      activePath={pathname}
      mode="cluexp"
      modeBadge="CONSOLE"
      nav={consoleNav}
      onSignOut={() => void signOut().then(() => router.replace("/signin"))}
      session={session ?? undefined}
      surfaceLabel="NETWORK MANAGEMENT"
    >
      <MockAuthBoundary allowedRoles={["platform_admin"]} session={session}>
        {children}
      </MockAuthBoundary>
    </AppShell>
  );
}
