"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cluexp/console-ui";
import { RefreshCw } from "lucide-react";
import { AppFrame } from "../frame";

type AuditEvent = { job_id: string; event: string; at: string | null; address?: string | null };

// Friendly labels + tone for the audit action prefix (the part before ":").
const ACTION_META: Record<string, { label: string; variant: "outline" | "warn" | "danger" | "success" }> = {
  created: { label: "Created", variant: "outline" },
  dispatch_cutover: { label: "Entered dispatch", variant: "outline" },
  assign: { label: "Assigned", variant: "outline" },
  provider_assign: { label: "Offer sent", variant: "outline" },
  en_route: { label: "En route", variant: "warn" },
  arrived: { label: "Arrived", variant: "warn" },
  in_progress: { label: "In progress", variant: "warn" },
  completed_pending_customer: { label: "Work completed", variant: "success" },
  completed_confirmed: { label: "Confirmed", variant: "success" },
  customer_cancel: { label: "Customer cancelled", variant: "danger" },
  provider_cancel: { label: "Provider cancelled", variant: "danger" },
  provider_release: { label: "Technician released", variant: "danger" },
  provider_no_show: { label: "No-show", variant: "danger" },
  provider_recall: { label: "Offer recalled", variant: "warn" },
  resolve: { label: "Dispute resolved", variant: "success" },
  tech_issue: { label: "Technician issue", variant: "danger" },
};

function parse(ev: string): { action: string; detail: string } {
  const i = ev.indexOf(":");
  return i === -1 ? { action: ev, detail: "" } : { action: ev.slice(0, i), detail: ev.slice(i + 1) };
}

function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/provider/audit", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load the audit log (${res.status})`);
      const body = (await res.json()) as AuditEvent[];
      setEvents(Array.isArray(body) ? body : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the audit log");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const loading = state === "loading";

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Append-only audit"
        title="Audit Log"
        description="Recent lifecycle and recovery events across your company's jobs, newest first. Tenant-scoped — only your organization's events. Refreshes every 30s."
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Event trail</CardTitle>
            <CardDescription>{loading ? "Loading…" : `${events.length} recent event${events.length === 1 ? "" : "s"}.`}</CardDescription>
          </div>
          <Badge variant="outline">Provider scoped</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Job</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state === "error" ? (
                  <TableRow><TableCell colSpan={4} className="py-10 text-center text-destructive">{error}</TableCell></TableRow>
                ) : loading ? (
                  <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : events.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">No events recorded yet.</TableCell></TableRow>
                ) : (
                  events.map((e, idx) => {
                    const { action, detail } = parse(e.event);
                    const meta = ACTION_META[action];
                    return (
                      <TableRow key={`${e.job_id}-${idx}`} className="align-top">
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{e.at ? new Date(e.at).toLocaleString() : "—"}</TableCell>
                        <TableCell><Badge variant={meta?.variant ?? "outline"}>{meta?.label ?? action.replaceAll("_", " ")}</Badge></TableCell>
                        <TableCell className="max-w-[360px] break-words text-sm text-muted-foreground">{detail || "—"}</TableCell>
                        <TableCell className="text-xs">
                          <Link href={`/jobs/${e.job_id}`} className="font-medium text-primary hover:underline">
                            {e.address || `${e.job_id.slice(0, 8)}…`}
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AuditPage() {
  return <AppFrame><AuditLog /></AppFrame>;
}
