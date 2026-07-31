import type { AuthSession } from "../types";

const TOKEN_KEY = "cluexp.accessToken";
const REFRESH_KEY = "cluexp.refreshToken";
const SESSION_KEY = "cluexp.session";

export type StoredSession = {
  accessToken: string;
  refreshToken?: string | null;
  session: AuthSession;
};

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  const store = storage();
  if (!store) return null;
  const accessToken = store.getItem(TOKEN_KEY);
  const refreshToken = store.getItem(REFRESH_KEY);
  const sessionRaw = store.getItem(SESSION_KEY);
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
  const store = storage();
  if (!store) return;
  store.setItem(TOKEN_KEY, value.accessToken);
  if (value.refreshToken) {
    store.setItem(REFRESH_KEY, value.refreshToken);
  } else {
    store.removeItem(REFRESH_KEY);
  }
  store.setItem(SESSION_KEY, JSON.stringify(value.session));
}

export async function clearStoredSession() {
  const store = storage();
  if (!store) return;
  store.removeItem(TOKEN_KEY);
  store.removeItem(REFRESH_KEY);
  store.removeItem(SESSION_KEY);
}
