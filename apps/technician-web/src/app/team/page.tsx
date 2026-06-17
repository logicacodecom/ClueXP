"use client";

import { AppFrame, EmptyState, Screen, Section, icons } from "@/components/mobile";
import { CheckCircle2, ChevronRight, Clock3, RefreshCw, ShieldAlert, UserPlus, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface TechnicianAffiliation {
  id: string;
  organization_id: string;
  organization_name?: string;
  status: "pending_invite" | "active" | "suspended" | "ended" | "rejected";
  affiliation_type?: string;
  exclusivity?: string;
  dispatch_allowed?: boolean;
  starts_at?: string;
  ended_at?: string | null;
  ended_reason?: string | null;
}

interface Organization {
  id: string;
  name: string;
  status: string;
}

export default function TeamPage() {
  const [affiliations, setAffiliations] = useState<TechnicianAffiliation[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [backendReady, setBackendReady] = useState(true);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  const loadAffiliations = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/affiliations", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/signin"); return; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Could not load affiliations");
      setAffiliations(Array.isArray(body.affiliations) ? body.affiliations : []);
      setOrganizations(Array.isArray(body.organizations) ? body.organizations : []);
      setBackendReady(body.backend_ready !== false);
      setMessage(body.detail || null);
      setState("ready");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not load affiliations");
      setState("error");
    }
  }, []);

  useEffect(() => { void loadAffiliations(); }, [loadAffiliations]);

  const handleAccept = useCallback(async (affiliationId: string) => {
    setLoadingIds(prev => new Set(prev).add(affiliationId));
    try {
      const response = await fetch(`/api/affiliations/${affiliationId}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Failed to accept affiliation");
      await loadAffiliations();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Failed to accept affiliation");
    } finally {
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(affiliationId);
        return next;
      });
    }
  }, [loadAffiliations]);

  const handleDecline = useCallback(async (affiliationId: string) => {
    if (!confirm("Are you sure you want to decline this invitation?")) return;

    setLoadingIds(prev => new Set(prev).add(affiliationId));
    try {
      const response = await fetch(`/api/affiliations/${affiliationId}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Failed to decline affiliation");
      await loadAffiliations();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Failed to decline affiliation");
    } finally {
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(affiliationId);
        return next;
      });
    }
  }, [loadAffiliations]);

  const pendingInvites = affiliations.filter((a) => a.status === "pending_invite");
  const activeAffiliations = affiliations.filter((a) => a.status === "active");
  const endedAffiliations = affiliations.filter((a) => a.status === "ended" || a.status === "suspended" || a.status === "rejected");

  const getOrganizationName = (orgId: string) => {
    const org = organizations.find((o) => o.id === orgId);
    return org?.name || `Organization ${orgId.slice(0, 8)}...`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending_invite":
        return <div className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-bold text-yellow-800"><Clock3 className="size-3" />Pending</div>;
      case "active":
        return <div className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800"><CheckCircle2 className="size-3" />Active</div>;
      case "suspended":
        return <div className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800"><ShieldAlert className="size-3" />Suspended</div>;
      case "rejected":
        return <div className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-800"><XCircle className="size-3" />Rejected</div>;
      case "ended":
        return <div className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-800"><XCircle className="size-3" />Ended</div>;
      default:
        return <div className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-800">{status}</div>;
    }
  };

  return (
    <AppFrame title="Provider Network">
      <Screen>
        <header className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[.12em] text-primary">Provider network</div>
            <h1 className="mt-1 font-condensed text-4xl font-bold uppercase leading-none">Team</h1>
            <p className="mt-2 text-sm leading-5 text-muted">Provider affiliations, pending invites, and work history.</p>
          </div>
          <button className="touch-target flex size-10 items-center justify-center rounded-full border border-border bg-card" onClick={() => void loadAffiliations()} aria-label="Refresh affiliations">
            <RefreshCw className={`size-4 ${state === "loading" ? "animate-spin" : ""}`} />
          </button>
        </header>

        {!backendReady ? (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm text-muted">
            {message || "Affiliation invite actions are waiting on the backend contract. This screen is ready to connect when Slice B exposes the technician endpoints."}
          </div>
        ) : null}

        {state === "error" ? (
          <div className="mb-4 rounded-xl border border-danger/35 bg-danger/10 p-3 text-sm text-danger">
            {message}
          </div>
        ) : null}

        <Section title="Overview">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-card p-3 text-center">
              <div className="text-2xl font-black">{pendingInvites.length}</div>
              <div className="text-[10px] font-bold uppercase text-muted">Pending</div>
            </div>
            <div className="rounded-xl bg-card p-3 text-center">
              <div className="text-2xl font-black">{activeAffiliations.length}</div>
              <div className="text-[10px] font-bold uppercase text-muted">Active</div>
            </div>
            <div className="rounded-xl bg-card p-3 text-center">
              <div className="text-2xl font-black">{endedAffiliations.length}</div>
              <div className="text-[10px] font-bold uppercase text-muted">History</div>
            </div>
          </div>
        </Section>

        {pendingInvites.length > 0 && (
          <Section title="Pending invites">
            <div className="space-y-2">
              {pendingInvites.map((affiliation) => {
                const isLoading = loadingIds.has(affiliation.id);
                return (
                  <div key={affiliation.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold">{getOrganizationName(affiliation.organization_id)}</h3>
                          {getStatusBadge(affiliation.status)}
                        </div>
                        {affiliation.affiliation_type && (
                          <p className="mt-1 text-sm text-muted">
                            {affiliation.affiliation_type.toUpperCase().replace("_", " ")} • {affiliation.exclusivity?.replace("_", " ") || "non-exclusive"}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleAccept(affiliation.id)}
                          disabled={isLoading}
                          className={`flex size-8 items-center justify-center rounded-full text-white transition-opacity ${isLoading ? "opacity-50" : "hover:bg-green-600"}`}
                          aria-label="Accept invite"
                        >
                          {isLoading ? <RefreshCw className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDecline(affiliation.id)}
                          disabled={isLoading}
                          className={`flex size-8 items-center justify-center rounded-full bg-red-100 text-red-700 transition-opacity ${isLoading ? "opacity-50" : "hover:bg-red-200"}`}
                          aria-label="Decline invite"
                        >
                          {isLoading ? <RefreshCw className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {activeAffiliations.length > 0 && (
          <Section title="Active affiliations">
            <div className="space-y-2">
              {activeAffiliations.map((affiliation) => (
                <div key={affiliation.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-bold">{getOrganizationName(affiliation.organization_id)}</h3>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {getStatusBadge(affiliation.status)}
                        {affiliation.affiliation_type && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-700">
                            {affiliation.affiliation_type.toUpperCase().replace("_", " ")}
                          </span>
                        )}
                        {affiliation.exclusivity && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-700">
                            {affiliation.exclusivity.replace("_", " ")}
                          </span>
                        )}
                        {affiliation.dispatch_allowed ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">Dispatch allowed</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-700">Not dispatchable</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="size-5 text-muted" />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {endedAffiliations.length > 0 && (
          <Section title="Past affiliations">
            <div className="space-y-2">
              {endedAffiliations.map((affiliation) => (
                <div key={affiliation.id} className="rounded-xl border border-border bg-card p-4 opacity-75">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-bold">{getOrganizationName(affiliation.organization_id)}</h3>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {getStatusBadge(affiliation.status)}
                        {affiliation.ended_reason && (
                          <p className="mt-1 text-sm text-muted">{affiliation.ended_reason}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {state === "loading" ? (
          <p className="py-10 text-center text-sm text-muted">Loading affiliations…</p>
        ) : affiliations.length === 0 && (
          <div className="mt-8">
            <EmptyState
              title="No provider affiliations"
              icon={UserPlus}
              text="You are not yet affiliated with any provider companies. When you accept an invitation, it will appear here."
            />
          </div>
        )}
      </Screen>
    </AppFrame>
  );
}
