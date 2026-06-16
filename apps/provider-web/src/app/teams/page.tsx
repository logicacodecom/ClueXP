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
  SkillSelect,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  skillLabel
} from "@cluexp/console-ui";
import { BriefcaseBusiness, CheckCircle2, Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface Team {
  id: string;
  parent_team_id?: string | null;
  name: string;
  description?: string | null;
  status: string;
  member_count: number;
}
interface Technician {
  id: string;
  display_name: string;
  email?: string | null;
  status: string;
  vetting_status: string;
  team_ids: string[];
  skills: string[];
}
interface Workspace { teams: Team[]; technicians: Technician[]; }

export default function TeamsPage() {
  const [workspace, setWorkspace] = useState<Workspace>({ teams: [], technicians: [] });
  const [teamForm, setTeamForm] = useState({ name: "", description: "", parent_team_id: "" });
  const [techForm, setTechForm] = useState({ display_name: "", email: "", password: "", skills: [] as string[], team_id: "" });
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
      if (!response.ok) throw new Error(body.detail || "Unable to save");
      done();
      await refresh();
      setMessage("Saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }

  const activeTeams = workspace.teams.filter((team) => team.status === "active");
  const verifiedTechnicians = workspace.technicians.filter((technician) => technician.vetting_status === "verified");
  const dispatchReadyTechnicians = workspace.technicians.filter(
    (technician) => technician.status === "active" && technician.vetting_status === "verified"
  );

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader
          kicker="Provider network"
          title="Workforce"
          description="Manage technicians, assign skills, and organize teams for dispatch readiness."
        />
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={BriefcaseBusiness} label="Active teams" value={activeTeams.length.toString()} trend={`${workspace.teams.length} total teams`} />
          <StatCard icon={Users} label="Technicians" value={workspace.technicians.length.toString()} trend="Affiliated workforce" />
          <StatCard icon={ShieldCheck} intent="success" label="Verified" value={verifiedTechnicians.length.toString()} trend="Passed provider vetting" />
          <StatCard icon={CheckCircle2} intent="success" label="Dispatch ready" value={dispatchReadyTechnicians.length.toString()} trend="Active and verified" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
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
                <CardTitle className="flex items-center gap-2"><UserPlus className="size-5 text-primary" />Add technician</CardTitle>
                <CardDescription>Onboard affiliated technicians with assigned skills.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Full name" value={techForm.display_name} onChange={(event) => setTechForm({ ...techForm, display_name: event.target.value })} />
              <Input placeholder="Email" type="email" value={techForm.email} onChange={(event) => setTechForm({ ...techForm, email: event.target.value })} />
              <Input placeholder="Temporary password" type="password" value={techForm.password} onChange={(event) => setTechForm({ ...techForm, password: event.target.value })} />
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Skills</label>
                <SkillSelect selected={techForm.skills} onChange={(skills) => setTechForm({ ...techForm, skills })} />
              </div>
              <select className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={techForm.team_id} onChange={(event) => setTechForm({ ...techForm, team_id: event.target.value })}>
                <option value="">No team yet</option>
                {workspace.teams.filter((team) => team.status === "active").map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <Button disabled={busy || !techForm.display_name || !techForm.email || techForm.password.length < 8} onClick={() => void submit("/api/technicians", { display_name: techForm.display_name, email: techForm.email, password: techForm.password, skills: techForm.skills, team_ids: techForm.team_id ? [techForm.team_id] : [] }, () => setTechForm({ display_name: "", email: "", password: "", skills: [], team_id: "" }))}><UserPlus className="size-4" />Add technician</Button>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workspace.teams.length === 0 ? (
                      <TableRow><TableCell className="py-8 text-center text-muted-foreground" colSpan={3}>No teams created.</TableCell></TableRow>
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
                <CardDescription>Dispatch-ready workforce with vetting status and skills.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Technician</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Teams</TableHead>
                      <TableHead>Skills</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workspace.technicians.length === 0 ? (
                      <TableRow><TableCell className="py-8 text-center text-muted-foreground" colSpan={4}>No affiliated technicians.</TableCell></TableRow>
                    ) : workspace.technicians.map((technician) => (
                      <TableRow key={technician.id}>
                        <TableCell>
                          <div className="font-medium">{technician.display_name}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{technician.email || technician.id}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant={technician.status === "active" ? "success" : "neutral"}>{technician.status}</Badge>
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
                      </TableRow>
                    ))}
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
