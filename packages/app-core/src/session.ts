"use client";

import type { AuthSession } from "@cluexp/api-client";
import { useCallback, useEffect, useState } from "react";

export interface SessionResponse {
  session: AuthSession;
}

interface BackendSession {
  user?: {
    id?: string;
    display_name?: string;
    email?: string | null;
    phone?: string | null;
    locale?: "en" | "es" | null;
  };
  roles?: AuthSession["active_role"][];
  active_organization_id?: string | null;
  organization_name?: string | null;
  technician?: AuthSession["technician"];
}

export function normalizeAuthSession(raw: BackendSession): AuthSession {
  const roles = raw.roles ?? [];
  const activeRole =
    roles.find((role) => role === "platform_admin") ??
    roles.find((role) => role === "provider_admin" || role === "dispatcher") ??
    roles.find((role) => role === "technician") ??
    roles[0] ??
    "customer";
  const surface: AuthSession["surface"] =
    activeRole === "platform_admin" ? "platform" :
    activeRole === "provider_admin" || activeRole === "dispatcher" ? "provider" :
    activeRole === "technician" ? "technician" : "customer";
  return {
    active_role: activeRole,
    active_organization_id: raw.active_organization_id ?? undefined,
    organization_name: raw.organization_name ?? undefined,
    surface,
    technician: raw.technician,
    user: {
      id: raw.user?.id ?? "",
      display_name: raw.user?.display_name ?? "ClueXP user",
      email: raw.user?.email ?? undefined,
      phone: raw.user?.phone ?? undefined,
      locale: raw.user?.locale ?? undefined,
      organization_ids: raw.active_organization_id ? [raw.active_organization_id] : [],
      roles,
      status: "active",
      technician_id: raw.technician?.id
    }
  };
}

export async function sessionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    // Never serve auth state from cache — a stale /api/session read is what made a
    // just-logged-in user bounce back to the sign-in screen.
    cache: "no-store",
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
      const response = await sessionRequest<{ session: BackendSession }>("/api/session");
      const normalized = normalizeAuthSession(response.session);
      setSession(normalized);
      return normalized;
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
