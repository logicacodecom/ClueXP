"use client";

import { technicianAppProfile } from "@cluexp/api-client";
import type { TechnicianAppProfile } from "@cluexp/api-client";
import { BriefcaseBusiness, CircleDollarSign, MapPinned, MessageCircle, Timer, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const navItems: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/map", label: "Active", icon: MapPinned },
  { href: "/activity", label: "Earnings", icon: CircleDollarSign },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/profile", label: "Profile", icon: UserRound }
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function TechnicianBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="safe-bottom fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-border/80 bg-background/96 px-2 pt-2 backdrop-blur-xl md:bottom-6 md:rounded-b-[28px]">
      <div className="grid grid-cols-5 gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              className={cx(
                "touch-target flex min-h-[58px] flex-col items-center justify-center rounded-2xl px-1 py-2 text-[10px] font-black transition active:scale-[.98]",
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
  const online = profile.availability === "online";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAvailability = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/availability", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ available: !online }),
      });
      if (!response.ok) {
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
        online ? "border-success/35 bg-success/10 text-success" : "border-border bg-card text-muted"
      )}
      onClick={toggleAvailability}
      disabled={loading}
      aria-label={`Technician is ${online ? "online" : "offline"}`}
    >
      <span className={cx("size-2.5 rounded-full", online ? "bg-success" : "bg-muted")} />
      {loading ? "Updating..." : online ? "Online" : "Offline"}
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
