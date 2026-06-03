import { technicianActivitySummary, technicianHistory } from "@cluexp/api-client";
import { AppFrame, MiniStat, Pill, Screen, Section, formatTime, icons } from "@/components/mobile";

export default function ActivityPage() {
  return (
    <AppFrame title="Activity">
      <Screen>
        <Section action={<Pill tone="warn">Provisional</Pill>} subtitle="Earnings are mock settlement estimates." title="Today">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Today" value={String(technicianActivitySummary.today_completed)} tone="success" />
            <MiniStat label="Week" value={String(technicianActivitySummary.week_completed)} tone="info" />
            <MiniStat label="Pay" value={technicianActivitySummary.provisional_earnings} tone="warn" />
          </div>
        </Section>
        <Section action={<Pill tone="success" icon={icons.CheckCircle2}>{technicianActivitySummary.completion_rate}</Pill>} title="History">
          <div className="space-y-2">
            {technicianHistory.map((entry) => (
              <div className="rounded-xl border border-border bg-card-strong p-3" key={entry.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold">{entry.label}</div>
                    <div className="mt-1 text-xs text-muted">{entry.source_label} · {formatTime(entry.completed_at)}</div>
                  </div>
                  <Pill tone={entry.status === "completed" ? "success" : "warn"}>{entry.amount ?? entry.status}</Pill>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </Screen>
    </AppFrame>
  );
}
