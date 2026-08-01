import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CluexpApi } from "../api/client";
import { FieldButton } from "../components/FieldButton";
import { DEFAULT_SERVICE_CATALOG, flattenServiceSkills } from "../data/serviceCatalog";
import type { ServiceCategory } from "../data/serviceCatalog";
import { colors, radius } from "../theme";
import type { AuthSession } from "../types";

export function ProfileEditor({ session, api, onSaved }: { session: AuthSession; api: CluexpApi; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ServiceCategory[]>(DEFAULT_SERVICE_CATALOG);
  const [form, setForm] = useState({
    displayName: session.user?.display_name ?? "",
    phone: session.technician?.phone ?? "",
    radius: session.technician?.service_area_radius_km != null ? String(session.technician.service_area_radius_km) : "",
    skills: session.technician?.skills ?? []
  });

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    api.serviceCatalog()
      .then((body) => {
        if (!cancelled && Array.isArray(body?.categories) && body.categories.length > 0) setCatalog(body.categories);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [editing, api]);

  function toggleSkill(code: string) {
    setForm((current) => ({
      ...current,
      skills: current.skills.includes(code) ? current.skills.filter((item) => item !== code) : [...current.skills, code]
    }));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api.updateProfile({
        display_name: form.displayName,
        phone: form.phone,
        skills: form.skills,
        service_area_radius_km: form.radius ? Number(form.radius) : undefined
      });
      await onSaved();
      setEditing(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Profile could not be saved");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <Pressable onPress={() => setEditing(true)} style={styles.toggleButton}>
        <Ionicons color={colors.foreground} name="pencil-outline" size={16} />
        <Text style={styles.toggleButtonText}>Edit profile</Text>
      </Pressable>
    );
  }

  const canSave = !busy && form.displayName.trim().length >= 2 && form.phone.trim().length >= 7;

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Display name</Text>
        <TextInput onChangeText={(value) => setForm((current) => ({ ...current, displayName: value }))} style={styles.input} value={form.displayName} />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Phone</Text>
        <TextInput inputMode="tel" onChangeText={(value) => setForm((current) => ({ ...current, phone: value }))} style={styles.input} value={form.phone} />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Skills</Text>
        <View style={styles.skillBox}>
          {catalog.filter((category) => category.skills.length > 0).map((category) => (
            <View key={category.code} style={styles.skillCategory}>
              <Text style={styles.skillCategoryLabel}>{category.label}</Text>
              <View style={styles.skillChipRow}>
                {category.skills.map((skill) => {
                  const active = form.skills.includes(skill.code);
                  return (
                    <Pressable key={skill.code} onPress={() => toggleSkill(skill.code)} style={[styles.skillChip, active ? styles.skillChipActive : null]}>
                      <Text style={[styles.skillChipText, active ? styles.skillChipTextActive : null]}>{skill.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {form.skills.length > 0 ? (
            <Text style={styles.skillHint}>{form.skills.length} selected — {flattenServiceSkills(catalog).filter((s) => form.skills.includes(s.code)).map((s) => s.label).join(", ") || form.skills.join(", ")}</Text>
          ) : (
            <Text style={styles.skillHint}>Choose the services you want to receive offers for.</Text>
          )}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Service radius (km)</Text>
        <TextInput inputMode="decimal" onChangeText={(value) => setForm((current) => ({ ...current, radius: value.replace(/[^0-9.]/g, "") }))} style={styles.input} value={form.radius} />
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={styles.actionRow}>
        <View style={styles.actionHalf}>
          <FieldButton disabled={busy} icon={<Ionicons color={colors.foreground} name="close" size={16} />} label="Cancel" onPress={() => setEditing(false)} tone="secondary" />
        </View>
        <View style={styles.actionHalf}>
          <FieldButton disabled={!canSave} icon={<Ionicons color={colors.primaryText} name="checkmark" size={16} />} label={busy ? "Saving" : "Save"} loading={busy} onPress={() => void save()} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggleButton: {
    alignItems: "center",
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48
  },
  toggleButtonText: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800"
  },
  form: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    gap: 16,
    padding: 14
  },
  field: {
    gap: 8
  },
  fieldLabel: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "800"
  },
  input: {
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: radius.xs,
    borderWidth: 1,
    color: colors.foreground,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 14
  },
  skillBox: {
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: radius.xs,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  skillCategory: {
    gap: 6
  },
  skillCategoryLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  skillChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  skillChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  skillChipActive: {
    backgroundColor: "rgba(255, 191, 0, 0.12)",
    borderColor: colors.primary
  },
  skillChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  skillChipTextActive: {
    color: colors.primary
  },
  skillHint: {
    color: colors.mutedFaint,
    fontSize: 11,
    lineHeight: 16
  },
  message: {
    color: colors.danger,
    fontSize: 13
  },
  actionRow: {
    flexDirection: "row",
    gap: 10
  },
  actionHalf: {
    flex: 1
  }
});
