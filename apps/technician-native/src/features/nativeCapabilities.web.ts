import type { CluexpApi } from "../api/client";

const INSTALLATION_ID_KEY = "cluexp.installationId";

function makeLocalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `inst_${crypto.randomUUID()}`;
  }
  return `inst_${Date.now().toString(36)}`;
}

export async function installationId() {
  if (typeof window === "undefined") return makeLocalId();
  const existing = window.localStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const created = makeLocalId();
  window.localStorage.setItem(INSTALLATION_ID_KEY, created);
  return created;
}

export async function requestAndSendLocation(_api: CluexpApi) {
  return { ok: false, reason: "native_location_required" };
}

export async function registerPushDevice(_api: CluexpApi) {
  return { ok: false, reason: "native_push_required" };
}
