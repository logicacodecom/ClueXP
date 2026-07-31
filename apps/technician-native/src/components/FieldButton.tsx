import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "secondary" | "ghost" | "danger";
  icon?: ReactNode;
};

export function FieldButton({ label, onPress, disabled = false, loading = false, tone = "primary", icon }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        tone === "primary" ? styles.primary : null,
        tone === "secondary" ? styles.secondary : null,
        tone === "ghost" ? styles.ghost : null,
        tone === "danger" ? styles.danger : null,
        pressed ? styles.pressed : null,
        disabled || loading ? styles.disabled : null
      ]}
    >
      {loading ? <ActivityIndicator color={tone === "primary" ? colors.primaryText : colors.foreground} /> : <View style={styles.icon}>{icon}</View>}
      <Text style={[styles.label, tone === "primary" ? styles.primaryLabel : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 58,
    paddingHorizontal: 16
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  secondary: {
    backgroundColor: "#142144",
    borderColor: "#274981"
  },
  ghost: {
    backgroundColor: colors.card,
    borderColor: colors.border
  },
  danger: {
    backgroundColor: "#1A1213",
    borderColor: "#4A2325"
  },
  pressed: {
    opacity: 0.82
  },
  disabled: {
    opacity: 0.55
  },
  icon: {
    minWidth: 1
  },
  label: {
    color: colors.foreground,
    fontSize: 18,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  primaryLabel: {
    color: colors.primaryText
  }
});
