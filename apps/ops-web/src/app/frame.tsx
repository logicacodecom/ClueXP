"use client";

import { AppShell, MockAuthBoundary } from "@cluexp/console-ui";
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
  return (
    <AppShell
      activePath={pathname}
      mode="cluexp"
      modeBadge="NETWORK OPS"
      onSignOut={() => void signOut().then(() => router.replace("/signin"))}
      session={session ?? undefined}
      surfaceLabel="PLATFORM OPERATIONS"
    >
      <MockAuthBoundary allowedRoles={["platform_admin"]} session={session}>
        {children}
      </MockAuthBoundary>
    </AppShell>
  );
}
