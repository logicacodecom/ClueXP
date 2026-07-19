# ClueXP Technician App Redesign and Development Plan

> **Status:** Product direction approved; detailed specification pending TAR-0 approval
>
> **Updated:** 2026-07-19
>
> **Primary delivery:** redesign the existing `apps/technician-web` PWA first while building
> shared contracts for a future native client
>
> **Authority:** [`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) remains authoritative for dispatch,
> fulfillment, trust, tenancy, financial, and communication contracts. This document translates
> those contracts into the technician product experience and required development work.
>
> **Visual reference:** the approved UI mock (full lifecycle, account/receipt/call/conflict
> screens, and the gap screens: evidence capture, blocked/suspended modes, notification center,
> permission primers) and its token/screen spec live in
> [`design-ref/ui/technician-app/`](design-ref/ui/technician-app/DESIGN.md), synced 2026-07-19.
> The mock now covers this spec's full screen inventory; where mock and spec disagree, this spec
> wins.

## 1. Executive decision

The technician app is an important ClueXP competitive edge. It must become a **field command
system**, not a generic mobile dashboard and not a visual copy of Uber Driver or DoorDash.

The redesign starts with the active job and follows one governing interaction principle:

> At every moment, show one authoritative current state and one safe next action.

The experience will remain dark, industrial, authoritative, and amber-led for now. It will be
designed as a native-ready product, delivered first through the existing PWA. Shared behavior must
not require sharing browser-specific UI components with the future native app.

### Confirmed direction

- Active-job execution is the first redesign priority.
- The first vertical slice is **Accepted → En route → Arrival verification**.
- The same command shell then extends through In service, Closeout, Customer review, and Completed.
- A live map or honest location fallback, current stage, essential job context, one dominant action,
  and contextual Message, Call, and Safety tools form the active-job composition.
- Map and Messages remain contextual to the active job unless they gain honest standalone value.
- One global technician may hold at most one immediate active job across all company affiliations.
- Ordinary new-work alerts are suppressed during an active job.
- PWA polling is pilot fallback, not the production notification standard.
- Native-only capabilities remain behind platform adapters.

## 2. Product context

### 2.1 Users

The primary user is a field technician working alone, often outdoors, in a vehicle, under time
pressure, with intermittent connectivity, limited attention, and one-handed use. The technician may
be affiliated with several provider companies but owns one global ClueXP identity.

Secondary users affected by the experience are:

- the customer waiting for arrival and service;
- the owning-company dispatcher monitoring and recovering the job;
- provider administrators responsible for workforce/compliance;
- ClueXP platform operators providing read-only oversight and platform governance.

### 2.2 Jobs to be done

The technician must be able to:

1. Know whether the device and account are genuinely ready for dispatch.
2. Receive and evaluate an offer quickly without seeing private customer details prematurely.
3. Accept exactly one job without double-booking across companies.
4. Navigate, share location, and communicate without unsafe interaction while driving.
5. Prove arrival and authorization.
6. Perform work, record evidence, and report blockers or safety concerns.
7. Produce an accurate closeout and collection record.
8. Obtain customer confirmation and understand when the job is actually complete.
9. Review activity, earnings, payments, affiliations, and compliance without confusing company and
   global ownership.

### 2.3 Desired emotional outcome

The app should feel:

- **Certain:** status always reflects server truth.
- **Operational:** controls are direct and task-focused.
- **Protective:** privacy, safety, and recovery are visible.
- **Calm under urgency:** urgency changes priority, not visual chaos.
- **Professional:** the technician can trust it as a work instrument.

## 3. Current baseline — built versus missing

### 3.1 Built today

The PWA already uses real application-server BFF routes for:

- sign-in/sign-up and session restoration;
- global profile, photo, skills, affiliations, and compliance documents;
- availability control;
- privacy-gated offer polling, sorting, countdown, accept, and decline;
- active-job restoration;
- lifecycle transitions through arrival PIN, service, and customer confirmation pending;
- foreground location submission;
- structured problem reporting;
- closeout/collection reporting;
- activity/history, settlements, and technician-submitted payment records.

### 3.2 Current limitations

- Offer discovery polls every 15 seconds while the PWA is open.
- Active-job refresh polls every 15 seconds.
- Location uses foreground browser geolocation and submits about every 25 seconds during active work.
- There is no dependable background GPS, production push/alarm delivery, service worker, durable
  offline job cache, or offline mutation outbox.
- The current DB acceptance transaction protects one job but does not yet enforce the global
  cross-job technician-capacity lock.
- Busy assignment remains overrideable in the current pilot flow.
- Map and Messages appear as navigation destinations but currently redirect to Jobs.
- Job chat and masked calling are unbuilt.
- The active-job component combines map, lifecycle, safety/problem reporting, closeout, and payment
  entry in one long surface.
- Several operational labels are 9–11px and are unsuitable for outdoor/low-vision use.
- Some UI remains mock/presentational or contains demo copy; no surface may imply that these
  capabilities are live.

## 4. Success measures

The redesign is successful when the following outcomes are demonstrated. As an initial interaction
**design heuristic**, not a measured launch target, the current state and primary action should be
recognizable in about two seconds. Quantitative release targets must come from pilot baselines.

- accepted-to-en-route and en-route-to-arrived transitions can be completed one-handed;
- no technician can accept overlapping active jobs, including cross-company races;
- an offer has monitored delivery and acknowledgement rather than assumed delivery;
- active-job state restores after refresh, app switch, restart, or network loss;
- failed mutations never silently disappear or duplicate;
- arrival, service, safety, communication, and closeout events remain server-authoritative;
- all critical flows pass keyboard, screen-reader, 200% zoom, color-independent, outdoor contrast,
  reduced-motion, slow-network, and interruption testing;
- the PWA and future native app produce the same lifecycle outcomes and terminology.

Initial product telemetry should measure offer delivery/acknowledgement, offer decision time,
accept conflicts, state-transition latency/failure, GPS freshness, navigation launch, PIN failure,
problem/safety reports, offline queue recovery, messaging delivery, closeout completion, and job
abandonment/recovery. Targets must be set from pilot baselines rather than invented in UI copy.

## 5. Experience architecture

### 5.1 Global application modes

The Work surface renders one mutually exclusive mode:

| Mode | Meaning | Primary action |
|---|---|---|
| Blocked | Account/compliance prevents work | Resolve the named blocker |
| Offline | Technician chose not to receive work | Go online |
| Readiness degraded | Availability is on, but GPS/alerts/network is insufficient | Repair the named condition |
| Ready / waiting | Technician is globally available with no active job | Stay ready; no fake activity |
| Offer decision | One or more valid offers require a decision | Accept the selected offer |
| Active job | A server-confirmed active assignment exists | Perform the state-specific next action |
| Recovery | Active state cannot safely continue | Retry, contact dispatcher, or follow safe recovery |

The application must not render a waiting dashboard and active job simultaneously.

### 5.2 Target information architecture

Recommended bottom destinations:

1. **Work** — readiness, waiting, offers, and the active job.
2. **Activity** — completed, cancelled, released, disputed, and confirmation-pending history.
3. **Earnings** — collections, settlement snapshots, payment ledger, adjustments, and explanations.
4. **Account** — global profile, affiliations, teams, compliance, language, permissions, and device
   settings.

Map, customer/dispatcher messaging, mediated calling, safety, evidence, and closeout are contextual
job tools. A standalone destination is allowed only when it provides real independent value.

### 5.3 Persistent readiness bar

The technician must see four independently verified dimensions:

- **Availability:** offline, ready, busy, break, compliance-blocked, suspended.
- **Location:** precise/live, low accuracy, stale, permission needed, background limited.
- **Alerts:** enabled, muted, permission needed, delivery degraded.
- **Connection:** online, reconnecting, offline with queued changes, sync failed.

“Ready for offers” is displayed only when every required condition passes. Selecting a degraded
dimension opens a focused repair surface with the exact cause and next action.

## 6. Active-job command surface

### 6.1 Composition

The active job uses a stable spatial model:

```text
Map or honest location/navigation fallback
──────────────────────────────────────────
Current lifecycle state and time-sensitive context
Service address / access summary
One dominant next action
──────────────────────────────────────────
Message · Call · Safety · More
```

`Report problem` is a non-emergency operational action under **More**. **Safety** remains a dedicated
top-level action for unsafe or urgent conditions.

The map is a working surface, not decoration. When maps, GPS, or network are unavailable, the app
shows the address, last verified position/time, external-navigation action, and explicit limitation.
It must never animate simulated movement or fabricate ETA.

### 6.2 Stage specifications

#### Accepted / ready to depart

Show:

- owning company;
- service category and customer-safe job summary;
- exact destination, access notes, and preparation requirements now authorized after acceptance;
- GPS/readiness state;
- external navigation choice;
- dominant **Start route** action;
- Message, Call, and Safety, with non-emergency Report problem under More.

Start route must obtain/validate location, write `en_route` on the backend, confirm success, start
the platform location policy, and recover safely if any step fails. It must not show En route on an
optimistic-only client state after a rejected backend mutation.

#### En route

Show:

- destination and honest navigation state;
- last location sync time/accuracy;
- current-job communication and cancellation alerts;
- driving-safe quick actions;
- dominant **Confirm arrival** action, available only at a safe interaction point.

Suppress ordinary new offers. Typing is discouraged/disabled while motion policy says driving;
provide optional read-aloud and approved quick replies. Arrival opens PIN verification rather than
writing `arrived` directly.

#### Arrival verification

Show:

- clear instruction to request the customer-held six-digit PIN;
- numeric one-time-code input with paste/autofill support;
- remaining attempts and exact recovery for incorrect, expired, used, locked, or wrong-technician
  PIN outcomes;
- customer unavailable, cannot access, wrong address, and unsafe paths;
- owning-dispatcher contact and reason-required override visibility.

Successful server verification advances to Arrived and confirms it visibly/haptically. The app must
not expose the stored PIN or bypass the server contract.

#### Arrived / authorization

Show customer/job identity, authorization requirements, scoped evidence, service summary, and the
dominant **Start service** action. Work must not begin until the required arrival/authority condition
is confirmed or the owning dispatcher records an authorized exception.

#### In service

Show elapsed time, work summary, evidence, service/part entries, contextual communication, and
Safety; keep non-emergency Report problem under More. Secondary data entry remains collapsed until
requested. The dominant action is **Review and finish service**, not immediate completion.

#### Closeout

Closeout is a guided, interruption-safe flow rather than an expanded form inside the active-job
screen:

1. Select completed services from the managed catalog/recent presets.
2. Add labor, parts, codes, or third-party items only when applicable.
3. Identify who provided reimbursable items.
4. Add evidence/notes where policy requires them.
5. Record collection method and tip without implying processor settlement.
6. Review calculated tax/fees and final receipt.
7. Submit for customer confirmation.

Drafts autosave locally and server-side where authorized. Reopening resumes exactly where the
technician stopped. The confirmed payment ledger and frozen settlement periods remain financially
authoritative; collection reporting must not claim payout or charge processing.

#### Customer review pending

Show that the technician submitted the work but cannot self-confirm completion. Display customer
confirmation state, support/dispute window, owning-dispatcher escalation, and safe exit guidance.
The global capacity lock remains until the contractually defined terminal/release event.

#### Completed

Show completion confirmation, customer-safe receipt/evidence outcome, collection record, and an
honest earnings/settlement explanation. Ask whether to return to the technician’s prior availability
preference only after server confirmation releases global capacity.

### 6.3 Recovery states

Every stage requires explicit designs for:

- session expired;
- no network;
- stale active-job snapshot;
- job cancelled or released elsewhere;
- permission denied;
- GPS unavailable/low accuracy/stale;
- map unavailable;
- backend conflict (`409`);
- validation error;
- duplicate tap/mutation in flight;
- app refresh/restart during mutation;
- dispatcher override/reassignment;
- customer unavailable;
- unsafe conditions;
- customer confirmation timeout or dispute.

Recovery must preserve work, name what happened, and provide a safe next action. Destructive or
high-impact recovery actions require reason capture and an audit event where the system contract
requires it.

## 7. Offer and global-capacity experience

### 7.1 Offer decision

As a **design heuristic**, not a measured performance target, an idle technician should be able to
understand the decision-relevant offer information in about five seconds. Show only server-backed:

- owning company;
- service category and required skill/equipment;
- approximate area before acceptance;
- distance and coarse travel estimate when valid;
- expected technician amount only when contractually supported, otherwise honest pending copy;
- access/safety warning;
- backend-derived expiration.

The primary offer occupies the decision surface. Additional valid offers are available behind a
clear count/queue rather than rendered as equal visual competitors. Accept is the dominant thumb-zone
action; Decline reveals quick reasons after selection. Internal rank is not shown unless it gives the
technician actionable meaning.

### 7.2 Global capacity

Acceptance must atomically:

1. Lock global technician capacity.
2. Verify no active job exists across any company.
3. Claim exactly one job.
4. Mark the technician busy.
5. Supersede all other pending offers to that technician across companies.
6. Return losing jobs to their owning queues.
7. Notify affected dispatchers without cross-tenant details.

A losing concurrent accept returns a calm, recoverable unavailable state. Busy is a hard gate for
immediate dispatch and cannot be bypassed with an override. Future-job reservations require a
separate time-window capacity model.

## 8. Alerts and notifications

### 8.1 Priority classes

| Class | Examples | Treatment |
|---|---|---|
| Offer | New immediate offer while idle | Distinct sound/haptic, countdown, deep link |
| Current-job normal | Customer message | Normal sound/haptic |
| Current-job operational | Dispatcher instruction, arrival problem | Stronger treatment |
| Acknowledgement required | Urgent dispatcher instruction | Persistent until acknowledged/escalated |
| Critical | Safety, cancellation, forced release/reassignment | Distinct critical treatment |
| Quiet | Affiliation/admin notice, document reminder | Notification center; no active-job interruption |

### 8.2 Delivery requirements

- APNs/FCM-capable device registration and token rotation.
- Tenant/job-safe notification payloads and deep links.
- Sent, provider-accepted, app/device-acknowledged, opened/read, failed, and expired outcomes where
  technically measurable.
- Safe retry without duplicate visible alarms.
- Dispatcher-visible unacknowledged/failed offer delivery and reassignment path.
- Foreground polling fallback.
- User permission education and repair flow.
- Privacy-safe lock-screen defaults.
- Notification preferences that cannot disable mandatory safety/system alerts without explicit
  consequence disclosure.

No product surface may say an alert was delivered when ClueXP only submitted it to a provider.

## 9. Job-scoped messaging and calling

The detailed contract is [`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) §18.2.1. The redesign must provide:

- separate Customer, Dispatcher, and read-only System destinations;
- persistent active-job Message, Call, and Safety actions;
- sender role/company labels and unread counts;
- quick replies and optional read-aloud while en route;
- idempotent send, platform-appropriately protected offline draft/outbox, retry, delivery/read state,
  and attachment progress; PWA protection is constrained by the web threat model and is not treated
  as equivalent to native encrypted storage;
- release/reassignment permission changes;
- support/dispute-window retention, then read-only history;
- mediated calling from the same job authorization boundary.

The global Messages tab remains absent until a real standalone inbox provides honest value.

## 10. Safety, evidence, and trust

Safety is a dedicated flow, not a chat label. It must support:

- unsafe conditions;
- customer unavailable;
- wrong address or access blocked;
- job materially different from dispatch information;
- cannot complete;
- immediate emergency guidance where appropriate;
- owning-dispatcher acknowledgement/escalation;
- timestamp, location quality, evidence, reason, and audit outcome.

Evidence capture must distinguish customer-safe, provider-only, and regulated/sensitive artifacts.
Camera/gallery permissions are requested at the moment of need. Uploads require progress, retry,
background continuation where supported, type/size validation, malware scanning, authorization,
retention, and deletion policy.

## 11. Visual and interaction system

### 11.1 Direction

Retain the existing dark/amber ClueXP identity, but refine it into **industrial field utility**:

- near-black, warm-tinted operational surfaces rather than decorative black cards;
- amber reserved for the current safe action and verified attention priority;
- green only for verified readiness/success;
- red only for danger, destructive action, or critical failure;
- blue/info only where it has a stable semantic role;
- borders, dividers, and spatial layering instead of wrapping every element in a rounded card;
- no gradient text, simulated telemetry, decorative sparklines, or broad glassmorphism.

### 11.2 Typography and touch

- Replace critical 9–11px labels with field-readable sizes; operational labels should generally be
  at least 14px.
- Use a distinctive condensed display face only for stage/timer emphasis and a highly readable body
  face for instructions and data.
- Primary touch targets: 52–60px where field action is expected; never below 44×44px.
- Keep the dominant action in the lower thumb zone and clear of safe-area/system UI.
- Use tabular numerals for countdown, distance, time, and money.
- Do not truncate safety, address, or critical recovery text without an expansion path.

### 11.3 Motion and feedback

Motion communicates state transitions, not decoration:

- offer arrival;
- successful accept;
- GPS acquisition/loss;
- lifecycle advancement;
- message delivery/failure;
- completion and capacity release.

Use restrained transform/opacity transitions with reduced-motion alternatives. Avoid bounce,
continuous ambient animation, or motion that could suggest unverified movement.

### 11.4 Core component inventory

- FieldAppShell
- ReadinessBar / ReadinessRepairSheet
- WorkModeRouter
- OfferDecisionSheet / OfferQueue
- ActiveJobMapCanvas / LocationFallback
- ActiveJobCommandSheet
- StageHeader / StageProgress
- PrimaryStageAction
- ContextActionRail
- ArrivalPinPanel
- SafetyReportSheet
- JobMessageSheet
- EvidenceCapture
- CloseoutWizard / CloseoutDraftStatus
- SyncStatus / OfflineOutbox
- PermissionPrimer
- OperationalAlert
- CompletionReceipt

Components share names, states, tokens, and behavior contracts across platforms; web and native
renderers remain platform-appropriate.

## 12. Shared architecture and platform boundaries

### 12.1 Share across PWA and native

- domain types and managed enums;
- job/offer/readiness state machines;
- transition guards and validation;
- API request/response contracts;
- error normalization and UX terminology;
- design tokens and semantic colors;
- analytics event names/properties;
- synchronization/idempotency rules;
- permission/readiness model;
- test fixtures and contract tests.

Recommended package boundaries:

- `packages/technician-domain` — pure state, types, guards, selectors, copy keys;
- `packages/technician-sync` — mutation queue/idempotency/conflict policy with platform storage ports;
- `packages/technician-design` — semantic tokens and component-state contracts;
- existing `packages/api-client` — generated/validated transport contracts where appropriate.

Package names are proposed and require repository architecture review before creation.

### 12.2 PWA-specific

- Next.js routing, BFF/session cookie integration, and web accessibility.
- Service worker only after cache/mutation safety rules are defined.
- Web push where supported, with explicit platform limitations.
- Browser geolocation foreground behavior and honest background-limited state.
- IndexedDB-backed protected local draft/outbox with best-effort confidentiality appropriate to the
  web threat model; this does not provide the same guarantee as native encrypted storage because the
  executing JavaScript context must be able to access the data/key material.
- Install guidance that never blocks use.

### 12.3 Native-specific

- Native navigation and lifecycle handling.
- APNs/FCM device registration and deep links.
- Background/foreground location service and OS indicators.
- Native maps/navigation handoff.
- Secure credential/token storage.
- Encrypted local database/outbox.
- Camera/gallery/file access.
- Audio/haptic notification behavior.
- App updates, crash reporting, permission changes, and device integrity signals.

React Native/Expo is the default candidate because the team already uses TypeScript/React, but it
must be confirmed by an ADR covering background location, notification extensions, maps, secure
storage, offline database, build/release ownership, and any required native modules. A thin webview
wrapper is not an acceptable substitute for native reliability unless the ADR proves the required
background capabilities.

## 13. Backend and data development

### 13.1 P0 global capacity

- Add a DB-enforced invariant or capacity record that prevents more than one active immediate job
  per global technician.
- Lock/recheck capacity inside offer acceptance.
- Remove active-job conflict from the overrideable immediate-offer path.
- Supersede all other active offers to the technician across companies on acceptance.
- Return each losing job to its owning queue without cross-tenant leakage.
- Release capacity on every terminal/recovery path exactly once.
- Add same-company and cross-company concurrency/integration tests.
- Expose a tenant-safe busy projection; only the owning company sees its job context.

### 13.2 Readiness and device registration

- Define canonical availability/readiness response with account, compliance, active-job, location,
  alert, device, and connection dimensions.
- Register/revoke/rotate device push tokens per user/device/environment.
- Track notification preferences and mandatory alert classes.
- Record last app acknowledgement, location freshness/accuracy, and background limitation honestly.

### 13.3 Active-job snapshot and commands

- Provide one versioned active-job snapshot containing lifecycle version/ETag, allowed actions,
  company/customer-safe context, location requirements, communication authorization, closeout
  state, and recovery state.
- Commands require idempotency keys and expected lifecycle version.
- Return structured conflict/error codes rather than copy-only `detail` strings.
- Support incremental/event sync or a documented polling fallback without making the client invent
  state.

### 13.4 Messaging

- Job/thread/message/participant/delivery/read/attachment schema.
- Tenant/job/assignment/capability authorization on every read and write.
- Idempotent message create and ordered cursor pagination.
- Durable push fan-out and critical acknowledgement/escalation.
- Release/reassignment and retention enforcement.
- Attachment scanning/storage policy.
- Audit linkage without exposing provider internal notes.

### 13.5 Offline synchronization

- Define which reads may be cached and which mutations may queue.
- Never queue unsafe stale transitions blindly; revalidate allowed actions on reconnect.
- Assign a client mutation ID, job ID, expected version, timestamp, and payload hash.
- Specify retry/backoff, duplicate detection, conflict resolution, expiration, and user-visible
  recovery for every mutation class.
- Apply platform-appropriate protection to sensitive local data, minimize retention, and wipe it on
  sign-out/revocation. Native storage must be encrypted; PWA protection is best-effort within the web
  threat model and must not be represented as a native-equivalent guarantee.

## 14. Security, privacy, and compliance

- Authenticate offer acceptance and every technician mutation against the signed-in technician.
- Enforce job/tenant/assignment authorization server-side; UI hiding is insufficient.
- Keep exact customer identity/address/contact unavailable before acceptance.
- Prevent cross-company inference through busy, push, messaging, analytics, logs, and errors.
- Use capability-limited customer communication access.
- Protect push payloads and default lock-screen previews.
- Define location consent, precision, retention, access, and deletion policy.
- Record reason/audit for sensitive recovery actions.
- Threat-model stolen devices, shared devices, rooted/jailbroken devices, screenshots, notification
  previews, offline caches, deep links, and attachment abuse.
- Define support/admin impersonation policy; do not create invisible technician actions.

## 15. Accessibility, localization, and field resilience

### Accessibility

- Target WCAG 2.2 AA for the PWA and equivalent native accessibility expectations.
- Complete primary flows with screen reader, keyboard/switch control, and 200% zoom.
- Preserve visible focus and semantic headings.
- Announce async state changes without flooding assistive technology.
- Never communicate status through color alone.
- Provide timer alternatives/extensions where policy permits.
- Respect reduced motion, text scaling, bold text, high contrast, and OS accessibility settings.

### Localization

- Move all technician copy into shared translation keys.
- Preserve EN/ES parity before widening either client.
- Test long strings, RTL readiness, locale-aware dates/times/distance/currency, and pluralization.
- Do not concatenate fragments that translators cannot reorder.

### Field resilience

- Test direct sunlight, dark environments, gloves, one-handed reach, landscape, small phones,
  tablets, low battery, poor GPS, airplane-mode transitions, phone calls, app switching, OS process
  termination, and device restart.
- Avoid heavy decorative assets on the active path.
- Establish performance budgets for app start, restored active job, offer open, command response,
  and map fallback.

## 16. Analytics and operational observability

Track product events without customer-sensitive payloads:

- readiness state and repair outcome;
- offer sent/provider accepted/device acknowledged/opened/expired/accepted/declined/superseded;
- global-capacity conflict and source category without foreign tenant identity;
- active-job restored, command attempted/succeeded/failed/conflicted;
- location permission/freshness/accuracy/background limitation;
- navigation launch;
- PIN result category and remaining attempts, never the PIN;
- safety/problem category and acknowledgement latency;
- message send/delivery/read/failure/retry;
- offline queue depth, age, replay, conflict, discard;
- closeout draft/save/submit/error;
- customer confirmation, dispute, auto-close, release, and completion.

Operational dashboards need alert-delivery failure, stale location, stuck lifecycle, unacknowledged
critical message, sync backlog, crash-free sessions, and version adoption. Product analytics and
security/audit logs remain separate systems with appropriate retention/access.

## 17. Development workstreams and order

### TAR-0 — Contract and design foundation

- [ ] Approve the detailed specification and resolve open decisions (§20); the product direction is
  already approved.
- [ ] Produce state diagrams and low/high-fidelity flows for every global mode and active stage.
- [ ] Define shared terminology, tokens, component states, analytics taxonomy, and error catalog.
- [ ] Inventory/remove misleading mock controls and dead navigation.
- [ ] Establish feature flags and baseline telemetry.

**Exit:** clickable/testable active-job prototype covers normal and recovery flows; contracts map to
real backend states; no surface implies unbuilt behavior.

### TAR-1 — Global capacity and readiness foundation (P0)

- [ ] Implement/test the atomic global active-job lock (§13.1).
- [ ] Implement canonical readiness/device status APIs.
- [ ] Make busy immediate dispatch non-overridable.
- [ ] Implement tenant-safe busy projections and dispatcher outcomes.
- [ ] Add same-company/cross-company race, release, cancellation, and retry tests.

**Exit:** double-booking cannot occur at the DB boundary and every client reads the same readiness
truth.

### TAR-2 — Shared field domain and redesigned shell

- [ ] Extract shared state/guard/error/copy/token contracts.
- [ ] Implement WorkModeRouter, ReadinessBar, repair surfaces, and four-tab IA in the PWA.
- [ ] Remove/redirect dead standalone navigation honestly.
- [ ] Add responsive, safe-area, accessibility, and localization foundations.

**Exit:** blocked, offline, degraded, waiting, offer, active, and recovery modes are mutually
exclusive and server-driven.

### TAR-3 — Accepted → En route → Arrival vertical slice

- [ ] Build the map/location canvas and adaptive command sheet.
- [ ] Implement Start route with idempotent backend command and location readiness.
- [ ] Implement en-route foreground tracking plus background-limited disclosure.
- [ ] Implement driving-safe current-job alerts/actions.
- [ ] Redesign PIN arrival with every failure/recovery state.
- [ ] Restore this exact state after refresh/restart/interruption.
- [ ] Add unit, contract, integration, accessibility, and device tests.

**Exit:** the first field journey is production-honest in the PWA and uses only shared contracts that
the native client can adopt.

**Accepted interim risk for TAR-3 through TAR-6:** until TAR-7 delivers monitored native push,
current-job cancellation and operational alerts rely on foreground polling (currently up to 15
seconds between checks) with no delivery acknowledgement. This is acceptable only for the controlled
pilot cohort while the app stays foregrounded and staffed dispatch/manual recovery is available; it
blocks unattended or broader rollout. Any temporary polling-interval reduction requires backend
load testing and still does not count as acknowledged delivery.

### TAR-4 — Arrived, in-service, safety, and evidence

- [ ] Authorization/start-service command.
- [ ] In-service task/evidence surface with progressive disclosure.
- [ ] Dedicated safety/problem flow and dispatcher acknowledgement.
- [ ] Camera/gallery/upload pipeline with offline/retry/security controls.
- [ ] Release/reassignment/cancellation behavior across every stage.

**Exit:** a technician can safely execute or recover a real job without leaving the command surface.

### TAR-5 — Job-scoped messaging and mediated call

- [ ] Implement messaging backend/schema/authorization/delivery.
- [ ] Implement Customer, Dispatcher, and System destinations.
- [ ] Implement quick replies, unread/read/delivery states, offline outbox, attachments, and push.
- [ ] Implement retention and release/reassignment access changes.
- [ ] Select/ADR the mediated voice provider and add calling after chat stabilizes.

**Exit:** communication works without exposing personal contact or crossing tenant/job boundaries.

### TAR-6 — Closeout, customer review, and completion

- [ ] Build autosaved guided closeout and managed service/item presets.
- [ ] Preserve financial ownership and confirmed-ledger/frozen-settlement contracts.
- [ ] Implement customer review pending, dispute/support, auto-close, and completion views.
- [ ] Release global capacity only on authoritative terminal/release outcomes.
- [ ] After confirmed release, ask whether to return to the technician's prior availability
  preference; never make the technician available again silently.

**Exit:** field work closes accurately without implying unbuilt payment processing or technician
payout.

### TAR-7 — Notification and native runtime

- [ ] Complete ADR and scaffold the native app/release pipeline.
- [ ] Implement secure auth/session, native navigation, deep links, maps, encrypted storage, and
  offline sync adapters.
- [ ] Implement APNs/FCM registration, priority classes, monitoring, and dispatcher failure paths.
- [ ] Implement OS-compliant background location and permission repair.
- [ ] Run PWA/native contract-parity tests.

**Exit:** native delivery meets background push/GPS requirements without forking product behavior.

### TAR-8 — Hardening, pilot, and staged rollout

- [ ] Threat model, privacy review, accessibility audit, localization QA, performance budgets, and
  operational runbooks.
- [ ] Test slow/offline/interrupted/device-killed scenarios on supported iOS/Android versions.
- [ ] Dogfood with synthetic jobs; then controlled technician cohort; then company-by-company rollout.
- [ ] Monitor delivery, capacity conflicts, lifecycle failures, crashes, GPS freshness, and support.
- [ ] Verify rollback/kill switches and minimum supported app version policy.

**Exit:** broader launch gates in [`EXECUTION-PLAN.md`](EXECUTION-PLAN.md) and
[`PILOT-OPERATIONS.md`](PILOT-OPERATIONS.md) have evidence, owners, and rollback procedures.

## 18. Testing matrix

Minimum automated and manual coverage:

| Layer | Required coverage |
|---|---|
| Pure domain | State guards, allowed actions, readiness derivation, copy/error mapping |
| API contract | Auth, tenancy, idempotency, version conflict, structured errors |
| DB/integration | Global-capacity races, offer supersession, release, terminal cleanup |
| Component | Every state, long text, loading, empty, error, reduced motion |
| End-to-end | Offer → accept → route → PIN → service → closeout → confirmation |
| Cross-tenant | Multiple affiliations, foreign busy privacy, messages, notifications |
| Offline | Restart, duplicate replay, stale transition, queued message/evidence/closeout |
| Accessibility | Screen reader, keyboard/switch, zoom/text scaling, contrast, focus |
| Device | Supported iOS/Android, background/foreground, lock screen, permissions |
| Operational | Push failure, GPS stale, dispatcher no-ack, rollback, version deprecation |

Production-like tests must use sanitized synthetic customers/jobs. Exact customer data, notification
payloads, and location traces do not belong in public evidence.

## 19. Rollout and feature control

- Separate flags for redesigned shell, global-capacity enforcement, messaging, native push,
  background location, evidence, closeout, and native cohort.
- Global-capacity correctness cannot be disabled after relying on it for production safety; rollback
  must preserve the invariant.
- Roll out by internal users → selected technicians → selected provider companies → broader cohort.
- Require compatible API/client versions before enabling commands that depend on new structured
  conflicts or readiness fields.
- Define forced-update/minimum-version behavior for security or lifecycle-contract breaks.
- Preserve the PWA as an accessible fallback and onboarding surface; disclose capability limits.

## 20. Decisions still required

These decisions block parts of implementation and must receive owners/dates before their workstream:

1. Native stack ADR: React Native/Expo versus another client technology.
2. Supported OS/device matrix and minimum versions.
3. Push provider/operations ownership and acknowledgement SLA.
4. Background-location frequency, precision, retention, consent, and battery policy.
5. Mapping/navigation provider and cost/offline policy.
6. Messaging/attachment retention and dispute-window duration.
7. Mediated voice provider and recording/transcription policy, if any.
8. Evidence classification, retention, and customer/provider visibility.
9. Offline storage encryption/key lifecycle and maximum retained job history.
10. Scheduled next-job/reservation capacity model; it must remain separate from immediate dispatch.
11. Whether/when a high-contrast outdoor theme supplements the current dark theme.
12. Product targets after pilot baselines: alert acknowledgement, transition success, GPS freshness,
    closeout duration, crash-free sessions, and support escalation.

## 21. Definition of done

The redesign is not complete when screens merely resemble this document. It is complete only when:

- every visible state comes from authoritative or explicitly labelled local/offline truth;
- one global technician cannot be double-booked;
- active work restores safely after interruption;
- notification and location limitations are honest and monitored;
- current-job communication is private, reliable, and job-scoped;
- safety and recovery have owned operational outcomes;
- closeout preserves financial truth;
- PWA and native clients pass shared contracts;
- accessibility, localization, privacy, security, device, and operational evidence is captured;
- rollout gates and rollback procedures are verified.
