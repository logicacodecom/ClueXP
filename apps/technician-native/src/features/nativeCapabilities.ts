import * as Application from "expo-application";
import * as Device from "expo-device";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { CluexpApi } from "../api/client";

const INSTALLATION_ID_KEY = "cluexp.installationId";

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
  const token = await Notifications.getExpoPushTokenAsync();
  await api.registerDevice({
    platform: Platform.OS === "ios" ? "ios" : "android",
    push_token: token.data,
    environment: __DEV__ ? "development" : "production",
    app_version: Application.nativeApplicationVersion ?? "1.0.0",
    installation_id: await installationId()
  });
  return { ok: true };
}
