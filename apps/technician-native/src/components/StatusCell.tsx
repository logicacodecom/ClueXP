import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../theme";

type Tone = "good" | "warn" | "bad" | "neutral";

// A tap-to-expand cell in the readiness grid — mirrors technician-web's
// WorkReadiness cell buttons (icon + label only; the detail lives in the
// panel that opens below when active).
export function StatusCell({ icon, label, tone, active = false, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: Tone;
  active?: boolean;
  onPress: () => void;
}) {
  const color = tone === "good" ? colors.success : tone === "bad" ? colors.danger : tone === "warn" ? colors.primary : colors.mutedFaint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: active }}
      onPress={onPress}
      style={[styles.cell, active ? styles.cellActive : null]}
    >
      <Ionicons name={icon} color={color} size={18} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    alignItems: "center",
    flex: 1,
    gap: 6,
    justifyContent: "center",
    minHeight: 58,
    paddingVertical: 8
  },
  cellActive: {
    backgroundColor: colors.cardStrong
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600"
  }
});
