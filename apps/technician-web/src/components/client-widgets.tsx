"use client";

import { technicianAppProfile } from "@cluexp/api-client";
import type { TechnicianAppProfile } from "@cluexp/api-client";
import { BriefcaseBusiness, LogOut, Timer, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const navItems: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/jobs", label: "Home", icon: BriefcaseBusiness },
  { href: "/profile", label: "Account", icon: UserRound }
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function TechnicianBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="safe-bottom fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-border/80 bg-background/96 px-2 pt-2 backdrop-blur-xl md:bottom-6 md:rounded-b-[28px]">
      <div className="grid grid-cols-2 gap-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              className={cx(
                "touch-target flex min-h-[58px] flex-col items-center justify-center px-1 py-2 text-[11px] font-black transition active:scale-[.98]",
                active ? "bg-primary text-primary-foreground" : "text-muted hover:bg-card-strong hover:text-foreground"
              )}
              href={item.href}
              key={item.href}
            >
              <Icon className="mb-1 size-5" strokeWidth={active ? 2.6 : 2.2} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export const BottomNav = TechnicianBottomNav;

export function AvailabilityToggle({ profile = technicianAppProfile }: { profile?: TechnicianAppProfile }) {
  const fallback = profile.availability === "online";
  const [online, setOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const isAvailable = data?.session?.technician?.is_available;
        setOnline(typeof isAvailable === "boolean" ? isAvailable : fallback);
      })
      .catch(() => setOnline(fallback));
  }, [fallback]);

  const isOnline = online ?? fallback;

  const toggleAvailability = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    const next = !isOnline;
    try {
      const response = await fetch("/api/availability", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_available: next }),
      });
      if (response.ok) {
        setOnline(next);
      } else {
        const body = await response.json().catch(() => ({})) as { detail?: string };
        if (response.status === 401) {
          setError("Please sign in to change availability");
        } else if (response.status === 403) {
          setError("Not authorized to change availability");
        } else {
          setError(body.detail ?? "Failed to update availability");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className={cx(
        "touch-target inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-black transition active:scale-[.98]",
        isOnline ? "border-success/35 bg-success/10 text-success" : "border-border bg-card text-muted"
      )}
      onClick={toggleAvailability}
      disabled={loading || online === null}
      aria-label={`Technician is ${isOnline ? "online" : "offline"}`}
    >
      <span className={cx("size-2.5 rounded-full", isOnline ? "bg-success" : "bg-muted")} />
      {online === null ? "..." : loading ? "Updating..." : isOnline ? "Online" : "Offline"}
      {error && <span className="text-xs text-danger">{error}</span>}
    </button>
  );
}

export function Countdown({ expiresAt }: { expiresAt: string }) {
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, target - now);
  const seconds = Math.floor(remaining / 1000);
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  const pct = Math.max(0, Math.min(100, (remaining / (90 * 1000)) * 100));
  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[.08em] text-muted">Offer expires</div>
          <div className="mt-1 font-condensed text-5xl font-bold leading-none tabular-nums">{minutesPart}:{secondsPart}</div>
        </div>
        <Timer className="size-8 text-primary" />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-card-strong">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}


export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function handleSignOut() {
    setBusy(true);
    await fetch("/api/session", { method: "DELETE" }).catch(() => null);
    router.replace("/signin");
  }
  return (
    <button
      className="touch-target mt-2 min-h-12 w-full rounded-xl border border-border bg-card-strong font-black text-danger flex items-center justify-center gap-2 disabled:opacity-50"
      disabled={busy}
      onClick={() => void handleSignOut()}
    >
      <LogOut className="size-4" />
      {busy ? "Signing out..." : "Sign out"}
    </button>
  );
}
