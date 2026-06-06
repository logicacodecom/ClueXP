"use client";

import type { AuthSession } from "@cluexp/api-client";
import { useCallback, useEffect, useState } from "react";

export interface SessionResponse {
  session: AuthSession;
}

export async function sessionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.detail || `Request failed: ${response.status}`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body as T;
}

export function useSession() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await sessionRequest<SessionResponse>("/api/session");
      setSession(response.session);
      return response.session;
    } catch (cause) {
      setSession(null);
      const status = (cause as Error & { status?: number }).status;
      if (status !== 401) setError(cause instanceof Error ? cause.message : "Unable to load session");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
    setSession(null);
  }, []);

  return { error, loading, refresh, session, signOut };
}
