// AI-assistant handoff (specs/003 FR-008/FR-010/FR-011). Pure functions only,
// so they can be tested without a browser (`scripts/ai-handoff.test.mjs`).

export type AiPrefill = {
  // "vehicle" | "home" | "business", or null when the skill has no intake bucket.
  accessType: string | null;
  location: { raw_text: string; lat: number; lng: number; geocode_confidence: string };
};

// Mirrors the API's `_access_type_for_skill` bucketing of catalog skill codes.
export function accessTypeForSkill(skill: string): string | null {
  if (skill.startsWith("locksmith.vehicle") || skill.startsWith("locksmith.key_programming")) return "vehicle";
  if (skill.startsWith("locksmith.residential")) return "home";
  if (skill.startsWith("locksmith.commercial")) return "business";
  return null;
}

// Parses `location.hash`. Reading it has no side effects: nothing is created or
// fetched, and the address is never copied into a request URL (FR-008/FR-011).
export function parseAiPrefill(hash: string): AiPrefill | null {
  if (!hash) return null;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (params.get("src") !== "ai_assistant") return null;
  const latRaw = params.get("lat");
  const lngRaw = params.get("lng");
  if (!latRaw || !lngRaw) return null;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const address = (params.get("address") || "").slice(0, 300);
  return {
    accessType: accessTypeForSkill(params.get("skill") || ""),
    location: { raw_text: address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng, geocode_confidence: "high" }
  };
}

// Address autocomplete sends the typed text as a query string, so it may only
// run for text the customer typed themselves -- never for a handed-off address.
export function shouldAutocomplete(address: string, typedByCustomer: boolean): boolean {
  return typedByCustomer && address.trim().length > 0;
}
