// react-native-web build: no notification channels, no alarm. The offer UI
// still renders; only the sound/vibration side is native-only.
export const OFFER_CHANNEL_ID = "job-offers-v2";
export const OFFER_SOUND = "offer_alarm.wav";
export const DEFAULT_CHANNEL_ID = "job-alerts";

export async function ensureNotificationChannels() {
  return { ok: false, created: false };
}

export function startOfferAlarm() {}

export function stopOfferAlarm() {}

export function isOfferAlarmRinging() {
  return false;
}

export function isOfferPush(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : typeof record.type === "string" ? record.type : "";
  return kind === "offer" || kind === "job_offer";
}

export function shouldAlarm(state: {
  activeOfferId: string | null;
  appActive: boolean;
  silencedOfferId: string | null;
}): boolean {
  if (!state.activeOfferId || !state.appActive) return false;
  return state.silencedOfferId !== state.activeOfferId;
}
