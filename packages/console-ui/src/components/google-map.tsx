"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type MapPoint = {
  lat: number;
  lng: number;
  // "request" is a pending-dispatch job with no assigned technician yet.
  // Only rendered as a distinct shape when the caller opts into richMarkers.
  kind: "tech" | "job" | "request";
  label?: string;
  id?: string;
  // Optional fleet classification for tech markers: free (green), busy (red),
  // inactive / last-known (yellow). Absent → default amber tech marker.
  status?: "free" | "busy" | "inactive";
  // Optional dispatch risk for request markers, used only in richMarkers mode.
  risk?: "normal" | "watch" | "critical";
};

const TECH_STATUS_COLOR: Record<NonNullable<MapPoint["status"]>, string> = {
  free: "#22c55e",
  busy: "#ef4444",
  inactive: "#eab308",
};

const REQUEST_RISK_COLOR: Record<NonNullable<MapPoint["risk"]>, string> = {
  normal: "#3b82f6",
  watch: "#eab308",
  critical: "#ef4444",
};

// Square path for "job" markers and diamond path for "request" markers, both in
// richMarkers mode only — gives dispatchers a shape (not just color) cue that
// distinguishes technicians (circle) from active jobs (square) from unassigned
// requests (diamond) on the same map.
const JOB_SQUARE_PATH = "M -7,-7 7,-7 7,7 -7,7 Z";
const REQUEST_DIAMOND_PATH = "M 0,-9 9,0 0,9 -9,0 Z";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function iconFor(p: MapPoint, maps: any, richMarkers: boolean) {
  if (p.kind === "tech") {
    const techColor = p.status ? TECH_STATUS_COLOR[p.status] : "#ffbf00";
    return { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: techColor, fillOpacity: 1, strokeColor: "#0b0d10", strokeWeight: 3 };
  }
  if (richMarkers && p.kind === "request") {
    return { path: REQUEST_DIAMOND_PATH, scale: 1, fillColor: REQUEST_RISK_COLOR[p.risk ?? "normal"], fillOpacity: 1, strokeColor: "#0b0d10", strokeWeight: 2 };
  }
  if (richMarkers && p.kind === "job") {
    return { path: JOB_SQUARE_PATH, scale: 1, fillColor: "#8b5cf6", fillOpacity: 1, strokeColor: "#0b0d10", strokeWeight: 2 };
  }
  // Legacy rendering for "job"/"request" outside richMarkers mode — unchanged
  // from the original circle so /map, /queue, and /jobs/assign keep their
  // current look exactly.
  return { path: maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#62a8ff", fillOpacity: 1, strokeColor: "#0b0d10", strokeWeight: 3 };
}

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
 *   richMarkers — opt-in shape differentiation (job = square, request = diamond)
 *                 for consoles that show technicians, jobs, and requests together.
 *                 Defaults off so existing callers render exactly as before.
 */
export function GoogleMapView({
  connect = false,
  fallback,
  onMarkerClick,
  pairs,
  points,
  richMarkers = false,
}: {
  connect?: boolean;
  fallback?: ReactNode;
  onMarkerClick?: (point: MapPoint) => void;
  pairs?: [MapPoint, MapPoint][];
  points: MapPoint[];
  richMarkers?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapsRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polylinesRef = useRef<any[]>([]);
  const hasFitBoundsRef = useRef(false);
  const onMarkerClickRef = useRef(onMarkerClick);
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    if (!MAPS_KEY) { setStatus("error"); return; }
    let cancelled = false;
    loadMaps(MAPS_KEY)
      .then((m) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maps = m as any;
        if (cancelled || !ref.current) return;
        mapsRef.current = maps;
        mapRef.current = new maps.Map(ref.current, {
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          backgroundColor: "#101720",
          styles: DARK_STYLE,
        });
        setStatus("ready");
      })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !maps || !map) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    polylinesRef.current.forEach((line) => line.setMap(null));
    markersRef.current = [];
    polylinesRef.current = [];

    const bounds = new maps.LatLngBounds();
    points.forEach((p) => {
      const pos = { lat: p.lat, lng: p.lng };
      bounds.extend(pos);
      const marker = new maps.Marker({
        position: pos,
        map,
        title: p.label,
        // Inactive techs render at reduced opacity — they are shown by their
        // last known location only, not a live position.
        opacity: p.kind === "tech" && p.status === "inactive" ? 0.7 : 1,
        icon: iconFor(p, maps, richMarkers),
      });
      marker.addListener("click", () => onMarkerClickRef.current?.(p));
      markersRef.current.push(marker);
    });

    if (connect && points.length >= 2) {
      polylinesRef.current.push(new maps.Polyline({
        path: points.map((p) => ({ lat: p.lat, lng: p.lng })),
        map,
        geodesic: true,
        strokeOpacity: 0,
        icons: [{
          icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#ffbf00", scale: 3 },
          offset: "0",
          repeat: "12px",
        }],
      }));
    }

    pairs?.forEach(([tech, job]) => {
      polylinesRef.current.push(new maps.Polyline({
        path: [{ lat: tech.lat, lng: tech.lng }, { lat: job.lat, lng: job.lng }],
        map,
        geodesic: true,
        strokeOpacity: 0,
        icons: [{
          icon: { path: "M 0,-1 0,1", strokeOpacity: 0.6, strokeColor: "#ffbf00", scale: 2 },
          offset: "0",
          repeat: "10px",
        }],
      }));
    });

    if (!hasFitBoundsRef.current && points.length > 0) {
      if (points.length === 1) {
        map.setCenter(points[0]);
        map.setZoom(14);
      } else {
        map.fitBounds(bounds, 56);
      }
      hasFitBoundsRef.current = true;
    }
  }, [status, points, connect, pairs, richMarkers]);

  if (!MAPS_KEY || status === "error") return <>{fallback}</>;
  return (
    <>
      <div ref={ref} className="absolute inset-0" />
      {status !== "ready" ? <div className="absolute inset-0 animate-pulse bg-card-strong/50" /> : null}
    </>
  );
}
