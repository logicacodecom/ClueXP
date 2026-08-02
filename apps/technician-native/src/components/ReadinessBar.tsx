import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusCell } from "./StatusCell";
import { FieldButton } from "./FieldButton";
import { useLocale } from "../i18n/LocaleContext";
import { colors, radius } from "../theme";
import type { ReadinessSnapshot } from "../types";

type CellKey = "available" | "location" | "alerts" | "connection";
type Tone = "good" | "warn" | "bad" | "neutral";

function ageLabel(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function toneColor(tone: Tone) {
  if (tone === "good") return colors.success;
  if (tone === "bad") return colors.danger;
  if (tone === "warn") return colors.primary;
  return colors.mutedFaint;
}

/**
 * Mirrors technician-web's WorkReadiness (readiness-bar.tsx): a tap-to-expand
 * four-cell grid (Available/Location/Alerts/Connection), and — only while
 * marked available — a blocker hero with the named cause and a real one-tap
 * fix. Simply being offline shows no hero, same as web: the fix lives behind
 * the Available cell's own expand panel. `online` is a client-side signal
 * (a fetch-level TypeError from the polling loop, same "offline" heuristic
 * this app already uses to route mutations into the outbox) since native has
 * no browser online/offline event — closer to web's own client-computed
 * check than a server field would be.
 */
export function ReadinessBar({ readiness, online, busy, onSetAvailable, onLocation, onPush }: {
  readiness: ReadinessSnapshot | null;
  online: boolean;
  busy: boolean;
  onSetAvailable: (next: boolean) => void;
  onLocation: () => void;
  onPush: () => void;
}) {
  const { t } = useLocale();
  const [openCell, setOpenCell] = useState<CellKey | null>(null);

  const available = readiness?.account.available ?? null;
  const locationFresh = Boolean(readiness?.location.fresh);
  const locationAt = readiness?.location.updated_at ?? null;
  const pushReady = Boolean(readiness?.push.push_ready);
  const blockers = readiness?.blocking_reasons ?? [];

  const cells: Array<{ key: CellKey; label: string; icon: keyof typeof Ionicons.glyphMap; tone: Tone; headline: string; detail: string; action?: { label: string; onPress: () => void } }> = [
    {
      key: "available",
      label: t("Available"),
      icon: "shield-checkmark-outline",
      tone: available === null ? "neutral" : available ? "good" : "neutral",
      headline: available ? t("You're marked available") : t("You're offline"),
      detail: available ? t("Companies can see and offer you jobs.") : t("Go online to start receiving offers."),
      action: available === null ? undefined : { label: available ? t("Go offline") : t("Go online"), onPress: () => onSetAvailable(!available) }
    },
    {
      key: "location",
      label: t("Location"),
      icon: "locate-outline",
      tone: !locationAt ? "warn" : locationFresh ? "good" : "warn",
      headline: !locationAt ? t("Location not shared yet") : locationFresh ? t("Location fresh") : t("Location stale"),
      detail: locationAt
        ? t(`Updated ${ageLabel(locationAt)}. A fresher fix helps match nearby work precisely.`)
        : t("Sharing a fix helps dispatch match you with nearby work precisely."),
      action: { label: t("Refresh"), onPress: onLocation }
    },
    {
      key: "alerts",
      label: t("Alerts"),
      icon: pushReady ? "notifications-outline" : "notifications-off-outline",
      tone: pushReady ? "good" : "warn",
      headline: pushReady ? t("Alerts on") : t("Alerts needed"),
      detail: pushReady
        ? t("You'll get a push alert for new offers, even with the app backgrounded.")
        : t("Enable notifications on a physical device so you don't miss an offer."),
      action: pushReady ? undefined : { label: t("Enable"), onPress: onPush }
    },
    {
      key: "connection",
      label: t("Connection"),
      icon: online ? "wifi-outline" : "cloud-offline-outline",
      tone: online ? "good" : "bad",
      headline: online ? t("Connected") : t("No connection"),
      detail: online ? t("Live sync with dispatch is working.") : t("Reconnect to the internet to receive offers.")
    }
  ];

  const openCellData = cells.find((cell) => cell.key === openCell) ?? null;

  const showHero = Boolean(readiness) && available === true && (!online || !readiness?.can_receive_offers);
  const hero = showHero
    ? !online
      ? { tone: "bad" as Tone, icon: "cloud-offline-outline" as const, cause: t("No connection"), detail: t("Reconnect to the internet — offers can't reach you until it's back."), action: undefined }
      : blockers.includes("location_stale")
        ? { tone: "warn" as Tone, icon: "locate-outline" as const, cause: t("Location access is stale"), detail: t("ClueXP needs a fresh location fix while you're available so companies can send offers near you."), action: { label: t("Fix location access"), onPress: onLocation } }
        : blockers.includes("push_not_ready")
          ? { tone: "warn" as Tone, icon: "notifications-off-outline" as const, cause: t("Alerts are off"), detail: t("Enable notifications on a physical device so offers can reach you."), action: { label: t("Enable alerts"), onPress: onPush } }
          : { tone: "neutral" as Tone, icon: "time-outline" as const, cause: t("Not receiving offers"), detail: blockers.length > 0 ? t(blockers.join(" / ").replaceAll("_", " ")) : t("Resolve the blocker above."), action: undefined }
    : null;

  return (
    <View>
      <View style={styles.grid}>
        {cells.map((cell, index) => (
          <View key={cell.key} style={[styles.cellWrap, index > 0 ? styles.cellDivider : null]}>
            <StatusCell
              active={openCell === cell.key}
              icon={cell.icon}
              label={cell.label}
              onPress={() => setOpenCell((current) => (current === cell.key ? null : cell.key))}
              tone={cell.tone}
            />
          </View>
        ))}
      </View>

      {openCellData ? (
        <View style={styles.detailPanel}>
          <Ionicons color={toneColor(openCellData.tone)} name={openCellData.icon} size={20} style={styles.detailIcon} />
          <View style={styles.detailBody}>
            <Text style={styles.detailHeadline}>{openCellData.headline}</Text>
            <Text style={styles.detailText}>{openCellData.detail}</Text>
            {openCellData.action ? (
              <FieldButton label={openCellData.action.label} loading={busy} onPress={openCellData.action.onPress} tone="secondary" />
            ) : null}
          </View>
        </View>
      ) : null}

      {available === false || !hero ? null : (
        <View style={styles.hero}>
          <View style={[styles.heroCircle, { borderColor: toneColor(hero.tone) }]}>
            <Ionicons color={toneColor(hero.tone)} name={hero.icon} size={30} />
          </View>
          <View style={styles.heroTitleRow}>
            <Ionicons color={toneColor(hero.tone)} name="alert-circle-outline" size={18} />
            <Text style={[styles.heroTitle, { color: toneColor(hero.tone) }]}>{t("Not receiving offers")}</Text>
          </View>
          <Text style={styles.heroCause}>{hero.cause}</Text>
          <Text style={styles.heroDetail}>{hero.detail}</Text>
          {hero.action ? <FieldButton label={hero.action.label} loading={busy} onPress={hero.action.onPress} /> : null}
          <FieldButton label={t("Go offline")} loading={busy} onPress={() => onSetAvailable(false)} tone="secondary" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden"
  },
  cellWrap: {
    flex: 1
  },
  cellDivider: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1
  },
  detailPanel: {
    backgroundColor: colors.cardStrong,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    borderColor: colors.border,
    borderTopWidth: 0,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginTop: -1,
    padding: 12
  },
  detailIcon: {
    marginTop: 2
  },
  detailBody: {
    flex: 1,
    gap: 10
  },
  detailHeadline: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800"
  },
  detailText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18
  },
  hero: {
    alignItems: "center",
    borderColor: colors.border,
    borderTopWidth: 1,
    gap: 8,
    marginTop: 20,
    paddingTop: 26,
    paddingVertical: 10
  },
  heroCircle: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 2,
    height: 64,
    justifyContent: "center",
    width: 64
  },
  heroTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 8
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  heroCause: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 4
  },
  heroDetail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 6,
    maxWidth: 280,
    textAlign: "center"
  }
});
