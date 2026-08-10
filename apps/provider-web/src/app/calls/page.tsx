"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@cluexp/console-ui";
import { PhoneCall, Plus, RefreshCw } from "lucide-react";
import { AppFrame } from "../frame";

type CallRow = {
  id: string;
  job_id: string | null;
  associated_job_id?: string | null;
  caller_type: string;
  callee_type: string;
  status: string;
  provider_status: string;
  provider: string | null;
  masked_number: string | null;
  created_at: string | null;
  direction?: string | null;
  caller_redacted?: string | null;
  callee_redacted?: string | null;
  duration_seconds?: number | null;
};

function callStatusVariant(status: string): "success" | "warn" | "danger" | "outline" {
  if (["completed", "answered", "connected"].includes(status)) return "success";
  if (["busy", "no_answer", "voicemail"].includes(status)) return "warn";
  if (["failed", "unavailable"].includes(status)) return "danger";
  return "outline";
}

function label(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ").replaceAll("-", " ") : "-";
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/provider/calls", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Could not load calls");
      setCalls(body.calls ?? []);
      setState("ready");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not load calls");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <AppFrame>
      <div className="space-y-6">
        <PageHeader
          kicker="Communications"
          title="Calls"
          description="Incoming and masked call activity for this provider organization."
          actions={
            <Button variant="outline" onClick={() => void load()} disabled={state === "loading"}>
              <RefreshCw className={state === "loading" ? "animate-spin" : undefined} />
              {state === "loading" ? "Refreshing" : "Refresh"}
            </Button>
          }
        />

        {message ? <Card><CardContent className="py-3 text-sm text-destructive">{message}</CardContent></Card> : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PhoneCall className="size-5 text-primary" />Call history</CardTitle>
          </CardHeader>
          <CardContent>
            {state === "loading" ? (
              <p className="text-sm text-muted-foreground">Loading calls...</p>
            ) : calls.length === 0 ? (
              <p className="rounded-md border border-border bg-secondary/20 p-4 text-sm text-muted-foreground">No call activity yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Direction</th>
                      <th className="py-2 pr-3">Parties</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Duration</th>
                      <th className="py-2 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {calls.map((call) => {
                      const jobId = call.associated_job_id || call.job_id;
                      return (
                        <tr key={call.id}>
                          <td className="py-3 pr-3 whitespace-nowrap">{call.created_at ? new Date(call.created_at).toLocaleString() : "-"}</td>
                          <td className="py-3 pr-3 capitalize">{label(call.direction || (call.caller_type === "customer" ? "inbound" : "outbound"))}</td>
                          <td className="py-3 pr-3">
                            <div className="font-medium capitalize">{label(call.caller_type)} to {label(call.callee_type)}</div>
                            <div className="text-xs text-muted-foreground">{call.caller_redacted || "private"} {"->"} {call.callee_redacted || call.masked_number || "private"}</div>
                          </td>
                          <td className="py-3 pr-3">
                            <div className="flex flex-wrap gap-1.5">
                              <Badge variant={callStatusVariant(call.status)}>{label(call.status)}</Badge>
                              <Badge variant="outline">{call.provider || "no provider"}</Badge>
                            </div>
                          </td>
                          <td className="py-3 pr-3">{call.duration_seconds ? `${call.duration_seconds}s` : "-"}</td>
                          <td className="py-3 pr-3">
                            <div className="flex flex-wrap gap-2">
                              {jobId ? <Button asChild variant="outline" size="sm"><Link href={`/jobs/${jobId}`}>Open job</Link></Button> : null}
                              {!jobId ? <Button asChild variant="outline" size="sm"><Link href="/intake/new"><Plus className="size-3" />New intake</Link></Button> : null}
                              {jobId ? <Button asChild variant="ghost" size="sm"><Link href={`/jobs/${jobId}`}>Callback</Link></Button> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppFrame>
  );
}
