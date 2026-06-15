"use client";

import { useEffect, useRef, useState } from "react";

const MAPS_KEY = process.env.NEXT_PUBLIC_MAPS_BROWSER_KEY;

// Singleton Maps JS loader — load the script once per page, share the promise.
let mapsPromise: Promise<unknown> | null = null;

function loadMaps(key: string): Promise<unknown> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as unknown as Record<string, unknown> & { google?: { maps?: unknown } };
  if (w.google?.maps) return Promise.resolve(w.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const cb = "__cluexpMapsReady";
    (w as Record<string, unknown>)[cb] = () => resolve((w.google as { maps: unknown }).maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${cb}&loading=async`;
    s.async = true;
    s.onerror = () => {
      mapsPromise = null;
      reject(new Error("maps script failed"));
    };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#101720" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b0d10" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8b94a0" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1b1f26" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1320" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#13171d" }] }
];

type LatLng = { lat: number; lng: number };

/**
 * Customer-safe live tracking map: plots the assigned technician's coarse current
 * position (`tech`) and the customer's own destination (`destination`). No internal
 * dispatch data. Falls back to the static `.map` placeholder when the browser Maps
 * key is unconfigured or the script fails, so the page still renders.
 */
export function TrackingMap({
  tech,
  destination,
  label
}: {
  tech: LatLng | null;
  destination: LatLng | null;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");

  const points: Array<LatLng & { kind: "tech" | "job" }> = [];
  if (tech) points.push({ ...tech, kind: "tech" });
  if (destination) points.push({ ...destination, kind: "job" });

  useEffect(() => {
    if (!MAPS_KEY || points.length === 0) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    loadMaps(MAPS_KEY)
      .then((m) => {
        const maps = m as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (cancelled || !ref.current) return;
        const map = new maps.Map(ref.current, {
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          backgroundColor: "#101720",
          styles: DARK_STYLE
        });
        const bounds = new maps.LatLngBounds();
        points.forEach((p) => {
          const pos = { lat: p.lat, lng: p.lng };
          bounds.extend(pos);
          new maps.Marker({
            position: pos,
            map,
            title: p.kind === "tech" ? label || "Technician" : "Destination",
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: p.kind === "tech" ? 8 : 9,
              fillColor: p.kind === "tech" ? "#ffbf00" : "#62a8ff",
              fillOpacity: 1,
              strokeColor: "#0b0d10",
              strokeWeight: 3
            }
          });
        });
        if (points.length >= 2) {
          new maps.Polyline({
            path: points.map((p) => ({ lat: p.lat, lng: p.lng })),
            map,
            geodesic: true,
            strokeOpacity: 0,
            icons: [
              {
                icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#ffbf00", scale: 3 },
                offset: "0",
                repeat: "12px"
              }
            ]
          });
          map.fitBounds(bounds, 56);
        } else {
          map.setCenter(points[0]);
          map.setZoom(14);
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // Re-render markers when either position changes (polling moves the tech).
  }, [tech?.lat, tech?.lng, destination?.lat, destination?.lng, label]);

  if (!MAPS_KEY || status === "error") {
    // Static placeholder (same visual as the legacy `.map` div).
    return <div className="map" aria-label={label || "Service area map"} />;
  }

  return (
    <div
      className="map"
      style={{ position: "relative", overflow: "hidden" }}
      aria-label={label || "Live technician tracking map"}
    >
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
