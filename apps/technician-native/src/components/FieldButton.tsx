import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "secondary" | "danger";
  icon?: ReactNode;
};

// Mirrors technician-web's PrimaryButton (mobile.tsx): rounded-2xl, min-h-[52px],
// font-black text-[15px]. "ghost" was dropped — web only has primary/secondary/danger.
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
        tone === "danger" ? styles.danger : null,
        pressed ? styles.pressed : null,
        disabled || loading ? styles.disabled : null
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone === "primary" ? colors.primaryText : colors.foreground} />
      ) : icon ? (
        <View style={styles.icon}>{icon}</View>
      ) : null}
      <Text style={[styles.label, tone === "primary" ? styles.primaryLabel : null, tone === "danger" ? styles.dangerLabel : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
    width: "100%"
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  secondary: {
    backgroundColor: colors.cardStrong,
    borderColor: colors.border
  },
  danger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }]
  },
  disabled: {
    opacity: 0.55
  },
  icon: {
    minWidth: 1
  },
  label: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "900"
  },
  primaryLabel: {
    color: colors.primaryText
  },
  dangerLabel: {
    color: "#250606"
  }
});
