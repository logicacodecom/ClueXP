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

// Mirrors technician-web's .field-primary-action / .field-secondary-action
// (globals.css) — the actual button classes used on the readiness, offer,
// and active-job screens: uppercase, min-h-[58px] for primary, no rounding
// beyond 6px. mobile.tsx's separate rounded-2xl PrimaryButton is not what's
// live on those screens.
export function FieldButton({ label, onPress, disabled = false, loading = false, tone = "primary", icon }: Props) {
  const primaryDisabled = disabled && tone === "primary";
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
        primaryDisabled ? styles.primaryDisabled : (disabled || loading) ? styles.disabled : null
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone === "primary" ? colors.primaryText : colors.foreground} />
      ) : icon ? (
        <View style={styles.icon}>{icon}</View>
      ) : null}
      <Text
        style={[
          styles.label,
          tone === "primary" ? styles.primaryLabel : styles.secondaryLabel,
          tone === "danger" ? styles.dangerLabel : null,
          primaryDisabled ? styles.primaryDisabledLabel : null
        ]}
      >
        {label}
      </Text>
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
    paddingHorizontal: 16,
    width: "100%"
  },
  primary: {
    backgroundColor: colors.primary,
    borderWidth: 0,
    minHeight: 58
  },
  secondary: {
    backgroundColor: "rgba(27, 25, 22, 0.96)",
    borderColor: colors.borderStrong,
    minHeight: 48
  },
  danger: {
    backgroundColor: colors.danger,
    borderWidth: 0,
    minHeight: 58
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }]
  },
  primaryDisabled: {
    backgroundColor: "#5C4A14"
  },
  disabled: {
    opacity: 0.55
  },
  icon: {
    minWidth: 1
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  primaryLabel: {
    color: colors.primaryText,
    fontSize: 21,
    letterSpacing: 0.9
  },
  secondaryLabel: {
    color: colors.foreground
  },
  dangerLabel: {
    color: "#250606"
  },
  primaryDisabledLabel: {
    color: "#A6987B"
  }
});
