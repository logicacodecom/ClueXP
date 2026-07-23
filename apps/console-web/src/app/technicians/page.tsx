"use client";

import { Badge, Button, DataTable, EmptyState, Input, PageHeader, StatCard } from "@cluexp/console-ui";
import { Check, Edit, PauseCircle, Plus, RotateCcw, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";
import { GovernanceActionDialog } from "../governance-action-dialog";

type AffiliationState = "affiliated" | "invited" | "unaffiliated";

interface TechnicianRow {
  id: string;
  display_name: string;
  status: string;
  vetting_status: string;
  provider_type: string;
  // Affiliation-derived, not primary_organization_id — see list_technicians_admin.
  organization_name?: string | null;
  affiliation_state?: AffiliationState;
  created_at?: string | null;
}

const STATUSES = ["all", "pending_vetting", "active", "suspended", "rejected", "archived"] as const;
// A separate axis from lifecycle status — a technician can be active and
// unaffiliated at the same time, so these cannot share one control.
const AFFILIATIONS = ["all", "affiliated", "invited", "unaffiliated"] as const;

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "pending_vetting") return "warn" as const;
  if (status === "suspended" || status === "rejected" || status === "archived") return "danger" as const;
  return "neutral" as const;
}

// "Invited" is deliberately not "affiliated": an open pending_invite is not yet
// dispatchable, but the technician is no longer independent either.
function affiliationVariant(state: AffiliationState) {
  if (state === "affiliated") return "success" as const;
  if (state === "invited") return "warn" as const;
  return "neutral" as const;
}

function filterButtonClass(selected: boolean) {
  return `min-h-10 rounded-md border px-3 py-1.5 text-xs font-medium capitalize ${selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`;
}

function pastTense(action: string) {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  if (action === "suspend") return "suspended";
  return "reactivated";
}

export default function TechniciansPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [affiliation, setAffiliation] = useState<(typeof AFFILIATIONS)[number]>("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<TechnicianRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/technicians", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to load technicians");
      setRows(body.technicians ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load technicians");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runAction(row: TechnicianRow, action: "approve" | "reject" | "suspend" | "reactivate", reason = "") {
    const verb = action === "reactivate" ? "activate" : action;
    setBusy(`${row.id}:${action}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/technicians/${encodeURIComponent(row.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${verb} technician`);
      await refresh();
      setMessage(`${row.display_name} ${pastTense(action)}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${verb} technician`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrArchive(row: TechnicianRow, reason: string) {
    setBusy(`${row.id}:delete`);
    setMessage(null);
    try {
      const response = await fetch(`/api/technicians/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to delete or archive technician");
      await refresh();
      setMessage(body.action === "deleted" ? `${row.display_name} deleted.` : `${row.display_name} archived because linked records exist.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to delete or archive technician");
    } finally {
      setBusy(null);
    }
  }

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      const state = row.affiliation_state ?? "unaffiliated";
      const statusMatch = status === "all" || row.status === status || row.vetting_status === status;
      const affiliationMatch = affiliation === "all" || state === affiliation;
      const queryMatch = !normalized || [
        row.display_name,
        row.provider_type,
        row.organization_name,
        state,
        row.status,
        row.vetting_status,
        row.id
      ].some((value) => String(value || "").toLowerCase().includes(normalized));
      return statusMatch && affiliationMatch && queryMatch;
    });
  }, [affiliation, query, rows, status]);

  const active = rows.filter((r) => r.status === "active").length;
  const pending = rows.filter((r) => r.status === "pending_vetting" || r.vetting_status === "unverified").length;
  const suspended = rows.filter((r) => r.status === "suspended").length;

  return (
    <AppFrame>
      <PageHeader
        kicker="Network"
        title="Technicians"
        description="Technician eligibility, company affiliation, and vetting actions."
        actions={<Button asChild><Link href="/technicians/new"><Plus className="size-4" />Add technician</Link></Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={UserRound} label="Total" value={String(rows.length)} />
        <StatCard icon={UserRound} label="Active" value={String(active)} />
        <StatCard icon={UserRound} intent={pending ? "warn" : "success"} label="Need vetting" value={String(pending)} />
        <StatCard icon={UserRound} intent={suspended ? "danger" : "neutral"} label="Suspended" value={String(suspended)} />
      </div>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,420px)_1fr]">
        <Input aria-label="Search technicians" placeholder="Search technician, company, status, skill, or ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</span>
          {STATUSES.map((option) => (
            <button
              className={filterButtonClass(status === option)}
              key={option}
              onClick={() => setStatus(option)}
              type="button"
            >
              {option.replaceAll("_", " ")}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Affiliation</span>
        {AFFILIATIONS.map((option) => (
          <button
            className={filterButtonClass(affiliation === option)}
            key={option}
            onClick={() => setAffiliation(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      {message ? <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
      {!loading && visibleRows.length === 0 ? (
        <EmptyState icon={UserRound} title="No technicians match" description="Adjust the status or affiliation filter, or the search term." />
      ) : (
        <DataTable
          columns={["Technician", "Provider type", "Company", "Affiliation", "Status", "Vetting", "Created", "Actions"]}
          rows={visibleRows.map((row) => [
            <Link className="font-medium text-foreground hover:text-primary" href={`/technicians/${row.id}`} key={`${row.id}-name`}>{row.display_name}</Link>,
            row.provider_type.replaceAll("_", " "),
            row.organization_name || "Independent",
            <Badge key={`${row.id}-affiliation`} variant={affiliationVariant(row.affiliation_state ?? "unaffiliated")}>{row.affiliation_state ?? "unaffiliated"}</Badge>,
            <Badge key={`${row.id}-status`} variant={statusVariant(row.status)}>{row.status.replaceAll("_", " ")}</Badge>,
            row.vetting_status.replaceAll("_", " "),
            row.created_at ? new Date(row.created_at).toLocaleDateString() : "-",
            <div className="flex items-center gap-2" key={`${row.id}-actions`}>
              <Button aria-label={`Edit ${row.display_name}`} asChild className="size-11" size="icon" title="Edit" variant="outline">
                <Link href={`/technicians/${row.id}`}><Edit className="size-4" /></Link>
              </Button>
              {row.status === "pending_vetting" || row.vetting_status === "unverified" ? <>
                <GovernanceActionDialog confirmLabel="Approve technician" description={`Approve ${row.display_name} for production dispatch eligibility.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "approve", reason)} title={`Approve ${row.display_name}?`}>
                  <Button aria-label={`Approve ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Approve" variant="success"><Check className="size-4" /></Button>
                </GovernanceActionDialog>
                <GovernanceActionDialog confirmLabel="Reject technician" description={`Reject ${row.display_name}. This blocks dispatch eligibility until reactivated.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "reject", reason)} reasonRequired title={`Reject ${row.display_name}?`} variant="destructive">
                  <Button aria-label={`Reject ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Reject" variant="outline"><X className="size-4" /></Button>
                </GovernanceActionDialog>
              </> : null}
              {row.status === "active" ? (
                <GovernanceActionDialog confirmLabel="Suspend technician" description={`Suspend ${row.display_name}. They will no longer be available for dispatch.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "suspend", reason)} reasonRequired title={`Suspend ${row.display_name}?`} variant="destructive">
                  <Button aria-label={`Suspend ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Suspend" variant="destructive"><PauseCircle className="size-4" /></Button>
                </GovernanceActionDialog>
              ) : null}
              {row.status === "suspended" || row.status === "rejected" || row.status === "archived" ? (
                <GovernanceActionDialog confirmLabel="Activate technician" description={`Reactivate ${row.display_name} for production dispatch eligibility.`} disabled={busy !== null} onConfirm={(reason) => runAction(row, "reactivate", reason)} title={`Activate ${row.display_name}?`}>
                  <Button aria-label={`Activate ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Activate" variant="success"><RotateCcw className="size-4" /></Button>
                </GovernanceActionDialog>
              ) : null}
              <GovernanceActionDialog confirmLabel="Delete or archive" description={`If ${row.display_name} has no linked records, they will be deleted. If linked records exist, they will be archived instead.`} disabled={busy !== null} onConfirm={(reason) => deleteOrArchive(row, reason)} reasonRequired title={`Delete or archive ${row.display_name}?`} variant="destructive">
                <Button aria-label={`Delete ${row.display_name}`} className="size-11" disabled={busy !== null} size="icon" title="Delete" variant="outline"><Trash2 className="size-4" /></Button>
              </GovernanceActionDialog>
            </div>
          ])}
        />
      )}
    </AppFrame>
  );
}
