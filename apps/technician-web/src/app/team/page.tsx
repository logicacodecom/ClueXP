import { AppFrame, MiniStat, Pill, Screen, Section, icons } from "@/components/mobile";

export default function TeamPage() {
  return (
    <AppFrame title="Team">
      <Screen>
        <Section action={<Pill tone="success" icon={icons.ShieldCheck}>Individual</Pill>} subtitle="This account is currently dispatched by ClueXP. Affiliated technicians may also be routed by their organization." title="Workspace">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Provider" value="Individual" tone="success" />
            <MiniStat label="Direct" value="ClueXP" tone="warn" />
            <MiniStat label="Org" value="None" />
            <MiniStat label="Teams" value="0" />
          </div>
        </Section>
        <Section title="Affiliated example">
          <div className="rounded-xl border border-border bg-card-strong p-3 text-sm leading-5 text-muted">
            Organization technicians would see org name, teams such as Auto Team or Home Team, and whether they are eligible for verified network routing.
          </div>
        </Section>
      </Screen>
    </AppFrame>
  );
}
