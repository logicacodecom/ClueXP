import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CluexpApi } from "../api/client";
import { Pill } from "../components/Pill";
import { colors, radius, sharedStyles } from "../theme";
import type { TechnicianAffiliation, TechnicianOrganization } from "../types";

function statusTone(status: TechnicianAffiliation["status"]): "warn" | "success" | "danger" | "muted" {
  if (status === "pending_invite") return "warn";
  if (status === "active") return "success";
  if (status === "suspended") return "danger";
  return "muted";
}

function statusLabel(status: TechnicianAffiliation["status"]) {
  if (status === "pending_invite") return "Pending";
  if (status === "active") return "Active";
  if (status === "suspended") return "Suspended";
  if (status === "rejected") return "Rejected";
  return "Ended";
}

export function TeamScreen({ api, onClose }: { api: CluexpApi; onClose: () => void }) {
  const [affiliations, setAffiliations] = useState<TechnicianAffiliation[]>([]);
  const [organizations, setOrganizations] = useState<TechnicianOrganization[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notReady, setNotReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const [affiliationRows, organizationRows] = await Promise.all([api.affiliations(), api.organizations()]);
      setAffiliations(affiliationRows);
      setOrganizations(organizationRows);
      setNotReady(false);
      setState("ready");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not load affiliations");
      setNotReady(true);
      setState("error");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept(affiliationId: string) {
    setBusyId(affiliationId);
    setMessage(null);
    try {
      await api.acceptAffiliation(affiliationId);
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Failed to accept affiliation");
    } finally {
      setBusyId(null);
    }
  }

  async function decline(affiliationId: string) {
    setBusyId(affiliationId);
    setMessage(null);
    try {
      await api.declineAffiliation(affiliationId);
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Failed to decline affiliation");
    } finally {
      setBusyId(null);
    }
  }

  async function leave(affiliationId: string) {
    setBusyId(affiliationId);
    setMessage(null);
    try {
      await api.leaveAffiliation(affiliationId);
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Failed to leave company");
    } finally {
      setBusyId(null);
    }
  }

  function organizationName(affiliation: TechnicianAffiliation) {
    if (affiliation.organization_name) return affiliation.organization_name;
    const found = organizations.find((org) => org.id === affiliation.organization_id);
    return found?.name || `Organization ${affiliation.organization_id.slice(0, 8)}`;
  }

  const pending = affiliations.filter((item) => item.status === "pending_invite");
  const active = affiliations.filter((item) => item.status === "active");
  const past = affiliations.filter((item) => item.status === "ended" || item.status === "suspended" || item.status === "rejected");

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={sharedStyles.title}>Team</Text>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.closeButton}>
          <Ionicons color={colors.foreground} name="close" size={20} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.subtitle}>Provider affiliations, pending invites, and work history.</Text>

        {notReady ? (
          <Text style={styles.errorText}>{message || "Affiliations could not be loaded."}</Text>
        ) : (
          <>
            <View style={styles.statsRow}>
              <StatBox label="Pending" value={String(pending.length)} />
              <StatBox label="Active" value={String(active.length)} />
              <StatBox label="History" value={String(past.length)} />
            </View>

            {message ? <Text style={styles.errorText}>{message}</Text> : null}

            {pending.length > 0 ? (
              <Section title="Pending invites">
                {pending.map((item) => (
                  <View key={item.id} style={styles.card}>
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.cardTitle}>{organizationName(item)}</Text>
                      <Pill tone={statusTone(item.status)}>{statusLabel(item.status)}</Pill>
                    </View>
                    {item.affiliation_type ? (
                      <Text style={styles.cardMeta}>{item.affiliation_type.toUpperCase().replaceAll("_", " ")} · {(item.exclusivity || "non_exclusive").replaceAll("_", " ")}</Text>
                    ) : null}
                    <View style={styles.actionRow}>
                      <View style={styles.actionHalf}>
                        <Pressable disabled={busyId === item.id} onPress={() => void decline(item.id)} style={styles.declineButton}>
                          <Ionicons color={colors.danger} name="close" size={16} />
                          <Text style={styles.declineButtonText}>Decline</Text>
                        </Pressable>
                      </View>
                      <View style={styles.actionHalf}>
                        <Pressable disabled={busyId === item.id} onPress={() => void accept(item.id)} style={styles.acceptButton}>
                          <Ionicons color={colors.primaryText} name="checkmark" size={16} />
                          <Text style={styles.acceptButtonText}>{busyId === item.id ? "Working…" : "Accept"}</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ))}
              </Section>
            ) : null}

            {active.length > 0 ? (
              <Section title="Active affiliations">
                {active.map((item) => (
                  <View key={item.id} style={styles.card}>
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.cardTitle}>{organizationName(item)}</Text>
                      <Pill tone={statusTone(item.status)}>{statusLabel(item.status)}</Pill>
                    </View>
                    <View style={styles.chipRow}>
                      {item.affiliation_type ? <Text style={styles.metaChip}>{item.affiliation_type.replaceAll("_", " ")}</Text> : null}
                      {item.exclusivity ? <Text style={styles.metaChip}>{item.exclusivity.replaceAll("_", " ")}</Text> : null}
                      <Text style={[styles.metaChip, item.dispatch_allowed ? styles.metaChipGood : null]}>
                        {item.dispatch_allowed ? "Dispatch allowed" : "Not dispatchable"}
                      </Text>
                    </View>
                    <Pressable disabled={busyId === item.id} onPress={() => void leave(item.id)} style={styles.leaveButton}>
                      <Text style={styles.leaveButtonText}>{busyId === item.id ? "Working…" : "Leave company"}</Text>
                    </Pressable>
                  </View>
                ))}
              </Section>
            ) : null}

            {past.length > 0 ? (
              <Section title="Past affiliations">
                {past.map((item) => (
                  <View key={item.id} style={[styles.card, styles.cardFaded]}>
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.cardTitle}>{organizationName(item)}</Text>
                      <Pill tone={statusTone(item.status)}>{statusLabel(item.status)}</Pill>
                    </View>
                  </View>
                ))}
              </Section>
            ) : null}

            {state === "ready" && affiliations.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons color={colors.muted} name="people-outline" size={26} />
                <Text style={styles.emptyBoxTitle}>No provider affiliations</Text>
                <Text style={styles.emptyBoxText}>You are not yet affiliated with any provider companies. When you accept an invitation, it will appear here.</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 18
  },
  closeButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  body: {
    gap: 20,
    padding: 18,
    paddingBottom: 60
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  errorText: {
    color: colors.danger,
    fontSize: 13
  },
  statsRow: {
    flexDirection: "row",
    gap: 8
  },
  statBox: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12
  },
  statValue: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: "900"
  },
  statLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
    textTransform: "uppercase"
  },
  section: {
    gap: 10
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "800"
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 10,
    marginBottom: 10,
    padding: 14
  },
  cardFaded: {
    opacity: 0.7
  },
  cardHeaderRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  cardTitle: {
    color: colors.foreground,
    flex: 1,
    fontSize: 15,
    fontWeight: "800"
  },
  cardMeta: {
    color: colors.muted,
    fontSize: 12
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  metaChip: {
    backgroundColor: colors.cardStrong,
    borderRadius: 999,
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
    textTransform: "uppercase"
  },
  metaChipGood: {
    color: colors.success
  },
  actionRow: {
    flexDirection: "row",
    gap: 10
  },
  actionHalf: {
    flex: 1
  },
  declineButton: {
    alignItems: "center",
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 44
  },
  declineButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800"
  },
  acceptButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 44
  },
  acceptButtonText: {
    color: colors.primaryText,
    fontSize: 13,
    fontWeight: "800"
  },
  leaveButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center"
  },
  leaveButtonText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  emptyBox: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 6,
    padding: 22
  },
  emptyBoxTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800"
  },
  emptyBoxText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center"
  }
});
