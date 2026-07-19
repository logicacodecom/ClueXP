"use client";

import { useLocale } from "@cluexp/app-core";
import { AlertTriangle, Check, MapPin, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Countdown } from "./client-widgets";

interface LiveOffer {
  id: string;
  offer_id?: string;
  job_id: string;
  status: "offered" | "seen" | "accepted" | "declined" | "expired" | "superseded" | "failed_delivery";
  expires_at: string;
  offered_at?: string;
  rank?: number;
  dist_km?: number;
  distance_mi?: number;
  eta_min?: number;
  estimated_earnings?: string;
  area?: string;
  service_type?: string;
  situation?: string;
  urgency?: "low" | "medium" | "high" | "critical";
}

function normalizeOffers(body: unknown): LiveOffer[] {
  const raw = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { offers?: unknown }).offers)
      ? (body as { offers: Array<Record<string, unknown>> }).offers
      : [];
  return raw.map((item) => ({
    ...(item as unknown as LiveOffer),
    id: String(item.id ?? item.offer_id ?? ""),
    job_id: String(item.job_id ?? ""),
    status: (item.status ?? "offered") as LiveOffer["status"],
    expires_at: String(item.expires_at ?? new Date().toISOString()),
    service_type: String(item.service_type ?? item.access_type ?? "Service request"),
    area: item.area
      ? String(item.area)
      : typeof item.area_lat === "number" && typeof item.area_lng === "number"
        ? "Approximate service area"
        : "Nearby service area"
  }));
}

export function LiveOffersFeed() {
  const router = useRouter();
  const { t } = useLocale();
  const [offers, setOffers] = useState<LiveOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/offers", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        router.replace("/signin");
        return;
      }
      if (!response.ok) throw new Error(body.detail || `Offer feed unavailable (${response.status})`);
      setOffers(normalizeOffers(body));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("unableToConnect"));
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(true), 15_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Cleanup expired/superseded offers
  useEffect(() => {
    const now = new Date();
    const expiredIds = offers
      .filter((offer) => {
        const status = offer.status;
        return (
          status === "expired" ||
          status === "superseded" ||
          status === "accepted" ||
          status === "declined" ||
          status === "failed_delivery"
        );
      })
      .map((o) => o.id || o.offer_id);
    
    if (expiredIds.length > 0) {
      setOffers((current) => current.filter((o) => !expiredIds.includes(o.id || o.offer_id)));
    }
  }, [offers]);

  const activeOffers = useMemo(
    () => offers.filter((offer) => offer.status === "offered" || offer.status === "seen"),
    [offers]
  );

  const sortedOffers = useMemo(() => {
    const now = new Date();
    return [...activeOffers].sort((a, b) => {
      // Priority 1: Urgency (critical > high > medium > low)
      const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const urgencyDiff = (urgencyOrder[b.urgency ?? "medium"] ?? 2) - (urgencyOrder[a.urgency ?? "medium"] ?? 2);
      if (urgencyDiff !== 0) return urgencyDiff;

      // Priority 2: Expiry (soonest first)
      const aExpires = new Date(a.expires_at).getTime();
      const bExpires = new Date(b.expires_at).getTime();
      if (aExpires !== bExpires) return aExpires - bExpires;

      // Priority 3: Distance (closest first, if available)
      if (a.dist_km != null && b.dist_km != null) {
        return a.dist_km - b.dist_km;
      }
      if (a.distance_mi != null && b.distance_mi != null) {
        return a.distance_mi - b.distance_mi;
      }

      return 0;
    });
  }, [activeOffers]);

  async function decline(offer: LiveOffer, reason?: string) {
    const id = offer.id || offer.offer_id;
    if (!id) return;
    setDeclining(id);
    setReasonFor(null);
    setError(null);
    try {
      const response = await fetch(`/api/offers/${encodeURIComponent(id)}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError((body as { detail?: string }).detail ?? "Could not decline offer");
        return;
      }
      setOffers((current) => current.filter((item) => (item.id || item.offer_id) !== id));
    } catch {
      setError("Unable to decline offer");
    } finally {
      setDeclining(null);
    }
  }

  const DECLINE_REASONS = ["Too far", "On another job", "Outside my skills", "Schedule conflict"];

  async function accept(offer: LiveOffer) {
    setAccepting(offer.id || offer.offer_id || null);
    setError(null);
    try {
      const id = offer.id || offer.offer_id;
      if (!id) throw new Error("Offer identifier is missing");
      const response = await fetch(`/api/offers/${encodeURIComponent(id)}/accept`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setOffers((current) => current.map((item) => item === offer ? { ...item, status: "superseded" } : item));
        setError(t("offerTaken"));
        return;
      }
      if (!response.ok) throw new Error(body.detail || `Unable to accept (${response.status})`);
      router.push(`/jobs/${body.job_id || offer.job_id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("unableToConnect"));
    } finally {
      setAccepting(null);
    }
  }

  if (loading) return <LiveOfferSkeleton />;
  if (error && offers.length === 0) {
    return (
      <div className="rounded-[22px] border border-danger/35 bg-danger/10 p-4" role="alert">
        <div className="flex gap-3"><AlertTriangle className="size-5 shrink-0 text-danger" /><div><h2 className="font-black">Dispatch feed unavailable</h2><p className="mt-1 text-sm text-muted">{error}</p></div></div>
        <button className="touch-target mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card font-black" onClick={() => void load()}><RefreshCw className="size-4" />{t("retry")}</button>
      </div>
    );
  }
  if (activeOffers.length === 0) {
    return (
      <div className="border-y border-border py-10 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full border-2 border-success text-success"><Check className="size-7" /></div>
        <h2 className="mt-4 font-condensed text-4xl font-bold uppercase">Ready for offers</h2>
        <p className="mt-1 font-mono text-xs text-success">server feed connected</p>
        <p className="mx-auto mt-4 max-w-[18rem] text-[15px] leading-6 text-muted">{t("noOffers")} You can leave this screen open while working nearby.</p>
      </div>
    );
  }

  const multipleOffers = activeOffers.length > 1;

  return (
    <div className="-mx-4 -mt-3 min-h-[calc(100svh-190px)] bg-background px-5 pb-4 pt-3" aria-live="polite">
      {error ? <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p> : null}
      {multipleOffers && (
        <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted">
          <span className="size-2 rounded-full bg-primary" />{activeOffers.length - 1} more {activeOffers.length - 1 === 1 ? "offer" : "offers"} waiting
        </div>
      )}
      {sortedOffers.slice(0, 1).map((offer) => (
        <article className="pt-5" key={offer.id || offer.offer_id}>
          <Countdown expiresAt={offer.expires_at} offeredAt={offer.offered_at} />
          <div className="mt-7 border-y border-border py-4">
            <p className="field-kicker">Incoming offer</p>
            <h2 className="mt-2 font-condensed text-3xl font-bold uppercase leading-none">{offer.service_type || offer.situation || "Service request"}</h2>
            <p className="mt-3 flex items-center gap-2 text-[15px] text-muted"><MapPin className="size-4 text-primary" />{offer.area || "Nearby service area"}</p>
            <p className="mt-1 text-sm text-[#6e6759]">Exact address and customer details unlock after acceptance.</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <OfferMetric label="Travel" value={offer.distance_mi != null ? `≈ ${offer.distance_mi} mi` : offer.dist_km != null ? `≈ ${offer.dist_km.toFixed(1)} km` : "Not provided"} />
            <OfferMetric label="Coarse drive" value={offer.eta_min != null ? `≈ ${offer.eta_min} min` : "Not provided"} />
          </div>
          <div className="mt-2 flex items-center justify-between border border-border bg-card p-4"><span className="text-sm text-muted">Your amount for this job</span><strong className="font-condensed text-3xl">{offer.estimated_earnings || "Pending"}</strong></div>
          <div className="mt-5 flex flex-col gap-3">
            <button className="field-primary-action" disabled={accepting === (offer.id || offer.offer_id)} onClick={() => void accept(offer)}>
              <Check className="mr-2 inline size-5" />{accepting === (offer.id || offer.offer_id) ? t("loading") : t("accept")}
            </button>
            <button className="touch-target min-h-[52px] border border-border bg-card px-4 font-condensed text-lg font-bold uppercase tracking-[.05em] disabled:opacity-50" disabled={declining === (offer.id || offer.offer_id)} onClick={() => { const oid = offer.id || offer.offer_id || null; setReasonFor((current) => current === oid ? null : oid); }}><X className="mr-2 inline size-5" />{declining === (offer.id || offer.offer_id) ? t("loading") : t("decline")}</button>
          </div>
          {reasonFor === (offer.id || offer.offer_id) ? (
            <div className="mt-3 rounded-2xl border border-border bg-card-strong p-3">
              <p className="text-[11px] font-black uppercase text-muted">Why are you declining?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DECLINE_REASONS.map((reason) => (
                  <button key={reason} className="touch-target min-h-10 rounded-full border border-border bg-card px-3 text-sm font-bold disabled:opacity-50" disabled={declining === (offer.id || offer.offer_id)} onClick={() => void decline(offer, reason)}>{reason}</button>
                ))}
                <button className="touch-target min-h-10 rounded-full border border-border bg-card px-3 text-sm font-bold text-muted disabled:opacity-50" disabled={declining === (offer.id || offer.offer_id)} onClick={() => void decline(offer)}>Skip</button>
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function OfferMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border border-border bg-card p-3"><div className="truncate text-sm text-muted">{label}</div><div className="mt-1 truncate text-base font-semibold">{value}</div></div>;
}

function LiveOfferSkeleton() {
  return <div className="animate-pulse rounded-[22px] border border-border bg-card p-4" aria-busy="true"><div className="h-6 w-24 rounded bg-card-strong" /><div className="mt-4 h-7 w-3/4 rounded bg-card-strong" /><div className="mt-2 h-5 w-full rounded bg-card-strong" /><div className="mt-5 h-14 rounded bg-card-strong" /><div className="mt-4 h-12 rounded bg-card-strong" /></div>;
}
