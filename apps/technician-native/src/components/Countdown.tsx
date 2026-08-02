import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocale } from "../i18n/LocaleContext";
import { colors } from "../theme";

// Mirrors technician-web's Countdown (client-widgets.tsx): mm:ss driven by
// the server's expires_at, progress bar denominator prefers the offer's real
// offered_at→expires_at window over an assumed fixed TTL.
export function Countdown({ expiresAt, offeredAt }: { expiresAt: string; offeredAt?: string | null }) {
  const { t } = useLocale();
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, target - now);
  const initialRemaining = useRef(remaining);
  const totalWindow = useMemo(() => {
    if (offeredAt) {
      const start = new Date(offeredAt).getTime();
      if (!Number.isNaN(start) && target > start) return target - start;
    }
    return initialRemaining.current || remaining;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeredAt, target]);

  const seconds = Math.floor(remaining / 1000);
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  const pct = totalWindow > 0 ? Math.max(0, Math.min(100, (remaining / totalWindow) * 100)) : 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.time}>{minutesPart}:{secondsPart}</Text>
      <Text style={styles.caption}>{t("offer expires · server timer")}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center"
  },
  time: {
    color: colors.foreground,
    fontSize: 64,
    fontWeight: "900",
    letterSpacing: 1,
    lineHeight: 68
  },
  caption: {
    color: colors.mutedFaint,
    fontFamily: "monospace",
    fontSize: 11,
    marginTop: 6,
    textTransform: "uppercase"
  },
  track: {
    backgroundColor: colors.cardStrong,
    borderRadius: 999,
    height: 6,
    marginTop: 12,
    overflow: "hidden",
    width: 200
  },
  fill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: "100%"
  }
});
