import * as Application from "expo-application";
import * as Device from "expo-device";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { CluexpApi, ApiError } from "../api/client";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "../storage/sessionStore";
import type { LoginResponse } from "../types";

const INSTALLATION_ID_KEY = "cluexp.installationId";
const EAS_PROJECT_ID = "10a489e5-0ee3-4ea8-9ee8-5ee8044ead22";
const BACKGROUND_LOCATION_TASK = "cluexp.backgroundLocation";

async function apiForStoredSession() {
  const stored = await loadStoredSession();
  if (!stored) return null;
  const backgroundApi = new CluexpApi(null);
  backgroundApi.setSessionTokens(stored.accessToken, stored.refreshToken);
  backgroundApi.configureSessionHandlers({
    onRefresh: async (result: LoginResponse) => {
      backgroundApi.setSessionTokens(result.access_token, result.refresh_token);
      await saveStoredSession({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        session: result.session
      });
    },
    onRefreshFailed: async () => {
      backgroundApi.setSessionTokens(null, null);
      await clearStoredSession();
      await stopBackgroundLocation();
    }
  });
  return backgroundApi;
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  const latest = locations[locations.length - 1];
  if (!latest) return;
  const backgroundApi = await apiForStoredSession();
  if (!backgroundApi) {
    await stopBackgroundLocation();
    return;
  }
  try {
    await backgroundApi.updateLocation(latest.coords.latitude, latest.coords.longitude);
  } catch (cause) {
    if (cause instanceof ApiError && cause.problem.status === 401) {
      await clearStoredSession();
      await stopBackgroundLocation();
    }
  }
});

function makeLocalId() {
  return `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function installationId() {
  const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const created = makeLocalId();
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, created);
  return created;
}

export async function requestAndSendLocation(api: CluexpApi) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    return { ok: false, reason: "location_permission_denied" };
  }
  const fix = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High
  });
  const saved = await api.updateLocation(fix.coords.latitude, fix.coords.longitude);
  return {
    ok: true,
    accuracy: fix.coords.accuracy,
    savedAt: saved.last_location_at ?? new Date().toISOString()
  };
}

export async function ensureBackgroundLocation() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    return { ok: false, reason: "location_permission_denied" };
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") {
    return { ok: false, reason: "background_location_permission_denied" };
  }
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (!alreadyStarted) {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      activityType: Location.ActivityType.AutomotiveNavigation,
      deferredUpdatesDistance: 250,
      deferredUpdatesInterval: 2 * 60 * 1000,
      distanceInterval: 100,
      foregroundService: {
        notificationTitle: "ClueXP location is active",
        notificationBody: "Sharing location while you are signed in. Sign out to stop.",
        notificationColor: "#FFBF00"
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      timeInterval: 60_000
    });
  }
  return { ok: true, started: !alreadyStarted };
}

export async function stopBackgroundLocation() {
  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (started) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  return { ok: true, stopped: started };
}

export async function registerPushDevice(api: CluexpApi) {
  if (!Device.isDevice) {
    return { ok: false, reason: "physical_device_required" };
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted
    ? current
    : await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true
      }
    });
  if (!granted.granted) {
    return { ok: false, reason: "notification_permission_denied" };
  }
  let token: Notifications.ExpoPushToken;
  try {
    token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (Platform.OS === "android" && /Firebase|googleServicesFile|Default FirebaseApp|FCM/i.test(message)) {
      return { ok: false, reason: "android_fcm_not_configured" };
    }
    return { ok: false, reason: "push_token_unavailable" };
  }
  await api.registerDevice({
    platform: Platform.OS === "ios" ? "ios" : "android",
    push_token: token.data,
    environment: __DEV__ ? "development" : "production",
    app_version: Application.nativeApplicationVersion ?? "1.0.0",
    installation_id: await installationId()
  });
  return { ok: true };
}
