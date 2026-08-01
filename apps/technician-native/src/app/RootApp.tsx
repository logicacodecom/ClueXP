import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { ApiError, CluexpApi } from "../api/client";
import { BottomNav, type TabKey } from "../components/BottomNav";
import { Countdown } from "../components/Countdown";
import { FieldButton } from "../components/FieldButton";
import { LanguageToggle, type Locale } from "../components/LanguageToggle";
import { Logo } from "../components/Logo";
import { MiniStat } from "../components/MiniStat";
import { Pill } from "../components/Pill";
import { ReadinessBar } from "../components/ReadinessBar";
import { registerPushDevice, requestAndSendLocation } from "../features/nativeCapabilities";
import { replayQueuedMutations } from "../features/outboxReplay";
import { logoutStoredSession } from "../features/sessionLifecycle";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "../storage/sessionStore";
import { enqueueMutation, initOutbox, queuedMutationCount, wipeOutbox } from "../storage/outbox";
import { colors, radius, sharedStyles } from "../theme";
import type { ActiveJob, ActiveJobSnapshot, AuthSession, JobStatus, QueuedMutation, ReadinessSnapshot, TechnicianOffer } from "../types";

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

function clientMutationId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function errorMessage(cause: unknown) {
  if (cause instanceof ApiError) return cause.problem.message;
  if (cause instanceof Error) return cause.message;
  return "Unable to connect to ClueXP.";
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
  const [booting, setBooting] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tab, setTab] = useState<TabKey>("work");
  const [queueCount, setQueueCount] = useState(0);
  const [workHint, setWorkHint] = useState<WorkHint>(null);

  const hardSignOut = useCallback(async () => {
    api.setSessionTokens(null, null);
    await clearStoredSession();
    await wipeOutbox();
    setAccessToken(null);
    setSession(null);
    setQueueCount(0);
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
        const count = await queuedMutationCount();
        if (mounted) setQueueCount(count);
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
        setTab("work");
      }
    });
  }, []);

  const refreshQueue = useCallback(async () => {
    setQueueCount(await queuedMutationCount());
  }, []);

  if (booting) {
    return (
      <SafeAreaView style={sharedStyles.screen}>
        <StatusBar style="light" />
        <View style={sharedStyles.phoneFrame}>
          <View style={styles.center}>
            <Logo height={40} />
            <Text style={styles.bootCaption}>Restoring secure session</Text>
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
          <Header onAvatarPress={() => setTab("account")} queueCount={queueCount} session={session} />
          {tab === "work" ? <WorkScreen hint={workHint} onHintConsumed={() => setWorkHint(null)} onQueueChanged={refreshQueue} session={session} /> : null}
          {tab === "activity" ? (
            <ComingSoonTab
              icon="time-outline"
              text="Finished jobs, collected money, and customer reviews will land here — matching the ClueXP web experience. This first native build keeps active work and command truth front and center."
              title="Activity is coming to native"
            />
          ) : null}
          {tab === "earnings" ? (
            <ComingSoonTab
              icon="wallet-outline"
              text="Settlement periods and payout estimates will land here. Collections you record during a job are already saved server-side."
              title="Earnings is coming to native"
            />
          ) : null}
          {tab === "account" ? <AccountScreen onLogout={onLogout} session={session} /> : null}
          <BottomNav onSelect={setTab} selected={tab} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const LOGIN_COPY: Record<Locale, { signIn: string; subtitle: string; email: string; password: string }> = {
  en: { signIn: "Sign in", subtitle: "Secure access for verified ClueXP technicians.", email: "Email or phone", password: "Password" },
  es: { signIn: "Iniciar sesion", subtitle: "Acceso seguro para tecnicos ClueXP verificados.", email: "Correo o telefono", password: "Contrasena" }
};

function LoginScreen({ onLogin }: { onLogin: (identifier: string, password: string) => Promise<void> }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const copy = LOGIN_COPY[locale];

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
            <LanguageToggle locale={locale} onChange={setLocale} />
          </View>
          <View style={styles.loginForm}>
            <View style={styles.loginBadge}>
              <Ionicons color={colors.primaryText} name="shield-checkmark" size={24} />
            </View>
            <Text style={styles.loginTitle}>{copy.signIn}</Text>
            <Text style={styles.loginCopy}>{copy.subtitle}</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{copy.email}</Text>
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
              <Text style={styles.fieldLabel}>{copy.password}</Text>
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
            <FieldButton disabled={!identifier.trim() || !password} label={copy.signIn} loading={busy} onPress={submit} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

function AvatarContent({ photoUrl, initials, textStyle }: { photoUrl?: string | null; initials: string; textStyle: object }) {
  if (photoUrl) {
    return <Image accessibilityLabel="Profile photo" resizeMode="cover" source={{ uri: photoUrl }} style={styles.avatarImage} />;
  }
  return <Text style={textStyle}>{initials}</Text>;
}

function Header({ session, queueCount, onAvatarPress }: { session: AuthSession; queueCount: number; onAvatarPress: () => void }) {
  const name = session.user?.display_name || session.user?.email || "Technician";
  return (
    <View style={styles.header}>
      <Logo height={20} />
      <Pressable accessibilityLabel="Open account" accessibilityRole="button" onPress={onAvatarPress} style={styles.avatar}>
        <AvatarContent initials={initialsFor(name)} photoUrl={session.technician?.photo_url} textStyle={styles.avatarText} />
        {queueCount > 0 ? <View style={styles.avatarBadge} /> : null}
      </Pressable>
    </View>
  );
}

function WorkScreen({ session, hint, onHintConsumed, onQueueChanged }: {
  session: AuthSession;
  hint: WorkHint;
  onHintConsumed: () => void;
  onQueueChanged: () => Promise<void>;
}) {
  const technicianId = session.technician?.id;
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<ActiveJobSnapshot | null>(null);
  const [offers, setOffers] = useState<TechnicianOffer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CommandSheet>(null);

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
    } catch (cause) {
      setError(errorMessage(cause));
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
      if (!result.ok) throw new Error("Allow precise location access to receive offers.");
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
      if (!result.ok) throw new Error("Enable notifications on a physical device to receive offers.");
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
        if (!located.ok) throw new Error("Location must be shared before route start.");
      }
      await api.updateJobStatus(job.id, target, snapshot?.version);
      await load(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem.code === "version_conflict") {
        setError("This job changed. Refreshed the latest server state.");
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
        {hint ? <AlertBanner text={`Opened ${hint.kind}${hint.id ? ` ${hint.id.slice(0, 8)}` : ""} from ${hint.source}. Refreshing server state.`} tone="warn" /> : null}
        {error ? <AlertBanner text={error} tone="bad" /> : null}
        {job ? (
          <ActiveJobCard allowedActions={snapshot?.allowed_actions ?? []} busy={busy} job={job} onAdvance={advanceJob} onSheet={setSheet} version={snapshot?.version ?? null} />
        ) : (
          <>
            <ReadinessBar busy={busy} onLocation={repairLocation} onPush={repairPush} onSetAvailable={setAvailability} readiness={readiness} />
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
  return (
    <View style={styles.readyWrap}>
      <View style={styles.readyCircle}>
        <Ionicons color={colors.success} name="checkmark" size={30} />
      </View>
      <Text style={styles.readyTitle}>Ready for offers</Text>
      <Text style={styles.readyCaption}>server feed connected</Text>
      <Text style={styles.readyBody}>You are online. New offers will appear here. You can leave this screen open while working nearby.</Text>
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
  const [showReasons, setShowReasons] = useState(false);
  return (
    <View style={styles.offerWrap}>
      {moreCount > 0 ? <Text style={styles.queueChip}>{moreCount} more offer{moreCount === 1 ? "" : "s"} waiting</Text> : null}
      <Countdown expiresAt={offer.expires_at} offeredAt={offer.offered_at} />
      <View style={styles.divider} />
      <Text style={sharedStyles.kicker}>{offer.organization_name ? `Offer from ${offer.organization_name}` : "Incoming offer"}</Text>
      <Text style={styles.offerTitle}>{offer.service_type || offer.situation || "Service request"}</Text>
      <View style={styles.offerMetaRow}>
        <Ionicons color={colors.primary} name="location-outline" size={15} />
        <Text style={styles.offerMeta}>{offer.area || "Nearby service area"}</Text>
      </View>
      <Text style={styles.faintText}>Exact address and customer details unlock after acceptance.</Text>
      <View style={styles.metricGrid}>
        <Metric label="Travel" value={offer.distance_mi != null ? `≈ ${offer.distance_mi} mi` : offer.dist_km != null ? `≈ ${offer.dist_km.toFixed(1)} km` : "Not provided"} />
        <Metric label="Coarse drive" value={offer.eta_min != null ? `≈ ${offer.eta_min} min` : "Not provided"} />
      </View>
      <View style={styles.amountRow}>
        <Text style={styles.faintText}>Your amount</Text>
        <Text style={styles.amountText}>{offer.estimated_earnings || "Pending"}</Text>
      </View>
      <FieldButton icon={<Ionicons color={colors.primaryText} name="checkmark" size={20} />} label="Accept" loading={busy} onPress={onAccept} />
      <FieldButton
        icon={<Ionicons color={colors.foreground} name="close" size={20} />}
        label="Decline"
        loading={busy}
        onPress={() => setShowReasons((value) => !value)}
        tone="secondary"
      />
      {showReasons ? (
        <View style={styles.reasonPanel}>
          <Text style={styles.reasonKicker}>Why are you declining?</Text>
          <View style={styles.reasonRow}>
            {DECLINE_REASONS.map((reason) => (
              <Pressable disabled={busy} key={reason} onPress={() => onDecline(reason)} style={styles.reasonChip}>
                <Text style={styles.reasonChipText}>{reason}</Text>
              </Pressable>
            ))}
            <Pressable disabled={busy} onPress={() => onDecline()} style={styles.reasonChip}>
              <Text style={[styles.reasonChipText, styles.reasonChipMuted]}>Skip</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ActiveJobCard({ job, version, allowedActions, busy, onAdvance, onSheet }: {
  job: ActiveJob;
  version: string | null;
  allowedActions: string[];
  busy: boolean;
  onAdvance: (target: string) => void;
  onSheet: (sheet: CommandSheet) => void;
}) {
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
  const customerName = stringValue(detail.customer_name) || stringValue(detail.customerName);
  const customerPhone = stringValue(detail.customer_phone) || stringValue(detail.customerPhone);
  const vehicle = [stringValue(automotive.year), stringValue(automotive.color), stringValue(automotive.make), stringValue(automotive.model)].filter(Boolean).join(" ") || null;
  const notes = stringValue(detail.additional_details) || stringValue(detail.notes) || stringValue(detail.description);
  const hasDetails = Boolean(customerName || customerPhone || vehicle || notes);

  return (
    <View style={styles.activeWrap}>
      <View style={styles.mapFallback}>
        <View style={styles.mapBadge}>
          <Ionicons color={colors.success} name="locate" size={13} />
          <Text style={styles.mapBadgeText}>GPS live</Text>
        </View>
        <View style={styles.mapGrid}>
          <MaterialCommunityIcons color={colors.primary} name="map-marker-radius-outline" size={34} />
          <Text style={styles.mapText}>{job.address || "Service address unavailable"}</Text>
        </View>
        <Text style={styles.mapTruth}>GPS is honest. No simulated movement is shown.</Text>
      </View>

      <View>
        <View style={styles.stageHeaderRow}>
          <Text style={sharedStyles.kicker}>Stage {stageIndex + 1} of 5</Text>
          <View style={styles.stageBars}>
            {activeStages.map((item, index) => (
              <View key={item.status} style={[styles.stageBar, index <= stageIndex ? styles.stageBarOn : null]} />
            ))}
          </View>
        </View>
        <Text style={styles.stageHeading}>{stage.heading}</Text>
        <Text style={styles.stageDetail}>{stageDetail(job.status)}</Text>
      </View>

      {pendingCustomer ? (
        <View style={styles.pendingCard}>
          <View style={styles.pendingCircle}>
            <Text style={styles.pendingEllipsis}>…</Text>
          </View>
          <Text style={styles.pendingKicker}>Job {job.id.slice(0, 8)}</Text>
          <Text style={styles.pendingText}>The customer must confirm the receipt. You cannot complete this job yourself, and you remain busy until it is resolved.</Text>
          <View style={styles.pendingStatusRow}>
            <Text style={styles.pendingStatusLabel}>Your status</Text>
            <Text style={styles.pendingStatusValue}>Busy · no new offers</Text>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.addressCard}>
            <View style={styles.addressIcon}>
              <Ionicons color={colors.primary} name="location-outline" size={18} />
            </View>
            <View style={styles.addressBody}>
              <Text style={styles.addressLabel}>Authorized service address</Text>
              <Text style={styles.addressValue}>{job.address || "Address will appear when authorized by the server."}</Text>
              <Text style={styles.addressSub}>{serviceLabel(job)}{job.access_type ? ` · ${job.access_type}` : ""}</Text>
            </View>
          </View>
          {job.eta_min != null || job.distance_mi != null ? (
            <View style={styles.chipRow}>
              {job.eta_min != null ? <MetaChip label="ETA" value={`${job.eta_min}${job.eta_max && job.eta_max !== job.eta_min ? `-${job.eta_max}` : ""} min`} /> : null}
              {job.distance_mi != null ? <MetaChip label="Distance" value={`${job.distance_mi} mi`} /> : null}
            </View>
          ) : null}
          {hasDetails ? (
            <View style={styles.detailsCard}>
              <Text style={sharedStyles.kicker}>Customer & job details</Text>
              {customerName ? <DetailRow label="Customer" value={customerName} /> : null}
              {customerPhone ? <DetailRow label="Phone" onPress={() => void Linking.openURL(`tel:${customerPhone.replace(/[^\d+]/g, "")}`)} value={customerPhone} /> : null}
              {vehicle ? <DetailRow label="Vehicle" value={vehicle} /> : null}
              {notes ? <DetailRow label="Job notes" value={notes} /> : null}
            </View>
          ) : null}
          {mapsUrl ? <FieldButton icon={<Ionicons color={colors.foreground} name="navigate" size={19} />} label="Open in maps" onPress={() => void Linking.openURL(mapsUrl)} tone="secondary" /> : null}
        </>
      )}

      {version ? <Text style={styles.truthText}>server-verified version {version}</Text> : null}
      {!pendingCustomer ? <FieldButton disabled={!next} label={actionLabel} loading={busy} onPress={() => (next ? onAdvance(next) : undefined)} /> : null}

      <View style={styles.rail}>
        <RailAction icon="chatbubble-outline" label="Message" onPress={() => onSheet("messages")} />
        <RailAction icon="call-outline" label="Call" onPress={() => onSheet("call")} />
        <RailAction danger icon="shield-outline" label="Safety" onPress={() => onSheet("safety")} />
        <RailAction icon="ellipsis-horizontal" label="More" onPress={() => onSheet("more")} />
      </View>
    </View>
  );
}

function CommandModal({ job, snapshotVersion, sheet, onClose, onSubmitted }: {
  job: ActiveJob | null;
  snapshotVersion: string | null;
  sheet: CommandSheet;
  onClose: () => void;
  onSubmitted: (keepOpen: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [issueKind, setIssueKind] = useState<string | null>(null);
  const [issueReason, setIssueReason] = useState("");
  const [issueDone, setIssueDone] = useState(false);
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pinInputRef = useRef<TextInput>(null);

  useEffect(() => {
    setIssueDone(false);
    setIssueKind(null);
    setIssueReason("");
    setError(null);
  }, [sheet]);

  async function run(kind: "arrival" | "issue" | "collection", overrideIssueKind?: string) {
    if (!job) return;
    setBusy(true);
    setError(null);
    const mutationId = clientMutationId(kind);
    const resolvedIssueKind = overrideIssueKind ?? issueKind ?? "cannot_complete";
    const payload = { pin, kind: resolvedIssueKind, reason: issueReason.trim(), amount: Number.parseFloat(amount || "0"), method };
    try {
      if (kind === "arrival") {
        await api.verifyArrival(job.id, { pin, expected_version: snapshotVersion, client_mutation_id: mutationId });
      } else if (kind === "issue") {
        await api.reportIssue(job.id, { kind: resolvedIssueKind, reason: issueReason.trim(), expected_version: snapshotVersion, client_mutation_id: mutationId });
      } else {
        await api.reportCollection(job.id, { amount: payload.amount, method, expected_version: snapshotVersion, client_mutation_id: mutationId });
        await api.updateJobStatus(job.id, "completed_pending_customer", snapshotVersion);
      }
      if (kind === "issue") {
        setIssueDone(true);
        await onSubmitted(true);
      } else {
        await onSubmitted(false);
        setPin("");
        setIssueReason("");
        setAmount("");
      }
    } catch (cause) {
      if ((cause instanceof ApiError && cause.problem.status === 0) || cause instanceof TypeError) {
        await queueLocalMutation(job.id, outboxKind(kind), snapshotVersion, mutationId, payload);
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
            <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <Ionicons color={colors.foreground} name="close" size={22} />
            </Pressable>

            {sheet === "arrival" ? (
              <View>
                <Text style={sharedStyles.kicker}>Stage 2 of 5</Text>
                <Text style={sharedStyles.title}>Verify arrival</Text>
                <Text style={sharedStyles.body}>Ask the customer for the six-digit PIN from their ClueXP tracking page.</Text>
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
                <Text style={styles.pinHint}>The button enables after six digits.</Text>
                {error ? <AlertBanner text={error} tone="bad" /> : null}
                <FieldButton disabled={pin.length !== 6} label="Confirm arrival" loading={busy} onPress={() => void run("arrival")} />
              </View>
            ) : null}

            {sheet === "safety" ? (
              <View>
                <Text style={styles.dangerTitle}>Safety</Text>
                <Text style={sharedStyles.body}>For unsafe conditions at or near this job. An alert is recorded against this job and sent to dispatch.</Text>
                <FieldButton
                  disabled={issueDone}
                  icon={<Ionicons color="#250606" name="warning-outline" size={20} />}
                  label={busy ? "Sending alert…" : issueDone ? "Alert sent" : "I feel unsafe — alert dispatch"}
                  loading={busy}
                  onPress={() => void run("issue", "unsafe")}
                  tone="danger"
                />
                <Pressable onPress={() => void Linking.openURL("tel:911")} style={styles.call911}>
                  <Text style={styles.call911Text}>Call 911</Text>
                </Pressable>
                <View style={styles.dangerNote}>
                  <Text style={styles.dangerNoteText}>If there is immediate danger, call 911 first. Reporting here is not a replacement for emergency services.</Text>
                </View>
              </View>
            ) : null}

            {sheet === "more" ? (
              <View>
                <Text style={sharedStyles.kicker}>More → Report problem</Text>
                <Text style={sharedStyles.title}>Report a problem</Text>
                <Text style={sharedStyles.body}>Non-emergency blockers for job {job ? job.id.slice(0, 8) : ""}. Dispatch decides what happens next.</Text>
                <View style={styles.issueList}>
                  {MORE_ISSUE_KINDS.map(([value, label]) => (
                    <Pressable key={value} onPress={() => setIssueKind(value)} style={[styles.issueRow, issueKind === value ? styles.issueRowActive : null]}>
                      <Text style={styles.issueRowText}>{label}</Text>
                      {issueKind === value ? <View style={styles.issueDot} /> : null}
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  multiline
                  onChangeText={setIssueReason}
                  placeholder="What is blocking you?"
                  placeholderTextColor={colors.mutedFaint}
                  style={[styles.input, styles.textArea]}
                  value={issueReason}
                />
                <Text style={styles.noteBox}>Submitting records the issue and notifies dispatch. It does not automatically reassign or cancel this job.</Text>
                {error ? <AlertBanner text={error} tone="bad" /> : null}
                <FieldButton disabled={!issueKind || issueDone} label={busy ? "Submitting…" : issueDone ? "Problem submitted" : "Submit to dispatch"} loading={busy} onPress={() => void run("issue")} />
              </View>
            ) : null}

            {sheet === "messages" ? <UnavailableSheet text="Job-scoped messaging is not enabled on this pilot environment yet. No delivery status will be fabricated." title="Job messages" /> : null}
            {sheet === "call" ? <UnavailableSheet text="Private call routing is not enabled on this pilot environment yet. Contact dispatch through your approved operational channel." title="Call" /> : null}

            {sheet === "collection" ? (
              <View>
                <Text style={sharedStyles.kicker}>Closeout record</Text>
                <Text style={sharedStyles.title}>Record collection</Text>
                <Text style={sharedStyles.body}>This is the record, not a payment. ClueXP does not process payout here.</Text>
                <TextInput
                  inputMode="decimal"
                  keyboardType="decimal-pad"
                  onChangeText={(value) => setAmount(value.replace(/[^0-9.]/g, ""))}
                  placeholder="Amount"
                  placeholderTextColor={colors.mutedFaint}
                  style={styles.input}
                  value={amount}
                />
                <View style={styles.methodRow}>
                  {["cash", "credit_card", "check", "zelle"].map((item) => (
                    <Pressable key={item} onPress={() => setMethod(item)} style={[styles.methodChip, method === item ? styles.choiceActive : null]}>
                      <Text style={styles.choiceText}>{item.replaceAll("_", " ")}</Text>
                    </Pressable>
                  ))}
                </View>
                {error ? <AlertBanner text={error} tone="bad" /> : null}
                <FieldButton disabled={!amount} label="Submit for customer confirmation" loading={busy} onPress={() => void run("collection")} />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function UnavailableSheet({ title, text }: { title: string; text: string }) {
  return (
    <View>
      <Text style={sharedStyles.title}>{title}</Text>
      <View style={styles.noticeBox}>
        <Text style={styles.noticeTitle}>Not enabled in this pilot</Text>
        <Text style={styles.noticeText}>{text}</Text>
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

function ComingSoonTab({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <View style={styles.emptyState}>
        <View style={styles.emptyIconWrap}>
          <Ionicons color={colors.primary} name={icon} size={26} />
        </View>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyText}>{text}</Text>
      </View>
    </ScrollView>
  );
}

function AccountScreen({ session, onLogout }: { session: AuthSession; onLogout: () => Promise<void> }) {
  const name = session.user?.display_name || "Technician";
  const vetting = session.technician?.vetting_status ?? "verified";
  const verified = vetting === "verified";
  return (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <View style={styles.accountHeader}>
        <View style={styles.accountHeaderBody}>
          <Text style={styles.accountName}>{name}</Text>
          <Text style={styles.accountSub}>{session.organization_name || "No provider affiliation"}</Text>
          <Text style={styles.accountId}>ID {(session.technician?.id || "—").slice(0, 8).toUpperCase()}</Text>
          <Pill icon={<Ionicons color={verified ? colors.success : colors.primary} name={verified ? "shield-checkmark-outline" : "time-outline"} size={13} />} tone={verified ? "success" : "default"}>
            {verified ? "Identity verified" : String(vetting).replaceAll("_", " ")}
          </Pill>
        </View>
        <View style={styles.accountAvatar}>
          <AvatarContent initials={initialsFor(name)} photoUrl={session.technician?.photo_url} textStyle={styles.accountAvatarText} />
        </View>
      </View>

      <Text style={styles.sectionKicker}>Trust profile</Text>
      <View style={styles.trustGrid}>
        <MiniStat label="Role" value={session.roles?.[0] ?? "technician"} />
        <MiniStat label="Status" value={String(session.technician?.status ?? "active")} />
      </View>
      <View style={styles.trustGrid}>
        <MiniStat label="Vetting" value={String(vetting)} />
        <MiniStat label="Company" value={session.organization_name || "None"} />
      </View>

      <View style={styles.panel}>
        <Text style={sharedStyles.kicker}>Native storage</Text>
        <Text style={sharedStyles.body}>Sessions and offline actions are secured with SecureStore and a SQLCipher-encrypted outbox.</Text>
      </View>

      <FieldButton icon={<Ionicons color="#250606" name="log-out-outline" size={18} />} label="Sign out" onPress={() => void onLogout()} tone="danger" />
    </ScrollView>
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
    borderRadius: radius.sm,
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
  emptyState: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: 20,
    padding: 26
  },
  emptyIconWrap: {
    alignItems: "center",
    backgroundColor: colors.cardStrong,
    borderRadius: radius.md,
    height: 52,
    justifyContent: "center",
    width: 52
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 14,
    textAlign: "center"
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    textAlign: "center"
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
