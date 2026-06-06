"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import { Building2, Check, ShieldCheck, UserRound, X } from "lucide-react";
import { useState } from "react";
import { AppFrame } from "../frame";

type ApprovalType = "technicians" | "organizations";
type Decision = "approve" | "reject";

export default function ApprovalsPage() {
  const [type, setType] = useState<ApprovalType>("technicians");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: Decision) {
    setBusy(decision);
    setMessage(null);
    try {
      const response = await fetch(`/api/approvals/${type}/${encodeURIComponent(id.trim())}/${decision}`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Unable to ${decision}`);
      setMessage(decision === "approve" ? "Access approved." : "Registration rejected.");
      setId("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `Unable to ${decision}`);
    } finally {
      setBusy(null);
    }
  }

  const Icon = type === "technicians" ? UserRound : Building2;
  return (
    <AppFrame>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <div className="text-xs font-semibold uppercase text-muted-foreground">Network governance</div>
          <h1 className="mt-2 text-3xl font-semibold">Access approvals</h1>
          <p className="mt-2 text-sm text-muted-foreground">Approve or reject a pending technician or provider organization by its registration ID.</p>
        </header>
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="grid size-10 place-items-center rounded-md bg-secondary"><Icon className="size-5 text-primary" /></div>
              <div><CardTitle>Registration decision</CardTitle><CardDescription>IDs are available in the registration response and platform audit trail.</CardDescription></div>
              <Badge className="ml-auto" variant="warn">Platform admin</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <button className={`min-h-12 rounded-md border px-4 text-left font-medium ${type === "technicians" ? "border-primary bg-primary/10" : "border-border"}`} onClick={() => setType("technicians")} type="button">Technician</button>
              <button className={`min-h-12 rounded-md border px-4 text-left font-medium ${type === "organizations" ? "border-primary bg-primary/10" : "border-border"}`} onClick={() => setType("organizations")} type="button">Organization</button>
            </div>
            <label className="block space-y-2 text-sm font-medium">
              Registration ID
              <Input autoComplete="off" placeholder="UUID from registration or audit event" value={id} onChange={(event) => setId(event.target.value)} />
            </label>
            {message ? <div className="rounded-md border border-border bg-secondary p-3 text-sm" role="status">{message}</div> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button disabled={!id.trim() || busy !== null} variant="outline" onClick={() => void decide("reject")}><X className="size-4" />Reject</Button>
              <Button disabled={!id.trim() || busy !== null} onClick={() => void decide("approve")}><Check className="size-4" />Approve</Button>
            </div>
          </CardContent>
        </Card>
        <div className="flex items-start gap-3 rounded-md border border-info/30 bg-info/5 p-4 text-sm text-info">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          Approval activates dispatch eligibility only when the backend verification rules succeed.
        </div>
      </div>
    </AppFrame>
  );
}
