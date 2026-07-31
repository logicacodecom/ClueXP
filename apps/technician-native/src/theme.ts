import { StyleSheet } from "react-native";

export const colors = {
  background: "#0E0E0E",
  card: "#161513",
  cardStrong: "#1B1916",
  cardRaised: "#242019",
  border: "#2B2823",
  borderStrong: "#3A362F",
  foreground: "#F1EDE4",
  muted: "#A39C8E",
  mutedFaint: "#6E6759",
  primary: "#FFBF00",
  primaryText: "#141210",
  success: "#3DBF7A",
  successSoft: "#8FCBAA",
  danger: "#E5484D",
  dangerSoft: "#EDD9D9",
  info: "#7FA7FF",
  cautionBg: "#1E1A10",
  cautionBorder: "#5C4A14"
} as const;

export const radius = {
  sm: 5,
  md: 8,
  lg: 12
} as const;

export const sharedStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background
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
    borderRadius: radius.md,
    borderWidth: 1
  }
});
