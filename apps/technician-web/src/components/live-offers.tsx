"use client";

import { useLocale } from "@cluexp/app-core";
import { AlertTriangle, Check, Clock3, MapPin, RefreshCw, ShieldAlert, Timer, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Countdown } from "./client-widgets";

interface LiveOffer {
  id: string;
  offer_id?: string;
  job_id: string;
  status: "offered" | "seen" | "accepted" | "declined" | "expired" | "superseded" | "failed_delivery";
  expires_at: string;
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
  if (Array.isArray(body)) return body as LiveOffer[];
  if (body && typeof body === "object" && Array.isArray((body as { offers?: unknown }).offers)) {
    return (body as { offers: LiveOffer[] }).offers;
  }
  return [];
}

export function LiveOffersFeed() {
  const router = useRouter();
  const { t } = useLocale();
  const [offers, setOffers] = useState<LiveOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);

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

  const activeOffers = useMemo(
    () => offers.filter((offer) => offer.status === "offered" || offer.status === "seen"),
    [offers]
  );

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
      <div className="rounded-[22px] border border-border bg-card p-5 text-center">
        <Clock3 className="mx-auto size-7 text-success" />
        <h2 className="mt-3 text-lg font-black">Standing by</h2>
        <p className="mt-1 text-sm leading-5 text-muted">{t("noOffers")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3" aria-live="polite">
      {error ? <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p> : null}
      {activeOffers.map((offer) => (
        <article className="rounded-[22px] border border-primary/45 bg-card p-4" key={offer.id || offer.offer_id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-black uppercase text-primary">
                {offer.urgency === "critical" ? <ShieldAlert className="size-3.5" /> : <Timer className="size-3.5" />}
                {offer.urgency ?? "urgent"}
              </div>
              <h2 className="mt-3 text-[22px] font-black leading-7">{offer.service_type || offer.situation || "Urgent service request"}</h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-muted"><MapPin className="size-4" />{offer.area || "Nearby service area"} · {t("exactAddressAfterAccept")}</p>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-condensed text-4xl font-bold leading-none">{offer.eta_min ?? "--"}</div>
              <div className="text-[10px] font-black uppercase text-muted">min ETA</div>
            </div>
          </div>
          <div className="mt-4"><Countdown expiresAt={offer.expires_at} /></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <OfferMetric label="Distance" value={offer.distance_mi != null ? `${offer.distance_mi} mi` : offer.dist_km != null ? `${offer.dist_km.toFixed(1)} km` : "--"} />
            <OfferMetric label="Value" value={offer.estimated_earnings || "TBD"} />
            <OfferMetric label="Rank" value={offer.rank ? `#${offer.rank}` : "--"} />
          </div>
          <div className="mt-4 grid grid-cols-[.72fr_1.28fr] gap-3">
            <button className="touch-target min-h-[52px] rounded-2xl border border-border bg-card-strong px-4 font-black"><X className="mr-2 inline size-5" />{t("decline")}</button>
            <button className="touch-target min-h-[52px] rounded-2xl bg-primary px-4 font-black text-primary-foreground disabled:opacity-50" disabled={accepting === (offer.id || offer.offer_id)} onClick={() => void accept(offer)}>
              <Check className="mr-2 inline size-5" />{accepting ? t("loading") : t("accept")}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function OfferMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl border border-border bg-card-strong p-2"><div className="truncate text-[10px] font-black uppercase text-muted">{label}</div><div className="mt-1 truncate text-sm font-black">{value}</div></div>;
}

function LiveOfferSkeleton() {
  return <div className="animate-pulse rounded-[22px] border border-border bg-card p-4" aria-busy="true"><div className="h-6 w-24 rounded bg-card-strong" /><div className="mt-4 h-7 w-3/4 rounded bg-card-strong" /><div className="mt-2 h-5 w-full rounded bg-card-strong" /><div className="mt-5 h-14 rounded bg-card-strong" /><div className="mt-4 h-12 rounded bg-card-strong" /></div>;
}
