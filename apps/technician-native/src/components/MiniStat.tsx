import { StyleSheet, Text, View } from "react-native";
import { radius, tone } from "../theme";
import type { ToneKey } from "../theme";

export function MiniStat({ label, value, tone: toneKey = "muted" }: { label: string; value: string; tone?: ToneKey }) {
  const t = tone(toneKey);
  return (
    <View style={[styles.box, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text numberOfLines={1} style={[styles.label, { color: t.text }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.value, { color: t.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: 10
  },
  label: {
    fontSize: 10,
    fontWeight: "900",
    opacity: 0.8,
    textTransform: "uppercase"
  },
  value: {
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4
  }
});
