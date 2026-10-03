// Inbound handoffs into a provider intake `/o/{slug}#src=...` (specs/003
// FR-008/FR-010/FR-011, plus the ClueXP Website handoff). Pure functions only,
// so they can be tested without a browser (`scripts/intake-handoff.test.mjs`).
//
// Source attribution is separate from location trust: only sources listed in
// COORDINATE_SOURCES may supply a dispatchable location; every other source's
// address is customer-provided text the intake must confirm itself. To add a
// source, map its `src` value(s) in SOURCES (and allow-list it in the API's
// INTAKE_SOURCES). Unknown values fail closed into a blank intake.

export type IntakeSource = "ai_assistant" | "cluexp_website";

const SOURCES = new Map<string, IntakeSource>([
  ["ai_assistant", "ai_assistant"],
  ["cluexp_website", "cluexp_website"],
  ["website", "cluexp_website"] // legacy Website links, normalized
]);
const COORDINATE_SOURCES = new Set<IntakeSource>(["ai_assistant"]);

const MAX_ADDRESS = 300;
const MAX_NOTES = 500;

export type HandoffPrefill = {
  source: IntakeSource;
  // "vehicle" | "home" | "business", or null when the skill has no intake bucket.
  accessType: string | null;
  situation: string | null;
  // "coordinates": `location` is set and may be sent with the ticket.
  // "typed_unconfirmed" / "zip_hint" / "none": `location` is null; the customer
  // must confirm an exact address in the location step.
  locationConfidence: "coordinates" | "typed_unconfirmed" | "zip_hint" | "none";
  location: { raw_text: string; lat: number; lng: number; geocode_confidence: string } | null;
  address: string; // display text only
  zip: string | null; // display hint only, never a dispatch location
  notes: string;
};

// Mirrors the API's `_access_type_for_skill` bucketing of catalog skill codes.
export function accessTypeForSkill(skill: string): string | null {
  if (skill.startsWith("locksmith.vehicle") || skill.startsWith("locksmith.key_programming")) return "vehicle";
  if (skill.startsWith("locksmith.residential")) return "home";
  if (skill.startsWith("locksmith.commercial")) return "business";
  return null;
}

// Intake situation chip suggested by a catalog skill code, when one fits.
export function situationForSkill(skill: string): string | null {
  if (skill.endsWith("_lockout")) return "locked_out";
  if (skill.endsWith("rekey")) return "rekey";
  if (skill.endsWith("broken_key")) return "broken_key";
  return null;
}

const clip = (value: string | null, max: number) => (value || "").trim().slice(0, max);

// Parses `location.hash`. Reading it has no side effects: nothing is created or
// fetched, and no value is copied into a request URL (FR-008/FR-011).
export function parseHandoff(hash: string): HandoffPrefill | null {
  if (!hash) return null;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const source = SOURCES.get(params.get("src") || "");
  if (!source) return null;
  const skill = params.get("skill") || "";
  const address = clip(params.get("address"), MAX_ADDRESS);
  const base = {
    source,
    accessType: accessTypeForSkill(skill),
    situation: situationForSkill(skill),
    address,
    notes: clip(params.get("notes"), MAX_NOTES)
  };
  if (COORDINATE_SOURCES.has(source)) {
    const latRaw = params.get("lat");
    const lngRaw = params.get("lng");
    if (!latRaw || !lngRaw) return null;
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const raw_text = address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return { ...base, address: raw_text, zip: null, locationConfidence: "coordinates", location: { raw_text, lat, lng, geocode_confidence: "high" } };
  }
  // Any lat/lng on other sources is ignored: their location is never trusted.
  const zipRaw = clip(params.get("zip"), 10);
  const zip = /^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(zipRaw) ? zipRaw : null;
  return { ...base, zip, locationConfidence: address ? "typed_unconfirmed" : zip ? "zip_hint" : "none", location: null };
}

// Address autocomplete/geocode send the text as a query string, so they may only
// run for text the customer typed or explicitly confirmed -- never for a
// handed-off address as-is.
export function shouldAutocomplete(address: string, typedByCustomer: boolean): boolean {
  return typedByCustomer && address.trim().length > 0;
}
