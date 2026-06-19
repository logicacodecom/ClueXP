"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type MapPoint = {
  lat: number;
  lng: number;
  kind: "tech" | "job";
  label?: string;
  id?: string;
  // Optional fleet classification for tech markers: free (green), busy (red),
  // inactive / last-known (yellow). Absent → default amber tech marker.
  status?: "free" | "busy" | "inactive";
};

const TECH_STATUS_COLOR: Record<NonNullable<MapPoint["status"]>, string> = {
  free: "#22c55e",
  busy: "#ef4444",
  inactive: "#eab308",
};

const MAPS_KEY = process.env.NEXT_PUBLIC_MAPS_BROWSER_KEY;

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
    s.onerror = () => { mapsPromise = null; reject(new Error("maps script failed")); };
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
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#272d35" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#39414d" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#99a2ad" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1320" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#13171d" }] }
];

/**
 * Google Maps layer for the ops console. Renders absolute inset-0 into its parent.
 *
 * Props:
 *   points      — markers to show (tech = amber, job = blue)
 *   connect     — draw a single dashed polyline through all points (technician-web nav flow)
 *   pairs       — draw one dashed polyline per [techPoint, jobPoint] pair (fleet map)
 *   onMarkerClick — called with the MapPoint when a marker is clicked
 *   fallback    — rendered when Maps key is absent or script fails
 */
export function GoogleMapView({
  connect = false,
  fallback,
  onMarkerClick,
  pairs,
  points,
}: {
  connect?: boolean;
  fallback?: ReactNode;
  onMarkerClick?: (point: MapPoint) => void;
  pairs?: [MapPoint, MapPoint][];
  points: MapPoint[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");

  useEffect(() => {
    if (!MAPS_KEY || points.length === 0) { setStatus("error"); return; }
    let cancelled = false;
    loadMaps(MAPS_KEY)
      .then((m) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maps = m as any;
        if (cancelled || !ref.current) return;
        const map = new maps.Map(ref.current, {
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          backgroundColor: "#101720",
          styles: DARK_STYLE,
        });
        const bounds = new maps.LatLngBounds();
        points.forEach((p) => {
          const pos = { lat: p.lat, lng: p.lng };
          bounds.extend(pos);
          const techColor = p.status ? TECH_STATUS_COLOR[p.status] : "#ffbf00";
          const marker = new maps.Marker({
            position: pos,
            map,
            title: p.label,
            // Inactive techs render at reduced opacity — they are shown by their
            // last known location only, not a live position.
            opacity: p.kind === "tech" && p.status === "inactive" ? 0.7 : 1,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: p.kind === "tech" ? 8 : 9,
              fillColor: p.kind === "tech" ? techColor : "#62a8ff",
              fillOpacity: 1,
              strokeColor: "#0b0d10",
              strokeWeight: 3,
            },
          });
          if (onMarkerClick) {
            marker.addListener("click", () => onMarkerClick(p));
          }
        });

        if (connect && points.length >= 2) {
          new maps.Polyline({
            path: points.map((p) => ({ lat: p.lat, lng: p.lng })),
            map,
            geodesic: true,
            strokeOpacity: 0,
            icons: [{
              icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#ffbf00", scale: 3 },
              offset: "0",
              repeat: "12px",
            }],
          });
        }

        if (pairs && pairs.length > 0) {
          pairs.forEach(([tech, job]) => {
            new maps.Polyline({
              path: [{ lat: tech.lat, lng: tech.lng }, { lat: job.lat, lng: job.lng }],
              map,
              geodesic: true,
              strokeOpacity: 0,
              icons: [{
                icon: { path: "M 0,-1 0,1", strokeOpacity: 0.6, strokeColor: "#ffbf00", scale: 2 },
                offset: "0",
                repeat: "10px",
              }],
            });
          });
        }

        if (points.length === 1) {
          map.setCenter(points[0]);
          map.setZoom(14);
        } else {
          map.fitBounds(bounds, 56);
        }
        setStatus("ready");
      })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [points, connect, pairs, onMarkerClick]);

  if (!MAPS_KEY || status === "error") return <>{fallback}</>;
  return (
    <>
      <div ref={ref} className="absolute inset-0" />
      {status !== "ready" ? <div className="absolute inset-0 animate-pulse bg-card-strong/50" /> : null}
    </>
  );
}
