"use client";

import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../frame";

type RecoveryJob = {
  id: string;
  status: string;
  address: string | null;
  access_type: string | null;
  situation: string | null;
  urgency: string | null;
  fulfillment_technician_id: string | null;
  offer_active: boolean;
  offer_id: string | null;
  offer_expires_at?: string | null;
};

type Action = "cancel" | "release" | "no-show";

const ASSIGNED = new Set(["assigned", "en_route", "arrived", "in_progress"]);
const CANCELLABLE = new Set(["pending_dispatch", "assigned", "en_route", "arrived", "in_progress"]);
const NO_SHOW_OK = new Set(["assigned", "en_route", "arrived"]);

function availableActions(status: string): Action[] {
  const actions: Action[] = [];
  if (CANCELLABLE.has(status)) actions.push("cancel");
  if (ASSIGNED.has(status)) actions.push("release");
  if (NO_SHOW_OK.has(status)) actions.push("no-show");
  return actions;
}

const ACTION_LABEL: Record<Action, string> = {
  cancel: "Cancel job",
  release: "Release technician",
  "no-show": "Mark no-show",
};

function RecoveryWorkspace() {
  const [jobs, setJobs] = useState<RecoveryJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ jobId: string; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/provider/jobs", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load jobs (${res.status})`);
      setJobs(await res.json());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load jobs");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function submit() {
    if (!pending || reason.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/provider/jobs/${encodeURIComponent(pending.jobId)}/${pending.action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Action failed (${res.status})`);
      setPending(null);
      setReason("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recovery workspace</p>
          <h1 className="text-2xl font-bold">Active jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your company&apos;s active jobs. Recovery actions require a reason and are audited; releasing or cancelling revokes the technician&apos;s access.</p>
        </div>
        <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold" onClick={() => void load()}>Refresh</button>
      </div>

      {error ? <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      {jobs === null ? (
        <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">No active jobs.</div>
      ) : (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs font-semibold uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Technician</th>
                <th className="px-4 py-3">Offer</th>
                <th className="px-4 py-3">Recovery</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-mono text-xs">{job.id.slice(0, 8)}</td>
                  <td className="px-4 py-3"><span className="rounded-full border border-border px-2 py-0.5 text-xs">{job.status.replaceAll("_", " ")}</span></td>
                  <td className="px-4 py-3 text-muted-foreground">{job.address ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{job.fulfillment_technician_id ? job.fulfillment_technician_id.slice(0, 8) : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{job.offer_active ? "Offer active" : "—"}</td>
                  <td className="px-4 py-3">
                    {pending && pending.jobId === job.id ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold">{ACTION_LABEL[pending.action]} — reason required</p>
                        <input
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                          placeholder="Reason (required)"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold" onClick={() => { setPending(null); setReason(""); }}>Cancel</button>
                          <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50" disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>{busy ? "Working…" : "Confirm"}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {availableActions(job.status).map((action) => (
                          <button key={action} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold" onClick={() => { setPending({ jobId: job.id, action }); setReason(""); setError(null); }}>
                            {ACTION_LABEL[action]}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RecoveryPage() {
  return <AppFrame><RecoveryWorkspace /></AppFrame>;
}
