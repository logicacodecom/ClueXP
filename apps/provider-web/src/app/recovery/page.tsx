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

type Note = { id: string; author_name: string | null; body: string; created_at: string | null };

type Action = "cancel" | "release" | "no-show" | "recall-offer" | "resolve";

const ASSIGNED = new Set(["assigned", "en_route", "arrived", "in_progress"]);
const CANCELLABLE = new Set(["pending_dispatch", "assigned", "en_route", "arrived", "in_progress"]);
const NO_SHOW_OK = new Set(["assigned", "en_route", "arrived"]);

function availableActions(job: RecoveryJob): Action[] {
  const actions: Action[] = [];
  if (CANCELLABLE.has(job.status)) actions.push("cancel");
  if (ASSIGNED.has(job.status)) actions.push("release");
  if (NO_SHOW_OK.has(job.status)) actions.push("no-show");
  if (job.status === "pending_dispatch" && job.offer_active) actions.push("recall-offer");
  if (job.status === "disputed") actions.push("resolve");
  return actions;
}

const ACTION_LABEL: Record<Action, string> = {
  cancel: "Cancel job",
  release: "Release technician",
  "no-show": "Mark no-show",
  "recall-offer": "Recall offer",
  resolve: "Resolve dispute",
};

function RecoveryWorkspace() {
  const [jobs, setJobs] = useState<RecoveryJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ jobId: string; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");

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
      // Dispute resolution forwards to the resolve endpoint with an action + note;
      // every other action takes a reason.
      const path = pending.action === "resolve" ? "resolve" : pending.action;
      const payload = pending.action === "resolve"
        ? { action: "close", note: reason.trim() }
        : { reason: reason.trim() };
      const res = await fetch(`/api/provider/jobs/${encodeURIComponent(pending.jobId)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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

  async function openNotes(jobId: string) {
    if (notesFor === jobId) { setNotesFor(null); return; }
    setNotesFor(jobId);
    setNotes([]);
    setNewNote("");
    try {
      const res = await fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/notes`, { cache: "no-store" });
      if (res.ok) setNotes(await res.json());
    } catch { /* surfaced on add */ }
  }

  async function addNote(jobId: string) {
    if (newNote.trim().length < 1 || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/provider/jobs/${encodeURIComponent(jobId)}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: newNote.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Could not add note (${res.status})`);
      setNotes((current) => [...current, body as Note]);
      setNewNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add note");
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
          <p className="mt-1 text-sm text-muted-foreground">Your company&apos;s active jobs. Recovery actions require a reason and are audited; releasing or cancelling revokes the technician&apos;s access. Notes are internal — never shown to customers or technicians.</p>
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
                        {availableActions(job).map((action) => (
                          <button key={action} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold" onClick={() => { setPending({ jobId: job.id, action }); setReason(""); setError(null); }}>
                            {ACTION_LABEL[action]}
                          </button>
                        ))}
                        <button className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground" onClick={() => void openNotes(job.id)}>
                          {notesFor === job.id ? "Hide notes" : "Notes"}
                        </button>
                      </div>
                    )}
                    {notesFor === job.id ? (
                      <div className="mt-3 rounded-md border border-border bg-card p-3">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Internal notes</p>
                        <ul className="mt-2 space-y-1">
                          {notes.length === 0 ? <li className="text-xs text-muted-foreground">No notes yet.</li> : notes.map((n) => (
                            <li key={n.id} className="text-xs"><span className="font-semibold">{n.author_name ?? "Dispatcher"}</span> <span className="text-muted-foreground">{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</span><br />{n.body}</li>
                          ))}
                        </ul>
                        <div className="mt-2 flex gap-2">
                          <input className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs" placeholder="Add an internal note" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
                          <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50" disabled={busy || newNote.trim().length < 1} onClick={() => void addNote(job.id)}>Add</button>
                        </div>
                      </div>
                    ) : null}
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
