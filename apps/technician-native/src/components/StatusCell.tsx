import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";

type Tone = "good" | "warn" | "bad" | "neutral";

export function StatusCell({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const dotStyle =
    tone === "good" ? styles.dotGood :
    tone === "bad" ? styles.dotBad :
    tone === "warn" ? styles.dotWarn :
    styles.dotNeutral;
  return (
    <View style={styles.cell}>
      <View style={[styles.dot, dotStyle]} />
      <Text style={styles.label}>{label}</Text>
      <Text numberOfLines={1} style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    minHeight: 72,
    padding: 8
  },
  dot: {
    borderRadius: 4,
    height: 8,
    marginBottom: 6,
    width: 8
  },
  dotGood: {
    backgroundColor: colors.success
  },
  dotBad: {
    backgroundColor: colors.danger
  },
  dotWarn: {
    backgroundColor: colors.primary
  },
  dotNeutral: {
    backgroundColor: colors.mutedFaint
  },
  label: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "700"
  },
  value: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 3
  }
});
