"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cluexp/console-ui";
import { RefreshCw, Star } from "lucide-react";
import { AppFrame } from "../frame";

const METHOD_LABELS: Record<string, string> = {
  credit_card: "Credit card", debit_card: "Debit card", cash: "Cash", check: "Check",
  zelle: "Zelle", cash_app: "Cash App", apple_pay: "Apple Pay", google_pay: "Google Pay",
  venmo: "Venmo", paypal: "PayPal", other: "Other"
};

const STATUS_LABELS: Record<string, string> = {
  completed_pending_customer: "Awaiting confirmation",
  completed_confirmed: "Confirmed", completed_auto_closed: "Auto-closed",
  cancelled: "Cancelled", no_show: "No-show"
};

const STATUS_VARIANTS: Record<string, "success" | "warn" | "danger" | "outline"> = {
  completed_pending_customer: "warn",
  completed_confirmed: "success",
  completed_auto_closed: "success",
  cancelled: "danger",
  no_show: "danger",
};

type PaymentReport = { amount: number; currency: string; method: string } | null;

type HistoryJob = {
  id: string;
  status: string;
  address: string | null;
  situation: string | null;
  finished_at: string | null;
  technician_display_name: string | null;
  review: { rating: number | null; comment: string | null } | null;
  payments: { technician: PaymentReport; customer: PaymentReport };
};

function money(p: PaymentReport): string {
  if (!p) return "—";
  return `${p.currency === "USD" ? "$" : `${p.currency} `}${p.amount.toFixed(2)} · ${METHOD_LABELS[p.method] ?? p.method}`;
}

function CompletedJobs() {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/provider/jobs/history", { cache: "no-store" });
      const body = await response.json().catch(() => ([]));
      if (!response.ok) throw new Error((body as { detail?: string })?.detail || "Could not load completed jobs");
      setJobs(Array.isArray(body) ? body : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load completed jobs");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalCollected = jobs.reduce((sum, j) => sum + (j.payments.technician?.amount ?? 0), 0);
  const confirmedCount = jobs.filter((job) => job.status === "completed_confirmed").length;
  const pendingCount = jobs.filter((job) => job.status === "completed_pending_customer").length;
  const reviewedCount = jobs.filter((job) => job.review?.rating).length;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Reports"
        title="Completed Jobs"
        description="Finished work, customer confirmation state, reviews, and the technician-reported payment the customer acknowledged."
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={state === "loading"}>
            <RefreshCw className={state === "loading" ? "animate-spin" : undefined} />
            {state === "loading" ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Completed jobs" value={state === "loading" ? "—" : String(jobs.length)} />
        <StatCard label="Confirmed" value={state === "loading" ? "—" : String(confirmedCount)} intent="success" />
        <StatCard label="Awaiting customer" value={state === "loading" ? "—" : String(pendingCount)} intent="warn" />
        <StatCard label="Tech collected" value={state === "loading" ? "—" : `$${totalCollected.toFixed(2)}`} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Completed job history</CardTitle>
            <CardDescription>{reviewedCount} customer review{reviewedCount === 1 ? "" : "s"} recorded.</CardDescription>
          </div>
          <Badge variant="outline">Provider scoped</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead className="text-right">Payment collected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
            {state === "error" ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-destructive">{error}</TableCell></TableRow>
            ) : state === "loading" ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Loading completed jobs...</TableCell></TableRow>
            ) : jobs.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No completed jobs yet.</TableCell></TableRow>
            ) : (
              jobs.map((job) => (
                <TableRow key={job.id} className="align-top">
                  <TableCell>
                    <div className="font-medium">{job.address || "Address unavailable"}</div>
                    <div className="mt-1 text-xs capitalize text-muted-foreground">{(job.situation || "Service request").replaceAll("_", " ")}</div>
                    {job.finished_at ? <div className="mt-1 text-xs text-muted-foreground">{new Date(job.finished_at).toLocaleString()}</div> : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[job.status] ?? "outline"}>{STATUS_LABELS[job.status] ?? job.status}</Badge>
                  </TableCell>
                  <TableCell>{job.technician_display_name || "—"}</TableCell>
                  <TableCell>
                    {job.review?.rating ? (
                      <span className="inline-flex items-center gap-1 font-medium"><Star className="size-4 text-warn" />{job.review.rating}/5</span>
                    ) : <span className="text-muted-foreground">—</span>}
                    {job.review?.comment ? <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">"{job.review.comment}"</p> : null}
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(job.payments.technician)}</TableCell>
                </TableRow>
              ))
            )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CompletedPage() {
  return <AppFrame><CompletedJobs /></AppFrame>;
}
