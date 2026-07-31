import type { StoredSession } from "../storage/sessionStore";

type LogoutApi = {
  logout: (refreshToken: string) => Promise<unknown>;
};

type LogoutDependencies = {
  api: LogoutApi;
  loadStoredSession: () => Promise<StoredSession | null>;
  clearStoredSession: () => Promise<void>;
  wipeOutbox: () => Promise<void>;
  afterLocalClear?: () => void | Promise<void>;
};

export async function logoutStoredSession({
  api,
  loadStoredSession,
  clearStoredSession,
  wipeOutbox,
  afterLocalClear
}: LogoutDependencies) {
  const stored = await loadStoredSession();
  if (stored?.refreshToken) {
    try {
      await api.logout(stored.refreshToken);
    } catch {
      // Local logout must win even when the network is unavailable.
    }
  }
  await clearStoredSession();
  await wipeOutbox();
  await afterLocalClear?.();
}
