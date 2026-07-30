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

| Option | Background push | Background GPS | Code reuse w/ web | Verdict |
|---|---|---|---|---|
| **React Native + Expo** | APNs/FCM via config plugins / expo-notifications; custom native modules available through prebuild | expo-location + expo-task-manager background tasks; OS-compliant | High — TS/React, shared `@cluexp/*` domain packages, same api-client | **Chosen** |
| Flutter | Strong (firebase_messaging) | Strong (geolocator/background) | Low — Dart rewrite of domain/UI; no reuse of shared packages | Rejected — abandons existing TS investment |
| Native Swift + Kotlin (two apps) | Best-in-class | Best-in-class | None — two codebases, doubled parity surface | Rejected — cost/parity risk unjustified for pilot scale |
| Webview wrapper (Capacitor over the PWA) | Plugin-dependent, brittle for critical alerts | Plugin-dependent, unreliable backgrounded | Highest | Rejected by policy — does not prove required background reliability |

## 4. Why Expo specifically

- **Prebuild / dev client**, not managed-only: lets us add custom native modules (background
  location task, notification service extension, encrypted storage) when a config plugin isn't
  enough — this is what makes the "not a webview wrapper" bar achievable without ejecting to bare.
- **EAS Build / Submit** gives an owned, reproducible CI release pipeline (TAR-7 asks for a
  scaffolded release pipeline).
- **OTA updates** for JS-layer fixes, subject to the forced-update / minimum-version policy in
  §19 — native-contract or security breaks still require a store build, OTA is not a bypass.
- Mature first-party modules cover the §12.3 checklist: `expo-notifications` (APNs/FCM),
  `expo-location` + `expo-task-manager` (background GPS), `expo-secure-store` (token/credential
  storage), `expo-sqlite` + SQLCipher via a custom module (encrypted offline DB),
  `expo-image-picker`/camera (evidence), `expo-haptics`, deep links.

## 5. Consequences

**Positive**
- Reuses the TS/React skillset and the shared domain packages; one team, one language.
- Background push + GPS become achievable to the standard TAR-7 requires.
- PWA remains the fallback; no product fork if contracts stay shared.

**Negative / costs**
- Requires **encrypted native storage** (SQLCipher) via a custom module — the plain `expo-sqlite`
  default is not encrypted; §13.5/§14 require encryption for sensitive local data.
- iOS **notification service extension** and background-location entitlements need Apple review
  justification; both carry App Store rejection risk if the usage string is weak.
- OTA updates must be governed so they can never ship a client that violates the API version
  contract (structured-error/readiness fields) — enforce minimum-version gating server-side.
- Adds an app-store release/ownership burden the team does not have today (signing, provisioning,
  store accounts) — see open decision §7.

## 6. Prerequisites this ADR does NOT resolve (must land before/with the build)

The stack choice is inert until the backend exposes contracts the BFF does not today. These are
tracked in `TECHNICIAN-APP-REDESIGN.md` §13 and must precede the native feature work:

- Device push-token registration/rotation endpoints (**notifications are `[ ]` — nothing built**).
- Canonical readiness response and a versioned active-job snapshot with **structured conflict/error
  codes** (the BFF currently returns copy-only `detail` strings the native client must not parse).
- DB-enforced global single-active-job capacity lock (P0).
- Offline-sync mutation contract (client mutation ID, expected version, retry/backoff, conflict).

## 7. Open decisions requiring owner + date (blockers)

Mirrors `TECHNICIAN-APP-REDESIGN.md` §20; this ADR closes #1 and needs the rest ratified:

1. ~~Native stack~~ — **decided here (React Native + Expo), pending sign-off.**
2. Supported OS/device matrix + minimum versions.
3. Push provider/operations ownership + acknowledgement SLA.
4. Background-location frequency, precision, retention, consent, battery policy.
5. Mapping/navigation provider + cost/offline policy.
6. Offline storage encryption / key lifecycle + max retained job history.
7. App-store account ownership, signing/provisioning, and release approver.

## 8. Verification (definition of "this ADR was right")

- A spike proves: cold-start restores an active job; a high-priority push wakes the app and is
  acknowledged; background location reports while backgrounded on both iOS and Android; secure
  store survives reinstall policy as intended.
- Contract-parity tests show the native client and PWA produce identical lifecycle outcomes from
  the same shared contracts.
- If the spike cannot show acknowledged background push + background GPS, this decision is revisited
  before any feature build proceeds.
