import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, CluexpApi } from "../api/client";
import { ActiveJobMap, canRenderActiveJobMap } from "../components/ActiveJobMap";
import type { MapPoint } from "../components/ActiveJobMap";
import { BottomNav, type TabKey } from "../components/BottomNav";
import { Countdown } from "../components/Countdown";
import { FieldButton } from "../components/FieldButton";
import { LanguageToggle } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { MiniStat } from "../components/MiniStat";
import { Pill } from "../components/Pill";
import { ReadinessBar } from "../components/ReadinessBar";
import { registerPushDevice, requestAndSendLocation } from "../features/nativeCapabilities";
import { replayQueuedMutations } from "../features/outboxReplay";
import { logoutStoredSession } from "../features/sessionLifecycle";
import { useLocale } from "../i18n/LocaleContext";
import { ActivityScreen } from "../screens/ActivityScreen";
import { DocumentsScreen } from "../screens/DocumentsScreen";
import { EarningsScreen } from "../screens/EarningsScreen";
import { ProfileEditor } from "../screens/ProfileEditor";
import { TeamScreen } from "../screens/TeamScreen";
import { clearStoredSession, loadStoredSession, saveStoredSession, updateStoredSession } from "../storage/sessionStore";
import { enqueueMutation, failedMutationCount, failedMutations, initOutbox, queuedMutationCount, wipeOutbox } from "../storage/outbox";
import type { FailedMutation } from "../storage/outbox";
import { colors, radius, sharedStyles } from "../theme";
import type { ActiveJob, ActiveJobDetail, ActiveJobSnapshot, AuthSession, CloseoutLineDraft, JobMessage, JobStatus, QueuedMutation, ReadinessSnapshot, TechnicianOffer } from "../types";

type CommandSheet = "arrival" | "safety" | "more" | "collection" | "messages" | "call" | null;
type WorkHint = { kind: "work" | "job" | "offer"; id?: string; source: "link" | "notification" } | null;

const api = new CluexpApi(null);

const DECLINE_REASONS = ["Too far", "On another job", "Outside my skills", "Schedule conflict"];

const MORE_ISSUE_KINDS: Array<[string, string]> = [
  ["customer_unavailable", "Customer unavailable"],
  ["wrong_address", "Wrong address"],
  ["cannot_access", "Cannot access the work area"],
  ["job_differs", "Job differs from the request"],
  ["cannot_complete", "Cannot complete the work"]
];

const activeStages: Array<{ status: JobStatus; label: string; heading: string }> = [
  { status: "assigned", label: "Depart", heading: "Ready to depart" },
  { status: "en_route", label: "En route", heading: "Driving to customer" },
  { status: "arrived", label: "On site", heading: "At the location" },
  { status: "in_progress", label: "Service", heading: "Service underway" },
  { status: "completed_pending_customer", label: "Review", heading: "Waiting for customer" }
];

// Mirrors technician-web's CLOSEOUT_ITEM_TYPES (active-job-workflow.tsx) — web
// hardcodes this list locally too rather than fetching GET /closeout-item-types,
// so native matches that behavior instead of diverging with a live fetch.
const CLOSEOUT_ITEM_TYPES: Array<{ value: string; label: string; taxable: boolean; requiresProvidedBy?: boolean; requiresNote?: boolean }> = [
  { value: "service_fee", label: "Service fee", taxable: true },
  { value: "labor", label: "Labor", taxable: true },
  { value: "diagnostic", label: "Diagnostic", taxable: true },
  { value: "physical_part", label: "Physical part", taxable: true, requiresProvidedBy: true },
  { value: "hardware", label: "Hardware", taxable: true, requiresProvidedBy: true },
  { value: "key_code_purchase", label: "Key code purchase", taxable: false, requiresProvidedBy: true, requiresNote: true },
  { value: "third_party_service", label: "Third-party service", taxable: false, requiresProvidedBy: true, requiresNote: true },
  { value: "other", label: "Other", taxable: true, requiresProvidedBy: true, requiresNote: true }
];

const CLOSEOUT_PAYMENT_METHODS = [
  { value: "credit_card", label: "Card reader" },
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "zelle", label: "Zelle" },
  { value: "other", label: "Other" }
];

const PROVIDED_BY_OPTIONS = ["company", "technician", "customer", "third_party"];

function newCloseoutLine(itemType = "service_fee"): CloseoutLineDraft {
  const spec = CLOSEOUT_ITEM_TYPES.find((item) => item.value === itemType) ?? CLOSEOUT_ITEM_TYPES[0];
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    item_type_code: spec.value,
    description: "",
    quantity: "1",
    unit_amount: "",
    taxable: spec.taxable,
    provided_by: "",
    note: ""
  };
}

function moneyValue(value: string) {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? amount : 0;
}

function closeoutLineError(line: CloseoutLineDraft, index: number) {
  const spec = CLOSEOUT_ITEM_TYPES.find((item) => item.value === line.item_type_code) ?? CLOSEOUT_ITEM_TYPES[0];
  if (!line.description.trim()) return `Item ${index + 1}: add a customer receipt description.`;
  if (moneyValue(line.quantity || "1") <= 0) return `${spec.label}: quantity must be greater than zero.`;
  if (!line.unit_amount.trim() || moneyValue(line.unit_amount) < 0) return `${spec.label}: enter an amount.`;
  if (spec.requiresProvidedBy && !line.provided_by) return `${spec.label}: choose who provided it.`;
  return null;
}

function closeoutFormError(lines: CloseoutLineDraft[], method: string) {
  const lineIssue = lines.map((line, index) => closeoutLineError(line, index)).find(Boolean);
  if (lineIssue) return lineIssue;
  if (!method) return "Choose how the money was collected.";
  return null;
}

function clientMutationId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function errorMessage(cause: unknown) {
  if (cause instanceof ApiError) return cause.problem.message;
  if (cause instanceof Error) return cause.message;
  return "Unable to connect to ClueXP.";
}

function isNetworkFailure(cause: unknown) {
  return (cause instanceof ApiError && cause.problem.status === 0) || cause instanceof TypeError;
}

function nativeCapabilityMessage(reason?: string) {
  if (reason === "android_fcm_not_configured") {
    return "Android push is not configured for this build yet. Add Firebase/FCM credentials and rebuild the app before enabling alerts.";
  }
  if (reason === "push_token_unavailable") {
    return "This build could not get a push token. Try again after rebuilding with push credentials.";
  }
  if (reason === "notification_permission_denied") {
    return "Notifications are blocked for ClueXP. Enable notifications in system settings to receive offers.";
  }
  if (reason === "physical_device_required") {
    return "Push alerts require a physical device.";
  }
  if (reason === "native_push_required") {
    return "Push alerts can only be enabled in the native Android or iOS app.";
  }
  if (reason === "location_permission_denied") {
    return "Allow precise location access to receive offers.";
  }
  if (reason === "native_location_required") {
    return "Location repair can only be tested in the native Android or iOS app.";
  }
  return "Unable to complete this device setup step.";
}

function serviceLabel(job: ActiveJob) {
  const raw = job.service_type || job.situation || job.access_type || "Service request";
  return raw.replaceAll("_", " ").replaceAll(".", " / ");
}

function offerId(offer: TechnicianOffer) {
  return offer.id || offer.offer_id || "";
}

function initialsFor(name: string) {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "T";
}

function stringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stageDetail(status: JobStatus) {
  if (status === "assigned") return "Review the destination, then share your location and begin the route.";
  if (status === "en_route") return "Use your maps app for directions. Confirm arrival with the customer's six-digit PIN.";
  if (status === "arrived") return "Review the request and authorization before beginning work.";
  if (status === "in_progress") return "Capture the work performed, then record an honest collection.";
  return "The receipt was submitted. You remain busy until the customer or dispatcher resolves it.";
}

function parseWorkHint(url: string, source: "link" | "notification"): WorkHint {
  const match = url.match(/^(?:cluexp-tech:\/\/|https?:\/\/[^/]+\/)(work|jobs?|offers?)(?:\/([^/?#]+))?/i);
  if (!match) return null;
  const section = match[1].toLowerCase();
  if (section.startsWith("job")) return { kind: "job", id: match[2], source };
  if (section.startsWith("offer")) return { kind: "offer", id: match[2], source };
  return { kind: "work", source };
}

function notificationHint(response: Notifications.NotificationResponse): WorkHint {
  const data = response.notification.request.content.data ?? {};
  const kind = typeof data.kind === "string" ? data.kind : typeof data.type === "string" ? data.type : "";
  const jobId = typeof data.job_id === "string" ? data.job_id : typeof data.jobId === "string" ? data.jobId : undefined;
  const offerIdValue = typeof data.offer_id === "string" ? data.offer_id : typeof data.offerId === "string" ? data.offerId : undefined;
  const url = typeof data.url === "string" || typeof data.deep_link === "string" ? String(data.url ?? data.deep_link) : null;
  if (url) return parseWorkHint(url, "notification");
  if (kind.includes("offer") && offerIdValue) return { kind: "offer", id: offerIdValue, source: "notification" };
  if (jobId) return { kind: "job", id: jobId, source: "notification" };
  return { kind: "work", source: "notification" };
}

function outboxKind(kind: "arrival" | "issue" | "collection"): QueuedMutation["kind"] {
  if (kind === "arrival") return "arrival_verify";
  if (kind === "issue") return "report_issue";
  return "collection";
}

export function RootApp() {
  const { t } = useLocale();
  const [booting, setBooting] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tab, setTab] = useState<TabKey>("work");
  const [queueCount, setQueueCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [workHint, setWorkHint] = useState<WorkHint>(null);

  const hardSignOut = useCallback(async () => {
    api.setSessionTokens(null, null);
    await clearStoredSession();
    await wipeOutbox();
    setAccessToken(null);
    setSession(null);
    setQueueCount(0);
    setFailedCount(0);
    setTab("work");
  }, []);

  useEffect(() => {
    api.configureSessionHandlers({
      onRefresh: async (result) => {
        api.setSessionTokens(result.access_token, result.refresh_token);
        await saveStoredSession({
          accessToken: result.access_token,
          refreshToken: result.refresh_token,
          session: result.session
        });
        setAccessToken(result.access_token);
        setSession(result.session);
      },
      onRefreshFailed: hardSignOut
    });
    return () => api.configureSessionHandlers(null);
  }, [hardSignOut]);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      try {
        await initOutbox();
        const stored = await loadStoredSession();
        if (stored) {
          api.setSessionTokens(stored.accessToken, stored.refreshToken);
          let fresh = stored.session;
          try {
            await replayQueuedMutations(api);
            fresh = await api.me();
          } catch (cause) {
            if (cause instanceof ApiError && cause.problem.status === 401) {
              await hardSignOut();
              return;
            }
            fresh = stored.session;
          }
          if (mounted) {
            setAccessToken(api.currentAccessToken());
            setSession(fresh);
          }
        }
        const [count, failed] = await Promise.all([queuedMutationCount(), failedMutationCount()]);
        if (mounted) {
          setQueueCount(count);
          setFailedCount(failed);
        }
      } finally {
        if (mounted) setBooting(false);
      }
    }
    void boot();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadInitialUrl() {
      const url = await Linking.getInitialURL();
      const hint = url ? parseWorkHint(url, "link") : null;
      if (mounted && hint) {
        setTab("work");
        setWorkHint(hint);
      }
    }
    void loadInitialUrl();
    const linkSub = Linking.addEventListener("url", (event) => {
      const hint = parseWorkHint(event.url, "link");
      if (hint) {
        setTab("work");
        setWorkHint(hint);
      }
    });
    const notificationSub = Notifications.addNotificationResponseReceivedListener((response) => {
      setTab("work");
      setWorkHint(notificationHint(response));
    });
    return () => {
      mounted = false;
      linkSub.remove();
      notificationSub.remove();
    };
  }, []);

  const onLogin = useCallback(async (identifier: string, password: string) => {
    const result = await api.login(identifier, password);
    api.setSessionTokens(result.access_token, result.refresh_token);
    await saveStoredSession({
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      session: result.session
    });
    setAccessToken(result.access_token);
    setSession(result.session);
  }, []);

  const onLogout = useCallback(async () => {
    await logoutStoredSession({
      api,
      loadStoredSession,
      clearStoredSession,
      wipeOutbox,
      afterLocalClear: () => {
        api.setSessionTokens(null, null);
        setAccessToken(null);
        setSession(null);
        setQueueCount(0);
        setFailedCount(0);
        setTab("work");
      }
    });
  }, []);

  const refreshQueue = useCallback(async () => {
    const [count, failed] = await Promise.all([queuedMutationCount(), failedMutationCount()]);
    setQueueCount(count);
    setFailedCount(failed);
  }, []);

  const refreshSession = useCallback(async () => {
    const fresh = await api.me();
    setSession(fresh);
    await updateStoredSession(fresh);
  }, []);

  if (booting) {
    return (
      <SafeAreaView style={sharedStyles.screen}>
        <StatusBar style="light" />
        <View style={sharedStyles.phoneFrame}>
          <View style={styles.center}>
            <Logo height={40} />
            <Text style={styles.bootCaption}>{t("Restoring secure session")}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!accessToken || !session) {
    return <LoginScreen onLogin={onLogin} />;
  }

  return (
    <SafeAreaView style={sharedStyles.screen}>
      <StatusBar style="light" />
      <View style={sharedStyles.phoneFrame}>
        <View style={styles.root}>
          <Header failedCount={failedCount} onAvatarPress={() => setTab("account")} queueCount={queueCount} session={session} />
          {tab === "work" ? <WorkScreen failedCount={failedCount} hint={workHint} onHintConsumed={() => setWorkHint(null)} onQueueChanged={refreshQueue} queueCount={queueCount} session={session} /> : null}
          {tab === "activity" ? <ActivityScreen api={api} /> : null}
          {tab === "earnings" ? <EarningsScreen api={api} /> : null}
          {tab === "account" ? <AccountScreen onLogout={onLogout} onSessionRefresh={refreshSession} session={session} /> : null}
          <BottomNav onSelect={setTab} selected={tab} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function LoginScreen({ onLogin }: { onLogin: (identifier: string, password: string) => Promise<void> }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocale();

  async function submit() {
    if (!identifier.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onLogin(identifier.trim(), password);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={sharedStyles.screen}>
      <StatusBar style="light" />
      <View style={sharedStyles.phoneFrame}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.loginWrap}>
          <View style={styles.loginTopRow}>
            <Logo height={24} />
            <LanguageToggle />
          </View>
          <View style={styles.loginForm}>
            <View style={styles.loginBadge}>
              <Ionicons color={colors.primaryText} name="shield-checkmark" size={24} />
            </View>
            <Text style={styles.loginTitle}>{t("Sign in")}</Text>
            <Text style={styles.loginCopy}>{t("Secure access for verified ClueXP technicians.")}</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t("Email or phone")}</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setIdentifier}
                placeholder="jordan@cluexp.example"
                placeholderTextColor={colors.mutedFaint}
                style={styles.input}
                value={identifier}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t("Password")}</Text>
              <TextInput
                autoCapitalize="none"
                onChangeText={setPassword}
                placeholder="••••••"
                placeholderTextColor={colors.mutedFaint}
                secureTextEntry
                style={styles.input}
                value={password}
              />
            </View>
            {error ? <AlertBanner text={error} tone="bad" /> : null}
            <FieldButton disabled={!identifier.trim() || !password} label={t("Sign in")} loading={busy} onPress={submit} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

function AvatarContent({ photoUrl, initials, textStyle }: { photoUrl?: string | null; initials: string; textStyle: object }) {
  const { t } = useLocale();
  if (photoUrl) {
    return <Image accessibilityLabel={t("Profile photo")} resizeMode="cover" source={{ uri: photoUrl }} style={styles.avatarImage} />;
  }
  return <Text style={textStyle}>{initials}</Text>;
}

function Header({ session, queueCount, failedCount, onAvatarPress }: { session: AuthSession; queueCount: number; failedCount: number; onAvatarPress: () => void }) {
  const { t } = useLocale();
  const name = session.user?.display_name || session.user?.email || t("Technician");
  return (
    <View style={styles.header}>
      <Logo height={20} />
      <Pressable accessibilityLabel={t("Open account")} accessibilityRole="button" onPress={onAvatarPress} style={styles.avatar}>
        <AvatarContent initials={initialsFor(name)} photoUrl={session.technician?.photo_url} textStyle={styles.avatarText} />
        {failedCount > 0 ? <View style={[styles.avatarBadge, styles.avatarBadgeDanger]} /> : queueCount > 0 ? <View style={styles.avatarBadge} /> : null}
      </Pressable>
    </View>
  );
}

function WorkScreen({ session, hint, onHintConsumed, onQueueChanged, queueCount, failedCount }: {
  session: AuthSession;
  hint: WorkHint;
  onHintConsumed: () => void;
  queueCount: number;
  failedCount: number;
  onQueueChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const technicianId = session.technician?.id;
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<ActiveJobSnapshot | null>(null);
  const [jobDetail, setJobDetail] = useState<ActiveJobDetail | null>(null);
  const [offers, setOffers] = useState<TechnicianOffer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CommandSheet>(null);
  const [online, setOnline] = useState(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      await replayQueuedMutations(api);
      await onQueueChanged();
      const [ready, active, offerFeed] = await Promise.all([
        api.readiness(),
        api.activeJobSnapshot(),
        technicianId ? api.offers(technicianId) : Promise.resolve({ offers: [] })
      ]);
      setReadiness(ready);
      setSnapshot(active);
      setOffers(offerFeed.offers.filter((offer) => offer.status === "offered" || offer.status === "seen"));
      setError(null);
      setOnline(true);
      if (active.active_job && technicianId) {
        // Read-only enrichment (customer detail, intake photos, recorded
        // collection, approval status). The snapshot above stays the only
        // source for version/mutations, so a failure here is silent — it
        // just means that extra detail stays hidden, nothing breaks.
        try {
          setJobDetail(await api.activeJobDetail(technicianId));
        } catch {
          setJobDetail(null);
        }
      } else {
        setJobDetail(null);
      }
    } catch (cause) {
      setError(errorMessage(cause));
      // Same "network-level failure" heuristic the outbox already uses to
      // decide whether to queue a mutation locally (see CommandModal.run).
      if (cause instanceof TypeError) setOnline(false);
    } finally {
      setRefreshing(false);
    }
  }, [onQueueChanged, technicianId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 15000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!hint) return;
    void load(true).finally(onHintConsumed);
  }, [hint, load, onHintConsumed]);

  // On app start: one opportunistic, silent location fix so "Location fresh"
  // doesn't start stale. Foreground-only — just the permission the app
  // already requests elsewhere, no new prompt.
  useEffect(() => {
    void requestAndSendLocation(api).catch(() => undefined);
  }, []);

  // Automatic foreground location refresh so a technician doesn't have to
  // keep tapping "Fix location" — tight cadence while there's an active job,
  // loose cadence while merely available, off otherwise. This is
  // foreground-only (same permission as above, no background task, no new
  // dependency); true OS background tracking while the app is backgrounded
  // is a materially bigger decision (new permission class, new native
  // module, real store-review/privacy implications) and isn't included here.
  // Manual "Fix location" in ReadinessBar remains the rescue path.
  const hasActiveJob = Boolean(snapshot?.active_job);
  const isAvailable = Boolean(readiness?.account.available);
  useEffect(() => {
    if (!hasActiveJob && !isAvailable) return;
    const intervalMs = hasActiveJob ? 20_000 : 3 * 60_000;
    const timer = setInterval(() => {
      void requestAndSendLocation(api).catch(() => undefined);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [hasActiveJob, isAvailable]);

  async function setAvailability(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.setAvailability(next);
      await load(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function repairLocation() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestAndSendLocation(api);
      if (!result.ok) throw new Error(nativeCapabilityMessage(result.reason));
      await load(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function repairPush() {
    setBusy(true);
    setError(null);
    try {
      const result = await registerPushDevice(api);
      if (!result.ok) throw new Error(nativeCapabilityMessage(result.reason));
      await load(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function acceptOffer(offer: TechnicianOffer) {
    const id = offerId(offer);
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.acceptOffer(id);
      await load(true);
    } catch (cause) {
      setError(errorMessage(cause));
      await load(true);
    } finally {
      setBusy(false);
    }
  }

  async function declineOffer(offer: TechnicianOffer, reason?: string) {
    const id = offerId(offer);
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.declineOffer(id, reason || "Declined from native app");
      await load(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function advanceJob(target: string) {
    const job = snapshot?.active_job;
    if (!job) return;
    if (job.status === "en_route") {
      setSheet("arrival");
      return;
    }
    if (target === "completed_pending_customer") {
      setSheet("collection");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (target === "en_route") {
        const located = await requestAndSendLocation(api);
        if (!located.ok) throw new Error(t("Location must be shared before route start."));
      }
      await api.updateJobStatus(job.id, target, snapshot?.version);
      await load(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem.code === "version_conflict") {
        setError(t("This job changed. Refreshed the latest server state."));
        await load(true);
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  const job = snapshot?.active_job ?? null;
  const activeOffer = offers[0] ?? null;

  return (
    <View style={styles.content}>
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        refreshControl={<RefreshControl onRefresh={() => void load()} refreshing={refreshing} tintColor={colors.primary} />}
      >
        {hint ? <AlertBanner text={`${t("Opened")} ${hint.kind}${hint.id ? ` ${hint.id.slice(0, 8)}` : ""} ${t("from")} ${hint.source}. ${t("Refreshing server state.")}`} tone="warn" /> : null}
        {error ? <AlertBanner text={error} tone="bad" /> : null}
        {failedCount > 0 ? (
          <AlertBanner text={`${failedCount} ${t(failedCount === 1 ? "action could not sync and was not applied. Open Account to review, or contact dispatch if this was a job update." : "actions could not sync and were not applied. Open Account to review, or contact dispatch if this was a job update.")}`} tone="bad" />
        ) : queueCount > 0 ? (
          <AlertBanner text={`${queueCount} ${t(queueCount === 1 ? "action queued offline — will sync automatically once you're back online." : "actions queued offline — will sync automatically once you're back online.")}`} tone="warn" />
        ) : null}
        {job ? (
          <ActiveJobCard allowedActions={snapshot?.allowed_actions ?? []} busy={busy} job={job} jobDetail={jobDetail} onAdvance={advanceJob} onSheet={setSheet} version={snapshot?.version ?? null} />
        ) : (
          <>
            <ReadinessBar busy={busy} onLocation={repairLocation} online={online} onPush={repairPush} onSetAvailable={setAvailability} readiness={readiness} />
            {readiness?.can_receive_offers ? (
              activeOffer ? (
                <OfferCard
                  busy={busy}
                  moreCount={Math.max(0, offers.length - 1)}
                  offer={activeOffer}
                  onAccept={() => void acceptOffer(activeOffer)}
                  onDecline={(reason) => void declineOffer(activeOffer, reason)}
                />
              ) : (
                <ReadyState />
              )
            ) : null}
          </>
        )}
      </ScrollView>
      <CommandModal
        job={job}
        jobDetail={jobDetail}
        onClose={() => setSheet(null)}
        onSubmitted={async (keepOpen) => {
          await load(true);
          await onQueueChanged();
          if (!keepOpen) setSheet(null);
        }}
        sheet={sheet}
        snapshotVersion={snapshot?.version ?? null}
      />
    </View>
  );
}

function ReadyState() {
  const { t } = useLocale();
  return (
    <View style={styles.readyWrap}>
      <View style={styles.readyCircle}>
        <Ionicons color={colors.success} name="checkmark" size={30} />
      </View>
      <Text style={styles.readyTitle}>{t("Ready for offers")}</Text>
      <Text style={styles.readyCaption}>{t("server feed connected")}</Text>
      <Text style={styles.readyBody}>{t("You are online. New offers will appear here. You can leave this screen open while working nearby.")}</Text>
    </View>
  );
}

function OfferCard({ offer, moreCount, busy, onAccept, onDecline }: {
  offer: TechnicianOffer;
  moreCount: number;
  busy: boolean;
  onAccept: () => void;
  onDecline: (reason?: string) => void;
}) {
  const { t } = useLocale();
  const [showReasons, setShowReasons] = useState(false);
  return (
    <View style={styles.offerWrap}>
      {moreCount > 0 ? <Text style={styles.queueChip}>{t(`${moreCount} more offer${moreCount === 1 ? "" : "s"} waiting`)}</Text> : null}
      <Countdown expiresAt={offer.expires_at} offeredAt={offer.offered_at} />
      <View style={styles.divider} />
      <Text style={sharedStyles.kicker}>{offer.organization_name ? `${t("Offer from")} ${offer.organization_name}` : t("Incoming offer")}</Text>
      <Text style={styles.offerTitle}>{offer.service_type || offer.situation || t("Service request")}</Text>
      <View style={styles.offerMetaRow}>
        <Ionicons color={colors.primary} name="location-outline" size={15} />
        <Text style={styles.offerMeta}>{offer.area || t("Nearby service area")}</Text>
      </View>
      <Text style={styles.faintText}>{t("Exact address and customer details unlock after acceptance.")}</Text>
      <View style={styles.metricGrid}>
        <Metric label={t("Travel")} value={offer.distance_mi != null ? `≈ ${offer.distance_mi} mi` : offer.dist_km != null ? `≈ ${offer.dist_km.toFixed(1)} km` : t("Not provided")} />
        <Metric label={t("Coarse drive")} value={offer.eta_min != null ? `≈ ${offer.eta_min} min` : t("Not provided")} />
      </View>
      <View style={styles.amountRow}>
        <Text style={styles.faintText}>{t("Your amount")}</Text>
        <Text style={styles.amountText}>{offer.estimated_earnings || t("Pending")}</Text>
      </View>
      <FieldButton icon={<Ionicons color={colors.primaryText} name="checkmark" size={20} />} label={t("Accept")} loading={busy} onPress={onAccept} />
      <FieldButton
        icon={<Ionicons color={colors.foreground} name="close" size={20} />}
        label={t("Decline")}
        loading={busy}
        onPress={() => setShowReasons((value) => !value)}
        tone="secondary"
      />
      {showReasons ? (
        <View style={styles.reasonPanel}>
          <Text style={styles.reasonKicker}>{t("Why are you declining?")}</Text>
          <View style={styles.reasonRow}>
            {DECLINE_REASONS.map((reason) => (
              <Pressable disabled={busy} key={reason} onPress={() => onDecline(reason)} style={styles.reasonChip}>
                <Text style={styles.reasonChipText}>{t(reason)}</Text>
              </Pressable>
            ))}
            <Pressable disabled={busy} onPress={() => onDecline()} style={styles.reasonChip}>
              <Text style={[styles.reasonChipText, styles.reasonChipMuted]}>{t("Skip")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ActiveJobCard({ job, jobDetail, version, allowedActions, busy, onAdvance, onSheet }: {
  job: ActiveJob;
  jobDetail: ActiveJobDetail | null;
  version: string | null;
  allowedActions: string[];
  busy: boolean;
  onAdvance: (target: string) => void;
  onSheet: (sheet: CommandSheet) => void;
}) {
  const { t } = useLocale();
  const next = useMemo(() => {
    const action = allowedActions.find((item) => item.startsWith("advance_to:"));
    return action ? action.replace("advance_to:", "") : null;
  }, [allowedActions]);
  const stageIndex = Math.max(0, activeStages.findIndex((item) => item.status === job.status));
  const stage = activeStages[stageIndex] ?? activeStages[activeStages.length - 1];
  const pendingCustomer = job.status === "completed_pending_customer";
  const actionLabel =
    job.status === "assigned" ? "Start route" :
    job.status === "en_route" ? "Confirm arrival" :
    job.status === "arrived" ? "Start service" :
    job.status === "in_progress" ? "Review and finish" :
    "Waiting for customer";
  const mapsUrl = job.lat != null && job.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`
    : job.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}` : null;

  const detail = recordValue(job.detail);
  const automotive = recordValue(detail.automotive);
  const customerName = jobDetail?.customer_name || stringValue(detail.customer_name) || stringValue(detail.customerName);
  const customerPhone = jobDetail?.customer_phone || stringValue(detail.customer_phone) || stringValue(detail.customerPhone);
  const vehicle = [stringValue(automotive.year), stringValue(automotive.color), stringValue(automotive.make), stringValue(automotive.model)].filter(Boolean).join(" ") || null;
  const notes = stringValue(detail.additional_details) || stringValue(detail.notes) || stringValue(detail.description);
  const hasDetails = Boolean(customerName || customerPhone || vehicle || notes);
  const intakePhotos = jobDetail?.intake_photos ?? [];
  const collectionItems = jobDetail?.collection_items ?? [];
  const mapPoints: MapPoint[] = job.lat != null && job.lng != null ? [{ kind: "job", label: job.address ?? undefined, lat: job.lat, lng: job.lng }] : [];
  const showRealMap = canRenderActiveJobMap(mapPoints);
  const mapBadgeText = showRealMap ? "GPS live" : job.lat != null && job.lng != null ? "Map unavailable" : "Address only";

  return (
    <View style={styles.activeWrap}>
      <View style={styles.mapFallback}>
        {showRealMap ? <ActiveJobMap points={mapPoints} /> : null}
        <View style={styles.mapBadge}>
          <Ionicons color={showRealMap ? colors.success : colors.warn} name={showRealMap ? "locate" : "map-outline"} size={13} />
          <Text style={styles.mapBadgeText}>{t(mapBadgeText)}</Text>
        </View>
        {!showRealMap ? (
          <View style={styles.mapGrid}>
            <MaterialCommunityIcons color={colors.primary} name="map-marker-radius-outline" size={34} />
            <Text style={styles.mapText}>{job.address || t("Service address unavailable")}</Text>
          </View>
        ) : null}
        {!pendingCustomer && mapsUrl ? (
          <Pressable onPress={() => void Linking.openURL(mapsUrl)} style={styles.navigateBadge}>
            <Ionicons color={colors.primaryText} name="navigate" size={13} />
            <Text style={styles.navigateBadgeText}>{t("Navigate")}</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.mapTruth, showRealMap ? styles.mapTruthOverlay : null]}>{t("GPS is honest. No simulated movement is shown.")}</Text>
      </View>

      {job.location_requirements?.location_updated_at ? (
        <View style={styles.freshnessRow}>
          <View style={[styles.freshnessDot, job.location_requirements.location_is_fresh ? styles.freshnessDotGood : styles.freshnessDotWarn]} />
          <Text style={styles.freshnessText}>
            {t("Dispatch sees your location:")}{" "}
            <Text style={job.location_requirements.location_is_fresh ? styles.freshnessGood : styles.freshnessWarn}>
              {t(job.location_requirements.location_is_fresh ? "fresh" : "stale")}
            </Text>
          </Text>
        </View>
      ) : null}

      <View>
        <View style={styles.stageHeaderRow}>
          <Text style={sharedStyles.kicker}>{t("Stage")} {stageIndex + 1} {t("of 5")}</Text>
          <View style={styles.stageBars}>
            {activeStages.map((item, index) => (
              <View key={item.status} style={[styles.stageBar, index <= stageIndex ? styles.stageBarOn : null]} />
            ))}
          </View>
        </View>
        <Text style={styles.stageHeading}>{t(stage.heading)}</Text>
        <Text style={styles.stageDetail}>{t(stageDetail(job.status))}</Text>
      </View>

      {pendingCustomer ? (
        <View style={styles.pendingCard}>
          <View style={styles.pendingCircle}>
            <Text style={styles.pendingEllipsis}>…</Text>
          </View>
          <Text style={styles.pendingKicker}>{t(`Job ${job.id.slice(0, 8)}`)}</Text>
          <Text style={styles.pendingText}>{t("The customer must confirm the receipt. You cannot complete this job yourself, and you remain busy until it is resolved.")}</Text>
          <View style={styles.pendingStatusRow}>
            <Text style={styles.pendingStatusLabel}>{t("Customer approval")}</Text>
            <Text style={[styles.pendingStatusValue, jobDetail?.approval_status === "disputed" ? styles.pendingStatusDanger : null]}>
              {t(jobDetail?.approval_status === "approved" ? "Approved" :
               jobDetail?.approval_status === "disputed" ? "Disputed — dispatch mediating" :
               jobDetail?.approval_status === "expired" ? "Confirmation window expired" :
               "Awaiting confirmation")}
            </Text>
          </View>
          <View style={styles.pendingStatusRow}>
            <Text style={styles.pendingStatusLabel}>{t("Your status")}</Text>
            <Text style={styles.pendingStatusValue}>{t("Busy · no new offers")}</Text>
          </View>
          {jobDetail?.approval_url && /^https?:\/\//.test(jobDetail.approval_url) ? (
            <FieldButton icon={<Ionicons color={colors.foreground} name="open-outline" size={17} />} label={t("View approval status")} onPress={() => void Linking.openURL(jobDetail.approval_url as string)} tone="secondary" />
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.addressCard}>
            <View style={styles.addressIcon}>
              <Ionicons color={colors.primary} name="location-outline" size={18} />
            </View>
            <View style={styles.addressBody}>
              <Text style={styles.addressLabel}>{t("Authorized service address")}</Text>
              <Text style={styles.addressValue}>{job.address || t("Address will appear when authorized by the server.")}</Text>
              <Text style={styles.addressSub}>{t(serviceLabel(job))}{job.access_type ? ` · ${t(job.access_type)}` : ""}</Text>
            </View>
          </View>
          {mapsUrl ? (
            <View style={styles.navigationActionBlock}>
              <FieldButton
                icon={<Ionicons color={colors.foreground} name="navigate-outline" size={18} />}
                label={t("Open navigation")}
                onPress={() => void Linking.openURL(mapsUrl)}
                tone="secondary"
              />
              <Text style={styles.navigationActionHint}>{t("Uses your phone's maps app for live routing and traffic.")}</Text>
            </View>
          ) : null}
          {job.eta_min != null || job.distance_mi != null ? (
            <View style={styles.chipRow}>
              {job.eta_min != null ? <MetaChip label={t("ETA (est.)")} value={`${job.eta_min}${job.eta_max && job.eta_max !== job.eta_min ? `-${job.eta_max}` : ""} min`} /> : null}
              {job.distance_mi != null ? <MetaChip label={t("Distance")} value={`${job.distance_mi} mi`} /> : null}
            </View>
          ) : null}
          {hasDetails ? (
            <View style={styles.detailsCard}>
              <Text style={sharedStyles.kicker}>{t("Customer & job details")}</Text>
              {customerName ? <DetailRow label={t("Customer")} value={customerName} /> : null}
              {customerPhone ? <DetailRow label={t("Phone")} onPress={() => void Linking.openURL(`tel:${customerPhone.replace(/[^\d+]/g, "")}`)} value={customerPhone} /> : null}
              {vehicle ? <DetailRow label={t("Vehicle")} value={vehicle} /> : null}
              {notes ? <DetailRow label={t("Job notes")} value={notes} /> : null}
            </View>
          ) : null}
          {intakePhotos.length > 0 ? (
            <View style={styles.photosBlock}>
              <Text style={sharedStyles.kicker}>{t("Customer intake photos")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
                {intakePhotos.map((photo, index) => (
                  <Pressable key={`${photo.url}-${index}`} onPress={() => void Linking.openURL(photo.url)} style={styles.photoThumbWrap}>
                    <Image accessibilityLabel={photo.label || `${t("Intake photo")} ${index + 1}`} resizeMode="cover" source={{ uri: photo.url }} style={styles.photoThumb} />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </>
      )}

      {collectionItems.length > 0 ? (
        <View style={styles.detailsCard}>
          <Text style={sharedStyles.kicker}>{t("Recorded collection")}</Text>
          {collectionItems.map((item, index) => (
            <View key={`${item.description}-${index}`} style={styles.collectionRow}>
              <Text style={styles.collectionDescription} numberOfLines={1}>
                {item.description}{item.provided_by ? ` · ${t("provided by")} ${item.provided_by}` : ""}
              </Text>
              {item.amount != null ? <Text style={styles.collectionAmount}>${item.amount.toFixed(2)}</Text> : null}
            </View>
          ))}
          {jobDetail?.collection_total != null ? (
            <View style={styles.collectionTotalRow}>
              <Text style={styles.collectionTotalLabel}>{t("Total recorded")}</Text>
              <Text style={styles.collectionTotalValue}>${jobDetail.collection_total.toFixed(2)}</Text>
            </View>
          ) : null}
          <Text style={styles.collectionNote}>{t("ClueXP records this collection; it does not process payment or determine payout.")}</Text>
        </View>
      ) : null}

      {version ? <Text style={styles.truthText}>{t("server-verified version")} {version}</Text> : null}
      {!pendingCustomer ? <FieldButton disabled={!next} label={t(actionLabel)} loading={busy} onPress={() => (next ? onAdvance(next) : undefined)} /> : null}

      <View style={styles.rail}>
        <RailAction icon="chatbubble-outline" label={t("Message")} onPress={() => onSheet("messages")} />
        <RailAction icon="call-outline" label={t("Call")} onPress={() => onSheet("call")} />
        <RailAction danger icon="shield-outline" label={t("Safety")} onPress={() => onSheet("safety")} />
        <RailAction icon="ellipsis-horizontal" label={t("More")} onPress={() => onSheet("more")} />
      </View>
    </View>
  );
}

function CommandModal({ job, jobDetail, snapshotVersion, sheet, onClose, onSubmitted }: {
  job: ActiveJob | null;
  jobDetail: ActiveJobDetail | null;
  snapshotVersion: string | null;
  sheet: CommandSheet;
  onClose: () => void;
  onSubmitted: (keepOpen: boolean) => Promise<void>;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [dispatcherName, setDispatcherName] = useState("");
  const [dispatcherReason, setDispatcherReason] = useState("");
  const [issueKind, setIssueKind] = useState<string | null>(null);
  const [issueReason, setIssueReason] = useState("");
  const [issueDone, setIssueDone] = useState(false);
  const [method, setMethod] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [closeoutLines, setCloseoutLines] = useState<CloseoutLineDraft[]>(() => [newCloseoutLine()]);
  const [error, setError] = useState<string | null>(null);
  const pinInputRef = useRef<TextInput>(null);

  useEffect(() => {
    setIssueDone(false);
    setIssueKind(null);
    setIssueReason("");
    setDispatcherName("");
    setDispatcherReason("");
    setError(null);
  }, [sheet]);

  const dispatcherFallbackAllowed = Boolean(jobDetail?.arrival_verification?.dispatcher_fallback_allowed);
  const canDispatcherVerify = dispatcherName.trim().length >= 2 && dispatcherReason.trim().length >= 3;
  const closeoutSubtotal = closeoutLines.reduce((sum, line) => sum + moneyValue(line.quantity || "1") * moneyValue(line.unit_amount), 0);
  const closeoutValidationError = closeoutFormError(closeoutLines, method);

  function updateCloseoutLine(id: string, patch: Partial<CloseoutLineDraft>) {
    setCloseoutLines((current) => current.map((line) => {
      if (line.id !== id) return line;
      const next = { ...line, ...patch };
      if (patch.item_type_code) {
        const spec = CLOSEOUT_ITEM_TYPES.find((item) => item.value === patch.item_type_code);
        if (spec) {
          next.taxable = spec.taxable;
          if (!spec.requiresProvidedBy) next.provided_by = "";
          if (!spec.requiresNote) next.note = "";
        }
      }
      return next;
    }));
  }

  async function run(kind: "arrival" | "issue" | "collection", options: { issueKind?: string; dispatcherVerified?: boolean } = {}) {
    if (!job) return;
    setBusy(true);
    setError(null);
    const mutationId = clientMutationId(kind);
    const resolvedIssueKind = options.issueKind ?? issueKind ?? "cannot_complete";
    const lineItemsPayload = closeoutLines.map((line) => ({
      item_type_code: line.item_type_code,
      description: line.description.trim(),
      quantity: moneyValue(line.quantity || "1"),
      unit_amount: moneyValue(line.unit_amount),
      taxable: line.taxable,
      provided_by: line.provided_by || undefined,
      note: line.note.trim() || undefined
    }));
    const arrivalPayload = options.dispatcherVerified
      ? { method: "dispatcher_verified", dispatcher_name: dispatcherName.trim(), reason: dispatcherReason.trim(), expected_version: snapshotVersion, client_mutation_id: mutationId }
      : { pin, expected_version: snapshotVersion, client_mutation_id: mutationId };
    const outboxPayload = {
      pin,
      kind: resolvedIssueKind,
      reason: issueReason.trim(),
      arrival_method: options.dispatcherVerified ? "dispatcher_verified" : "pin",
      dispatcher_name: dispatcherName.trim(),
      dispatcher_reason: dispatcherReason.trim(),
      line_items: lineItemsPayload,
      method,
      tip_amount: moneyValue(tipAmount),
      amount: closeoutSubtotal
    };
    try {
      if (kind === "arrival") {
        await api.verifyArrival(job.id, arrivalPayload);
      } else if (kind === "issue") {
        await api.reportIssue(job.id, { kind: resolvedIssueKind, reason: issueReason.trim(), expected_version: snapshotVersion, client_mutation_id: mutationId });
      } else {
        await api.reportCollection(job.id, { line_items: lineItemsPayload, method, tip_amount: moneyValue(tipAmount), expected_version: snapshotVersion, client_mutation_id: mutationId });
        try {
          await api.updateJobStatus(job.id, "completed_pending_customer", snapshotVersion);
        } catch (statusCause) {
          if (!isNetworkFailure(statusCause)) throw statusCause;
          await queueLocalMutation(
            job.id,
            "status",
            snapshotVersion,
            `${mutationId}_status`,
            { status: "completed_pending_customer" }
          );
        }
      }
      if (kind === "issue") {
        setIssueDone(true);
        await onSubmitted(true);
      } else {
        await onSubmitted(false);
        setPin("");
        setDispatcherName("");
        setDispatcherReason("");
        setIssueReason("");
        setCloseoutLines([newCloseoutLine()]);
        setTipAmount("");
        setMethod("");
      }
    } catch (cause) {
      if (isNetworkFailure(cause)) {
        await queueLocalMutation(job.id, outboxKind(kind), snapshotVersion, mutationId, outboxPayload);
        if (kind === "issue") {
          setIssueDone(true);
          await onSubmitted(true);
        } else {
          await onSubmitted(false);
        }
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent={false} visible={sheet !== null}>
      <SafeAreaView style={sharedStyles.screen}>
        <View style={sharedStyles.phoneFrame}>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Pressable accessibilityLabel={t("Close")} accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <Ionicons color={colors.foreground} name="close" size={22} />
            </Pressable>

            {sheet === "arrival" ? (
              <View>
                <Text style={sharedStyles.kicker}>{t("Stage")} 2 {t("of 5")}</Text>
                <Text style={sharedStyles.title}>{t("Verify arrival")}</Text>
                <Text style={sharedStyles.body}>{t("Ask the customer for the six-digit PIN from their ClueXP tracking page.")}</Text>
                <Pressable onPress={() => pinInputRef.current?.focus()} style={styles.pinBoxRow}>
                  {Array.from({ length: 6 }, (_, index) => (
                    <View key={index} style={[styles.pinBox, index === pin.length ? styles.pinBoxActive : null]}>
                      <Text style={styles.pinBoxText}>{pin[index] || ""}</Text>
                    </View>
                  ))}
                </Pressable>
                <TextInput
                  inputMode="numeric"
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))}
                  ref={pinInputRef}
                  style={styles.hiddenInput}
                  value={pin}
                />
                <Text style={styles.pinHint}>{t("The button enables after six digits.")}</Text>
                {error ? <AlertBanner text={error} tone="bad" /> : null}
                <FieldButton disabled={pin.length !== 6} label={t("Confirm arrival")} loading={busy} onPress={() => void run("arrival")} />

                {dispatcherFallbackAllowed ? (
                  <View style={styles.dispatcherBox}>
                    <Text style={styles.dispatcherTitle}>{t("Call-center verification")}</Text>
                    <Text style={styles.dispatcherHint}>{t("Use this only when dispatch confirms arrival for a call-center intake and the customer has no PIN page available.")}</Text>
                    <Text style={styles.fieldLabel}>{t("Dispatcher name or initials")}</Text>
                    <TextInput onChangeText={setDispatcherName} placeholder={t("Example: NR or Nadia")} placeholderTextColor={colors.mutedFaint} style={styles.input} value={dispatcherName} />
                    <Text style={styles.fieldLabel}>{t("Verification note")}</Text>
                    <TextInput
                      multiline
                      onChangeText={setDispatcherReason}
                      placeholder={t("Example: Customer called dispatch and confirmed technician is on site.")}
                      placeholderTextColor={colors.mutedFaint}
                      style={[styles.input, styles.textArea]}
                      value={dispatcherReason}
                    />
                    <FieldButton
                      disabled={!canDispatcherVerify}
                      icon={<Ionicons color={colors.info} name="shield-checkmark-outline" size={18} />}
                      label={busy ? t("Verifying…") : t("Mark dispatch verified")}
                      loading={busy}
                      onPress={() => void run("arrival", { dispatcherVerified: true })}
                      tone="secondary"
                    />
                  </View>
                ) : (
                  <Text style={styles.noteBox}>{t("No PIN available? Contact dispatch. Dispatcher override is handled from the provider console for this intake type.")}</Text>
                )}
              </View>
            ) : null}

            {sheet === "safety" ? (
              <View>
                <Text style={styles.dangerTitle}>{t("Safety")}</Text>
                <Text style={sharedStyles.body}>{t("For unsafe conditions at or near this job. An alert is recorded against this job and sent to dispatch.")}</Text>
                <FieldButton
                  disabled={issueDone}
                  icon={<Ionicons color="#250606" name="warning-outline" size={20} />}
                  label={busy ? t("Sending alert…") : issueDone ? t("Alert sent") : t("I feel unsafe — alert dispatch")}
                  loading={busy}
                  onPress={() => void run("issue", { issueKind: "unsafe" })}
                  tone="danger"
                />
                <Pressable onPress={() => void Linking.openURL("tel:911")} style={styles.call911}>
                  <Text style={styles.call911Text}>{t("Call 911")}</Text>
                </Pressable>
                <View style={styles.dangerNote}>
                  <Text style={styles.dangerNoteText}>{t("If there is immediate danger, call 911 first. Reporting here is not a replacement for emergency services.")}</Text>
                </View>
              </View>
            ) : null}

            {sheet === "more" ? (
              <View>
                <Text style={sharedStyles.kicker}>{t("More → Report problem")}</Text>
                <Text style={sharedStyles.title}>{t("Report a problem")}</Text>
                <Text style={sharedStyles.body}>{t("Non-emergency blockers for job")} {job ? job.id.slice(0, 8) : ""}. {t("Dispatch decides what happens next.")}</Text>
                <View style={styles.issueList}>
                  {MORE_ISSUE_KINDS.map(([value, label]) => (
                    <Pressable key={value} onPress={() => setIssueKind(value)} style={[styles.issueRow, issueKind === value ? styles.issueRowActive : null]}>
                      <Text style={styles.issueRowText}>{t(label)}</Text>
                      {issueKind === value ? <View style={styles.issueDot} /> : null}
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  multiline
                  onChangeText={setIssueReason}
                  placeholder={t("What is blocking you?")}
                  placeholderTextColor={colors.mutedFaint}
                  style={[styles.input, styles.textArea]}
                  value={issueReason}
                />
                <Text style={styles.noteBox}>{t("Submitting records the issue and notifies dispatch. It does not automatically reassign or cancel this job.")}</Text>
                {error ? <AlertBanner text={error} tone="bad" /> : null}
                <FieldButton disabled={!issueKind || issueDone} label={busy ? t("Submitting…") : issueDone ? t("Problem submitted") : t("Submit to dispatch")} loading={busy} onPress={() => void run("issue")} />
              </View>
            ) : null}

            {sheet === "messages" ? <OperationsMessagesSheet job={job} onSubmitted={onSubmitted} /> : null}
            {sheet === "call" ? <UnavailableSheet text="Private call routing is not enabled on this pilot environment yet. Contact dispatch through your approved operational channel." title="Call" /> : null}

            {sheet === "collection" ? (
              <View>
                <Text style={sharedStyles.kicker}>{t("Closeout record")}</Text>
                <Text style={sharedStyles.title}>{t("What did you complete?")}</Text>
                <Text style={sharedStyles.body}>{t("Record what actually happened. ClueXP records this collection; it does not process payment or determine payout.")}</Text>

                <View style={styles.closeoutLines}>
                  {closeoutLines.map((line, index) => {
                    const spec = CLOSEOUT_ITEM_TYPES.find((item) => item.value === line.item_type_code) ?? CLOSEOUT_ITEM_TYPES[0];
                    return (
                      <View key={line.id} style={styles.closeoutLineCard}>
                        <View style={styles.closeoutLineHeader}>
                          <Text style={styles.closeoutLineKicker}>{t("Item")} {index + 1}</Text>
                          {closeoutLines.length > 1 ? (
                            <Pressable onPress={() => setCloseoutLines((current) => current.filter((item) => item.id !== line.id))}>
                              <Text style={styles.closeoutRemoveText}>{t("Remove")}</Text>
                            </Pressable>
                          ) : null}
                        </View>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.closeoutTypeRow}>
                          {CLOSEOUT_ITEM_TYPES.map((type) => {
                            const active = line.item_type_code === type.value;
                            return (
                              <Pressable key={type.value} onPress={() => updateCloseoutLine(line.id, { item_type_code: type.value })} style={[styles.typeChip, active ? styles.typeChipActive : null]}>
                                <Text style={[styles.typeChipText, active ? styles.typeChipTextActive : null]}>{t(type.label)}</Text>
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                        <TextInput
                          onChangeText={(value) => updateCloseoutLine(line.id, { description: value })}
                          placeholder={`${t("Describe this")} ${t(spec.label).toLowerCase()}`}
                          placeholderTextColor={colors.mutedFaint}
                          style={styles.input}
                          value={line.description}
                        />
                        <View style={styles.closeoutAmountRow}>
                          <TextInput
                            inputMode="decimal"
                            keyboardType="decimal-pad"
                            onChangeText={(value) => updateCloseoutLine(line.id, { quantity: value.replace(/[^0-9.]/g, "") })}
                            placeholder={t("Qty")}
                            placeholderTextColor={colors.mutedFaint}
                            style={[styles.input, styles.closeoutAmountInput]}
                            value={line.quantity}
                          />
                          <TextInput
                            inputMode="decimal"
                            keyboardType="decimal-pad"
                            onChangeText={(value) => updateCloseoutLine(line.id, { unit_amount: value.replace(/[^0-9.]/g, "") })}
                            placeholder={t("Amount")}
                            placeholderTextColor={colors.mutedFaint}
                            style={[styles.input, styles.closeoutAmountInput]}
                            value={line.unit_amount}
                          />
                        </View>
                        {spec.requiresProvidedBy ? (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.closeoutTypeRow}>
                            {PROVIDED_BY_OPTIONS.map((option) => {
                              const active = line.provided_by === option;
                              return (
                                <Pressable key={option} onPress={() => updateCloseoutLine(line.id, { provided_by: option })} style={[styles.typeChip, active ? styles.typeChipActive : null]}>
                                  <Text style={[styles.typeChipText, active ? styles.typeChipTextActive : null]}>{t(option.replaceAll("_", " "))}</Text>
                                </Pressable>
                              );
                            })}
                          </ScrollView>
                        ) : null}
                        {spec.requiresNote ? (
                          <TextInput
                            onChangeText={(value) => updateCloseoutLine(line.id, { note: value })}
                            placeholder={t("Add context if needed")}
                            placeholderTextColor={colors.mutedFaint}
                            style={styles.input}
                            value={line.note}
                          />
                        ) : null}
                      </View>
                    );
                  })}
                </View>

                <Pressable onPress={() => setCloseoutLines((current) => [...current, newCloseoutLine()])} style={styles.addLineButton}>
                  <Text style={styles.addLineButtonText}>+ {t("Add service or part")}</Text>
                </Pressable>

                <View style={styles.closeoutTotalBox}>
                  <View style={styles.closeoutTotalRow}>
                    <Text style={styles.closeoutTotalLabel}>{t("Total recorded")}</Text>
                    <Text style={styles.closeoutTotalValue}>${closeoutSubtotal.toFixed(2)}</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.closeoutTypeRow}>
                    {CLOSEOUT_PAYMENT_METHODS.map((item) => {
                      const active = method === item.value;
                      return (
                        <Pressable key={item.value} onPress={() => setMethod(item.value)} style={[styles.typeChip, active ? styles.typeChipActive : null]}>
                          <Text style={[styles.typeChipText, active ? styles.typeChipTextActive : null]}>{t(item.label)}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <TextInput
                    inputMode="decimal"
                    keyboardType="decimal-pad"
                    onChangeText={(value) => setTipAmount(value.replace(/[^0-9.]/g, ""))}
                    placeholder={t("Tip received (optional)")}
                    placeholderTextColor={colors.mutedFaint}
                    style={styles.input}
                    value={tipAmount}
                  />
                </View>

                {closeoutValidationError ? <Text style={styles.closeoutValidationText}>{t(closeoutValidationError)}</Text> : null}
                {error ? <AlertBanner text={error} tone="bad" /> : null}
                <FieldButton
                  disabled={Boolean(closeoutValidationError)}
                  icon={<Ionicons color={colors.primaryText} name="shield-checkmark-outline" size={18} />}
                  label={busy ? t("Saving…") : t("Record closeout")}
                  loading={busy}
                  onPress={() => void run("collection")}
                />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

type MessageChannel = "operations" | "customer";

const CUSTOMER_MESSAGE_TEMPLATES = [
  "on_my_way",
  "arrived",
  "running_late",
  "need_more_details",
  "customer_unavailable",
  "work_complete",
  "please_confirm"
] as const;

const CUSTOMER_TEMPLATE_LABELS: Record<(typeof CUSTOMER_MESSAGE_TEMPLATES)[number], string> = {
  on_my_way: "On my way",
  arrived: "I have arrived",
  running_late: "Running late",
  need_more_details: "Need more details",
  customer_unavailable: "Customer unavailable",
  work_complete: "Work complete",
  please_confirm: "Please confirm"
};

function messageAuthorLabel(message: JobMessage) {
  if (message.sender_type === "technician") return "You";
  if (message.sender_type === "provider_admin") return "Dispatch";
  if (message.sender_type === "dispatcher") return "Dispatch";
  if (message.sender_type === "customer") return "Customer";
  if (message.sender_type === "system") return "System";
  return "Operations";
}

function messageDisplayBody(message: JobMessage) {
  if (message.body) return message.body;
  if (message.template_code && message.template_code in CUSTOMER_TEMPLATE_LABELS) {
    return CUSTOMER_TEMPLATE_LABELS[message.template_code as keyof typeof CUSTOMER_TEMPLATE_LABELS];
  }
  return message.template_code || "";
}

function messageTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function OperationsMessagesSheet({ job, onSubmitted }: {
  job: ActiveJob | null;
  onSubmitted: (keepOpen: boolean) => Promise<void>;
}) {
  const { t } = useLocale();
  const [channel, setChannel] = useState<MessageChannel>("operations");
  const [messages, setMessages] = useState<JobMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [queuedNotice, setQueuedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(async (silent = false) => {
    if (!job) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      setMessages(await api.listJobMessages(job.id, channel));
    } catch (cause) {
      if (!silent) setError(errorMessage(cause));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [channel, job]);

  useEffect(() => {
    setMessages([]);
    setDraft("");
    setQueuedNotice(false);
    setError(null);
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!job) return;
    const timer = setInterval(() => {
      void loadMessages(true);
    }, 15_000);
    return () => clearInterval(timer);
  }, [job, loadMessages]);

  const renderMessage = useCallback(({ item }: { item: JobMessage }) => {
    const mine = item.sender_type === "technician";
    const body = messageDisplayBody(item);
    return (
      <View style={[styles.messageBubbleRow, mine ? styles.messageBubbleRowMine : null]}>
        <View style={[styles.messageBubble, mine ? styles.messageBubbleMine : null]}>
          <View style={styles.messageMetaRow}>
            <Text style={styles.messageAuthor}>{t(messageAuthorLabel(item))}</Text>
            {messageTime(item.created_at) ? <Text style={styles.messageTime}>{messageTime(item.created_at)}</Text> : null}
          </View>
          <Text style={styles.messageBody}>{body}</Text>
          {item.delivery_state ? <Text style={styles.messageState}>{t(item.delivery_state)}</Text> : null}
        </View>
      </View>
    );
  }, [t]);

  function selectChannel(nextChannel: MessageChannel) {
    setChannel(nextChannel);
    setDraft("");
    setQueuedNotice(false);
    setError(null);
  }

  async function sendMessage() {
    if (!job || !draft.trim() || sending) return;
    const body = draft.trim();
    const clientMessageId = clientMutationId("message");
    setSending(true);
    setError(null);
    setQueuedNotice(false);
    try {
      const result = await api.sendJobMessage(job.id, {
        body,
        channel: "operations",
        client_message_id: clientMessageId
      });
      setMessages((current) => [...current, result.message]);
      setDraft("");
      await onSubmitted(true);
    } catch (cause) {
      if (isNetworkFailure(cause)) {
        await queueLocalMutation(job.id, "message", null, clientMessageId, { body, channel: "operations" });
        setMessages((current) => [...current, {
          id: clientMessageId,
          job_id: job.id,
          channel: "operations",
          sender_type: "technician",
          body,
          client_message_id: clientMessageId,
          created_at: new Date().toISOString(),
          delivery_state: "queued"
        }]);
        setDraft("");
        setQueuedNotice(true);
        await onSubmitted(true);
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setSending(false);
    }
  }

  async function sendCustomerTemplate(templateCode: (typeof CUSTOMER_MESSAGE_TEMPLATES)[number]) {
    if (!job || sending) return;
    const clientMessageId = clientMutationId("message");
    setSending(true);
    setError(null);
    setQueuedNotice(false);
    try {
      const result = await api.sendJobMessage(job.id, {
        channel: "customer",
        template_code: templateCode,
        client_message_id: clientMessageId
      });
      setMessages((current) => [...current, result.message]);
      await onSubmitted(true);
    } catch (cause) {
      if (isNetworkFailure(cause)) {
        await queueLocalMutation(job.id, "message", null, clientMessageId, { channel: "customer", template_code: templateCode });
        setMessages((current) => [...current, {
          id: clientMessageId,
          job_id: job.id,
          channel: "customer",
          sender_type: "technician",
          template_code: templateCode,
          client_message_id: clientMessageId,
          created_at: new Date().toISOString(),
          delivery_state: "queued"
        }]);
        setQueuedNotice(true);
        await onSubmitted(true);
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.messageSheet}>
      <Text style={sharedStyles.kicker}>{channel === "operations" ? t("Operations channel") : t("Customer channel")}</Text>
      <View style={styles.messageTitleRow}>
        <Text style={sharedStyles.title}>{t("Job messages")}</Text>
        <Pressable
          accessibilityLabel={t("Refresh messages")}
          accessibilityRole="button"
          disabled={loading}
          onPress={() => void loadMessages()}
          style={[styles.messageRefreshButton, loading ? styles.messageSendButtonDisabled : null]}
        >
          <Ionicons color={colors.foreground} name="refresh" size={17} />
          <Text style={styles.messageRefreshText}>{t("Refresh")}</Text>
        </Pressable>
      </View>
      <Text style={sharedStyles.body}>{channel === "operations" ? t("Message your company operations team about this active job.") : t("Send customer-visible template updates about this active job.")}</Text>

      <View style={styles.messageChannelTabs}>
        {(["operations", "customer"] as const).map((nextChannel) => (
          <Pressable
            accessibilityRole="button"
            key={nextChannel}
            onPress={() => selectChannel(nextChannel)}
            style={[styles.messageChannelTab, channel === nextChannel ? styles.messageChannelTabActive : null]}
          >
            <Text style={[styles.messageChannelTabText, channel === nextChannel ? styles.messageChannelTabTextActive : null]}>
              {t(nextChannel === "operations" ? "Operations" : "Customer")}
            </Text>
          </Pressable>
        ))}
      </View>

      {queuedNotice ? <AlertBanner text={t("Message queued offline — it will send automatically once you're back online.")} tone="warn" /> : null}
      {error ? <AlertBanner text={error} tone="bad" /> : null}

      <View style={styles.messageListBox}>
        {loading ? <Text style={styles.emptyMessageText}>{t("Loading messages…")}</Text> : null}
        {!loading && messages.length === 0 ? <Text style={styles.emptyMessageText}>{t(channel === "operations" ? "No operations messages yet." : "No customer messages yet.")}</Text> : null}
        {messages.length > 0 ? (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            scrollEnabled={false}
          />
        ) : null}
      </View>

      {channel === "operations" ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.messageComposer}>
            <TextInput
              multiline
              onChangeText={setDraft}
              placeholder={t("Type an operations message")}
              placeholderTextColor={colors.mutedFaint}
              style={styles.messageInput}
              value={draft}
            />
            <Pressable
              accessibilityLabel={t("Send message")}
              accessibilityRole="button"
              disabled={!draft.trim() || sending}
              onPress={() => void sendMessage()}
              style={[styles.messageSendButton, !draft.trim() || sending ? styles.messageSendButtonDisabled : null]}
            >
              <Ionicons color={colors.primaryText} name="send" size={18} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.customerTemplateGrid}>
          {CUSTOMER_MESSAGE_TEMPLATES.map((templateCode) => (
            <Pressable
              accessibilityRole="button"
              disabled={sending}
              key={templateCode}
              onPress={() => void sendCustomerTemplate(templateCode)}
              style={[styles.customerTemplateButton, sending ? styles.messageSendButtonDisabled : null]}
            >
              <Text style={styles.customerTemplateText}>{t(CUSTOMER_TEMPLATE_LABELS[templateCode])}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.messageFinePrint}>{t(channel === "operations" ? "This thread is visible to your company operations team. Do not share payment card data or private access codes here." : "Customer messages are visible on the live tracking page. Use approved templates only.")}</Text>
    </View>
  );
}

function UnavailableSheet({ title, text }: { title: string; text: string }) {
  const { t } = useLocale();
  return (
    <View>
      <Text style={sharedStyles.title}>{t(title)}</Text>
      <View style={styles.noticeBox}>
        <Text style={styles.noticeTitle}>{t("Not enabled in this pilot")}</Text>
        <Text style={styles.noticeText}>{t(text)}</Text>
      </View>
    </View>
  );
}

async function queueLocalMutation(jobId: string, kind: QueuedMutation["kind"], expectedVersion: string | null, clientMutationId: string, payload: Record<string, unknown>) {
  await enqueueMutation({
    clientMutationId,
    jobId,
    kind,
    expectedVersion,
    payload,
    createdAt: new Date().toISOString()
  });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaChip}>
      <Text style={styles.metaChipLabel}>{label}</Text>
      <Text style={styles.metaChipValue}>{value}</Text>
    </View>
  );
}

function DetailRow({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailRowLabel}>{label}</Text>
      {onPress ? (
        <Pressable onPress={onPress}>
          <Text style={[styles.detailRowValue, styles.detailRowLink]}>{value}</Text>
        </Pressable>
      ) : (
        <Text style={styles.detailRowValue}>{value}</Text>
      )}
    </View>
  );
}

function RailAction({ label, icon, danger = false, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.railAction, danger ? styles.railDanger : null]}>
      <Ionicons color={danger ? colors.danger : colors.foreground} name={icon} size={18} />
      <Text style={[styles.railText, danger ? styles.dangerText : null]}>{label}</Text>
    </Pressable>
  );
}

function AlertBanner({ text, tone }: { text: string; tone: "bad" | "warn" }) {
  return (
    <View style={[styles.alert, tone === "bad" ? styles.alertBad : styles.alertWarn]}>
      <Ionicons color={tone === "bad" ? colors.danger : colors.primary} name="alert-circle-outline" size={20} />
      <Text style={styles.alertText}>{text}</Text>
    </View>
  );
}

function mutationLabel(kind: FailedMutation["kind"]) {
  if (kind === "arrival_verify") return "Arrival verification";
  if (kind === "report_issue") return "Problem report";
  if (kind === "collection") return "Collection record";
  return "Status update";
}

function SyncIssuesPanel() {
  const { t } = useLocale();
  const [failed, setFailed] = useState<FailedMutation[]>([]);

  useEffect(() => {
    void failedMutations().then(setFailed).catch(() => undefined);
  }, []);

  if (failed.length === 0) return null;

  return (
    <View style={styles.syncPanel}>
      <Text style={styles.syncPanelTitle}>{t("Actions that could not sync")}</Text>
      <Text style={styles.syncPanelHint}>{t("These job actions were not applied to the server. Contact dispatch if the job still needs this update — the app will not retry them automatically.")}</Text>
      <View style={styles.syncPanelList}>
        {failed.map((item) => (
          <View key={item.clientMutationId} style={styles.syncPanelRow}>
            <Text style={styles.syncPanelRowTitle}>{t(mutationLabel(item.kind))} · {t("job")} {item.jobId.slice(0, 8)}</Text>
            <Text style={styles.syncPanelRowDetail}>{item.lastError || t("Unknown error")}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function AccountScreen({ session, onLogout, onSessionRefresh }: { session: AuthSession; onLogout: () => Promise<void>; onSessionRefresh: () => Promise<void> }) {
  const { t } = useLocale();
  const name = session.user?.display_name || t("Technician");
  const vetting = session.technician?.vetting_status ?? "verified";
  const verified = vetting === "verified";
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [pendingInvites, setPendingInvites] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.affiliations()
      .then((rows) => {
        if (!cancelled) setPendingInvites(rows.filter((row) => row.status === "pending_invite").length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function changePhoto() {
    setPhotoError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoError(t("Allow photo library access to update your headshot."));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPhotoBusy(true);
    try {
      await api.uploadPhoto({ name: asset.fileName || "photo.jpg", type: asset.mimeType || "image/jpeg", uri: asset.uri });
      await onSessionRefresh();
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : t("Failed to upload photo"));
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <View style={styles.accountHeader}>
          <View style={styles.accountHeaderBody}>
            <Text style={styles.accountName}>{name}</Text>
            <Text style={styles.accountSub}>{session.organization_name || t("No provider affiliation")}</Text>
            <Text style={styles.accountId}>ID {(session.technician?.id || "—").slice(0, 8).toUpperCase()}</Text>
            <Pill icon={<Ionicons color={verified ? colors.success : colors.primary} name={verified ? "shield-checkmark-outline" : "time-outline"} size={13} />} tone={verified ? "success" : "default"}>
              {verified ? t("Identity verified") : t(String(vetting).replaceAll("_", " "))}
            </Pill>
          </View>
          <Pressable accessibilityLabel={t("Change profile photo")} disabled={photoBusy} onPress={() => void changePhoto()} style={styles.avatarWrap}>
            <View style={styles.accountAvatar}>
              <AvatarContent initials={initialsFor(name)} photoUrl={session.technician?.photo_url} textStyle={styles.accountAvatarText} />
            </View>
            <View style={styles.avatarEditBadge}>
              <Ionicons color={colors.primaryText} name={photoBusy ? "hourglass-outline" : "camera-outline"} size={12} />
            </View>
          </Pressable>
        </View>
        {photoError ? <Text style={styles.photoError}>{photoError}</Text> : null}

        <ProfileEditor api={api} onSaved={onSessionRefresh} session={session} />

        <Text style={styles.sectionKicker}>{t("Trust profile")}</Text>
        <View style={styles.trustGrid}>
          <MiniStat label={t("Role")} value={t(session.roles?.[0] ?? "technician")} />
          <MiniStat label={t("Status")} value={t(String(session.technician?.status ?? "active"))} />
        </View>
        <View style={styles.trustGrid}>
          <MiniStat label={t("Vetting")} value={t(String(vetting))} />
          <MiniStat label={t("Company")} value={session.organization_name || t("None")} />
        </View>

        <Pressable onPress={() => setShowDocuments(true)} style={styles.linkRow}>
          <View style={styles.linkRowLeft}>
            <Ionicons color={colors.muted} name="document-text-outline" size={18} />
            <Text style={styles.linkRowText}>{t("Documents")}</Text>
          </View>
          <Ionicons color={colors.muted} name="chevron-forward" size={16} />
        </Pressable>

        <Pressable onPress={() => setShowTeam(true)} style={styles.linkRow}>
          <View style={styles.linkRowLeft}>
            <Ionicons color={colors.muted} name="people-outline" size={18} />
            <Text style={styles.linkRowText}>{t("Team")}</Text>
          </View>
          <View style={styles.linkRowRight}>
            {pendingInvites > 0 ? (
              <View style={styles.linkRowBadge}>
                <Text style={styles.linkRowBadgeText}>{t(`${pendingInvites} invite${pendingInvites === 1 ? "" : "s"}`)}</Text>
              </View>
            ) : null}
            <Ionicons color={colors.muted} name="chevron-forward" size={16} />
          </View>
        </Pressable>

        <SyncIssuesPanel />

        <View style={styles.panel}>
          <Text style={sharedStyles.kicker}>{t("Native storage")}</Text>
          <Text style={sharedStyles.body}>{t("Sessions and offline actions are secured with SecureStore and a SQLCipher-encrypted outbox.")}</Text>
        </View>

        <FieldButton icon={<Ionicons color="#250606" name="log-out-outline" size={18} />} label={t("Sign out")} onPress={() => void onLogout()} tone="danger" />
      </ScrollView>
      <Modal animationType="slide" onRequestClose={() => setShowDocuments(false)} visible={showDocuments}>
        <SafeAreaView style={sharedStyles.screen}>
          <View style={sharedStyles.phoneFrame}>
            <DocumentsScreen api={api} onClose={() => setShowDocuments(false)} />
          </View>
        </SafeAreaView>
      </Modal>
      <Modal animationType="slide" onRequestClose={() => setShowTeam(false)} visible={showTeam}>
        <SafeAreaView style={sharedStyles.screen}>
          <View style={sharedStyles.phoneFrame}>
            <TeamScreen api={api} onClose={() => setShowTeam(false)} />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  center: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center"
  },
  bootCaption: {
    color: colors.mutedFaint,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  loginWrap: {
    flex: 1,
    justifyContent: "space-between",
    padding: 22
  },
  loginTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  loginForm: {
    paddingBottom: 12
  },
  loginBadge: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 48,
    justifyContent: "center",
    marginBottom: 20,
    width: 48
  },
  loginTitle: {
    color: colors.foreground,
    fontSize: 30,
    fontWeight: "900"
  },
  loginCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8
  },
  field: {
    marginTop: 20
  },
  fieldLabel: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "700"
  },
  input: {
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: radius.xs,
    borderWidth: 1,
    color: colors.foreground,
    fontSize: 16,
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 16
  },
  textArea: {
    minHeight: 96,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    overflow: "hidden",
    width: 44
  },
  avatarImage: {
    height: "100%",
    width: "100%"
  },
  avatarText: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800"
  },
  avatarBadge: {
    backgroundColor: colors.primary,
    borderColor: colors.background,
    borderRadius: 6,
    borderWidth: 2,
    height: 12,
    position: "absolute",
    right: -2,
    top: -2,
    width: 12
  },
  avatarBadgeDanger: {
    backgroundColor: colors.danger
  },
  content: {
    flex: 1
  },
  scrollBody: {
    gap: 16,
    padding: 16,
    paddingBottom: 98
  },
  panel: {
    ...sharedStyles.panel,
    gap: 10,
    marginTop: 20,
    padding: 16
  },
  syncPanel: {
    backgroundColor: colors.cautionBg,
    borderColor: colors.cautionBorder,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 8,
    padding: 14
  },
  syncPanelTitle: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  syncPanelHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  syncPanelList: {
    gap: 8
  },
  syncPanelRow: {
    backgroundColor: colors.background,
    borderRadius: radius.xs,
    padding: 10
  },
  syncPanelRowTitle: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: "800"
  },
  syncPanelRowDetail: {
    color: colors.dangerSoft,
    fontSize: 12,
    marginTop: 3
  },
  readyWrap: {
    alignItems: "center",
    borderColor: colors.border,
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 30,
    paddingVertical: 10
  },
  readyCircle: {
    alignItems: "center",
    borderColor: colors.success,
    borderRadius: 999,
    borderWidth: 2,
    height: 64,
    justifyContent: "center",
    width: 64
  },
  readyTitle: {
    color: colors.foreground,
    fontSize: 26,
    fontWeight: "900",
    marginTop: 10,
    textTransform: "uppercase"
  },
  readyCaption: {
    color: colors.successSoft,
    fontFamily: "monospace",
    fontSize: 11,
    textTransform: "uppercase"
  },
  readyBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 280,
    textAlign: "center"
  },
  offerWrap: {
    gap: 13
  },
  queueChip: {
    alignSelf: "center",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 4
  },
  offerTitle: {
    color: colors.foreground,
    fontSize: 28,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  offerMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6
  },
  offerMeta: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "700"
  },
  faintText: {
    color: colors.mutedFaint,
    fontSize: 13,
    lineHeight: 19
  },
  metricGrid: {
    flexDirection: "row",
    gap: 10
  },
  metric: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    padding: 12
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12
  },
  metricValue: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4
  },
  amountRow: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14
  },
  amountText: {
    color: colors.foreground,
    fontSize: 26,
    fontWeight: "900"
  },
  reasonPanel: {
    backgroundColor: colors.cardStrong,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12
  },
  reasonKicker: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  reasonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8
  },
  reasonChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  reasonChipText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "700"
  },
  reasonChipMuted: {
    color: colors.muted
  },
  activeWrap: {
    gap: 16
  },
  mapFallback: {
    backgroundColor: "#131417",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    minHeight: 220,
    overflow: "hidden",
    padding: 16
  },
  mapBadge: {
    alignItems: "center",
    backgroundColor: "rgba(14, 14, 14, 0.92)",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: "absolute",
    top: 12
  },
  mapBadgeText: {
    color: colors.foreground,
    fontSize: 11,
    fontWeight: "800"
  },
  navigateBadge: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: "absolute",
    right: 12,
    top: 12
  },
  navigateBadgeText: {
    color: colors.primaryText,
    fontSize: 11,
    fontWeight: "800"
  },
  mapGrid: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  mapText: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 10,
    textAlign: "center"
  },
  mapTruth: {
    color: colors.mutedFaint,
    fontFamily: "monospace",
    fontSize: 10,
    textAlign: "center",
    textTransform: "uppercase"
  },
  mapTruthOverlay: {
    backgroundColor: "rgba(14, 14, 14, 0.85)",
    borderRadius: 999,
    bottom: 12,
    left: 12,
    paddingVertical: 7,
    position: "absolute",
    right: 12
  },
  freshnessRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  freshnessDot: {
    borderRadius: 4,
    height: 7,
    width: 7
  },
  freshnessDotGood: {
    backgroundColor: colors.success
  },
  freshnessDotWarn: {
    backgroundColor: colors.primary
  },
  freshnessText: {
    color: colors.muted,
    fontSize: 12
  },
  freshnessGood: {
    color: colors.success,
    fontWeight: "700"
  },
  freshnessWarn: {
    color: colors.primary,
    fontWeight: "700"
  },
  stageHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  stageBars: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "flex-end",
    maxWidth: 160
  },
  stageBar: {
    backgroundColor: colors.border,
    borderRadius: 3,
    flex: 1,
    height: 4
  },
  stageBarOn: {
    backgroundColor: colors.primary
  },
  stageHeading: {
    color: colors.foreground,
    fontSize: 32,
    fontWeight: "900",
    marginTop: 6,
    textTransform: "uppercase"
  },
  stageDetail: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8
  },
  addressCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14
  },
  addressIcon: {
    alignItems: "center",
    backgroundColor: colors.cardStrong,
    borderRadius: radius.sm,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  addressBody: {
    flex: 1
  },
  addressLabel: {
    color: colors.muted,
    fontSize: 13
  },
  addressValue: {
    color: colors.foreground,
    fontSize: 17,
    fontWeight: "700",
    marginTop: 4
  },
  addressSub: {
    color: colors.mutedFaint,
    fontSize: 13,
    marginTop: 6,
    textTransform: "capitalize"
  },
  navigationActionBlock: {
    gap: 8
  },
  navigationActionHint: {
    color: colors.mutedFaint,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center"
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  metaChip: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.xs,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  metaChipLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  metaChipValue: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "800"
  },
  detailsCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 10,
    padding: 14
  },
  detailRow: {
    gap: 3
  },
  detailRowLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  detailRowValue: {
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 19
  },
  detailRowLink: {
    color: colors.primary,
    fontWeight: "700"
  },
  photosBlock: {
    gap: 8
  },
  photoRow: {
    flexGrow: 0
  },
  photoThumbWrap: {
    borderRadius: radius.xs,
    height: 76,
    marginRight: 8,
    overflow: "hidden",
    width: 76
  },
  photoThumb: {
    height: "100%",
    width: "100%"
  },
  collectionRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  collectionDescription: {
    color: colors.foreground,
    flex: 1,
    fontSize: 13,
    fontWeight: "700"
  },
  collectionAmount: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "900"
  },
  collectionTotalRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10
  },
  collectionTotalLabel: {
    color: colors.muted,
    fontSize: 13
  },
  collectionTotalValue: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "900"
  },
  collectionNote: {
    color: colors.mutedFaint,
    fontSize: 11,
    lineHeight: 16
  },
  truthText: {
    color: colors.successSoft,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    textTransform: "uppercase"
  },
  pendingCard: {
    alignItems: "center",
    paddingVertical: 24
  },
  pendingCircle: {
    alignItems: "center",
    borderColor: colors.primary,
    borderRadius: 999,
    borderStyle: "dashed",
    borderWidth: 2,
    height: 60,
    justifyContent: "center",
    width: 60
  },
  pendingEllipsis: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: "900"
  },
  pendingKicker: {
    ...sharedStyles.kicker,
    marginTop: 16
  },
  pendingText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    maxWidth: 300,
    textAlign: "center"
  },
  pendingStatusRow: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
    padding: 14,
    width: "100%"
  },
  pendingStatusLabel: {
    color: colors.muted,
    fontSize: 13
  },
  pendingStatusValue: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800"
  },
  pendingStatusDanger: {
    color: colors.danger
  },
  rail: {
    flexDirection: "row",
    gap: 8
  },
  railAction: {
    alignItems: "center",
    backgroundColor: colors.cardRail,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    gap: 5,
    justifyContent: "center",
    minHeight: 58
  },
  railDanger: {
    borderColor: "#4A2325"
  },
  railText: {
    color: colors.foreground,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  dangerText: {
    color: colors.danger
  },
  alert: {
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 12
  },
  alertBad: {
    backgroundColor: "#1A1213",
    borderColor: "#4A2325"
  },
  alertWarn: {
    backgroundColor: colors.cautionBg,
    borderColor: colors.cautionBorder
  },
  alertText: {
    color: colors.foreground,
    flex: 1,
    fontSize: 14,
    lineHeight: 20
  },
  modalBody: {
    gap: 18,
    padding: 18,
    paddingBottom: 40
  },
  closeButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  pinBoxRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 28
  },
  pinBox: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    height: 58,
    justifyContent: "center"
  },
  pinBoxActive: {
    borderColor: colors.primary,
    borderWidth: 2
  },
  pinBoxText: {
    color: colors.foreground,
    fontSize: 26,
    fontWeight: "900"
  },
  hiddenInput: {
    height: 1,
    opacity: 0,
    position: "absolute",
    width: 1
  },
  pinHint: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 10,
    textAlign: "center"
  },
  dangerTitle: {
    color: colors.danger,
    fontSize: 34,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  call911: {
    alignItems: "center",
    borderColor: colors.danger,
    borderRadius: radius.md,
    borderWidth: 2,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 56
  },
  call911Text: {
    color: colors.danger,
    fontSize: 18,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  dangerNote: {
    backgroundColor: "#1A1213",
    borderColor: "#4A2325",
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: 18,
    padding: 14
  },
  dangerNoteText: {
    color: colors.dangerSoft,
    fontSize: 13,
    lineHeight: 19
  },
  issueList: {
    gap: 8,
    marginTop: 18
  },
  issueRow: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 14
  },
  issueRowActive: {
    backgroundColor: "rgba(255, 191, 0, 0.08)",
    borderColor: colors.primary
  },
  issueRowText: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "700"
  },
  issueDot: {
    backgroundColor: colors.primary,
    borderRadius: 5,
    height: 10,
    width: 10
  },
  noteBox: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    padding: 12
  },
  messageSheet: {
    gap: 14
  },
  messageTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  messageRefreshButton: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 10
  },
  messageRefreshText: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  messageListBox: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 180,
    padding: 10
  },
  messageChannelTabs: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden"
  },
  messageChannelTab: {
    alignItems: "center",
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10
  },
  messageChannelTabActive: {
    backgroundColor: colors.primary
  },
  messageChannelTabText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  messageChannelTabTextActive: {
    color: colors.primaryText
  },
  emptyMessageText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
    textAlign: "center"
  },
  messageBubbleRow: {
    alignItems: "flex-start",
    marginVertical: 5
  },
  messageBubbleRowMine: {
    alignItems: "flex-end"
  },
  messageBubble: {
    backgroundColor: colors.cardStrong,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    maxWidth: "86%",
    padding: 11
  },
  messageBubbleMine: {
    backgroundColor: "rgba(255, 191, 0, 0.1)",
    borderColor: colors.primary
  },
  messageMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  messageAuthor: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  messageTime: {
    color: colors.mutedFaint,
    fontSize: 11
  },
  messageBody: {
    color: colors.foreground,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6
  },
  messageState: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 7,
    textTransform: "uppercase"
  },
  messageComposer: {
    alignItems: "flex-end",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10
  },
  messageInput: {
    color: colors.foreground,
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 120,
    minHeight: 42,
    paddingHorizontal: 4,
    paddingTop: 8,
    textAlignVertical: "top"
  },
  messageSendButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    height: 44,
    justifyContent: "center",
    width: 48
  },
  messageSendButtonDisabled: {
    opacity: 0.45
  },
  messageFinePrint: {
    color: colors.mutedFaint,
    fontSize: 12,
    lineHeight: 17
  },
  customerTemplateGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  customerTemplateButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  customerTemplateText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "900"
  },
  dispatcherBox: {
    backgroundColor: "rgba(98, 168, 255, 0.06)",
    borderColor: colors.info,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 10,
    marginTop: 20,
    padding: 14
  },
  dispatcherTitle: {
    color: colors.info,
    fontSize: 20,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  dispatcherHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  closeoutLines: {
    gap: 12,
    marginTop: 16
  },
  closeoutLineCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 8,
    padding: 12
  },
  closeoutLineHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  closeoutLineKicker: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  closeoutRemoveText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700"
  },
  closeoutTypeRow: {
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
    fontWeight: "700",
    textTransform: "capitalize"
  },
  typeChipTextActive: {
    color: colors.primary
  },
  closeoutAmountRow: {
    flexDirection: "row",
    gap: 8
  },
  closeoutAmountInput: {
    flex: 1
  },
  addLineButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderStyle: "dashed",
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 46
  },
  addLineButtonText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  closeoutTotalBox: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 10,
    marginTop: 16,
    padding: 14
  },
  closeoutTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  closeoutTotalLabel: {
    color: colors.muted,
    fontSize: 14
  },
  closeoutTotalValue: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: "900"
  },
  closeoutValidationText: {
    color: colors.primary,
    fontSize: 12,
    marginTop: 10,
    textAlign: "center"
  },
  noticeBox: {
    backgroundColor: "rgba(255, 191, 0, 0.08)",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: 16,
    padding: 14
  },
  noticeTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800"
  },
  noticeText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8
  },
  methodRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginVertical: 12
  },
  methodChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 12
  },
  choiceActive: {
    backgroundColor: "rgba(255, 191, 0, 0.08)",
    borderColor: colors.primary
  },
  choiceText: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "700",
    textTransform: "capitalize"
  },
  accountHeader: {
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between"
  },
  accountHeaderBody: {
    flex: 1,
    gap: 8
  },
  accountName: {
    color: colors.foreground,
    fontSize: 26,
    fontWeight: "900"
  },
  accountSub: {
    color: colors.muted,
    fontSize: 14
  },
  accountId: {
    color: colors.mutedFaint,
    fontFamily: "monospace",
    fontSize: 11
  },
  avatarWrap: {
    height: 56,
    width: 56
  },
  accountAvatar: {
    alignItems: "center",
    backgroundColor: colors.cardStrong,
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    overflow: "hidden",
    width: 56
  },
  accountAvatarText: {
    color: colors.foreground,
    fontSize: 19,
    fontWeight: "900"
  },
  avatarEditBadge: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderColor: colors.background,
    borderRadius: 10,
    borderWidth: 2,
    bottom: -2,
    height: 20,
    justifyContent: "center",
    position: "absolute",
    right: -2,
    width: 20
  },
  photoError: {
    color: colors.danger,
    fontSize: 12,
    marginTop: -8
  },
  linkRow: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 14
  },
  linkRowLeft: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  linkRowText: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800"
  },
  linkRowRight: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  linkRowBadge: {
    backgroundColor: "rgba(255, 191, 0, 0.12)",
    borderColor: colors.primary,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  linkRowBadgeText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800"
  },
  sectionKicker: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginTop: 6,
    textTransform: "uppercase"
  },
  trustGrid: {
    flexDirection: "row",
    gap: 10
  }
});
