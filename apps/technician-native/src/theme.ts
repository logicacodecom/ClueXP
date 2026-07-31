import { Platform, StyleSheet } from "react-native";

// Mirrors apps/technician-web/src/app/globals.css so native and web read as
// the same product. Keep these in sync when the web tokens change.
export const colors = {
  background: "#0E0E0E",
  backgroundOuter: "#090909",
  card: "#161513",
  cardStrong: "#24211D",
  cardRail: "#1B1916",
  border: "#2B2823",
  borderStrong: "#3A362F",
  foreground: "#F1EDE4",
  muted: "#8A8171",
  mutedFaint: "#6E6759",
  primary: "#FFBF00",
  primaryText: "#1D1500",
  success: "#3DBF7A",
  successSoft: "#8FCBAA",
  danger: "#E5484D",
  dangerSoft: "#EDD9D9",
  info: "#62A8FF",
  warn: "#F5B53D",
  cautionBg: "#1E1A10",
  cautionBorder: "#5C4A14"
} as const;

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 22,
  pill: 999
} as const;

function alpha(hex: string, opacity: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export type ToneKey = "default" | "success" | "warn" | "danger" | "info" | "muted";

// Mirrors technician-web's toneClass() (mobile.tsx) — border/bg alpha blends
// over the tone color, same ratios, so Pill/MiniStat read identically to web.
export function tone(key: ToneKey) {
  if (key === "success") return { bg: alpha(colors.success, 0.1), border: alpha(colors.success, 0.3), text: colors.success };
  if (key === "danger") return { bg: alpha(colors.danger, 0.1), border: alpha(colors.danger, 0.35), text: colors.danger };
  if (key === "info") return { bg: alpha(colors.info, 0.1), border: alpha(colors.info, 0.3), text: colors.info };
  if (key === "muted") return { bg: colors.cardStrong, border: colors.border, text: colors.muted };
  return { bg: alpha(colors.primary, 0.12), border: alpha(colors.primary, 0.35), text: colors.primary };
}

export const sharedStyles = StyleSheet.create({
  screen: {
    alignItems: Platform.OS === "web" ? "center" : "stretch",
    flex: 1,
    backgroundColor: Platform.OS === "web" ? colors.backgroundOuter : colors.background
  },
  kicker: {
    color: colors.primary,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  title: {
    color: colors.foreground,
    fontSize: 34,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22
  },
  panel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1
  },
  // Web preview only: technician-web renders its phone shell at max-w-[480px],
  // centered on a dark page background. Native builds ignore this — flex:1
  // already fills the device screen edge-to-edge.
  phoneFrame:
    Platform.OS === "web"
      ? { flex: 1, maxWidth: 480, width: "100%", backgroundColor: colors.background }
      : { flex: 1 }
});
