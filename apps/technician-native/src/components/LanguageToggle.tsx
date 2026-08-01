import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export type Locale = "en" | "es";

const LABELS: Record<Locale, string> = { en: "English", es: "Espanol" };
const LOCALES: Locale[] = ["en", "es"];

// Mirrors technician-web's LanguageToggle (@cluexp/app-core locale.tsx):
// a rounded-full segmented pill, only shown on sign-in on web too.
export function LanguageToggle({ locale, onChange }: { locale: Locale; onChange: (locale: Locale) => void }) {
  return (
    <View accessibilityLabel="Language" accessibilityRole="radiogroup" style={styles.track}>
      {LOCALES.map((item) => {
        const active = locale === item;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            key={item}
            onPress={() => onChange(item)}
            style={[styles.segment, active ? styles.segmentActive : null]}
          >
            <Text style={[styles.label, active ? styles.labelActive : null]}>{LABELS[item]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    alignSelf: "flex-start",
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3
  },
  segment: {
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 12
  },
  segmentActive: {
    backgroundColor: colors.primary
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  labelActive: {
    color: colors.primaryText
  }
});
