import type { ReactNode } from "react";
import { AppFrame, Screen } from "@/components/mobile";
import { LanguageSettings } from "@cluexp/app-core";
import { LocateFixed, Lock, PhoneOff } from "lucide-react";

function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <p className="field-kicker">{title}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <AppFrame title="Account settings">
      <Screen>
        <header className="border-b border-border pb-4">
          <h1 className="font-condensed text-3xl font-bold uppercase leading-none">Account settings</h1>
          <p className="mt-2 text-sm leading-5 text-muted">Language, location, and privacy for your ClueXP account.</p>
        </header>

        {/* LanguageSettings renders its own heading — no wrapper title, to avoid a duplicate. */}
        <div className="mt-6"><LanguageSettings /></div>

        <FieldSection title="Location & permissions">
          <div className="border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <LocateFixed className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-semibold">How your location is used</div>
                <div className="mt-1 text-xs leading-5 text-muted">
                  ClueXP uses your location only while you are available or on a job — to match you with nearby work and to show the customer honest arrival tracking.
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-4 text-muted">
              There is no silent background tracking. You refresh your location from the Work screen or your active job; if the app can’t get a fix, you’ll see it there.
            </p>
          </div>
        </FieldSection>

        <FieldSection title="Privacy">
          <div className="divide-y divide-border border border-border bg-card">
            <div className="flex items-center gap-3 p-3">
              <PhoneOff className="size-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Masked calls &amp; messages</div>
                <div className="text-xs text-muted">Customer contact is always routed through ClueXP — your number stays private.</div>
              </div>
              <span className="shrink-0 text-xs font-semibold text-success">Always on</span>
            </div>
            <div className="flex items-center gap-3 p-3">
              <Lock className="size-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Location sharing scope</div>
                <div className="text-xs text-muted">Shared only while you have an active job or explicitly refresh it.</div>
              </div>
              <span className="shrink-0 text-xs font-semibold text-muted">On a job</span>
            </div>
          </div>
        </FieldSection>
      </Screen>
    </AppFrame>
  );
}
