# ADR-0001 — Technician native app stack

- **Status:** Proposed — awaiting owner/date sign-off on the open decisions in §7.
- **Date:** 2026-07-30
- **Scope:** The native technician client that TAR-7 (`docs/TECHNICIAN-APP-REDESIGN.md` §17) requires.
  This ADR decides the client technology only. It does not authorise the build; it unblocks it.
- **Relates to:** `TECHNICIAN-APP-REDESIGN.md` §12.3, §13, §20 (decision #1); `EXECUTION-PLAN.md`
  §5 (notifications gate) and the P0 global-capacity item.

## 1. Context

The technician experience ships today as a Next.js PWA (`apps/technician-web`). The PWA is the
right onboarding and fallback surface, but it cannot meet two field requirements the pilot has
already shown to be load-bearing:

1. **Background push with delivery acknowledgement** — the current active-job cancel/alert path
   relies on foreground polling (up to 15s), explicitly accepted as interim risk for TAR-3..TAR-6
   and called out as a blocker for unattended or broader rollout.
2. **Reliable background location** — web geolocation is foreground-limited and cannot honestly
   support en-route tracking once the app is backgrounded or the device sleeps.

The redesign doc already names React Native/Expo as the default candidate "because the team
already uses TypeScript/React" but requires an ADR to confirm it against the background
capabilities, and rules out "a thin webview wrapper … unless the ADR proves the required
background capabilities." This ADR is that confirmation.

## 2. Decision

**Adopt React Native with Expo (dev client / prebuild, not managed-only) for the native
technician app.** Reject the webview-wrapper option outright; keep the PWA as the accessible
fallback and onboarding surface.

The app lives as a new workspace (proposed `apps/technician-native`, name pending the
architecture review §12.1 asks for) and consumes the same shared contracts as the PWA — business
logic stays in `@cluexp/api-client` / `@cluexp/app-core`, never in the native UI. The PWA and
native client MUST produce identical lifecycle outcomes and terminology (contract-parity tests,
TAR-7).

## 3. Options considered

**No option escapes the mobile OS execution model.** Background push and background
location are governed by iOS and Android, not by the client framework: iOS suspends
backgrounded apps and only wakes them for specific push types/entitlements; Android
imposes Doze, App Standby, and aggressive OEM battery managers. "Background push" and
"background GPS" below therefore mean *"exposes the OS mechanism cleanly and reliably,"*
not *"runs freely in the background"* — no option grants the latter. The comparison is
which framework gives honest, first-class access to those OS-constrained mechanisms.

| Option | Background push (OS-gated) | Background GPS (OS-gated) | Code reuse w/ web | Verdict |
|---|---|---|---|---|
| **React Native + Expo** | Clean access to APNs/FCM via config plugins / expo-notifications; custom native modules through prebuild | expo-location + expo-task-manager background tasks; honors OS limits | High — TS/React, shared `@cluexp/*` domain packages, same api-client | **Chosen** |
| Flutter | Clean (firebase_messaging), same OS ceiling | Clean (geolocator/background), same OS ceiling | Low — Dart rewrite of domain/UI; no reuse of shared packages | Rejected — abandons existing TS investment |
| Native Swift + Kotlin (two apps) | Direct, same OS ceiling | Direct, same OS ceiling | None — two codebases, doubled parity surface | Rejected — cost/parity risk unjustified for pilot scale |
| Webview wrapper (Capacitor over the PWA) | Plugin-dependent, brittle for critical alerts | Plugin-dependent, unreliable backgrounded | Highest | Rejected by policy — does not prove required background reliability |

**A WebView wrapper does not remove the need for native ownership.** Wrapping the PWA
still requires the same signed native shell, APNs/FCM entitlements, background-location
permissions and usage strings, app-store accounts, and a minimum-version/forced-update
story as a real native app — it only *adds* an unreliable JS↔native bridge on the
critical alert path. It buys web code reuse we already have via the PWA while keeping
every native cost, so it is rejected regardless of the stack decision above.

## 4. Why Expo specifically

- **Prebuild / dev client**, not managed-only: lets us add custom native modules (background
  location task, notification service extension, encrypted storage) when a config plugin isn't
  enough — this is what makes the "not a webview wrapper" bar achievable without ejecting to bare.
- **EAS Build / Submit** gives an owned, reproducible CI release pipeline (TAR-7 asks for a
  scaffolded release pipeline).
- **OTA updates** for JS-layer fixes, subject to the forced-update / minimum-version policy in
  §19 — native-contract or security breaks still require a store build, OTA is not a bypass.
- Mature first-party modules cover **much of** the §12.3 checklist: `expo-notifications`
  (APNs/FCM), `expo-location` + `expo-task-manager` (background GPS), `expo-secure-store`
  (token/credential storage), a **SQLCipher-enabled `expo-sqlite` build** (encrypted offline
  DB — see below), `expo-image-picker`/camera (evidence), `expo-haptics`, deep links.
  **Not covered by that core set** and still owed (via ecosystem modules or open decisions,
  not this list): native maps/navigation handoff (§20.5), crash reporting, app-update /
  minimum-version enforcement, runtime permission-change monitoring, and device-integrity
  signals. These do not change the stack choice but must not be assumed solved by the modules above.

**Encrypted storage — use the built-in path first.** `expo-sqlite` supports SQLCipher
encryption at rest through its own configuration; adopt that native build first rather
than writing a custom module. Reserve custom native code for concrete requirements the
built-in path cannot meet — specifically key-lifecycle needs (rotation, per-user keying,
biometric-gated key release, wipe-on-revocation) or a schema/data **migration** the
default cannot perform. Do not build a bespoke encrypted store on speculation.

## 5. Consequences

**Positive**
- Reuses the TS/React skillset and the shared domain packages; one team, one language.
- Background push + GPS become achievable to the standard TAR-7 requires.
- PWA remains the fallback; no product fork if contracts stay shared.

**Negative / costs**
- Requires **encrypted local storage** — the plain `expo-sqlite` default is not encrypted;
  §13.5/§14 require encryption for sensitive local data. Met by the SQLCipher-enabled
  `expo-sqlite` build, with custom native code only if key-lifecycle or migration needs exceed it.
- iOS **notification service extension** and background-location entitlements need Apple review
  justification; both carry App Store rejection risk if the usage string is weak.
- OTA updates must be governed so they can never ship a client that violates the API version
  contract (structured-error/readiness fields) — enforce minimum-version gating server-side.
- Adds an app-store release/ownership burden the team does not have today (signing, provisioning,
  store accounts) — see open decision §7.

## 6. Prerequisites this ADR does NOT resolve (must land before/with the build)

**Delivery semantics the notification contract must model — four distinct events, not one.**
"Delivered" is not a single fact. The backend and client must track, and must not conflate:

1. **Provider receipt** — APNs/FCM accepted the message for delivery attempt.
2. **Device receipt** — the OS actually received it on a specific device.
3. **User display** — it surfaced to the technician (banner/sound/lock screen).
4. **Explicit acknowledgement** — the technician acted on it in-app.

Only (4) counts as acknowledged delivery for SLA/escalation. **Silent (data-only) push
must not be treated as a guaranteed wake mechanism** — the OS may throttle, delay,
coalesce, or drop it (iOS background budget; Android Doze/OEM battery managers). Critical
alerts therefore require a user-visible push plus an in-app acknowledgement and a
dispatcher-side escalation path when (4) does not arrive — never a silent-push assumption.

The stack choice is inert until the backend exposes contracts the BFF does not today. These are
tracked in `TECHNICIAN-APP-REDESIGN.md` §13 and must precede the native feature work:

- Device push-token registration/rotation endpoints (**notifications are `[ ]` — nothing built**).
- Canonical readiness response and a versioned active-job snapshot with **structured conflict/error
  codes** (the BFF currently returns copy-only `detail` strings the native client must not parse).
- DB-enforced global single-active-job capacity lock (P0).
- Offline-sync mutation contract (client mutation ID, expected version, retry/backoff, conflict).

## 7. Acceptance blockers (owner + due date + evidence required)

Covers the **native-runtime subset of `TECHNICIAN-APP-REDESIGN.md` §20** (items 2–5 and 9)
that gates the stack decision, **plus app-store ownership** (from §12.3, not in §20). This
ADR closes §20 #1 (the stack itself). The remaining §20 items — **6** messaging/attachment
retention, **7** mediated-voice provider/recording policy, **8** evidence classification, **10**
scheduled next-job capacity model, **11** high-contrast outdoor theme, **12** post-pilot product
target baselines — are **not stack blockers**; they gate their own feature workstreams and stay
tracked in §20. Do not read this table as a complete §20 sign-off.

**This ADR cannot move from Proposed to Accepted until every row below has a named
accountable owner, a calendar due date, and the concrete evidence recorded** — an empty
cell is an open blocker, not a formality. Owners are individuals, not teams.

| # | Blocker | Owner | Due (date) | Evidence required to close |
|---|---|---|---|---|
| 1 | Native stack = React Native + Expo | _TBD_ | _TBD_ | This ADR signed off; spike (§8) passes on iOS + Android |
| 2 | Supported OS/device matrix + minimum versions | _TBD_ | _TBD_ | Written matrix + forced-update floor committed to repo |
| 3 | Push provider ownership + acknowledgement SLA | _TBD_ | _TBD_ | Named provider, on-call owner, numeric ack target + escalation rule |
| 4 | Background-location frequency/precision/retention/consent/battery | _TBD_ | _TBD_ | Written policy + consent copy + retention/deletion job |
| 5 | Mapping/navigation provider + cost/offline policy | _TBD_ | _TBD_ | Provider chosen, cost estimate, offline fallback documented |
| 6 | Offline storage encryption / key lifecycle + max retained history | _TBD_ | _TBD_ | Key rotation/wipe design + retention cap; SQLCipher build verified encrypted |
| 7 | App-store account ownership, signing/provisioning, release approver | _TBD_ | _TBD_ | Accounts provisioned; named signer + release approver |

## 8. Verification — spike acceptance criteria

The spike must run on a **real signed release build** (TestFlight / internal-track AAB),
not a dev/debug build or simulator, on both iOS and Android, and produce **observable,
recorded measurements** (timestamps, delivery/ack counts, GPS fix logs) — not a "seemed to
work" note. It passes only when every item below is demonstrated:

**Application states** — separate *state restoration on next launch* from *continuous
background behavior after kill/reboot*; do not require the impossible:
- Cold start, warm foreground, and backgrounded restore the correct active-job state and keep
  push/location running.
- After **OS-termination (swiped away)** or **device reboot**, background location legitimately
  **stops** (Android will not auto-restart a terminated app for location/geofence; iOS suspends
  on termination). The requirement is that the **next app launch** restores the correct active-job
  state and re-registers push + location — *not* that background location continues while the app
  stays killed. Measure and document the actual resumption behavior (including any OS
  significant-location / geofence re-launch signal, where available) rather than assuming it.

**Push delivery + acknowledgement escalation**
- A user-visible high-priority push arrives and the technician can explicitly acknowledge it;
  the four delivery events in §6 are distinguishable in logs.
- When no acknowledgement arrives within the SLA, the dispatcher-side escalation path fires.
- Silent/data-only push is measured for drop/delay rate and is **not** relied on as the wake path.

**Permission failure paths**
- Denied/downgraded notification permission, denied/"while using"-only location, and revoked-
  after-grant are each detected and surfaced with a repair prompt — never silently degraded.

**Background location under battery management**
- Background location reports on iOS (backgrounded/suspended) and on Android under **Doze, App
  Standby, and at least one aggressive OEM battery manager** (e.g. Samsung/Xiaomi), with the
  gaps/latency recorded honestly.

**Encrypted-storage lifecycle**
- SQLCipher-enabled store is verified encrypted at rest; key rotation, biometric-gated release
  (if adopted), and wipe-on-sign-out/revocation behave as designed across reinstall.

**Contract parity**
- Native client and PWA produce identical lifecycle outcomes from the same shared contracts.

If the spike cannot show acknowledged, user-visible background push **and** OS-compliant
background GPS on a real release build, this decision is revisited before any feature build
proceeds.
