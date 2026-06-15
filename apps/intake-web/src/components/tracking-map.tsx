"use client";

// Google Maps JS has no bundled types in this app; the interop below is intentionally
// untyped. Scope the escape hatch to this file rather than sprinkling per-line disables.
/* eslint-disable @typescript-eslint/no-explicit-any */

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

function markerIcon(maps: any, kind: "tech" | "job") {
  return {
    path: maps.SymbolPath.CIRCLE,
    scale: kind === "tech" ? 8 : 9,
    fillColor: kind === "tech" ? "#ffbf00" : "#62a8ff",
    fillOpacity: 1,
    strokeColor: "#0b0d10",
    strokeWeight: 3
  };
}

/**
 * Customer-safe live tracking map: plots the assigned technician's coarse current
 * position (`tech`) and the customer's own destination (`destination`). No internal
 * dispatch data. Falls back to the static `.map` placeholder when the browser Maps
 * key is unconfigured or the script fails, so the page still renders.
 *
 * The Google Map, markers, and polyline are created once and then mutated in place:
 * the tracking page polls every ~5s, so rebuilding the map on each coordinate change
 * would flicker and waste Maps usage. When `liveExpected` is set but no `tech` point
 * is available (location stale/offline), an unobtrusive "unavailable" note is shown
 * over the destination map instead of a frozen technician dot.
 */
export function TrackingMap({
  tech,
  destination,
  label,
  liveExpected = false,
  unavailableLabel
}: {
  tech: LatLng | null;
  destination: LatLng | null;
  label?: string;
  liveExpected?: boolean;
  unavailableLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");

  // Long-lived Maps objects, created once and reused across polls.
  const mapsRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const techMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);

  // Effect 1 — load the script and initialize the map exactly once.
  useEffect(() => {
    if (!MAPS_KEY) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    loadMaps(MAPS_KEY)
      .then((m) => {
        const maps = m as any;
        if (cancelled || !ref.current || mapRef.current) return;
        mapsRef.current = maps;
        mapRef.current = new maps.Map(ref.current, {
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          backgroundColor: "#101720",
          styles: DARK_STYLE
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // Mount-once: the map instance is reused for the component's lifetime.
  }, []);

  // Effect 2 — reflect the latest coordinates onto the existing map objects. Never
  // calls `new maps.Map()` again; only moves markers, updates the polyline, and
  // re-centers/fits to whatever points are currently present.
  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map || status !== "ready") return;

    // Technician marker — create, move, or remove.
    if (tech) {
      const pos = { lat: tech.lat, lng: tech.lng };
      if (!techMarkerRef.current) {
        techMarkerRef.current = new maps.Marker({
          position: pos, map, title: label || "Technician", icon: markerIcon(maps, "tech")
        });
      } else {
        techMarkerRef.current.setPosition(pos);
        techMarkerRef.current.setTitle(label || "Technician");
      }
    } else if (techMarkerRef.current) {
      techMarkerRef.current.setMap(null);
      techMarkerRef.current = null;
    }

    // Destination marker — create or move (it stays for the job's lifetime).
    if (destination) {
      const pos = { lat: destination.lat, lng: destination.lng };
      if (!destMarkerRef.current) {
        destMarkerRef.current = new maps.Marker({
          position: pos, map, title: "Destination", icon: markerIcon(maps, "job")
        });
      } else {
        destMarkerRef.current.setPosition(pos);
      }
    } else if (destMarkerRef.current) {
      destMarkerRef.current.setMap(null);
      destMarkerRef.current = null;
    }

    // Connector polyline only while both endpoints exist.
    if (tech && destination) {
      const path = [
        { lat: tech.lat, lng: tech.lng },
        { lat: destination.lat, lng: destination.lng }
      ];
      if (!polylineRef.current) {
        polylineRef.current = new maps.Polyline({
          path, map, geodesic: true, strokeOpacity: 0,
          icons: [
            {
              icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#ffbf00", scale: 3 },
              offset: "0",
              repeat: "12px"
            }
          ]
        });
      } else {
        polylineRef.current.setPath(path);
      }
    } else if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    // Re-center / fit to the points currently on the map.
    const pts: LatLng[] = [];
    if (tech) pts.push({ lat: tech.lat, lng: tech.lng });
    if (destination) pts.push({ lat: destination.lat, lng: destination.lng });
    if (pts.length >= 2) {
      const bounds = new maps.LatLngBounds();
      pts.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 56);
    } else if (pts.length === 1) {
      map.setCenter(pts[0]);
      map.setZoom(14);
    }
  }, [tech?.lat, tech?.lng, destination?.lat, destination?.lng, label, status]);

  if (!MAPS_KEY || status === "error") {
    // Static placeholder (same visual as the legacy `.map` div).
    return <div className="map" aria-label={label || "Service area map"} />;
  }

  const showUnavailable = liveExpected && !tech;
  return (
    <div
      className="map"
      style={{ position: "relative", overflow: "hidden" }}
      aria-label={label || "Live technician tracking map"}
    >
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      {showUnavailable && (
        <div
          role="status"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "8px 12px",
            background: "rgba(11, 13, 16, 0.78)",
            color: "#cdd4dd",
            fontSize: "0.82rem",
            textAlign: "center"
          }}
        >
          {unavailableLabel || "Live location temporarily unavailable"}
        </div>
      )}
    </div>
  );
}
