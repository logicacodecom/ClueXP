"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { BriefcaseBusiness, Plus, UserPlus, Users } from "lucide-react";
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
}
interface Workspace { teams: Team[]; technicians: Technician[]; }

export default function TeamsPage() {
  const [workspace, setWorkspace] = useState<Workspace>({ teams: [], technicians: [] });
  const [teamForm, setTeamForm] = useState({ name: "", description: "", parent_team_id: "" });
  const [techForm, setTechForm] = useState({ display_name: "", email: "", password: "", skills: "home,business", team_id: "" });
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

  return (
    <AppFrame>
      <div className="space-y-6">
        <header>
          <div className="text-xs font-semibold uppercase text-muted-foreground">Provider network</div>
          <h1 className="mt-2 text-3xl font-semibold">Teams and technicians</h1>
          <p className="mt-2 text-sm text-muted-foreground">Organize affiliated technicians without changing ClueXP verification requirements.</p>
        </header>
        {message ? <div className="rounded-md border border-border bg-card p-3 text-sm" role="status">{message}</div> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BriefcaseBusiness className="size-5 text-primary" />Create team</CardTitle></CardHeader>
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
            <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-5 text-primary" />Add affiliated technician</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Full name" value={techForm.display_name} onChange={(event) => setTechForm({ ...techForm, display_name: event.target.value })} />
              <Input placeholder="Email" type="email" value={techForm.email} onChange={(event) => setTechForm({ ...techForm, email: event.target.value })} />
              <Input placeholder="Temporary password" type="password" value={techForm.password} onChange={(event) => setTechForm({ ...techForm, password: event.target.value })} />
              <Input placeholder="Skills, comma separated" value={techForm.skills} onChange={(event) => setTechForm({ ...techForm, skills: event.target.value })} />
              <select className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={techForm.team_id} onChange={(event) => setTechForm({ ...techForm, team_id: event.target.value })}>
                <option value="">No team yet</option>
                {workspace.teams.filter((team) => team.status === "active").map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <Button disabled={busy || !techForm.display_name || !techForm.email || techForm.password.length < 8} onClick={() => void submit("/api/technicians", { display_name: techForm.display_name, email: techForm.email, password: techForm.password, skills: techForm.skills.split(",").map((value) => value.trim()).filter(Boolean), team_ids: techForm.team_id ? [techForm.team_id] : [] }, () => setTechForm({ display_name: "", email: "", password: "", skills: "home,business", team_id: "" }))}><UserPlus className="size-4" />Add technician</Button>
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Teams</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {workspace.teams.length === 0 ? <p className="text-sm text-muted-foreground">No teams created.</p> : workspace.teams.map((team) => (
                <div className="flex min-h-14 items-center gap-3 rounded-md border border-border p-3" key={team.id}>
                  <Users className="size-5 text-primary" />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{team.name}</div><div className="text-xs text-muted-foreground">{team.member_count} members</div></div>
                  <Badge variant={team.status === "active" ? "success" : "neutral"}>{team.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Affiliated technicians</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {workspace.technicians.length === 0 ? <p className="text-sm text-muted-foreground">No affiliated technicians.</p> : workspace.technicians.map((technician) => (
                <div className="flex min-h-14 items-center gap-3 rounded-md border border-border p-3" key={technician.id}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{technician.display_name}</div><div className="truncate text-xs text-muted-foreground">{technician.email || technician.id}</div></div>
                  <Badge variant={technician.vetting_status === "verified" ? "success" : "warn"}>{technician.vetting_status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppFrame>
  );
}
