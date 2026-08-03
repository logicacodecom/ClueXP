import * as Notifications from "expo-notifications";
import { Platform, Vibration } from "react-native";

// Ride-hail-style incoming-offer alert.
//
// OS reality: neither iOS nor Android lets a remote push ring endlessly while
// the app is backgrounded or killed — that needs CallKit / Apple's critical
// alert entitlement, which ClueXP does not have. So this module does two things:
//   * background: register the strongest ALLOWED channel (MAX importance,
//     sound + vibration) so the offer push is as loud as the OS permits;
//   * foreground / opened-from-notification: run a real looping alarm until the
//     offer is accepted, declined, expires, or is silenced.

export const OFFER_CHANNEL_ID = "job-offers";
export const DEFAULT_CHANNEL_ID = "job-alerts";

// Matches the backend's push data payload (api/push.py _push_data).
const ALARM_SOURCE = require("../../assets/offer-alarm.wav");

// Roughly the alarm loop length; each pass is one buzz so the phone keeps
// pulsing in time with the tone. `true` repeats until we cancel.
const VIBRATION_PATTERN = [0, 600, 400];

type AudioPlayerLike = {
  loop: boolean;
  volume: number;
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  remove: () => void;
};

type AudioModule = {
  createAudioPlayer: (source: unknown) => AudioPlayerLike;
  setAudioModeAsync?: (mode: Record<string, unknown>) => Promise<void>;
};

// Lazily resolved: a build whose native side predates expo-audio must still
// vibrate and show the offer UI rather than crash on import.
let audioModule: AudioModule | null | undefined;
let player: AudioPlayerLike | null = null;
let ringing = false;

function loadAudio(): AudioModule | null {
  if (audioModule === undefined) {
    try {
      audioModule = require("expo-audio") as AudioModule;
    } catch {
      audioModule = null;
    }
  }
  return audioModule;
}

/**
 * Android notification channels. Offers get their own MAX-importance channel so
 * they arrive with sound + vibration even when the quieter ops channel is muted;
 * everything else stays on `job-alerts`. Safe to call repeatedly — creating an
 * existing channel is a no-op, and the user's own channel settings always win.
 */
export async function ensureNotificationChannels() {
  if (Platform.OS !== "android") return { ok: true, created: false };
  try {
    await Notifications.setNotificationChannelAsync(OFFER_CHANNEL_ID, {
      name: "Job offers",
      description: "Incoming job offers. Time-critical — keep this channel loud.",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 400, 200, 400],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false
    });
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
      name: "Job updates",
      description: "Messages and updates about your current job.",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      enableVibrate: true
    });
    return { ok: true, created: true };
  } catch {
    return { ok: false, created: false };
  }
}

/** Start (or keep) the looping offer alarm. Idempotent. */
export function startOfferAlarm() {
  if (ringing) return;
  ringing = true;
  Vibration.vibrate(VIBRATION_PATTERN, true);
  const audio = loadAudio();
  if (!audio) return; // vibration-only fallback
  try {
    // Ring through the silent switch: an expiring offer is the whole job.
    void audio.setAudioModeAsync?.({ playsInSilentMode: true, shouldPlayInBackground: false });
    if (!player) {
      player = audio.createAudioPlayer(ALARM_SOURCE);
      player.loop = true;
      player.volume = 1;
    }
    void player.seekTo(0); // a re-alert starts on the beat, not mid-loop
    player.play();
  } catch {
    // Audio unavailable on this build/device — the vibration and the
    // full-screen UI still carry the alert.
  }
}

/** Stop the alarm. Idempotent; safe to call when it was never started. */
export function stopOfferAlarm() {
  ringing = false;
  Vibration.cancel();
  try {
    player?.pause();
  } catch {
    // already gone
  }
}

export function isOfferAlarmRinging() {
  return ringing;
}

/** True when a push payload is the urgent incoming-offer kind (api/push.py). */
export function isOfferPush(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : typeof record.type === "string" ? record.type : "";
  return kind === "offer" || kind === "job_offer";
}

/**
 * Whether the phone should be ringing right now. Deliberately driven by the
 * server's live offer, never by the push that announced it: an accepted,
 * declined or expired offer has already left `offers`, so the alarm stops with
 * it. Backgrounded means silent — the OS owns the notification at that point.
 */
export function shouldAlarm(state: {
  activeOfferId: string | null;
  appActive: boolean;
  silencedOfferId: string | null;
}): boolean {
  if (!state.activeOfferId || !state.appActive) return false;
  return state.silencedOfferId !== state.activeOfferId;
}
