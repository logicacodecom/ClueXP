import { AppFrame, MiniStat, Pill, Screen, Section, icons } from "@/components/mobile";
import { LanguageSettings } from "@cluexp/app-core";

export default function SettingsPage() {
  return (
    <AppFrame title="Settings">
      <Screen>
        <Section title="Language"><LanguageSettings /></Section>
        <Section action={<Pill tone="success" icon={icons.BellRing}>Alarm on</Pill>} title="Dispatch preferences">
          <div className="space-y-2">
            <SettingRow label="Auto accept eligible jobs" value="Off" />
            <SettingRow label="Sound alarm" value="On" />
            <SettingRow label="Background GPS" value="Active" />
            <SettingRow label="Availability" value="Online" />
          </div>
        </Section>
        <Section title="System state">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Polling" value="15s" tone="info" />
            <MiniStat label="Push" value="Planned" tone="warn" />
            <MiniStat label="PWA" value="Ready" tone="success" />
            <MiniStat label="Offline" value="No SW" />
          </div>
        </Section>
      </Screen>
    </AppFrame>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card-strong p-3">
      <span className="text-sm font-bold">{label}</span>
      <span className="rounded-full bg-card px-3 py-1 text-xs font-bold text-primary">{value}</span>
    </div>
  );
}
