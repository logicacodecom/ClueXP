import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { CluexpApi } from "../api/client";
import { FieldButton } from "../components/FieldButton";
import { Pill } from "../components/Pill";
import { useLocale } from "../i18n/LocaleContext";
import { colors, radius, sharedStyles } from "../theme";
import type { SettlementPayload, SettlementPeriodRow, TechPayment } from "../types";

const PAYMENT_METHODS = ["cash", "check", "zelle", "cash_app", "venmo", "paypal", "bank_transfer", "other"];

function money(cents: number | null | undefined, currency = "USD") {
  const amount = ((cents ?? 0) / 100).toFixed(2);
  return currency === "USD" ? `$${amount}` : `${currency} ${amount}`;
}

function percent(bps: number | null | undefined) {
  return `${((bps ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

function periodStatusTone(status: string): "success" | "warn" | "muted" {
  if (status === "paid") return "success";
  if (status === "locked") return "warn";
  return "muted";
}

export function EarningsScreen({ api }: { api: CluexpApi }) {
  const { t } = useLocale();
  const [payload, setPayload] = useState<SettlementPayload>({ live: [], period_rows: [] });
  const [payments, setPayments] = useState<TechPayment[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ organizationId: "", amount: "", method: "cash", reference: "", note: "" });
  const [formBusy, setFormBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [settlements, paymentRows] = await Promise.all([api.settlements(), api.payments()]);
      setPayload({
        live: Array.isArray(settlements?.live) ? settlements.live : [],
        period_rows: Array.isArray(settlements?.period_rows) ? settlements.period_rows : []
      });
      setPayments(Array.isArray(paymentRows) ? paymentRows : []);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not load earnings"));
      setState("error");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const companies = useMemo(() => {
    const byId = new Map<string, string | null>();
    for (const row of payload.live) {
      if (row.organization_id) byId.set(row.organization_id, null);
    }
    for (const payment of payments) {
      byId.set(payment.organization_id, payment.organization_name ?? byId.get(payment.organization_id) ?? null);
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [payload.live, payments]);

  useEffect(() => {
    if (!form.organizationId && companies.length > 0) {
      setForm((current) => ({ ...current, organizationId: companies[0].id }));
    }
  }, [companies, form.organizationId]);

  async function registerPayment() {
    if (!form.organizationId || !form.amount || formBusy) return;
    setFormBusy(true);
    setFormMessage(null);
    try {
      const amountCents = Math.round(Number.parseFloat(form.amount || "0") * 100);
      await api.createPayment({
        organization_id: form.organizationId,
        amount_cents: amountCents,
        payment_method: form.method,
        reference_number: form.reference || undefined,
        note: form.note || undefined
      });
      setForm((current) => ({ ...current, amount: "", reference: "", note: "" }));
      setFormMessage(t("Submitted. Your company will confirm it."));
      await load();
    } catch (cause) {
      setFormMessage(cause instanceof Error ? cause.message : t("Could not register payment"));
    } finally {
      setFormBusy(false);
    }
  }

  const stats = useMemo(() => {
    const liveEstimate = payload.live.reduce((sum, row) => sum + (row.tech_payout_cents ?? 0), 0);
    const locked = payload.period_rows.filter((row) => row.status === "locked").reduce((sum, row) => sum + (row.row.tech_payout_cents ?? 0), 0);
    const paid = payload.period_rows.filter((row) => row.status === "paid").reduce((sum, row) => sum + (row.row.tech_payout_cents ?? 0), 0);
    return { liveEstimate, locked, paid };
  }, [payload]);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={sharedStyles.kicker}>{t("Settlements")}</Text>
          <Text style={styles.title}>{t("Earnings")}</Text>
          <Text style={styles.subtitle}>{t("Your provider-calculated payout rows. Paid means your company marked external payment complete.")}</Text>
        </View>
        <Pressable accessibilityLabel={t("Refresh")} onPress={() => void load()} style={styles.refreshButton}>
          <Ionicons color={colors.foreground} name="refresh" size={16} />
        </Pressable>
      </View>

      {state === "error" ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.statsRow}>
        <StatBox label={t("Estimate")} value={money(stats.liveEstimate)} />
        <StatBox label={t("Locked")} tone="warn" value={money(stats.locked)} />
        <StatBox label={t("Paid")} tone="success" value={money(stats.paid)} />
      </View>

      <Section title={t("Payments")} count={payments.length}>
        <View style={styles.formBox}>
          <Text style={styles.formHint}>{t("Register a payment you made to the company")}</Text>
          {formMessage ? <Text style={styles.formMessage}>{formMessage}</Text> : null}
          {companies.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.companyRow}>
              {companies.map((company) => {
                const active = form.organizationId === company.id;
                return (
                  <Pressable key={company.id} onPress={() => setForm((current) => ({ ...current, organizationId: company.id }))} style={[styles.companyChip, active ? styles.companyChipActive : null]}>
                    <Text style={[styles.companyChipText, active ? styles.companyChipTextActive : null]}>{company.name ?? t(`Company ${company.id.slice(0, 8)}`)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          <TextInput
            inputMode="decimal"
            keyboardType="decimal-pad"
            onChangeText={(value) => setForm((current) => ({ ...current, amount: value.replace(/[^0-9.]/g, "") }))}
            placeholder={t("Amount $")}
            placeholderTextColor={colors.mutedFaint}
            style={styles.input}
            value={form.amount}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.companyRow}>
            {PAYMENT_METHODS.map((method) => {
              const active = form.method === method;
              return (
                <Pressable key={method} onPress={() => setForm((current) => ({ ...current, method }))} style={[styles.companyChip, active ? styles.companyChipActive : null]}>
                  <Text style={[styles.companyChipText, active ? styles.companyChipTextActive : null]}>{t(method.replaceAll("_", " "))}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <TextInput
            onChangeText={(value) => setForm((current) => ({ ...current, reference: value }))}
            placeholder={t("Reference (optional)")}
            placeholderTextColor={colors.mutedFaint}
            style={styles.input}
            value={form.reference}
          />
          <TextInput
            onChangeText={(value) => setForm((current) => ({ ...current, note: value }))}
            placeholder={t("Note (optional)")}
            placeholderTextColor={colors.mutedFaint}
            style={styles.input}
            value={form.note}
          />
          <FieldButton disabled={!form.organizationId || !form.amount} label={t("Submit for confirmation")} loading={formBusy} onPress={() => void registerPayment()} tone="secondary" />
        </View>

        {payments.length > 0 ? (
          <View style={styles.list}>
            {payments.map((payment) => (
              <View key={payment.id} style={styles.paymentRow}>
                <View style={styles.paymentRowText}>
                  <Text style={styles.paymentTitle}>
                    {payment.direction === "company_to_technician" ? t("Company paid you") : t("You paid the company")} · {money(payment.amount_cents)}
                  </Text>
                  <Text style={styles.paymentMeta}>
                    {formatDate(payment.paid_on)} · {t(payment.payment_method.replaceAll("_", " "))}
                    {payment.reference_number ? ` · ${t("ref")} ${payment.reference_number}` : ""}
                    {payment.organization_name ? ` · ${payment.organization_name}` : ""}
                  </Text>
                  {payment.status === "rejected" && payment.rejected_reason ? (
                    <Text style={styles.paymentRejected}>{t("Rejected:")} {payment.rejected_reason}</Text>
                  ) : null}
                </View>
                <Pill tone={payment.status === "confirmed" ? "success" : payment.status === "pending" ? "warn" : "muted"}>{t(payment.status)}</Pill>
              </View>
            ))}
          </View>
        ) : null}
      </Section>

      <Section title={t("Approved settlement periods")} count={payload.period_rows.length}>
        {state === "loading" ? (
          <Text style={styles.emptyText}>{t("Loading earnings…")}</Text>
        ) : payload.period_rows.length === 0 ? (
          <Text style={styles.emptyText}>{t("No settlement periods yet. Your company must create and lock a settlement period before rows appear here.")}</Text>
        ) : (
          <View style={styles.list}>
            {payload.period_rows.map((item: SettlementPeriodRow) => (
              <View key={`${item.settlement_period_id}-${item.row.job_id}`} style={styles.periodRow}>
                <View style={styles.periodHeaderRow}>
                  <Text numberOfLines={1} style={styles.periodLabel}>{item.label}</Text>
                  <Pill tone={periodStatusTone(item.status)}>{t(item.status)}</Pill>
                </View>
                <Text style={styles.periodDates}>{formatDate(item.period_start)} – {formatDate(item.period_end)} · {t("job")} {item.row.job_id.slice(0, 8)}</Text>
                <View style={styles.periodMetaGrid}>
                  <MetaLine label={t("Payout")} value={money(item.row.tech_payout_cents, item.row.currency)} />
                  <MetaLine label={t("Service cut")} value={percent(item.row.cut_basis_points)} />
                  <MetaLine label={t("Reimbursement")} value={money(item.row.tech_reimbursement_cents, item.row.currency)} />
                  <MetaLine label={t("Tip share")} value={money(item.row.tech_tip_cents, item.row.currency)} />
                </View>
                {item.status === "paid" ? <Text style={styles.paidNote}>{t("Marked paid by provider on")} {formatDate(item.paid_at)}.</Text> : null}
              </View>
            ))}
          </View>
        )}
      </Section>

      <Section title={t("Current payout estimates")} count={payload.live.length}>
        {payload.live.length === 0 ? (
          <Text style={styles.emptyText}>{t("No calculated settlement rows yet. Completed itemized closeouts appear here before provider approval.")}</Text>
        ) : (
          <View style={styles.list}>
            {payload.live.map((row) => (
              <View key={row.job_id} style={styles.periodRow}>
                <View style={styles.periodHeaderRow}>
                  <Text style={styles.periodLabel}>{row.skill_code ? t(row.skill_code.replaceAll("_", " ")) : t("Service job")}</Text>
                  <Ionicons color={colors.primary} name="briefcase-outline" size={16} />
                </View>
                <Text style={styles.periodDates}>{t("Finished")} {formatDate(row.finished_at)} · {t("agreement")} {t(row.agreement_status)}</Text>
                <View style={styles.periodMetaGrid}>
                  <MetaLine label={t("Estimated payout")} value={money(row.tech_payout_cents, row.currency)} />
                  <MetaLine label={t("Commissionable")} value={money(row.commissionable_cents, row.currency)} />
                  <MetaLine label={t("Service cut")} value={percent(row.cut_basis_points)} />
                  <MetaLine label={t("Tech items")} value={money(row.tech_reimbursement_cents, row.currency)} />
                </View>
              </View>
            ))}
          </View>
        )}
      </Section>
    </ScrollView>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Pill tone="muted">{String(count)}</Pill>
      </View>
      {children}
    </View>
  );
}

function StatBox({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "warn" | "success" }) {
  return (
    <View style={[styles.statBox, tone === "warn" ? styles.statBoxWarn : tone === "success" ? styles.statBoxSuccess : null]}>
      <Text style={[styles.statLabel, tone === "warn" ? styles.statLabelWarn : tone === "success" ? styles.statLabelSuccess : null]}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaLine}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: 20,
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
  statBoxWarn: {
    backgroundColor: "rgba(255, 191, 0, 0.12)",
    borderColor: colors.primary
  },
  statBoxSuccess: {
    backgroundColor: "rgba(61, 191, 122, 0.1)",
    borderColor: colors.success
  },
  statLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  statLabelWarn: {
    color: colors.primary
  },
  statLabelSuccess: {
    color: colors.success
  },
  statValue: {
    color: colors.foreground,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 4
  },
  section: {
    gap: 10
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "800"
  },
  formBox: {
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 8,
    padding: 12
  },
  formHint: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  formMessage: {
    backgroundColor: colors.card,
    borderRadius: radius.xs,
    color: colors.foreground,
    fontSize: 12,
    fontWeight: "700",
    padding: 8
  },
  companyRow: {
    flexGrow: 0
  },
  companyChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginRight: 8,
    minHeight: 34,
    paddingHorizontal: 12
  },
  companyChipActive: {
    backgroundColor: "rgba(255, 191, 0, 0.12)",
    borderColor: colors.primary
  },
  companyChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "capitalize"
  },
  companyChipTextActive: {
    color: colors.primary
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.xs,
    borderWidth: 1,
    color: colors.foreground,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12
  },
  list: {
    gap: 10
  },
  paymentRow: {
    backgroundColor: colors.cardStrong,
    borderRadius: radius.xs,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    padding: 12
  },
  paymentRowText: {
    flex: 1
  },
  paymentTitle: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "800"
  },
  paymentMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4
  },
  paymentRejected: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  periodRow: {
    backgroundColor: colors.cardStrong,
    borderRadius: radius.xs,
    padding: 12
  },
  periodHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  periodLabel: {
    color: colors.foreground,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "capitalize"
  },
  periodDates: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4
  },
  periodMetaGrid: {
    gap: 4,
    marginTop: 10
  },
  metaLine: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 12
  },
  metaValue: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: "800"
  },
  paidNote: {
    color: colors.success,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 8
  }
});
