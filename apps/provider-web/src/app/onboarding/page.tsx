"use client";

import { useSession } from "@cluexp/app-core";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cluexp/console-ui";
import { CheckCircle2, Clock, FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

type StatusMeta = {
  badge: "outline" | "success" | "warn" | "danger";
  label: string;
  title: string;
  body: string;
  icon: typeof Clock;
};

const STATUS: Record<string, StatusMeta> = {
  pending_review: {
    badge: "warn", label: "Pending review", icon: Clock,
    title: "Your company is pending Ops review",
    body: "A ClueXP platform admin is reviewing your company. Upload the required documents now to speed up approval — you'll get console access once your company is approved.",
  },
  active: {
    badge: "success", label: "Active", icon: CheckCircle2,
    title: "Your company is approved",
    body: "You're all set. Open the console to manage your workforce, dispatch jobs, and recover work.",
  },
  suspended: {
    badge: "danger", label: "Suspended", icon: ShieldAlert,
    title: "Your company is suspended",
    body: "Dispatch is paused for your company. This is usually due to missing/expired documents or a policy issue. Please contact ClueXP support to resolve it.",
  },
  rejected: {
    badge: "danger", label: "Rejected", icon: ShieldAlert,
    title: "Your company was not approved",
    body: "Your registration was rejected. If you believe this is a mistake, contact ClueXP support.",
  },
  closed: {
    badge: "outline", label: "Closed", icon: ShieldAlert,
    title: "This company account is closed",
    body: "This company relationship has ended. Contact ClueXP support if you need to reopen it.",
  },
};

export default function OnboardingPage() {
  const router = useRouter();
  const { loading, session, signOut } = useSession();

  useEffect(() => {
    if (!loading && !session) router.replace("/signin");
  }, [loading, session, router]);

  if (loading) return <div className="min-h-screen bg-background" aria-busy="true" />;
  if (!session) return null;

  const status = session.organization_status ?? "pending_review";
  const meta = STATUS[status] ?? STATUS.pending_review;
  const Icon = meta.icon;
  const isActive = status === "active";

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div>
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="gap-1"><ShieldCheck className="size-3" />Provider onboarding</Badge>
              <Badge variant={meta.badge}>{meta.label}</Badge>
            </div>
            <CardTitle className="mt-3 flex items-center gap-2"><Icon className="size-5" />{meta.title}</CardTitle>
            <CardDescription className="mt-1">{session.organization_name ?? "Your company"}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">{meta.body}</p>

          {/* Pending companies can upload documents while they wait. */}
          {status === "pending_review" || status === "suspended" ? (
            <div className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center gap-2 font-medium"><FileText className="size-4 text-primary" />Required documents</div>
              <p className="mt-1 text-sm text-muted-foreground">Upload your company's compliance documents for Ops review.</p>
              <Button asChild className="mt-3" variant="outline"><Link href="/documents">Upload documents</Link></Button>
            </div>
          ) : null}

          {isActive ? (
            <Button asChild className="min-h-11 w-full"><Link href="/dashboard">Enter console</Link></Button>
          ) : null}

          <button
            type="button"
            className="block w-full pt-1 text-center text-sm font-semibold text-muted-foreground hover:text-foreground"
            onClick={() => void signOut().then(() => router.replace("/signin"))}
          >
            Sign out
          </button>
        </CardContent>
      </Card>
    </main>
  );
}
