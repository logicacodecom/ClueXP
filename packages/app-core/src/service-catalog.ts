"use client";

import { DEFAULT_SERVICE_CATALOG, type ServiceCategory } from "@cluexp/api-client";
import { useEffect, useState } from "react";

export function useServiceCatalog(path = "/api/service-catalog") {
  const [catalog, setCatalog] = useState<ServiceCategory[]>(DEFAULT_SERVICE_CATALOG);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(path, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.detail || "Unable to load service catalog");
        if (!cancelled) setCatalog(body.categories ?? DEFAULT_SERVICE_CATALOG);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load service catalog");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { catalog, error, loading };
}
