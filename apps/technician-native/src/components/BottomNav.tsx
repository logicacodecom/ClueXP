import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocale } from "../i18n/LocaleContext";
import { colors } from "../theme";

export type TabKey = "work" | "activity" | "earnings" | "account";

// Mirrors technician-web's technicianNavItems (technician-app-chrome.tsx).
export const tabs: Array<{ key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "work", label: "Work", icon: "briefcase-outline" },
  { key: "activity", label: "Activity", icon: "time-outline" },
  { key: "earnings", label: "Earnings", icon: "wallet-outline" },
  { key: "account", label: "Account", icon: "person-circle-outline" }
];

export function BottomNav({ selected, onSelect }: { selected: TabKey; onSelect: (tab: TabKey) => void }) {
  const { t } = useLocale();
  return (
    <View style={styles.bar}>
      {tabs.map((item) => {
        const active = selected === item.key;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={[styles.button, active ? styles.buttonActive : null]}
          >
            <Ionicons name={item.icon} color={active ? colors.primaryText : colors.muted} size={20} />
            <Text style={[styles.label, active ? styles.labelActive : null]}>{t(item.label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: "row",
    gap: 6,
    left: 0,
    paddingBottom: Platform.OS === "ios" ? 16 : 8,
    paddingHorizontal: 8,
    paddingTop: 8,
    position: "absolute",
    right: 0
  },
  button: {
    alignItems: "center",
    flex: 1,
    gap: 4,
    justifyContent: "center",
    minHeight: 58
  },
  buttonActive: {
    backgroundColor: colors.primary
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900"
  },
  labelActive: {
    color: colors.primaryText
  }
});
