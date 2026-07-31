# Technician Native App — Implementation Spec

- **Status:** Draft — implementation plan; assumes ADR-0001 (React Native + Expo) is accepted.
- **Date:** 2026-07-30
- **Scope:** How to build the native technician client. ADR-0001 decides the *stack*; this doc
  decides the *port*. It does not re-argue the stack or restate ADR-0001's open blockers.
- **Relates to:** `docs/ADR-0001-technician-native-stack.md`, `docs/TECHNICIAN-APP-REDESIGN.md`
  (§13 backend contracts, §17 TAR phases), `apps/technician-web` (the reference PWA).

**Principle:** the native app is a **second client over the same contracts**, not a second
product. Business logic and types live in `@cluexp/app-core` / `@cluexp/api-client`; the native
app owns UI, navigation, device I/O, and offline. Any behavior divergence from the PWA is a bug
(contract-parity tests, §9).

## 0. Design source of truth — reproduce, don't redesign

The native app **reproduces the already-accepted technician-web mobile UI/UX**. It does **not**
introduce a new visual design, layout system, or interaction model. The RN implementation is new
only because web components cannot run natively — the *design* is carried over unchanged.

Accepted design sources (the blueprint the native UI must match):
- The polished technician-web mobile experience — `TechnicianShell`, `JobOfferCard`,
  `ActiveJobCard`, `JobStatusTimeline`, bottom nav, action sheet (`apps/technician-web`).
- `docs/DESIGN-SYSTEM.md` and `docs/TECHNICIAN-APP-REDESIGN.md`.

Match the look, hierarchy, usability, terminology, and flow of those references. Native-only
adjustments are limited to what the platform *requires* (safe-area/notch, native nav gestures,
OS permission dialogs, haptics) — these adapt the accepted design to the device, they do not
change it.

> **Rule:** do **not** develop a new UI idea, redesign, or usability change on your own. If any
> screen, layout, or interaction genuinely needs to differ from the accepted design (a real
> platform constraint, a gap the references don't cover), **stop and ask for approval first** —
> propose the change, wait for sign-off, then build. Reproduction is the default; deviation needs
> explicit permission.

---

## 1. Screens

Port the PWA surface (`apps/technician-web/src/app/*`) 1:1 in lifecycle terms. Native grouping:

| Group | Screens | PWA source |
|---|---|---|
| Auth/onboarding | Sign in, Sign up, Onboarding, Invite accept | `/signin`, `/signup`, `/onboarding`, `invite/[token]` |
| Availability/home | Jobs (map-first), availability toggle, presence | `/jobs`, `/map` |
| Offer | Incoming offer, accept, decline (with reason) | `/offer/[id]`, `/offer/[id]/decline` |
| Active job | Detail, navigate, arrival (PIN), service, complete/closeout, approval | `/jobs/[id]` + `arrival` `navigate` `service` `complete` `approval` |
| Comms | Chat (job-scoped), call (mediated), messages inbox | `/jobs/[id]/chat`, `/jobs/[id]/call`, `/messages` |
| Money | Earnings, settlements | `/earnings`, `/settlements` (BFF) |
| Account | Profile, documents, team, activity, settings | `/profile`, `/documents`, `/team`, `/activity`, `/settings` |

Each screen must implement all states: loading, empty, error (structured code → copy), offline,
and permission-blocked. Reduced-motion and text-scaling honored. EN/ES parity before ship.

## 2. Route + deep-link mapping

- Use a typed route tree (Expo Router) mirroring the PWA paths so parity tests can assert the
  same lifecycle target from the same trigger.
- **Deep links** (universal links / app links) needed for: push-tap → active job
  (`cluexp://jobs/{id}`), offer alert (`cluexp://offer/{id}`), chat message
  (`cluexp://jobs/{id}/chat`). Deep link resolves through the **auth + capability guard** before
  rendering — a link never exposes a job the signed-in tech isn't assigned/affiliated to.
- Cold-start via deep link must restore the full nav stack (job detail reachable "back" to Jobs),
  not a dead-end screen.

## 3. Auth / session

The PWA bridges FastAPI JWT through a **same-site httpOnly cookie** at the BFF. Native has no
BFF and no cookie jar — this is the biggest contract change:

- Native calls the FastAPI API directly with a **bearer token** (or short-lived access + refresh)
  stored in `expo-secure-store`, never in JS-readable storage.
- Add/confirm a **token issue + refresh endpoint** for non-cookie clients (the current
  `/api/session` cookie exchange doesn't serve native). Refresh rotates; revocation invalidates.
- Sign-out and server-side revoke must **wipe secure store + encrypted DB** (§7 storage) and
  deregister the push token (§5).
- Every mutation is authorized against the signed-in technician server-side; UI hiding is never
  the control (`TECHNICIAN-APP-REDESIGN.md` §14).

## 4. Push payload schema

Backend does not send push today (notifications = `[ ]`). Define the payload the device-token
service emits. Honor ADR-0001 §6 delivery semantics (provider receipt + explicit ack are
first-class; device receipt/display inferred).

- **Envelope:** `{ type, job_id?, offer_id?, thread_id?, alert_class, notification_id, created_at }`.
  `alert_class ∈ {offer, active_job_change, message, safety, system}`.
- **Visible push** for critical classes (offer, safety) — title/body are tenant-safe and carry
  **no customer PII** (lock-screen preview policy, §14). Silent/data push is best-effort sync
  only, never the wake guarantee (ADR-0001 §6).
- Payload carries **no authoritative state** — it's a signal to fetch the versioned snapshot (§8
  of redesign / this doc's active-job model). Client acks by calling an **ack endpoint** with
  `notification_id`; missing ack drives dispatcher escalation.
- Token lifecycle: register on login/permission-grant, rotate on OS token change, revoke on
  sign-out. Per user + device + environment.

## 5. Offline sync

Per `TECHNICIAN-APP-REDESIGN.md` §13.5. Define per data class, do not blanket-cache:

- **Cacheable reads:** active-job snapshot, offer envelope, profile, service catalog. Cache with
  the snapshot's version/ETag; render with a visible "as of" staleness marker.
- **Queueable mutations:** report-issue, collection/closeout draft, chat message, evidence upload,
  location samples. Each gets `{ client_mutation_id, job_id, expected_version, ts, payload_hash }`.
- **Never queue blind:** on reconnect, revalidate allowed actions against the fresh snapshot
  before replay; a stale lifecycle transition (e.g. "complete" on a job already cancelled) is
  rejected with a structured conflict and surfaced for user recovery — not silently applied.
- Idempotency: server dedupes on `client_mutation_id`. Retry/backoff with expiration; expired
  mutations become user-visible failures, not silent drops.
- Wipe queue + cache on sign-out/revocation.

## 6. Location state machine

Grounds the existing `/api/location` + `TechnicianAvailability`/`GpsState` contract into an
explicit state machine (redesign §13.2). States:

`off → foreground_only → background_active → background_limited → stale/unknown`

- Transitions driven by: availability toggle, active-job stage (en-route needs background),
  permission grants/downgrades, OS battery state (Doze/low-power), and app lifecycle.
- **Honesty rules:** report `background_limited`/`stale` truthfully when the OS throttles; never
  present a stale fix as live. After app kill/reboot, location **stops** — resume on next launch,
  re-register, and label the gap (ADR-0001 §8, not continuous background after kill).
- Precision/frequency/retention per the §7 policy decision; sample cadence differs by stage
  (idle vs en-route) to respect battery.
- Consent capture + a permission-repair prompt for denied/"while using only"/revoked-after-grant.

## 7. Evidence upload

Job photos/attachments (PWA `/api/photo`, `/api/jobs/[id]/collection`):

- Capture via `expo-image-picker`/camera; write to the **encrypted store** first (SQLCipher
  `expo-sqlite` build, ADR-0001 §4), then upload.
- Upload is a **queued mutation** (§5): resumable, retried, tied to `job_id` + `client_mutation_id`.
- Strip/limit EXIF location per privacy policy; scan/size-limit per attachment policy
  (redesign §13.4). No customer PII in filenames or logs.
- Evidence classification/retention/visibility is an **open decision** (redesign §20.8) — block
  shipping evidence until it's set; do not default to "keep everything, show everyone."

## 8. Release pipeline

- **EAS Build + Submit** (ADR-0001 §4). Internal track (TestFlight / Play internal) for the spike
  and dogfood.
- Channels: `development` (dev client) → `preview` (internal cohort) → `production`.
- **OTA (`expo-updates`)** for JS-only fixes, gated by a **minimum-supported-version** check the
  server enforces — an OTA can never ship a client that violates the API version contract
  (structured errors / readiness fields). Native-contract or security breaks require a store build.
- Crash reporting + app-update prompt + device-integrity signals are **owed** (the §12.3 gaps the
  core Expo modules don't cover, per ADR-0001 §4) — pick modules here.
- Signing/provisioning owners per ADR-0001 §7 blocker row 7.

## 9. Parity + test matrix

Extends `TECHNICIAN-APP-REDESIGN.md` §18. Minimum before cohort rollout:

| Layer | Coverage |
|---|---|
| Shared domain | State guards, allowed-action derivation, readiness, error/copy mapping (in `@cluexp/*`, one suite both clients pass) |
| Contract parity | Same trigger → same lifecycle outcome on native and PWA (offer→accept→route→PIN→service→closeout→confirm) |
| API contract | Bearer auth, tenancy, idempotency (`client_mutation_id`), version conflict, structured errors |
| Offline | Restart, duplicate replay, stale-transition rejection, queued message/evidence/closeout |
| Device | Real signed build; background/foreground/killed/rebooted; Doze/OEM battery; lock screen; permission grant/deny/revoke |
| Push | Visible + silent delivery/drop rate, ack path, dispatcher escalation on no-ack |
| Location | State-machine transitions, staleness honesty, resume-after-kill |
| Security/privacy | No PII in push/logs, secure-store + encrypted-DB wipe on revoke, deep-link authorization |
| A11y | Screen reader, switch control, zoom/text scaling, contrast, focus order |

## 10. Build order (maps to TAR phases)

1. **Prereqs (backend, blocks everything):** bearer auth/refresh, device-token service + push
   payload, versioned active-job snapshot + structured errors, global-capacity lock, offline-sync
   contract. (ADR-0001 §6; redesign §13.)
2. **Scaffold + spike:** app skeleton, auth, one live screen; run the ADR-0001 §8 acceptance spike
   on a real release build. Stop if it fails.
3. **Offer → accept → active job → closeout** parity (§1, §5, §6).
4. **Push + location** hardened (§4, §6) with monitoring.
5. **Comms** (chat, mediated call) once messaging backend exists (redesign §13.4 / §20.6–7).
6. **Harden + staged rollout** (§8, §9; TAR-8): threat model, a11y, perf budgets, cohort flag,
   company-by-company.

---

**This spec is not a green light to code.** The backend prerequisites in §10.1 and the ADR-0001
§7 blockers (owners/dates/evidence) come first; several sections (evidence classification,
messaging retention, product baselines) still reference open §20 decisions.
