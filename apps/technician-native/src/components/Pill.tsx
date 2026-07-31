import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius, tone } from "../theme";
import type { ToneKey } from "../theme";

export function Pill({ children, icon, tone: toneKey = "default" }: { children: string; icon?: ReactNode; tone?: ToneKey }) {
  const t = tone(toneKey);
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      {icon}
      <Text style={[styles.label, { color: t.text }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 26,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  label: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  }
});
