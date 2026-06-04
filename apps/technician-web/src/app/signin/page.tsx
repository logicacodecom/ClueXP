import { technicianSession } from "@cluexp/api-client";
import { AppFrame, PrimaryButton, Screen, Section, icons } from "@/components/mobile";

export default function SignInPage() {
  return (
    <AppFrame nav={false} title="Sign In">
      <Screen>
        <div className="flex min-h-[720px] flex-col justify-end">
          <Section title="Sign in" subtitle="Mock auth shell for verified technician access.">
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-card-strong px-3 py-3 text-sm text-muted">{technicianSession.user.phone ?? technicianSession.user.email ?? "Phone or email"}</div>
              <div className="rounded-xl border border-border bg-card-strong px-3 py-3 text-sm text-muted">Password</div>
              <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-3 text-xs font-bold uppercase text-primary">
                {technicianSession.active_role} · {technicianSession.user.status}
              </div>
            </div>
          </Section>
          <PrimaryButton href="/jobs"><icons.ShieldCheck className="size-5" />Enter demo</PrimaryButton>
        </div>
      </Screen>
    </AppFrame>
  );
}
