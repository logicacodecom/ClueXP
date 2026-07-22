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
  // Optional fleet classification for tech markers: free (green), busy (amber),
  // inactive / last-known (gray). Absent → default amber tech marker.
  status?: "free" | "busy" | "inactive";
  // Optional dispatch risk for request markers, used only in richMarkers mode.
  risk?: "normal" | "watch" | "critical";
  // Selected points are rendered with a stronger outline and lifted z-index.
  selected?: boolean;
  // Optional rich-marker identity/freshness fields used by the dispatcher
  // operations map. Other map consumers can ignore them.
  avatarUrl?: string | null;
  initials?: string;
  stale?: boolean;
  rankBadge?: string;
  markerLabel?: string;
  clusterCount?: number;
  clusterMembers?: Array<{ lat: number; lng: number }>;
  chip?: string;
  chipTone?: "info" | "warn" | "critical" | "neutral";
  chipVisible?: boolean;
  callout?: {
    title: string;
    meta?: string[];
    lines?: string[];
  };
};

const TECH_STATUS_COLOR: Record<NonNullable<MapPoint["status"]>, string> = {
  free: "#22c55e",
  busy: "#f59e0b",
  inactive: "#64748b",
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

function clusterMapPoints(points: MapPoint[]): MapPoint[] {
  const buckets = new Map<string, MapPoint[]>();
  const singles: MapPoint[] = [];
  for (const point of points) {
    if (point.selected) {
      singles.push(point);
      continue;
    }
    const key = `${point.kind}:${Math.round(point.lat * 1_000)}:${Math.round(point.lng * 1_000)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), point]);
  }
  const clustered: MapPoint[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) {
      clustered.push(bucket[0]!);
      continue;
    }
    const first = bucket[0]!;
    const lat = bucket.reduce((sum, point) => sum + point.lat, 0) / bucket.length;
    const lng = bucket.reduce((sum, point) => sum + point.lng, 0) / bucket.length;
    const available = bucket.filter((point) => point.kind === "tech" && point.status === "free").length;
    const busy = bucket.filter((point) => point.kind === "tech" && point.status === "busy").length;
    const inactive = bucket.filter((point) => point.kind === "tech" && point.status === "inactive").length;
    const warningCount = bucket.filter((point) => point.risk === "critical" || point.chipTone === "critical" || point.stale).length;
    clustered.push({
      ...first,
      id: undefined,
      lat,
      lng,
      label: `${bucket.length} ${first.kind === "tech" ? "technicians" : first.kind === "request" ? "requests" : "active jobs"}`,
      markerLabel: String(bucket.length),
      clusterCount: bucket.length,
      clusterMembers: bucket.map((point) => ({ lat: point.lat, lng: point.lng })),
      rankBadge: undefined,
      selected: false,
      stale: warningCount > 0,
      chip: undefined,
      callout: {
        title: `${bucket.length} ${first.kind === "tech" ? "technicians" : first.kind === "request" ? "requests" : "active jobs"}`,
        meta: first.kind === "tech"
          ? [`${available} available`, `${busy} busy`, `${inactive} offline`]
          : [first.kind === "request" ? "Request cluster" : "Active-job cluster"],
        lines: warningCount > 0 ? [`${warningCount} item${warningCount === 1 ? "" : "s"} need attention`] : ["Click to fit these items"],
      },
    });
  }
  return [...singles, ...clustered];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function iconFor(p: MapPoint, maps: any, richMarkers: boolean) {
  const selected = Boolean(p.selected);
  const strokeColor = selected ? "#f8fafc" : "#0b0d10";
  const strokeWeight = selected ? 4 : 2;
  if (p.kind === "tech") {
    const techColor = p.status ? TECH_STATUS_COLOR[p.status] : "#ffbf00";
    return { path: maps.SymbolPath.CIRCLE, scale: selected ? 10 : 8, fillColor: techColor, fillOpacity: 1, strokeColor, strokeWeight: selected ? 4 : 3 };
  }
  if (richMarkers && p.kind === "request") {
    return {
      path: REQUEST_DIAMOND_PATH,
      scale: selected ? 1.45 : 1.15,
      fillColor: "#3b82f6",
      fillOpacity: 1,
      strokeColor: REQUEST_RISK_COLOR[p.risk ?? "normal"],
      strokeWeight: selected ? 5 : p.risk && p.risk !== "normal" ? 4 : 2,
    };
  }
  if (richMarkers && p.kind === "job") {
    return { path: JOB_SQUARE_PATH, scale: selected ? 1.45 : 1.15, fillColor: "#8b5cf6", fillOpacity: 1, strokeColor, strokeWeight };
  }
  // Legacy rendering for "job"/"request" outside richMarkers mode — unchanged
  // from the original circle so /map, /queue, and /jobs/assign keep their
  // current look exactly.
  return { path: maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#62a8ff", fillOpacity: 1, strokeColor: "#0b0d10", strokeWeight: 3 };
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function calloutHtml(callout: NonNullable<MapPoint["callout"]>): string {
  const meta = callout.meta?.filter(Boolean) ?? [];
  const lines = callout.lines?.filter(Boolean) ?? [];
  return `
    <div style="min-width:220px;max-width:280px;color:#e5e7eb;background:#111827;font:500 12px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="font-weight:800;font-size:13px;line-height:1.25;color:#f8fafc;margin-bottom:6px;">${htmlEscape(callout.title)}</div>
      ${meta.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">${meta.map((item) => `<span style="border:1px solid #374151;border-radius:999px;padding:2px 6px;color:#cbd5e1;background:#1f2937;">${htmlEscape(item)}</span>`).join("")}</div>` : ""}
      ${lines.length > 0 ? `<div style="display:grid;gap:3px;color:#cbd5e1;line-height:1.35;">${lines.map((line) => `<div>${htmlEscape(line)}</div>`).join("")}</div>` : ""}
    </div>
  `;
}

function techMarkerBorder(point: MapPoint): string {
  if (point.status === "free") return "#22c55e";
  if (point.status === "busy") return "#f59e0b";
  return "#64748b";
}

function workMarkerTone(point: MapPoint) {
  if (point.kind === "request") {
    return {
      fill: "#3b82f6",
      stroke: REQUEST_RISK_COLOR[point.risk ?? "normal"],
      chip: point.chipTone === "critical" ? "#ef4444" : point.chipTone === "warn" ? "#f59e0b" : "#2563eb",
      shape: "diamond" as const,
    };
  }
  return {
    fill: "#8b5cf6",
    stroke: point.chipTone === "critical" ? "#ef4444" : point.chipTone === "warn" ? "#f59e0b" : point.selected ? "#f8fafc" : "#0b0d10",
    chip: point.chipTone === "critical" ? "#ef4444" : point.chipTone === "warn" ? "#f59e0b" : "#7c3aed",
    shape: "square" as const,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createWorkOverlay(point: MapPoint, maps: any, map: any, onClick: (point: MapPoint) => void, onHover: (point: MapPoint, open: boolean) => void) {
  const overlay = new maps.OverlayView();
  const tone = workMarkerTone(point);
  const size = point.selected ? 38 : 32;
  const shell = document.createElement("button");
  shell.type = "button";
  shell.title = point.label ?? "";
  shell.style.position = "absolute";
  shell.style.minWidth = `${size}px`;
  shell.style.height = point.chip ? `${size + 18}px` : `${size}px`;
  shell.style.padding = "0";
  shell.style.border = "0";
  shell.style.background = "transparent";
  shell.style.cursor = "pointer";
  shell.style.transform = "translate(-50%, -100%)";
  shell.style.zIndex = point.selected ? "950" : point.kind === "request" ? "55" : "50";
  shell.style.filter = point.selected ? "drop-shadow(0 0 0.55rem rgba(255,191,0,0.7))" : "drop-shadow(0 0.25rem 0.4rem rgba(0,0,0,0.35))";
  shell.setAttribute("aria-label", point.label ?? (point.kind === "request" ? "Request" : "Job"));
  const marker = document.createElement("span");
  marker.style.position = "absolute";
  marker.style.left = "50%";
  marker.style.top = "0";
  marker.style.width = `${size}px`;
  marker.style.height = `${size}px`;
  marker.style.display = "grid";
  marker.style.placeItems = "center";
  marker.style.transform = tone.shape === "diamond" ? "translateX(-50%) rotate(45deg)" : "translateX(-50%)";
  marker.style.borderRadius = tone.shape === "diamond" ? "4px" : "8px";
  marker.style.background = tone.fill;
  marker.style.border = `${point.selected ? 4 : point.risk && point.risk !== "normal" ? 3 : 2}px solid ${tone.stroke}`;
  marker.style.boxSizing = "border-box";
  const label = document.createElement("span");
  label.textContent = point.markerLabel ?? (point.kind === "request" ? "R" : "J");
  label.style.color = "#f8fafc";
  label.style.font = "800 10px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  label.style.transform = tone.shape === "diamond" ? "rotate(-45deg)" : "none";
  marker.appendChild(label);
  shell.appendChild(marker);
  if (point.chip) {
    const chip = document.createElement("span");
    chip.textContent = point.chip;
    chip.style.position = "absolute";
    chip.style.left = "50%";
    chip.style.bottom = "0";
    chip.style.transform = "translateX(-50%) translateY(0)";
    chip.style.padding = "1px 5px";
    chip.style.borderRadius = "999px";
    chip.style.border = "1px solid #0b0d10";
    chip.style.background = tone.chip;
    chip.style.color = point.chipTone === "warn" ? "#0b0d10" : "#f8fafc";
    chip.style.font = "800 10px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    chip.style.whiteSpace = "nowrap";
    chip.style.opacity = point.chipVisible || point.selected ? "1" : "0";
    chip.style.transition = "opacity 120ms ease, transform 120ms ease";
    shell.appendChild(chip);
  }
  const chipEl = point.chip ? shell.lastElementChild as HTMLElement | null : null;
  const show = () => {
    if (chipEl) {
      chipEl.style.opacity = "1";
      chipEl.style.transform = "translateX(-50%) translateY(-1px)";
    }
    onHover(point, true);
  };
  const hide = () => {
    if (chipEl && !point.chipVisible && !point.selected) {
      chipEl.style.opacity = "0";
      chipEl.style.transform = "translateX(-50%) translateY(0)";
    }
    onHover(point, false);
  };
  shell.addEventListener("mouseenter", show);
  shell.addEventListener("mouseleave", hide);
  shell.addEventListener("focus", show);
  shell.addEventListener("blur", hide);
  shell.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(point);
  });
  overlay.onAdd = () => {
    overlay.getPanes()?.overlayMouseTarget.appendChild(shell);
  };
  overlay.draw = () => {
    const projection = overlay.getProjection();
    if (!projection) return;
    const pixel = projection.fromLatLngToDivPixel(new maps.LatLng(point.lat, point.lng));
    if (!pixel) return;
    shell.style.left = `${pixel.x}px`;
    shell.style.top = `${pixel.y}px`;
  };
  overlay.onRemove = () => {
    shell.remove();
  };
  overlay.setMap(map);
  return overlay;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTechOverlay(point: MapPoint, maps: any, map: any, onClick: (point: MapPoint) => void) {
  const overlay = new maps.OverlayView();
  const size = point.selected ? { width: 50, height: 62, avatar: 32 } : { width: 42, height: 54, avatar: 27 };
  const border = techMarkerBorder(point);
  const shell = document.createElement("button");
  shell.type = "button";
  shell.title = point.label ?? "";
  shell.style.position = "absolute";
  shell.style.width = `${size.width}px`;
  shell.style.height = `${size.height}px`;
  shell.style.padding = "0";
  shell.style.border = "0";
  shell.style.background = "transparent";
  shell.style.cursor = "pointer";
  shell.style.transform = "translate(-50%, -100%)";
  shell.style.zIndex = point.selected ? "1000" : point.status === "free" ? "40" : point.status === "busy" ? "35" : "30";
  shell.style.filter = point.selected ? "drop-shadow(0 0 0.65rem rgba(255,191,0,0.75))" : "drop-shadow(0 0.35rem 0.45rem rgba(0,0,0,0.35))";
  shell.style.opacity = point.status === "inactive" ? "0.72" : "1";
  shell.setAttribute("aria-label", point.label ?? "Technician");
  shell.innerHTML = `
    <svg width="${size.width}" height="${size.height}" viewBox="0 0 42 54" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M21 52 C21 52 3 34 3 20 C3 9.5 11.2 2 21 2 C30.8 2 39 9.5 39 20 C39 34 21 52 21 52 Z" fill="#111827" stroke="${border}" stroke-width="${point.selected ? 4 : 3}"/>
      <circle cx="21" cy="20" r="13.8" fill="#f8fafc" stroke="#0b0d10" stroke-width="2"/>
    </svg>
  `;
  const avatar = document.createElement("div");
  avatar.style.position = "absolute";
  avatar.style.left = "50%";
  avatar.style.top = point.selected ? "6px" : "7px";
  avatar.style.width = `${size.avatar}px`;
  avatar.style.height = `${size.avatar}px`;
  avatar.style.transform = "translateX(-50%)";
  avatar.style.borderRadius = "999px";
  avatar.style.overflow = "hidden";
  avatar.style.display = "grid";
  avatar.style.placeItems = "center";
  avatar.style.background = "#1f2937";
  avatar.style.color = "#f8fafc";
  avatar.style.font = "700 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  avatar.style.letterSpacing = "0";
  if (point.avatarUrl) {
    const image = document.createElement("img");
    image.src = point.avatarUrl;
    image.alt = "";
    image.style.width = "100%";
    image.style.height = "100%";
    image.style.objectFit = "cover";
    avatar.appendChild(image);
  } else {
    avatar.innerHTML = htmlEscape((point.initials ?? "?").slice(0, 2).toUpperCase());
  }
  shell.appendChild(avatar);
  if (point.stale) {
    const warning = document.createElement("span");
    warning.textContent = "!";
    warning.style.position = "absolute";
    warning.style.right = point.selected ? "6px" : "5px";
    warning.style.top = point.selected ? "7px" : "8px";
    warning.style.width = "14px";
    warning.style.height = "14px";
    warning.style.borderRadius = "999px";
    warning.style.display = "grid";
    warning.style.placeItems = "center";
    warning.style.background = "#f59e0b";
    warning.style.color = "#0b0d10";
    warning.style.font = "800 10px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    warning.style.border = "1px solid #0b0d10";
    shell.appendChild(warning);
  }
  if (point.rankBadge) {
    const rank = document.createElement("span");
    rank.textContent = point.rankBadge;
    rank.style.position = "absolute";
    rank.style.left = point.selected ? "4px" : "3px";
    rank.style.top = point.selected ? "7px" : "8px";
    rank.style.minWidth = "15px";
    rank.style.height = "15px";
    rank.style.padding = "0 4px";
    rank.style.borderRadius = "999px";
    rank.style.display = "grid";
    rank.style.placeItems = "center";
    rank.style.background = "#fbbf24";
    rank.style.color = "#0b0d10";
    rank.style.font = "900 10px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    rank.style.border = "1px solid #0b0d10";
    rank.setAttribute("aria-hidden", "true");
    shell.appendChild(rank);
  }
  shell.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(point);
  });
  overlay.onAdd = () => {
    overlay.getPanes()?.overlayMouseTarget.appendChild(shell);
  };
  overlay.draw = () => {
    const projection = overlay.getProjection();
    if (!projection) return;
    const pixel = projection.fromLatLngToDivPixel(new maps.LatLng(point.lat, point.lng));
    if (!pixel) return;
    shell.style.left = `${pixel.x}px`;
    shell.style.top = `${pixel.y}px`;
  };
  overlay.onRemove = () => {
    shell.remove();
  };
  overlay.setMap(map);
  return overlay;
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
 *   focusPoint  — selected point to pan toward without rebuilding the map
 *   showViewportControls — opt-in map controls for dense operations screens
 *   clusterMarkers — opt-in lightweight type-preserving clustering for dense operations maps
 *   richMarkers — opt-in shape differentiation (job = square, request = diamond)
 *                 for consoles that show technicians, jobs, and requests together.
 *                 Defaults off so existing callers render exactly as before.
 */
export function GoogleMapView({
  connect = false,
  fallback,
  focusPoint,
  onMarkerClick,
  pairs,
  points,
  richMarkers = false,
  showViewportControls = false,
  clusterMarkers = false,
}: {
  clusterMarkers?: boolean;
  connect?: boolean;
  fallback?: ReactNode;
  focusPoint?: MapPoint | null;
  onMarkerClick?: (point: MapPoint) => void;
  pairs?: [MapPoint, MapPoint][];
  points: MapPoint[];
  richMarkers?: boolean;
  showViewportControls?: boolean;
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
    const infoWindow = new maps.InfoWindow({
      disableAutoPan: true,
      maxWidth: 300,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let selectedMarker: any | null = null;
    let selectedContent: string | null = null;
    let selectedPosition: { lat: number; lng: number } | null = null;
    const renderPoints = clusterMarkers ? clusterMapPoints(points) : points;
    renderPoints.forEach((p) => {
      const pos = { lat: p.lat, lng: p.lng };
      bounds.extend(pos);
      const content = p.callout ? calloutHtml(p.callout) : null;
      const openInfoAtPosition = () => {
        if (!content) return;
        infoWindow.setContent(content);
        infoWindow.setPosition(pos);
        infoWindow.open({ map });
      };
      if (richMarkers && p.kind === "tech" && !p.clusterCount) {
        markersRef.current.push(createTechOverlay(p, maps, map, (point) => onMarkerClickRef.current?.(point)));
        return;
      }
      if (richMarkers && p.kind !== "tech" && p.chip && !p.clusterCount) {
        markersRef.current.push(createWorkOverlay(
          p,
          maps,
          map,
          (point) => {
            openInfoAtPosition();
            onMarkerClickRef.current?.(point);
          },
          (_point, open) => {
            if (open) openInfoAtPosition();
            if (!open && !p.selected) infoWindow.close();
          },
        ));
        if (p.selected && content) {
          selectedContent = content;
          selectedPosition = pos;
        }
        return;
      }
      const marker = new maps.Marker({
        position: pos,
        map,
        title: p.label,
        // Inactive techs render at reduced opacity — they are shown by their
        // last known location only, not a live position.
        opacity: p.kind === "tech" && p.status === "inactive" ? 0.7 : 1,
        icon: iconFor(p, maps, richMarkers),
        label: richMarkers && p.kind !== "tech" ? {
          text: p.markerLabel ?? (p.kind === "request" ? "R" : "J"),
          color: "#f8fafc",
          fontSize: "10px",
          fontWeight: "800",
        } : undefined,
        zIndex: p.selected ? 1000 : undefined,
      });
      if (content) {
        marker.addListener("mouseover", () => {
          infoWindow.setContent(content);
          infoWindow.open({ anchor: marker, map });
        });
        marker.addListener("mouseout", () => {
          if (!p.selected) infoWindow.close();
        });
        if (p.selected) {
          selectedMarker = marker;
          selectedContent = content;
          selectedPosition = null;
        }
      }
      marker.addListener("click", () => {
        if (p.clusterMembers && p.clusterMembers.length > 1) {
          const clusterBounds = new maps.LatLngBounds();
          p.clusterMembers.forEach((member) => clusterBounds.extend(member));
          map.fitBounds(clusterBounds, 64);
          if (content) {
            infoWindow.setContent(content);
            infoWindow.open({ anchor: marker, map });
          }
          return;
        }
        if (content) {
          infoWindow.setContent(content);
          infoWindow.open({ anchor: marker, map });
        }
        onMarkerClickRef.current?.(p);
      });
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
    if (selectedMarker && selectedContent) {
      infoWindow.setContent(selectedContent);
      infoWindow.open({ anchor: selectedMarker, map });
    } else if (selectedPosition && selectedContent) {
      infoWindow.setContent(selectedContent);
      infoWindow.setPosition(selectedPosition);
      infoWindow.open({ map });
    }
  }, [status, points, connect, pairs, richMarkers, clusterMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map || !focusPoint) return;
    map.panTo({ lat: focusPoint.lat, lng: focusPoint.lng });
    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : null;
    if (typeof currentZoom !== "number" || currentZoom < 13) map.setZoom(13);
  }, [status, focusPoint?.id, focusPoint?.kind, focusPoint?.lat, focusPoint?.lng]);

  const fitOperations = () => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !maps || !map || points.length === 0) return;
    if (points.length === 1) {
      const [point] = points;
      if (!point) return;
      map.panTo({ lat: point.lat, lng: point.lng });
      map.setZoom(14);
      return;
    }
    const bounds = new maps.LatLngBounds();
    points.forEach((point) => bounds.extend({ lat: point.lat, lng: point.lng }));
    map.fitBounds(bounds, 56);
  };

  const returnToSelection = () => {
    const map = mapRef.current;
    if (status !== "ready" || !map || !focusPoint) return;
    map.panTo({ lat: focusPoint.lat, lng: focusPoint.lng });
    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : null;
    if (typeof currentZoom !== "number" || currentZoom < 13) map.setZoom(13);
  };

  if (!MAPS_KEY || status === "error") return <>{fallback}</>;
  return (
    <>
      <div ref={ref} className="absolute inset-0" />
      {status !== "ready" ? <div className="absolute inset-0 animate-pulse bg-card-strong/50" /> : null}
      {showViewportControls ? (
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <button
            aria-label="Fit operations"
            className="rounded-md border border-border bg-background/90 px-2.5 py-2 text-[11px] font-semibold uppercase text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
            disabled={status !== "ready" || points.length === 0}
            onClick={fitOperations}
            title="Fit operations"
            type="button"
          >
            Fit
          </button>
          <button
            aria-label="Return to selection"
            className="rounded-md border border-border bg-background/90 px-2.5 py-2 text-[11px] font-semibold uppercase text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
            disabled={status !== "ready" || !focusPoint}
            onClick={returnToSelection}
            title="Return to selection"
            type="button"
          >
            Return
          </button>
        </div>
      ) : null}
    </>
  );
}
