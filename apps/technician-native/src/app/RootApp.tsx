import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
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
import { FieldButton } from "../components/FieldButton";
import { StatusCell } from "../components/StatusCell";
import { registerPushDevice, requestAndSendLocation } from "../features/nativeCapabilities";
import { replayQueuedMutations } from "../features/outboxReplay";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "../storage/sessionStore";
import { enqueueMutation, initOutbox, queuedMutationCount, wipeOutbox } from "../storage/outbox";
import { colors, radius, sharedStyles } from "../theme";
import type { ActiveJob, ActiveJobSnapshot, AuthSession, QueuedMutation, ReadinessSnapshot, TechnicianOffer } from "../types";

type TabKey = "work" | "activity" | "earnings" | "account";
type CommandSheet = "arrival" | "issue" | "collection" | null;
type WorkHint = { kind: "work" | "job" | "offer"; id?: string; source: "link" | "notification" } | null;

const api = new CluexpApi(null);
const tabs: Array<{ key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "work", label: "Work", icon: "briefcase-outline" },
  { key: "activity", label: "Activity", icon: "time-outline" },
  { key: "earnings", label: "Earnings", icon: "wallet-outline" },
  { key: "account", label: "Account", icon: "person-circle-outline" }
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
  }, [hardSignOut]);

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
    const stored = await loadStoredSession();
    if (stored?.refreshToken) {
      try {
        await api.logout(stored.refreshToken);
      } catch {
        // Local logout must win even when the network is unavailable.
      }
    }
    await hardSignOut();
  }, [hardSignOut]);

  const refreshQueue = useCallback(async () => {
    setQueueCount(await queuedMutationCount());
  }, []);

  if (booting) {
    return (
      <SafeAreaView style={sharedStyles.screen}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Text style={styles.wordmark}>CLUEXP</Text>
          <Text style={styles.monoMuted}>restoring secure session</Text>
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
      <View style={styles.root}>
        <Header session={session} queueCount={queueCount} />
        {tab === "work" ? <WorkScreen session={session} hint={workHint} onHintConsumed={() => setWorkHint(null)} onQueueChanged={refreshQueue} /> : null}
        {tab === "activity" ? <StaticTab title="Activity" text="Finished-job history is part of the next native slice. This first build keeps active work and command truth front and center." /> : null}
        {tab === "earnings" ? <StaticTab title="Earnings" text="Collections are recorded in the active job flow. Settlement history comes next, and this screen will keep recorded totals separate from payout." /> : null}
        {tab === "account" ? <AccountScreen session={session} onLogout={onLogout} /> : null}
        <BottomTabs selected={tab} onSelect={setTab} />
      </View>
    </SafeAreaView>
  );
}

function LoginScreen({ onLogin }: { onLogin: (identifier: string, password: string) => Promise<void> }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.loginWrap}>
        <View>
          <Text style={styles.wordmark}>CLUEXP</Text>
          <Text style={styles.loginTitle}>Technician field command</Text>
          <Text style={styles.loginCopy}>Secure access for verified technicians. Native sessions use bearer tokens now and are ready for refresh-token rotation.</Text>
        </View>
        <View style={styles.loginPanel}>
          <Text style={sharedStyles.kicker}>Sign in</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setIdentifier}
            placeholder="Email or phone"
            placeholderTextColor={colors.mutedFaint}
            style={styles.input}
            value={identifier}
          />
          <TextInput
            autoCapitalize="none"
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.mutedFaint}
            secureTextEntry
            style={styles.input}
            value={password}
          />
          {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
          <FieldButton label="Sign in" loading={busy} disabled={!identifier.trim() || !password} onPress={submit} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ session, queueCount }: { session: AuthSession; queueCount: number }) {
  const name = session.user?.display_name || session.user?.email || "Technician";
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.wordmarkSmall}>CLUEXP</Text>
        <Text numberOfLines={1} style={styles.headerName}>{name}</Text>
      </View>
      <View style={styles.syncPill}>
        <View style={[styles.tinyDot, queueCount > 0 ? styles.dotWarn : styles.dotGood]} />
        <Text style={styles.syncText}>{queueCount > 0 ? `${queueCount} queued` : "server mode"}</Text>
      </View>
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

  async function goOnline() {
    setBusy(true);
    setError(null);
    try {
      await api.setAvailability(true);
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

  async function declineOffer(offer: TechnicianOffer) {
    const id = offerId(offer);
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.declineOffer(id, "Declined from native app");
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
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => void load()} />}
      >
        {hint ? <AlertBanner text={`Opened ${hint.kind}${hint.id ? ` ${hint.id.slice(0, 8)}` : ""} from ${hint.source}. Refreshing server state.`} tone="warn" /> : null}
        {error ? <AlertBanner text={error} tone="bad" /> : null}
        <ReadinessCard readiness={readiness} onAvailability={goOnline} onLocation={repairLocation} onPush={repairPush} busy={busy} />
        {job ? (
          <ActiveJobCard job={job} version={snapshot?.version ?? null} allowedActions={snapshot?.allowed_actions ?? []} busy={busy} onAdvance={advanceJob} onSheet={setSheet} />
        ) : activeOffer ? (
          <OfferCard offer={activeOffer} moreCount={Math.max(0, offers.length - 1)} busy={busy} onAccept={() => void acceptOffer(activeOffer)} onDecline={() => void declineOffer(activeOffer)} />
        ) : (
          <WaitingCard ready={Boolean(readiness?.can_receive_offers)} />
        )}
      </ScrollView>
      <CommandModal
        job={job}
        snapshotVersion={snapshot?.version ?? null}
        sheet={sheet}
        onClose={() => setSheet(null)}
        onComplete={async () => {
          setSheet(null);
          await load(true);
          await onQueueChanged();
        }}
      />
    </View>
  );
}

function ReadinessCard({ readiness, busy, onAvailability, onLocation, onPush }: {
  readiness: ReadinessSnapshot | null;
  busy: boolean;
  onAvailability: () => void;
  onLocation: () => void;
  onPush: () => void;
}) {
  const accountReady = Boolean(readiness?.account.approved && readiness.account.available);
  const locationReady = Boolean(readiness?.location.fresh);
  const pushReady = Boolean(readiness?.push.push_ready);
  const activeClear = readiness ? !readiness.active_job.busy : false;
  const blockers = readiness?.blocking_reasons ?? [];
  const primary =
    blockers.includes("unavailable") ? { label: "Go online", action: onAvailability } :
    blockers.includes("location_stale") ? { label: "Fix location", action: onLocation } :
    blockers.includes("push_not_ready") ? { label: "Enable alerts", action: onPush } :
    null;

  return (
    <View style={styles.panel}>
      <View style={styles.rowBetween}>
        <Text style={sharedStyles.kicker}>Readiness</Text>
        <Text style={[styles.truthText, readiness?.can_receive_offers ? styles.goodText : styles.warnText]}>
          {readiness?.can_receive_offers ? "ready for offers" : "not receiving offers"}
        </Text>
      </View>
      <View style={styles.readinessGrid}>
        <StatusCell label="Available" value={accountReady ? "online" : "blocked"} tone={accountReady ? "good" : "bad"} />
        <StatusCell label="Location" value={locationReady ? "fresh" : "repair"} tone={locationReady ? "good" : "bad"} />
        <StatusCell label="Alerts" value={pushReady ? "enabled" : "needed"} tone={pushReady ? "good" : "warn"} />
        <StatusCell label="Capacity" value={activeClear ? "clear" : "busy"} tone={activeClear ? "good" : "warn"} />
      </View>
      {blockers.length > 0 ? <Text style={styles.blockerText}>{blockers.join(" / ")}</Text> : null}
      {primary ? <FieldButton label={primary.label} loading={busy} onPress={primary.action} /> : null}
    </View>
  );
}

function OfferCard({ offer, moreCount, busy, onAccept, onDecline }: {
  offer: TechnicianOffer;
  moreCount: number;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const expires = new Date(offer.expires_at).getTime();
  const seconds = Math.max(0, Math.floor((expires - Date.now()) / 1000));
  return (
    <View style={styles.offerWrap}>
      {moreCount > 0 ? <Text style={styles.queueChip}>{moreCount} more offer{moreCount === 1 ? "" : "s"} waiting</Text> : null}
      <Text style={styles.countdown}>{seconds}s</Text>
      <Text style={styles.monoMuted}>offer expires / server timer</Text>
      <View style={styles.divider} />
      <Text style={sharedStyles.kicker}>{offer.organization_name ? `Offer from ${offer.organization_name}` : "Incoming offer"}</Text>
      <Text style={styles.offerTitle}>{offer.service_type || offer.situation || "Service request"}</Text>
      <Text style={styles.offerMeta}>{offer.area || "Nearby service area"}</Text>
      <Text style={styles.faintText}>Exact address and customer details unlock after acceptance.</Text>
      <View style={styles.metricGrid}>
        <Metric label="Travel" value={offer.distance_mi != null ? `about ${offer.distance_mi} mi` : offer.dist_km != null ? `about ${offer.dist_km.toFixed(1)} km` : "not provided"} />
        <Metric label="Coarse drive" value={offer.eta_min != null ? `about ${offer.eta_min} min` : "not provided"} />
      </View>
      <View style={styles.amountRow}>
        <Text style={styles.faintText}>Your amount</Text>
        <Text style={styles.amountText}>{offer.estimated_earnings || "Pending"}</Text>
      </View>
      <FieldButton label="Accept" loading={busy} icon={<Ionicons name="checkmark" color={colors.primaryText} size={20} />} onPress={onAccept} />
      <FieldButton label="Decline" loading={busy} tone="ghost" icon={<Ionicons name="close" color={colors.foreground} size={20} />} onPress={onDecline} />
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
  const actionLabel =
    job.status === "assigned" ? "Start route" :
    job.status === "en_route" ? "Confirm arrival" :
    job.status === "arrived" ? "Start service" :
    job.status === "in_progress" ? "Review and finish" :
    "Waiting for customer";
  const mapsUrl = job.lat != null && job.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`
    : job.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}` : null;

  return (
    <View style={styles.activeWrap}>
      <View style={styles.mapFallback}>
        <View style={styles.mapGrid}>
          <MaterialCommunityIcons name="map-marker-radius-outline" color={colors.primary} size={34} />
          <Text style={styles.mapText}>{job.address || "Service address unavailable"}</Text>
        </View>
        <Text style={styles.mapTruth}>GPS is honest. No simulated movement is shown.</Text>
      </View>
      <StageHeader status={job.status} />
      {job.status === "completed_pending_customer" ? (
        <AlertBanner
          text="Work submitted. Awaiting customer confirmation. You remain assigned here, and dispatch can help with support or dispute questions."
          tone="warn"
        />
      ) : null}
      <Text style={styles.jobTitle}>{serviceLabel(job)}</Text>
      <Text style={styles.jobAddress}>{job.address || "Address will appear when authorized by the server."}</Text>
      <View style={styles.metricGrid}>
        <Metric label="Distance" value={job.distance_mi != null ? `${job.distance_mi} mi` : "server pending"} />
        <Metric label="ETA" value={job.eta_min != null ? `${job.eta_min}${job.eta_max && job.eta_max !== job.eta_min ? `-${job.eta_max}` : ""} min` : "server pending"} />
      </View>
      {version ? <Text style={styles.truthText}>server-verified version {version}</Text> : null}
      {mapsUrl ? <FieldButton label="Open in maps" tone="secondary" icon={<Ionicons name="navigate" color={colors.foreground} size={19} />} onPress={() => void Linking.openURL(mapsUrl)} /> : null}
      <FieldButton label={actionLabel} disabled={!next || job.status === "completed_pending_customer"} loading={busy} onPress={() => next ? onAdvance(next) : undefined} />
      <View style={styles.rail}>
        <RailAction label="Message" icon="chatbubble-outline" onPress={() => Alert.alert("Not enabled", "Job-scoped messaging is not enabled on this backend yet.")} />
        <RailAction label="Call" icon="call-outline" onPress={() => Alert.alert("Not enabled", "Masked calling is not enabled on this backend yet.")} />
        <RailAction label="Safety" danger icon="shield-outline" onPress={() => onSheet("issue")} />
        <RailAction label="More" icon="ellipsis-horizontal" onPress={() => onSheet("issue")} />
      </View>
    </View>
  );
}

function CommandModal({ job, snapshotVersion, sheet, onClose, onComplete }: {
  job: ActiveJob | null;
  snapshotVersion: string | null;
  sheet: CommandSheet;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [issueKind, setIssueKind] = useState("cannot_complete");
  const [issueReason, setIssueReason] = useState("");
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "arrival" | "issue" | "collection") {
    if (!job) return;
    setBusy(true);
    setError(null);
    const mutationId = clientMutationId(kind);
    try {
      if (kind === "arrival") {
        await api.verifyArrival(job.id, { pin, expected_version: snapshotVersion, client_mutation_id: mutationId });
      } else if (kind === "issue") {
        await api.reportIssue(job.id, { kind: issueKind, reason: issueReason.trim(), expected_version: snapshotVersion, client_mutation_id: mutationId });
      } else {
        await api.reportCollection(job.id, {
          amount: Number.parseFloat(amount || "0"),
          method,
          expected_version: snapshotVersion,
          client_mutation_id: mutationId
        });
        await api.updateJobStatus(job.id, "completed_pending_customer", snapshotVersion);
      }
      await onComplete();
      setPin("");
      setIssueReason("");
      setAmount("");
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem.status === 0) {
        await queueLocalMutation(job.id, outboxKind(kind), snapshotVersion, mutationId, {
          pin,
          kind: issueKind,
          reason: issueReason.trim(),
          amount: Number.parseFloat(amount || "0"),
          method
        });
        await onComplete();
      } else if (cause instanceof TypeError) {
        await queueLocalMutation(job.id, outboxKind(kind), snapshotVersion, mutationId, {
          pin,
          kind: issueKind,
          reason: issueReason.trim(),
          amount: Number.parseFloat(amount || "0"),
          method
        });
        await onComplete();
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal animationType="slide" transparent={false} visible={sheet !== null} onRequestClose={onClose}>
      <SafeAreaView style={sharedStyles.screen}>
        <ScrollView contentContainerStyle={styles.modalBody}>
          <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" color={colors.foreground} size={22} />
          </Pressable>
          {sheet === "arrival" ? (
            <View>
              <Text style={sharedStyles.kicker}>Stage 2 of 5</Text>
              <Text style={sharedStyles.title}>Verify arrival</Text>
              <Text style={sharedStyles.body}>Ask the customer for the six-digit PIN from their ClueXP tracking page.</Text>
              <TextInput
                inputMode="numeric"
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={colors.mutedFaint}
                style={styles.pinInput}
                value={pin}
              />
              <FieldButton label="Confirm arrival" loading={busy} disabled={pin.length !== 6} onPress={() => void run("arrival")} />
            </View>
          ) : null}
          {sheet === "issue" ? (
            <View>
              <Text style={sharedStyles.kicker}>More / Safety</Text>
              <Text style={sharedStyles.title}>Report problem</Text>
              <Text style={sharedStyles.body}>Dispatch decides what happens next. Unsafe reports are recorded against this job.</Text>
              {["cannot_complete", "customer_unavailable", "unsafe"].map((kind) => (
                <Pressable key={kind} onPress={() => setIssueKind(kind)} style={[styles.choice, issueKind === kind ? styles.choiceActive : null]}>
                  <Text style={styles.choiceText}>{kind.replaceAll("_", " ")}</Text>
                </Pressable>
              ))}
              <TextInput
                multiline
                onChangeText={setIssueReason}
                placeholder="Useful detail for dispatch"
                placeholderTextColor={colors.mutedFaint}
                style={[styles.input, styles.textArea]}
                value={issueReason}
              />
              <FieldButton label="Submit to dispatch" loading={busy} onPress={() => void run("issue")} />
            </View>
          ) : null}
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
              <FieldButton label="Submit for customer confirmation" loading={busy} disabled={!amount} onPress={() => void run("collection")} />
            </View>
          ) : null}
          {error ? <AlertBanner text={error} tone="bad" /> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
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

function StageHeader({ status }: { status: string }) {
  const labels = ["assigned", "en_route", "arrived", "in_progress", "completed_pending_customer"];
  const index = Math.max(0, labels.indexOf(status));
  return (
    <View style={styles.stageWrap}>
      <Text style={sharedStyles.kicker}>Stage {Math.min(index + 1, 5)} of 5</Text>
      <View style={styles.stageBars}>
        {labels.map((label, itemIndex) => (
          <View key={label} style={[styles.stageBar, itemIndex <= index ? styles.stageBarOn : null]} />
        ))}
      </View>
      <Text style={styles.stageTitle}>{status.replaceAll("_", " ")}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function RailAction({ label, icon, danger = false, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.railAction, danger ? styles.railDanger : null]}>
      <Ionicons name={icon} color={danger ? colors.danger : colors.foreground} size={18} />
      <Text style={[styles.railText, danger ? styles.dangerText : null]}>{label}</Text>
    </Pressable>
  );
}

function WaitingCard({ ready }: { ready: boolean }) {
  return (
    <View style={styles.waiting}>
      <Ionicons name={ready ? "checkmark-circle-outline" : "alert-circle-outline"} color={ready ? colors.success : colors.primary} size={64} />
      <Text style={styles.waitTitle}>{ready ? "Ready for offers" : "Repair readiness"}</Text>
      <Text style={sharedStyles.body}>{ready ? "You can lock your phone. Offer delivery still falls back to polling until APNs and FCM credentials are provisioned." : "Fix the named readiness blocker above. The app will never show ready while the server disagrees."}</Text>
    </View>
  );
}

function AlertBanner({ text, tone }: { text: string; tone: "bad" | "warn" }) {
  return (
    <View style={[styles.alert, tone === "bad" ? styles.alertBad : styles.alertWarn]}>
      <Ionicons name="alert-circle-outline" color={tone === "bad" ? colors.danger : colors.primary} size={20} />
      <Text style={styles.alertText}>{text}</Text>
    </View>
  );
}

function BottomTabs({ selected, onSelect }: { selected: TabKey; onSelect: (tab: TabKey) => void }) {
  return (
    <View style={styles.bottomTabs}>
      {tabs.map((item) => (
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: selected === item.key }} key={item.key} onPress={() => onSelect(item.key)} style={styles.tabButton}>
          <Ionicons name={item.icon} color={selected === item.key ? colors.primary : colors.muted} size={22} />
          <Text style={[styles.tabText, selected === item.key ? styles.tabTextActive : null]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function StaticTab({ title, text }: { title: string; text: string }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <View style={styles.panel}>
        <Text style={sharedStyles.kicker}>{title}</Text>
        <Text style={sharedStyles.title}>{title}</Text>
        <Text style={sharedStyles.body}>{text}</Text>
      </View>
    </ScrollView>
  );
}

function AccountScreen({ session, onLogout }: { session: AuthSession; onLogout: () => Promise<void> }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <View style={styles.panel}>
        <Text style={sharedStyles.kicker}>Account</Text>
        <Text style={styles.jobTitle}>{session.user?.display_name || "Technician"}</Text>
        <Text style={sharedStyles.body}>{session.user?.email || session.user?.phone || "No contact on session"}</Text>
        <View style={styles.divider} />
        <Metric label="Technician ID" value={session.technician?.id || "not available"} />
        <Metric label="Approval" value={session.technician?.approved ? "approved" : "pending"} />
        <Metric label="Native storage" value="SecureStore + SQLCipher outbox" />
        <FieldButton label="Sign out" tone="danger" onPress={() => void onLogout()} />
      </View>
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
    justifyContent: "center"
  },
  loginWrap: {
    flex: 1,
    justifyContent: "space-between",
    padding: 22
  },
  wordmark: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 3
  },
  wordmarkSmall: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 2
  },
  loginTitle: {
    color: colors.foreground,
    fontSize: 42,
    fontWeight: "900",
    lineHeight: 45,
    marginTop: 28,
    textTransform: "uppercase"
  },
  loginCopy: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 12
  },
  loginPanel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 12,
    padding: 16
  },
  input: {
    backgroundColor: colors.cardRaised,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.foreground,
    fontSize: 17,
    minHeight: 54,
    paddingHorizontal: 14
  },
  textArea: {
    minHeight: 110,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  pinInput: {
    backgroundColor: colors.cardRaised,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    borderWidth: 2,
    color: colors.foreground,
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 9,
    marginVertical: 24,
    minHeight: 70,
    paddingHorizontal: 18,
    textAlign: "center"
  },
  errorText: {
    color: colors.dangerSoft,
    fontSize: 14,
    lineHeight: 20
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  headerName: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 3,
    maxWidth: 230
  },
  syncPill: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  tinyDot: {
    borderRadius: 4,
    height: 8,
    width: 8
  },
  dotGood: {
    backgroundColor: colors.success
  },
  dotWarn: {
    backgroundColor: colors.primary
  },
  syncText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700"
  },
  content: {
    flex: 1
  },
  scrollBody: {
    gap: 14,
    padding: 16,
    paddingBottom: 98
  },
  panel: {
    ...sharedStyles.panel,
    gap: 14,
    padding: 14
  },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  truthText: {
    color: colors.successSoft,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  goodText: {
    color: colors.success
  },
  warnText: {
    color: colors.primary
  },
  blockerText: {
    backgroundColor: colors.cautionBg,
    borderColor: colors.cautionBorder,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.primary,
    fontSize: 13,
    padding: 10
  },
  readinessGrid: {
    flexDirection: "row",
    gap: 7
  },
  offerWrap: {
    gap: 13,
    paddingTop: 8
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
  countdown: {
    color: colors.primary,
    fontSize: 80,
    fontWeight: "900",
    lineHeight: 86,
    textAlign: "center"
  },
  monoMuted: {
    color: colors.mutedFaint,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    textTransform: "uppercase"
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 4
  },
  offerTitle: {
    color: colors.foreground,
    fontSize: 30,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  offerMeta: {
    color: colors.foreground,
    fontSize: 16,
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
    fontSize: 28,
    fontWeight: "900"
  },
  activeWrap: {
    gap: 14
  },
  mapFallback: {
    backgroundColor: "#131417",
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 230,
    overflow: "hidden",
    padding: 16
  },
  mapGrid: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  mapText: {
    color: colors.foreground,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 10,
    textAlign: "center"
  },
  mapTruth: {
    color: colors.mutedFaint,
    fontFamily: "monospace",
    fontSize: 11,
    textAlign: "center",
    textTransform: "uppercase"
  },
  stageWrap: {
    gap: 7
  },
  stageBars: {
    flexDirection: "row",
    gap: 6
  },
  stageBar: {
    backgroundColor: colors.border,
    borderRadius: 4,
    flex: 1,
    height: 5
  },
  stageBarOn: {
    backgroundColor: colors.primary
  },
  stageTitle: {
    color: colors.foreground,
    fontSize: 34,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  jobTitle: {
    color: colors.foreground,
    fontSize: 26,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  jobAddress: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22
  },
  rail: {
    flexDirection: "row",
    gap: 8
  },
  railAction: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    gap: 5,
    minHeight: 58,
    justifyContent: "center"
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
  waiting: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 10,
    padding: 26
  },
  waitTitle: {
    color: colors.foreground,
    fontSize: 31,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase"
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
  bottomTabs: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: "row",
    left: 0,
    paddingBottom: Platform.OS === "ios" ? 16 : 8,
    paddingTop: 8,
    position: "absolute",
    right: 0
  },
  tabButton: {
    alignItems: "center",
    flex: 1,
    gap: 4,
    minHeight: 54,
    justifyContent: "center"
  },
  tabText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  tabTextActive: {
    color: colors.primary
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
  choice: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: 10,
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  choiceActive: {
    backgroundColor: "#2A240D",
    borderColor: colors.primary
  },
  choiceText: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "800",
    textTransform: "uppercase"
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
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 12
  }
});
