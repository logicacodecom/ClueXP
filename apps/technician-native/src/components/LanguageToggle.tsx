import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocale } from "../i18n/LocaleContext";
import type { Locale } from "../i18n/LocaleContext";
import { colors } from "../theme";

const LOCALES: Locale[] = ["en", "es"];

// Mirrors technician-web's LanguageToggle (@cluexp/app-core locale.tsx): a
// rounded-full segmented pill. Reads/writes the shared app-wide locale
// directly via useLocale() rather than taking locale/onChange props, since
// there's only ever one locale for the whole app now.
export function LanguageToggle() {
  const { locale, setLocale, t } = useLocale();
  return (
    <View accessibilityLabel={t("Language")} accessibilityRole="radiogroup" style={styles.track}>
      {LOCALES.map((item) => {
        const active = locale === item;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            key={item}
            onPress={() => setLocale(item)}
            style={[styles.segment, active ? styles.segmentActive : null]}
          >
            <Text style={[styles.label, active ? styles.labelActive : null]}>{item === "en" ? t("English") : t("Spanish")}</Text>
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
