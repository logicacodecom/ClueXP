"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader } from "@cluexp/console-ui";
import { UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "../frame";

interface OrgUser { id: string; display_name: string; email?: string | null; phone?: string | null; role: string; status: string }

export default function UsersPage() {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [form, setForm] = useState({ display_name: "", email: "", password: "", role: "dispatcher" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [usersResponse, limitsResponse] = await Promise.all([
      fetch("/api/users", { cache: "no-store" }),
      fetch("/api/users/limits", { cache: "no-store" })
    ]);
    const usersBody = await usersResponse.json().catch(() => ({}));
    const limitsBody = await limitsResponse.json().catch(() => ({}));
    if (usersResponse.ok) setUsers(usersBody.users ?? []);
    if (limitsResponse.ok) setLimit(limitsBody.max_users ?? null);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const canSubmit = form.display_name.trim() && form.email.trim() && form.password.length >= 8;

  async function addUser() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: form.display_name.trim(), email: form.email.trim(),
          password: form.password, role: form.role
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to add user");
      setForm({ display_name: "", email: "", password: "", role: "dispatcher" });
      setMessage("User added.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to add user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppFrame>
      <PageHeader
        kicker="Team"
        title="Users"
        description="Dispatchers and admins on your account. Once added, a user can't be edited or removed here — contact ClueXP support for that."
        actions={limit !== null ? <Badge variant={users.length >= limit ? "danger" : "outline"}>{users.length} of {limit} users</Badge> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Team roster</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {users.length === 0 ? <p className="text-sm text-muted-foreground">No users yet.</p> : users.map((user) => (
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3" key={user.id}>
                <div className="min-w-0">
                  <div className="truncate font-medium">{user.display_name}</div>
                  <div className="truncate text-sm text-muted-foreground">{user.email || user.phone}</div>
                </div>
                <Badge variant="outline">{user.role.replaceAll("_", " ")}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="size-4" />Add user</CardTitle>
            <CardDescription>They can sign in to provider-web immediately.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Name" value={form.display_name} onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))} />
            <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
            <Input placeholder="Temporary password" type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
            <select className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}>
              <option value="dispatcher">Dispatcher</option>
              <option value="provider_admin">Admin</option>
            </select>
            {message ? <div className="text-sm" role="status">{message}</div> : null}
            <Button className="w-full" disabled={!canSubmit || busy} onClick={() => void addUser()}>{busy ? "Adding…" : "Add user"}</Button>
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
