import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CluexpApi } from "../api/client";
import { Pill } from "../components/Pill";
import { useLocale } from "../i18n/LocaleContext";
import { colors, radius, sharedStyles } from "../theme";
import type { TechnicianDocument } from "../types";

const DOCUMENT_TYPES = [
  { value: "driver_license", label: "Driver's License" },
  { value: "proof_of_insurance", label: "Proof of Insurance" },
  { value: "business_license", label: "Business License" },
  { value: "locksmith_certification", label: "Locksmith Certification" },
  { value: "background_check", label: "Background Check" }
];

const REQUIREMENTS = [
  { title: "Valid government-issued ID", text: "Driver's license, passport, or state ID" },
  { title: "Proof of insurance", text: "Current insurance policy showing coverage" },
  { title: "Background check", text: "Completed automatically during onboarding" }
];

function humanizeType(type: string) {
  return type.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

function statusTone(status: TechnicianDocument["status"]): "success" | "danger" | "warn" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  return "warn";
}

export function DocumentsScreen({ api, onClose }: { api: CluexpApi; onClose: () => void }) {
  const { t } = useLocale();
  const [documents, setDocuments] = useState<TechnicianDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState(DOCUMENT_TYPES[0].value);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api.listDocuments();
      setDocuments(Array.isArray(body) ? body : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not load documents"));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpload() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      copyToCacheDirectory: true
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (asset.size != null && asset.size > 10 * 1024 * 1024) {
      setError(t("File too large. Max 10MB."));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await api.uploadDocument(
        { uri: asset.uri, name: asset.name || "document", type: asset.mimeType || "application/octet-stream" },
        docType
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Failed to upload document"));
    } finally {
      setUploading(false);
    }
  }

  async function handleView(id: string) {
    setViewingId(id);
    try {
      const body = await api.documentDownloadUrl(id);
      if (!body.download_url) throw new Error(t("Could not open document"));
      await Linking.openURL(body.download_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not open document"));
    } finally {
      setViewingId(null);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={sharedStyles.title}>{t("Documents")}</Text>
        <Pressable accessibilityLabel={t("Close")} onPress={onClose} style={styles.closeButton}>
          <Ionicons color={colors.foreground} name="close" size={20} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Section title={t("Compliance documents")}>
          <Text style={styles.sectionHint}>{t("Upload required documents to remain eligible for jobs. All documents are reviewed before becoming active.")}</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {loading ? (
            <Text style={styles.emptyText}>{t("Loading documents…")}</Text>
          ) : documents.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons color={colors.muted} name="document-text-outline" size={26} />
              <Text style={styles.emptyBoxTitle}>{t("No documents uploaded")}</Text>
              <Text style={styles.emptyBoxText}>{t("Upload required documents to continue working.")}</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {documents.map((doc) => (
                <View key={doc.id} style={styles.docCard}>
                  <View style={styles.docHeaderRow}>
                    <View style={styles.docHeaderText}>
                      <Text style={styles.docTitle}>{t(humanizeType(doc.document_type))}</Text>
                      <Text style={styles.docMeta}>{t("Uploaded")} {formatDate(doc.uploaded_at)}</Text>
                      {doc.status === "rejected" && doc.rejected_reason ? <Text style={styles.docRejected}>{t("Rejected:")} {doc.rejected_reason}</Text> : null}
                    </View>
                    <View style={styles.docStatusCol}>
                      <Pill tone={statusTone(doc.status)}>{doc.status === "pending_review" ? t("Pending") : t(doc.status)}</Pill>
                      <Pressable disabled={viewingId === doc.id} onPress={() => void handleView(doc.id)}>
                        <Text style={styles.viewLink}>{viewingId === doc.id ? t("Opening…") : t("View")}</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Section>

        <Section title={t("Add document")}>
          <View style={styles.uploadBox}>
            <Text style={styles.sectionHint}>{t("Document type")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeRow}>
              {DOCUMENT_TYPES.map((type) => {
                const active = docType === type.value;
                return (
                  <Pressable disabled={uploading} key={type.value} onPress={() => setDocType(type.value)} style={[styles.typeChip, active ? styles.typeChipActive : null]}>
                    <Text style={[styles.typeChipText, active ? styles.typeChipTextActive : null]}>{t(type.label)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable disabled={uploading} onPress={() => void handleUpload()} style={styles.dropZone}>
              <Ionicons color={colors.muted} name="cloud-upload-outline" size={26} />
              <Text style={styles.dropZoneTitle}>{uploading ? t("Uploading…") : t("Tap to choose a file")}</Text>
              <Text style={styles.dropZoneHint}>{t("PDF, JPG, PNG up to 10MB")}</Text>
            </Pressable>
          </View>
        </Section>

        <Section title={t("Document requirements")}>
          <View style={styles.requirementList}>
            {REQUIREMENTS.map((item) => (
              <View key={item.title} style={styles.requirementRow}>
                <Ionicons color={colors.primary} name="checkmark-circle-outline" size={18} />
                <View style={styles.requirementText}>
                  <Text style={styles.requirementTitle}>{t(item.title)}</Text>
                  <Text style={styles.requirementSub}>{t(item.text)}</Text>
                </View>
              </View>
            ))}
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 18
  },
  closeButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  body: {
    gap: 22,
    padding: 18,
    paddingBottom: 60
  },
  section: {
    gap: 10
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "800"
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  errorText: {
    color: colors.danger,
    fontSize: 13
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13
  },
  emptyBox: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 6,
    padding: 20
  },
  emptyBoxTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800"
  },
  emptyBoxText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center"
  },
  list: {
    gap: 10
  },
  docCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: 14
  },
  docHeaderRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  docHeaderText: {
    flex: 1
  },
  docTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800"
  },
  docMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4
  },
  docRejected: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4
  },
  docStatusCol: {
    alignItems: "flex-end",
    gap: 8
  },
  viewLink: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800"
  },
  uploadBox: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 10,
    padding: 14
  },
  typeRow: {
    flexGrow: 0
  },
  typeChip: {
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginRight: 8,
    minHeight: 36,
    paddingHorizontal: 14
  },
  typeChipActive: {
    backgroundColor: "rgba(255, 191, 0, 0.12)",
    borderColor: colors.primary
  },
  typeChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  typeChipTextActive: {
    color: colors.primary
  },
  dropZone: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderStyle: "dashed",
    borderWidth: 2,
    gap: 4,
    paddingVertical: 26
  },
  dropZoneTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800"
  },
  dropZoneHint: {
    color: colors.muted,
    fontSize: 12
  },
  requirementList: {
    gap: 8
  },
  requirementRow: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: 10,
    padding: 12
  },
  requirementText: {
    flex: 1
  },
  requirementTitle: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "800"
  },
  requirementSub: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2
  }
});
