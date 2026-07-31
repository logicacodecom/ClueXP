import * as SecureStore from "expo-secure-store";
import type { AuthSession } from "../types";

const TOKEN_KEY = "cluexp.accessToken";
const REFRESH_KEY = "cluexp.refreshToken";
const SESSION_KEY = "cluexp.session";

export type StoredSession = {
  accessToken: string;
  refreshToken?: string | null;
  session: AuthSession;
};

export async function loadStoredSession(): Promise<StoredSession | null> {
  const [accessToken, refreshToken, sessionRaw] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
    SecureStore.getItemAsync(SESSION_KEY)
  ]);
  if (!accessToken || !sessionRaw) return null;
  try {
    return {
      accessToken,
      refreshToken,
      session: JSON.parse(sessionRaw) as AuthSession
    };
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function saveStoredSession(value: StoredSession) {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, value.accessToken),
    value.refreshToken
      ? SecureStore.setItemAsync(REFRESH_KEY, value.refreshToken)
      : SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(value.session))
  ]);
}

export async function clearStoredSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(SESSION_KEY)
  ]);
}
