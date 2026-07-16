"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  skillLabel
} from "@cluexp/console-ui";
import { BriefcaseBusiness, CheckCircle2, Plus, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";
import { ProviderActionDialog } from "../provider-action-dialog";

interface Team {
  id: string;
  parent_team_id?: string | null;
  name: string;
  description?: string | null;
  status: string;
  member_count: number;
}
interface Affiliation {
  status?: string;
  affiliation_type?: string;
  exclusivity?: string;
  dispatch_allowed?: boolean;
  is_pending_invite?: boolean;
}
interface Technician {
  id: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  status?: string;
  global_status?: string;
  vetting_status: string;
  team_ids: string[];
  skills: string[];
  affiliation?: Affiliation;
  photo_status?: string;
}
interface Workspace { teams: Team[]; technicians: Technician[]; }

export default function TeamsPage() {
  const [workspace, setWorkspace] = useState<Workspace>({ teams: [], technicians: [] });
  const [teamForm, setTeamForm] = useState({ name: "", description: "", parent_team_id: "" });
  const [manageTeamId, setManageTeamId] = useState("");
  const [addTechId, setAddTechId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || "Unable to load workspace");
    setWorkspace({ teams: body.teams ?? [], technicians: body.technicians ?? [] });
  }, []);

  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [refresh]);

  async function submit(path: string, payload: unknown, done: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = String(body.detail || "Unable to save");
        if (detail === "exclusive_conflict" || detail.includes("exclusive")) {
          throw new Error("Technician already has an exclusive active affiliation with another provider.");
        }
        throw new Error(detail);
      }
      done();
      await refresh();
      setMessage("Saved.");
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : "Unable to save";
      setMessage(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  async function del(path: string, successMessage: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.detail || "Unable to remove"));
      await refresh();
      setMessage(successMessage);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Unable to remove");
      setMessage(error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function updateAffiliation(technician: Technician, action: "suspend" | "end", reason: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/technicians/${technician.id}/affiliation/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.detail || "Unable to update affiliation"));
      await refresh();
      setMessage(action === "suspend" ? `${technician.display_name}'s affiliation was suspended.` : `Affiliation with ${technician.display_name} ended.`);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Unable to update affiliation");
      setMessage(error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  const affiliatedActive = useMemo(
    () => workspace.technicians.filter((t) => (t.affiliation?.status ?? t.status) === "active" && !t.affiliation?.is_pending_invite),
    [workspace.technicians]
  );
  const manageMembers = useMemo(
    () => (manageTeamId ? affiliatedActive.filter((t) => t.team_ids.includes(manageTeamId)) : []),
    [manageTeamId, affiliatedActive]
  );
  const addableTechs = useMemo(
    () => (manageTeamId ? affiliatedActive.filter((t) => !t.team_ids.includes(manageTeamId)) : []),
    [manageTeamId, affiliatedActive]
  );

  const activeTeams = workspace.teams.filter((team) => team.status === "active");
  const verifiedTechnicians = workspace.technicians.filter((technician) => technician.vetting_status === "verified");
  const dispatchReadyTechnicians = workspace.technicians.filter(
    (technician) => {
      const affiliation = technician.affiliation;
      const globalStatus = technician.global_status ?? technician.status ?? "unknown";
      return globalStatus === "active" && technician.vetting_status === "verified" && affiliation?.dispatch_allowed === true;
    }
  );

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader
          kicker="Workforce"
          title="Teams"
          description="Organize already-affiliated technicians into dispatch teams. Technician invites live in the Technicians area."
        />
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={BriefcaseBusiness} label="Active teams" value={activeTeams.length.toString()} trend={`${workspace.teams.length} total teams`} />
          <StatCard icon={Users} label="Technicians" value={workspace.technicians.length.toString()} trend="Affiliated workforce" />
          <StatCard icon={ShieldCheck} intent="success" label="Verified" value={verifiedTechnicians.length.toString()} trend="Passed provider vetting" />
          <StatCard icon={CheckCircle2} intent="success" label="Dispatch ready" value={dispatchReadyTechnicians.length.toString()} trend="Active and verified" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><BriefcaseBusiness className="size-5 text-primary" />Create team</CardTitle>
                <CardDescription>Group technicians by region, specialization, or operational team.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Team name" value={teamForm.name} onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })} />
              <Input placeholder="Description" value={teamForm.description} onChange={(event) => setTeamForm({ ...teamForm, description: event.target.value })} />
              <select className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={teamForm.parent_team_id} onChange={(event) => setTeamForm({ ...teamForm, parent_team_id: event.target.value })}>
                <option value="">Top-level team</option>
                {workspace.teams.filter((team) => team.status === "active").map((team) => <option key={team.id} value={team.id}>Inside {team.name}</option>)}
              </select>
              <Button disabled={busy || !teamForm.name.trim()} onClick={() => void submit("/api/teams", { ...teamForm, parent_team_id: teamForm.parent_team_id || null }, () => setTeamForm({ name: "", description: "", parent_team_id: "" }))}><Plus className="size-4" />Create team</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><UserPlus className="size-5 text-primary" />Manage team membership</CardTitle>
                <CardDescription>Add or remove already-affiliated technicians. Membership is team structure only — it never changes the technician's global profile or affiliation.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <select aria-label="Team" className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={manageTeamId} onChange={(event) => { setManageTeamId(event.target.value); setAddTechId(""); }}>
                <option value="">Select a team…</option>
                {activeTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              {manageTeamId ? (
                <>
                  <div className="flex gap-2">
                    <select aria-label="Technician to add" className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={addTechId} onChange={(event) => setAddTechId(event.target.value)}>
                      <option value="">Add a technician…</option>
                      {addableTechs.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
                    </select>
                    <Button disabled={busy || !addTechId} onClick={() => void submit(`/api/teams/${manageTeamId}/technicians`, { technician_id: addTechId }, () => setAddTechId(""))}><Plus className="size-4" />Add</Button>
                  </div>
                  <div className="space-y-1.5">
                    {manageMembers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No technicians in this team yet.</p>
                    ) : manageMembers.map((t) => (
                      <div key={t.id} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                        <span className="truncate">{t.display_name}</span>
                        <ProviderActionDialog
                          confirmLabel="Remove from team"
                          description={`Remove ${t.display_name} from this team. Their company affiliation and global profile will not change.`}
                          disabled={busy}
                          onConfirm={() => del(`/api/teams/${manageTeamId}/technicians/${t.id}`, `${t.display_name} was removed from the team.`)}
                          title={`Remove ${t.display_name}?`}
                        >
                          <Button aria-label={`Remove ${t.display_name} from team`} variant="ghost" size="sm"><X className="size-4" /></Button>
                        </ProviderActionDialog>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Select a team to add or remove members. Invite new technicians from the Technicians area.</p>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Teams</CardTitle>
                <CardDescription>Teams with member counts and status.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workspace.teams.length === 0 ? (
                      <TableRow><TableCell className="py-8 text-center text-muted-foreground" colSpan={4}>No teams created.</TableCell></TableRow>
                    ) : workspace.teams.map((team) => (
                      <TableRow key={team.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Users className="size-4 text-primary" />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{team.name}</div>
                              <div className="truncate text-xs text-muted-foreground">{team.description || "No description"}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">{team.member_count}</TableCell>
                        <TableCell><Badge variant={team.status === "active" ? "success" : "neutral"}>{team.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          <ProviderActionDialog
                            confirmLabel="Delete team"
                            description={`Delete ${team.name}. Members will be unassigned; technician profiles and affiliations remain unchanged.`}
                            disabled={busy}
                            onConfirm={() => del(`/api/teams/${team.id}`, `${team.name} was deleted.`)}
                            title={`Delete ${team.name}?`}
                            variant="destructive"
                          >
                            <Button aria-label={`Delete ${team.name}`} variant="ghost" size="sm"><Trash2 className="size-4" /></Button>
                          </ProviderActionDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Technicians</CardTitle>
                <CardDescription>Workforce with affiliation status, vetting, and dispatch readiness.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Technician</TableHead>
                      <TableHead>Work Status</TableHead>
                      <TableHead>Teams</TableHead>
                      <TableHead>Skills</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workspace.technicians.length === 0 ? (
                      <TableRow><TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>No affiliated technicians.</TableCell></TableRow>
                    ) : workspace.technicians.map((technician) => {
                      const affiliation = technician.affiliation;
                      const isPendingInvite = affiliation?.is_pending_invite || affiliation?.status === "pending_invite";
                      const globalStatus = technician.global_status ?? technician.status ?? "unknown";
                      const isDispatchable = affiliation?.dispatch_allowed === true && !isPendingInvite && globalStatus === "active";
                      return (
                        <TableRow key={technician.id} className={isPendingInvite ? "opacity-75" : undefined}>
                          <TableCell>
                            <div className="flex items-start gap-3">
                              <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                                {technician.display_name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium">{technician.display_name}</div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="truncate text-xs text-muted-foreground">{technician.email || technician.phone || technician.id}</span>
                                  {isPendingInvite && <Badge variant="outline" className="h-4 text-[10px]">Pending invite</Badge>}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {affiliation ? (
                                <>
                                  <Badge variant={affiliation.status === "active" ? "success" : "warn"}>{affiliation.status ?? "unknown"}</Badge>
                                  <Badge variant="outline" className="text-[10px]">{affiliation.affiliation_type ?? "unknown"}</Badge>
                                  <Badge variant="outline" className="text-[10px]">{affiliation.exclusivity ?? "unknown"}</Badge>
                                  <Badge variant={affiliation.dispatch_allowed ? "success" : "neutral"} className="text-[10px]">{affiliation.dispatch_allowed ? "Dispatch allowed" : "Not allowed"}</Badge>
                                </>
                              ) : (
                                <Badge variant="neutral">No affiliation</Badge>
                              )}
                              {isDispatchable && <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" />Dispatch ready</Badge>}
                              {!isDispatchable && !isPendingInvite && (
                                <Badge variant="neutral" className="text-[10px] text-muted-foreground">Not dispatchable</Badge>
                              )}
                              <Badge variant={technician.vetting_status === "verified" ? "success" : "warn"}>{technician.vetting_status}</Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {technician.team_ids.length > 0 ? technician.team_ids.map((teamId) => {
                                const team = workspace.teams.find((candidate) => candidate.id === teamId);
                                return <Badge key={teamId} variant="outline">{team?.name ?? "Team"}</Badge>;
                              }) : <Badge variant="outline" className="text-muted-foreground">No team</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            {technician.skills.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {technician.skills.slice(0, 3).map((skill) => <Badge key={skill} variant="outline">{skillLabel(skill)}</Badge>)}
                                {technician.skills.length > 3 ? <Badge variant="outline">+{technician.skills.length - 3}</Badge> : null}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">No skills</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {affiliation && affiliation.status === "active" ? (
                              <div className="flex justify-end gap-1.5">
                                <ProviderActionDialog
                                  confirmLabel="Suspend affiliation"
                                  description={`Temporarily stop ${technician.display_name} from receiving work through your company. Their global profile is not changed.`}
                                  disabled={busy}
                                  onConfirm={(reason) => updateAffiliation(technician, "suspend", reason)}
                                  reasonMode="required"
                                  title={`Suspend ${technician.display_name}?`}
                                  variant="destructive"
                                >
                                  <Button variant="outline" size="sm">Suspend</Button>
                                </ProviderActionDialog>
                                <ProviderActionDialog
                                  confirmLabel="End affiliation"
                                  description={`End your company's affiliation with ${technician.display_name}. History is preserved and they can be invited again later.`}
                                  disabled={busy}
                                  onConfirm={(reason) => updateAffiliation(technician, "end", reason)}
                                  reasonMode="required"
                                  title={`End affiliation with ${technician.display_name}?`}
                                  variant="destructive"
                                >
                                  <Button variant="outline" size="sm">End</Button>
                                </ProviderActionDialog>
                              </div>
                            ) : affiliation && affiliation.status === "suspended" ? (
                              <span className="text-xs text-muted-foreground">Suspended</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppFrame>
  );
}
