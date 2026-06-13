"use client";

import { LocaleProvider, useSession } from "@cluexp/app-core";
import { ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <LocaleProvider persistAuthenticated><TechnicianAccessGate>{children}</TechnicianAccessGate></LocaleProvider>;
}

function TechnicianAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, session, signOut } = useSession();
  const publicRoute = pathname === "/signin" || pathname === "/signup" || pathname === "/onboarding";
  useEffect(() => {
    if (!loading && !session && !publicRoute) router.replace("/signin");
  }, [loading, pathname, publicRoute, router, session]);
  if (publicRoute) return <>{children}</>;
  if (loading) return <main className="min-h-[100svh] bg-background" aria-busy="true" />;
  if (!session) return null;
  if (session.technician && !session.technician.approved) {
    return (
      <main className="mx-auto flex min-h-[100svh] w-full max-w-[480px] flex-col justify-center bg-background px-6 text-foreground">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary"><ShieldCheck className="size-6" /></div>
          <h1 className="mt-5 text-2xl font-black">Verification pending</h1>
          <p className="mt-2 text-sm leading-6 text-muted">Your technician registration is awaiting ClueXP approval. Job offers remain unavailable until verification is complete.</p>
          <div className="mt-4 rounded-xl border border-border bg-card-strong p-3 text-sm">
            <div className="text-xs font-black uppercase text-muted">Registration ID</div>
            <div className="mt-1 break-all font-semibold">{session.technician.id}</div>
          </div>
          <button className="touch-target mt-5 min-h-12 w-full rounded-xl border border-border bg-card-strong font-black" onClick={() => void signOut().then(() => router.replace("/signin"))}>Sign out</button>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
