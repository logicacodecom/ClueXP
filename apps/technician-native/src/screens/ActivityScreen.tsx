import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CluexpApi } from "../api/client";
import { Pill } from "../components/Pill";
import { colors, radius, sharedStyles } from "../theme";
import type { HistoryJob, PaymentReport } from "../types";

const METHOD_LABELS: Record<string, string> = {
  credit_card: "Credit card",
  debit_card: "Debit card",
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  cash_app: "Cash App",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  venmo: "Venmo",
  paypal: "PayPal",
  other: "Other"
};

const STATUS_LABELS: Record<string, string> = {
  completed_pending_customer: "Awaiting confirmation",
  completed_confirmed: "Confirmed",
  completed_auto_closed: "Auto-closed",
  cancelled: "Cancelled",
  no_show: "No-show"
};

const PERIODS = [
  { key: "all", label: "All time", days: null },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "365d", label: "1 year", days: 365 }
] as const;

function money(payment: PaymentReport): string {
  if (!payment) return "—";
  const symbol = payment.currency === "USD" ? "$" : `${payment.currency} `;
  return `${symbol}${payment.amount.toFixed(2)} · ${METHOD_LABELS[payment.method] ?? payment.method}`;
}

function statusTone(status: string): "success" | "warn" | "danger" | "muted" {
  if (status === "completed_confirmed") return "success";
  if (status === "completed_pending_customer") return "warn";
  if (status === "cancelled" || status === "no_show") return "danger";
  return "muted";
}

export function ActivityScreen({ api }: { api: CluexpApi }) {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const body = await api.jobHistory();
      setJobs(Array.isArray(body) ? body : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your history");
      setState("error");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      const spec = PERIODS.find((item) => item.key === period);
      if (!spec?.days) return true;
      const finishedAt = job.finished_at ? new Date(job.finished_at).getTime() : 0;
      if (!finishedAt) return false;
      return finishedAt >= Date.now() - spec.days * 24 * 60 * 60 * 1000;
    });
  }, [jobs, statusFilter, period]);

  const totalCollected = filteredJobs.reduce((sum, job) => sum + (job.payments.technician?.amount ?? 0), 0);
  const reviewedCount = filteredJobs.filter((job) => job.review?.rating).length;
  const statusOptions = useMemo(() => Array.from(new Set(jobs.map((job) => job.status))).sort(), [jobs]);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={sharedStyles.kicker}>Completed work</Text>
          <Text style={styles.title}>Activity</Text>
          <Text style={styles.subtitle}>Finished jobs, collected money, and customer reviews.</Text>
        </View>
        <Pressable accessibilityLabel="Refresh" onPress={() => void load()} style={styles.refreshButton}>
          <Ionicons color={colors.foreground} name="refresh" size={16} />
        </Pressable>
      </View>

      {state === "error" ? <Text style={styles.errorText}>{error}</Text> : null}

      {state === "ready" && jobs.length > 0 ? (
        <>
          <View style={styles.statsRow}>
            <StatBox label="Collected" value={`$${totalCollected.toFixed(2)}`} />
            <StatBox label="Jobs" value={String(filteredJobs.length)} />
            <StatBox label="Reviews" value={String(reviewedCount)} />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {["all", ...statusOptions].map((status) => {
              const active = statusFilter === status;
              return (
                <Pressable key={status} onPress={() => setStatusFilter(status)} style={[styles.filterChip, active ? styles.filterChipActive : null]}>
                  <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>
                    {status === "all" ? "All" : STATUS_LABELS[status] ?? status}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {PERIODS.map((item) => {
              const active = period === item.key;
              return (
                <Pressable key={item.key} onPress={() => setPeriod(item.key)} style={[styles.filterChip, active ? styles.filterChipActive : null]}>
                  <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}

      {state === "loading" ? (
        <Text style={styles.emptyText}>Loading…</Text>
      ) : jobs.length === 0 && state === "ready" ? (
        <Text style={styles.emptyText}>No finished jobs yet. Completed work appears here with payments and the customer's review.</Text>
      ) : filteredJobs.length === 0 && state === "ready" ? (
        <View style={styles.emptyBox}>
          <Ionicons color={colors.muted} name="calendar-outline" size={28} />
          <Text style={styles.emptyBoxTitle}>No activity matches these filters</Text>
          <Pressable onPress={() => { setStatusFilter("all"); setPeriod("all"); }} style={styles.resetButton}>
            <Text style={styles.resetButtonText}>Reset filters</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {filteredJobs.map((job) => {
            const expanded = expandedId === job.id;
            return (
              <View key={job.id} style={styles.jobCard}>
                <View style={styles.jobHeaderRow}>
                  <View style={styles.jobHeaderText}>
                    <Text numberOfLines={1} style={styles.jobAddress}>{job.address || "Address unavailable"}</Text>
                    <Text style={styles.jobSituation}>{(job.situation || "Service request").replaceAll("_", " ")}</Text>
                  </View>
                  <Pill tone={statusTone(job.status)}>{STATUS_LABELS[job.status] ?? job.status}</Pill>
                </View>
                <View style={styles.jobMetaRow}>
                  <MetaLine label="You collected" value={money(job.payments.technician)} />
                  <MetaLine label="Customer reported" value={money(job.payments.customer)} />
                  <MetaLine label="Finished" value={job.finished_at ? new Date(job.finished_at).toLocaleDateString() : "—"} />
                </View>
                {job.review?.rating ? (
                  <View style={styles.reviewRow}>
                    <Ionicons color={colors.primary} name="star" size={14} />
                    <Text style={styles.reviewText}>{job.review.rating}/5{job.review.comment ? ` · "${job.review.comment}"` : ""}</Text>
                  </View>
                ) : job.status === "completed_pending_customer" ? (
                  <View style={styles.reviewRow}>
                    <Ionicons color={colors.primary} name="shield-checkmark-outline" size={14} />
                    <Text style={styles.reviewText}>Receipt confirmation is with dispatch. You are available for new jobs.</Text>
                  </View>
                ) : (
                  <Text style={styles.noReviewText}>No customer review yet.</Text>
                )}
                <Pressable onPress={() => setExpandedId(expanded ? null : job.id)} style={styles.detailsToggle}>
                  <Ionicons color={colors.foreground} name={expanded ? "chevron-up" : "chevron-down"} size={14} />
                  <Text style={styles.detailsToggleText}>{expanded ? "Hide details" : "View details"}</Text>
                </Pressable>
                {expanded ? (
                  <View style={styles.detailsPanel}>
                    <MetaLine label="Job ID" value={job.operational_id ?? job.id} />
                    <MetaLine label="Urgency" value={(job.urgency || "—").replaceAll("_", " ")} />
                    <MetaLine label="Created" value={job.created_at ? new Date(job.created_at).toLocaleString() : "—"} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaLine}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: 16,
    padding: 16,
    paddingBottom: 98
  },
  header: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingBottom: 16
  },
  headerText: {
    flex: 1
  },
  title: {
    color: colors.foreground,
    fontSize: 32,
    fontWeight: "900",
    marginTop: 4,
    textTransform: "uppercase"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8
  },
  refreshButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  errorText: {
    color: colors.danger,
    fontSize: 14
  },
  statsRow: {
    flexDirection: "row",
    gap: 8
  },
  statBox: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    padding: 10
  },
  statLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  statValue: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 4
  },
  filterRow: {
    flexGrow: 0
  },
  filterChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginRight: 8,
    minHeight: 36,
    paddingHorizontal: 14
  },
  filterChipActive: {
    backgroundColor: "rgba(255, 191, 0, 0.12)",
    borderColor: colors.primary
  },
  filterChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  filterChipTextActive: {
    color: colors.primary
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    paddingVertical: 24,
    textAlign: "center"
  },
  emptyBox: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 8,
    padding: 20
  },
  emptyBoxTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "800"
  },
  resetButton: {
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  resetButtonText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "700"
  },
  list: {
    gap: 12
  },
  jobCard: {
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14
  },
  jobHeaderRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  jobHeaderText: {
    flex: 1
  },
  jobAddress: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "800"
  },
  jobSituation: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 3,
    textTransform: "capitalize"
  },
  jobMetaRow: {
    gap: 6,
    marginTop: 12
  },
  metaLine: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 13
  },
  metaValue: {
    color: colors.foreground,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "700",
    marginLeft: 12,
    textAlign: "right"
  },
  reviewRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
    paddingTop: 12
  },
  reviewText: {
    color: colors.foreground,
    flex: 1,
    fontSize: 13,
    fontWeight: "700"
  },
  noReviewText: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    color: colors.muted,
    fontSize: 13,
    marginTop: 12,
    paddingTop: 12
  },
  detailsToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 38
  },
  detailsToggleText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "700"
  },
  detailsPanel: {
    backgroundColor: colors.cardStrong,
    borderRadius: radius.xs,
    gap: 6,
    marginTop: 6,
    padding: 12
  }
});
