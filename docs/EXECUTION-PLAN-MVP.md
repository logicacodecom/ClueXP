# ClueXP Execution Plan MVP

> **Status:** Draft for discussion — **redlined 2026-06-13. Superseded in part by the provider-dispatch pivot (see §2 banner): ClueXP is SaaS and does not dispatch; the owning company's dispatcher does, via `/provider/*`. Public/channelless intake disabled.**
> **Prepared:** 2026-06-13
> **Purpose:** reduce the remaining roadmap to the smallest credible controlled
> production pilot and product demo.
>
> This document does not replace `docs/EXECUTION-PLAN.md` until approved. It
> reorganizes its remaining work around MVP outcomes and moves nonessential work
> into the next-version backlog.
>
> **Redline legend:** ✅ <s style="color:#1a7f37">green strikethrough = done & verified in code</s> · `- [ ]` = not started · items tagged _(partial)_ are begun but incomplete · _(operational)_ = a deploy/process step, not code.

## 1. MVP Objective

Prove one complete, honest service cycle:

> customer request -> Ops dispatch -> technician acceptance -> field service ->
> customer confirmation, dispute, cancellation, or Ops resolution

The MVP is a **controlled pilot**, not an unattended public launch. It uses a
small roster of approved technicians and a staffed ClueXP dispatcher. No screen
may claim that payment, notification delivery, live movement, or automation
exists when it does not.

## 2. MVP Product Decisions

> **⚠️ Architecture pivot (2026-06-13): ClueXP is an isolated-tenant SaaS platform and does NOT dispatch.**
> Each company is an **isolated tenant** — its own branded intake link, its own technicians,
> and it dispatches **only to its own roster** (no cross-tenant visibility). A request
> belongs to the **provider company** that owns its intake channel, and that
> **company's dispatcher assigns the company's own (W-2/affiliated) technicians**. ClueXP
> Ops (`/ops/*`) is retained for **platform oversight + user/resource management**, not
> dispatch. The earlier "ClueXP-Ops global-pool dispatch" decisions below are superseded
> by provider-managed dispatch; treat references to "ClueXP Ops dispatches" as
> "the owning company's dispatcher dispatches." Implemented under `/provider/*`
> (tenant-scoped). Public/channelless intake is **disabled** — every dispatchable request
> must belong to a company. **Public marketplace intake + dispatch to independent
> technicians/companies, and a company sourcing independent techs (network/overflow), are
> the explicit next-version widening (see §10) — out of scope for this MVP.**

- Dispatch is controlled by the **provider company that owns the request** (its dispatcher),
  not by ClueXP. (Superseded: "exclusively controlled by ClueXP Ops.")
- The system displays advisory technician signals; it never auto-assigns or
  automatically re-dispatches.
- One targeted technician offer may be active for a job at a time.
- A decline or expired offer returns the job to the Ops queue.
- Ops may manually cancel, resolve, or reassign a job with an audited reason.
- The customer sees truthful waiting, assigned, fulfillment, and closure states.
- Polling and manual refresh are acceptable for the controlled pilot.
- Real payment collection is outside MVP. The UI must clearly state that no
  production charge occurs.
- Provider-managed dispatch is outside MVP. The provider app may remain limited
  to existing organization and compliance administration.

## 3. Existing Foundation

The following capabilities are already substantially available and should be
reused rather than rebuilt:

- Customer intake, geocoding, photo upload, price-consent UI, and tracking token.
- Authentication, roles, registration approval, and tenant model.
- Technician offer feed, acceptance, availability, location update, and active
  job API.
- Operational lifecycle from `pending_dispatch` through completion, dispute,
  cancellation, and closure.
- Customer confirmation, review, dispute, cancellation, and 72-hour auto-close.
- Per-channel cutover flag and emergency global-off switch.
- EN/ES localization foundation.

## 4. MVP Gate 0 - Stop the Old Dispatch Model

**Outcome:** no new production request can enter the automatic dispatch path
while the Ops-controlled replacement is being completed.

> **Status: code-side DONE — only operational steps remain.** The legacy
> automatic path is already removed in code, so this gate is now mostly a deploy
> checklist rather than development work.

- [ ] Set `DISPATCH_CUTOVER_GLOBAL_OFF=true` in production and redeploy before
  changing dispatch behavior. _(operational)_
- [ ] Confirm the current `metro-key` channel flag and record its exact state. _(operational)_
- ✅ <s style="color:#1a7f37">Verify a new request does not create automatic offers.</s> — `POST /tickets/{id}/offers` returns `410`; sweep is cleanup-only.
- [ ] Keep existing jobs recoverable through current administrative controls. _(partial — see Gate 3)_
- ✅ <s style="color:#1a7f37">Define rollback as the global-off switch or channel disable, not the legacy instant-match route.</s> — flags exist in `config.py`.

**Exit:** production cannot create an automatic technician offer.

## 5. MVP Gate 1 - Ops-Controlled Dispatch

**Outcome:** a dispatcher can see a new job, review technicians, and send one
targeted offer without database access.

> **Status: COMPLETE (code).** Only operational step remaining: apply migrations
> `0011` + `0012` to prod.

### Backend

- ✅ <s style="color:#1a7f37">Remove automatic offer creation from ticket creation.</s>
- ✅ <s style="color:#1a7f37">Remove automatic re-dispatch from the scheduled sweep.</s>
- ✅ <s style="color:#1a7f37">Keep offer expiry and 72-hour completion auto-close.</s>
- ✅ <s style="color:#1a7f37">Gate or remove public legacy dispatch and offer-creation endpoints.</s>
- ✅ <s style="color:#1a7f37">Add a database constraint allowing only one active `offered` row per job.</s> — migration `0011` partial unique index; **not yet applied to prod.**
- ✅ <s style="color:#1a7f37">Add authenticated, platform-Ops-only endpoints:</s>
  - ✅ <s style="color:#1a7f37">`GET /ops/queue`</s>
  - ✅ <s style="color:#1a7f37">`GET /ops/queue/{job_id}/candidates`</s>
  - ✅ <s style="color:#1a7f37">`POST /ops/queue/{job_id}/assign`</s>
  - ✅ <s style="color:#1a7f37">`GET /ops/fleet` only if required by the queue UI</s>
- ✅ <s style="color:#1a7f37">Return `409` when the job changed, was cancelled, was assigned, or already has an active offer.</s>
- ✅ <s style="color:#1a7f37">On decline or expiry, return the job to an assignable queue state.</s>
- ✅ <s style="color:#1a7f37">Audit dispatcher identity, selected technician, time, and result.</s>
- ✅ <s style="color:#1a7f37">Persist technician decline reason now, because Ops needs it for reassignment.</s> — `dispatch_offers.decline_reason` (migration `0012`); captured at decline, surfaced as `last_decline_reason`/`decline_count` in the queue.

### Candidate Decision Support

✅ <s style="color:#1a7f37">Show all active, verified pilot technicians with:</s>

- ✅ <s style="color:#1a7f37">Skill match</s>
- ✅ <s style="color:#1a7f37">Current or last-known location</s>
- ✅ <s style="color:#1a7f37">Location freshness</s>
- ✅ <s style="color:#1a7f37">Coarse distance and ETA</s>
- ✅ <s style="color:#1a7f37">Online/offline signal</s>
- ✅ <s style="color:#1a7f37">Busy/free signal and active-job status</s>
- ✅ <s style="color:#1a7f37">Rating and organization</s>

✅ <s style="color:#1a7f37">For MVP, sort nearest-first and highlight skill match. Do not claim a predictive match percentage. The dispatcher owns the decision.</s>

✅ <s style="color:#1a7f37">The Assign action warns before selecting a technician who is offline, busy, missing the skill, or has stale/missing location. An override requires a reason.</s>

### Ops UI

- ✅ <s style="color:#1a7f37">Replace the mock `/queue` with live pending and active-offer jobs.</s>
- ✅ <s style="color:#1a7f37">Show time waiting, access type, location, urgency, offer state, and decline reason.</s> — decline reason + count now surfaced on the job context card.
- ✅ <s style="color:#1a7f37">Add a live candidate view with one Assign action per technician.</s>
- ✅ <s style="color:#1a7f37">Show active-offer technician and expiry; disable duplicate assignment.</s> — "Active offer already sent · expires …" guard blocks reassignment until expiry/decline.
- ✅ <s style="color:#1a7f37">Poll every 30 seconds and provide manual refresh.</s> — queue 30s, fleet 45s.
- [ ] Handle loading, empty, unauthorized, stale-session, conflict, and error
  states. _(partial — verify completeness)_
- ✅ <s style="color:#1a7f37">Use a simple list/table for MVP. A fleet map is optional.</s>

### Acceptance

- ✅ <s style="color:#1a7f37">Ticket creation produces no offer.</s>
- ✅ <s style="color:#1a7f37">Only an authorized ClueXP Ops user can assign.</s>
- ✅ <s style="color:#1a7f37">Provider dispatchers cannot access platform-wide Ops endpoints.</s>
- ✅ <s style="color:#1a7f37">Concurrent assignment attempts produce one offer and one safe conflict.</s> — unit-tested; live-DB integration test `skip`-marked pending `0011`.
- ✅ <s style="color:#1a7f37">Customer polling never creates an offer.</s>
- ✅ <s style="color:#1a7f37">Decline and expiry return the job to Ops.</s>
- ✅ <s style="color:#1a7f37">Acceptance atomically sets the named technician and `assigned` state.</s> — guarded on `pending_dispatch`.
- ✅ <s style="color:#1a7f37">Customer identity remains hidden until authorized assignment/acceptance.</s>

**Exit:** Ops can dispatch a real job from the UI, and no background process can
select or offer it to another technician.

## 6. MVP Gate 2 - Pilot Field Integrity

**Outcome:** the assigned technician can complete one honest field-service job
without mock operational data.

> **Status: arrival PIN DONE; remaining items are Gate-3-dependent or UI checks.**
> The insecure stub was replaced by a hashed, expiring, single-use,
> attempt-limited PIN (migration `0013`, table `arrival_verifications`), bound to
> the job + assigned technician, issued only via the customer's tracking token.
> The direct `en_route -> arrived` transition is now blocked behind verification.
> The remaining open items (revoke former-tech access, Ops cancel/no-show) depend
> on the Gate 3 recovery endpoints.

### Active Job

- [ ] Use the real active-job API on every pilot technician screen. _(partial — tech-app rewrite merged; confirm all screens)_
- [ ] Restore the job after refresh, sign-in, and normal reconnect. _(verify)_
- [ ] Remove mock job, movement, ETA, arrival, and completion data from the pilot
  path. _(partial — arrival stub now replaced; confirm movement/ETA/completion)_
- [ ] Enforce that only the assigned technician can read or update the job. _(verify)_
- [ ] Revoke the former technician's access after cancellation or reassignment. _(blocked on Gate 3 reassignment)_
- ✅ <s style="color:#1a7f37">Single-step transition rule enforced (`can_technician_transition`, tgt == cur+1) — no milestone skipping.</s>

### Location and ETA

- [ ] Capture GPS when the technician presses `Start route`. _(verify wiring)_
- ✅ <s style="color:#1a7f37">Allow manual location refresh while the job is active.</s>
- ✅ <s style="color:#1a7f37">Mark location stale after 15 minutes.</s> — `LOCATION_ONLINE_THRESHOLD_MINUTES=15`.
- [ ] Use a traffic-aware route ETA if the Routes integration is quick and
  reliable; otherwise show the existing coarse estimate clearly labelled as an
  estimate. _(partial — coarse ETA exists)_
- [ ] Never animate or imply continuous movement. _(verify in UI)_
- [ ] Stop customer location access after cancellation, reassignment, completion,
  or closure. _(verify)_

### Arrival

> **DONE — secure PIN rebuilt (migration `0013`, `arrival_verifications`).**

- ✅ <s style="color:#1a7f37">Generate a secure six-digit customer PIN.</s> — `secrets.randbelow`, issued via `POST /t/{token}/arrival-pin` (tracking-token-gated so the technician can't self-issue).
- ✅ <s style="color:#1a7f37">Bind it to the job and assigned technician.</s>
- ✅ <s style="color:#1a7f37">Store a hash, not the PIN.</s> — keyed HMAC-SHA256 (`ARRIVAL_PIN_SECRET` + job binding).
- ✅ <s style="color:#1a7f37">Make it expiring, single-use, and attempt-limited.</s> — TTL 900s, single-use `verified_at`, max 5 attempts.
- ✅ <s style="color:#1a7f37">Move `en_route -> arrived` only after successful verification.</s> — `POST /jobs/{id}/arrival/verify`; the generic status endpoint now 409s on a direct `arrived`.
- ✅ <s style="color:#1a7f37">Allow an Ops override with a mandatory reason and audit event.</s> — `POST /ops/jobs/{id}/arrival/override`.
- ✅ <s style="color:#1a7f37">Defer QR arrival verification.</s> — deferred per plan.

### Recovery

- ✅ <s style="color:#1a7f37">Customer can cancel before arrival under the existing policy.</s>
- [ ] Technician can report `cannot_complete`, `customer_unavailable`, or
  `unsafe`. _(partial — `unsafe_location` enum exists; confirm end-to-end)_
- [ ] Ops can cancel, mark no-show, or return the job to `pending_dispatch`. _(not built — no Ops recovery endpoints)_
- [ ] Reassignment preserves job history and revokes prior technician access. _(not built)_
- [ ] Every cancellation, no-show, failure, override, and reassignment records
  actor, reason, time, and resulting state. _(partial — assign is audited)_
- ✅ <s style="color:#1a7f37">No payment fee is charged in MVP.</s>

### Acceptance

- [ ] Active job survives a page refresh. _(verify)_
- ✅ <s style="color:#1a7f37">Wrong, expired, reused, or over-attempt PIN verification fails safely.</s> — regression-tested (wrong→lockout, expired, single-use, technician-mismatch).
- ✅ <s style="color:#1a7f37">Correct PIN records arrival.</s>
- [ ] GPS and ETA never display fabricated values. _(partial)_
- [ ] Cancellation immediately revokes offers and location visibility. _(verify)_
- [ ] Reassignment removes the job from the previous technician. _(not built)_
- [ ] One job reaches `completed_pending_customer`.

**Exit:** one real job reaches verified arrival and service completion, or is
manually recovered through cancellation, no-show, or reassignment.

## 7. MVP Gate 3 - Pilot Operations

**Outcome:** Ops can observe and recover every supported pilot job without
database changes.

> **Status: LARGEST UNBUILT SURFACE.** No `/ops/*` mutation endpoints exist for
> cancel / recall / release / return-to-queue / reassign / no-show / override;
> only `resolve_job` (dispute) is present.

### Live Job View

- [ ] Replace mock Ops job detail with real lifecycle data. _(queue is live; a dedicated job-detail view is not present)_
- [ ] Show request context, current status, active offer, assigned technician,
  ETA type, location freshness, and latest failure reason.
- [ ] Show an append-only audit timeline. _(events are logged via `log_event_raw`; timeline UI not confirmed)_
- ✅ <s style="color:#1a7f37">Auto-refresh every 30 seconds with manual refresh.</s> — queue polling in place.

### Minimum Recovery Controls

- [ ] Cancel a job.
- [ ] Recall or expire an active offer.
- [ ] Release an assigned technician.
- [ ] Return a job to `pending_dispatch`.
- [ ] Assign a replacement technician.
- [ ] Mark customer or technician no-show.
- [ ] Override arrival.
- [ ] Resolve or close a disputed job. _(partial — `resolve_job` exists)_
- [ ] Require a reason for every override or recovery action.
- [ ] Make mutations atomic and return `409` for conflicting actions. _(partial — holds for existing ops endpoints)_

### Queue and Notes

- [ ] Show pending dispatch, offer active, assigned, en route, arrived, in
  progress, confirmation pending, disputed, cancelled, and stalled jobs. _(partial — pending + active-offer shown)_
- [ ] Provide minimum filters for status, long wait, stale location, no response,
  and dispute.
- [ ] Sort urgent and oldest unresolved jobs first.
- [ ] Add append-only internal notes with author and timestamp.
- [ ] Keep internal notes invisible to customers and technicians.

### Pilot Notifications

- ✅ <s style="color:#1a7f37">Keep technician offer polling.</s>
- [ ] Provide an in-app visual offer alert and optional browser sound.
- ✅ <s style="color:#1a7f37">Show Ops whether an offer is active, accepted, declined, or expired.</s>
- ✅ <s style="color:#1a7f37">Display the customer tracking link after intake.</s>
- ✅ <s style="color:#1a7f37">Do not claim SMS, email, or push delivery.</s>

### Acceptance

- [ ] Ops can find every active pilot job and identify why it is stalled.
- [ ] Ops can cancel, reassign, mark no-show, and resolve a dispute through UI.
- [ ] The previous technician loses access after reassignment.
- [ ] Every Ops action and internal note appears in the audit timeline.
- [ ] Customer and technician views reflect changes after refresh.
- [ ] Concurrent Ops actions fail safely.

**Exit:** every supported pilot failure can be resolved from the Ops console.

## 8. MVP Gate 4 - Pilot Readiness and Proof

**Outcome:** the controlled pilot is safe, repeatable, observable, and honest.

> **Status: MOSTLY NOT STARTED.** Note: CI currently builds only `intake-web`;
> `ops-web`, `provider-web`, and `technician-web` are not built in CI.

### Minimum Hardening

- [ ] Retest Back navigation, GPS errors, photo upload, multiple-file selection,
  and file removal on production.
- [ ] Gate demo `/charge`, `/finalize`, and legacy `/review` away from the MVP
  path.
- ✅ <s style="color:#1a7f37">Confirm Python dispatch/lifecycle tests run in CI.</s> — `ci.yml` runs `pytest api/tests` + offline Alembic check.
- [ ] Build/typecheck all four apps in CI. _(only `intake-web` today)_
- [ ] Add a basic authenticated health check or deployment smoke test.
- [ ] Rate-limit public tracking-token mutations.
- [ ] Verify cross-tenant isolation for jobs, reviews, documents, and Ops routes. _(partial — ops role-isolation tested)_
- [ ] Rotate any secrets previously shared outside the secret manager.
- [ ] Document channel disable and global-off rollback procedures.

### Controlled Supply

- [ ] Use only explicitly approved pilot technicians.
- [ ] Confirm active status, verification, required skill, and current compliance
  documents before each pilot session.
- [ ] Do not widen beyond the controlled roster until automated compliance
  enforcement is built.

### Pilot Matrix

- [ ] Happy path: request -> Ops assign -> accept -> en route -> PIN arrival ->
  service -> customer confirm/review.
- [ ] Offer decline and manual reassignment.
- [ ] Offer expiry and return to queue.
- [ ] Customer cancellation before assignment and while en route.
- [ ] Technician failure and replacement assignment.
- [ ] Customer/technician no-show resolution.
- [ ] Customer dispute and Ops closure.
- [ ] 72-hour auto-close in a shortened non-production test configuration.
- [ ] Duplicate assignment race. _(unit-tested; live-DB integration test pending)_
- [ ] Unauthorized technician, provider, and cross-tenant access. _(partial — ops endpoint isolation tested)_
- [ ] Channel disable and global-off rollback.

**MVP exit:** at least one controlled pilot job completes successfully and the
failure matrix passes without database intervention, fabricated operational
data, privacy leakage, or automatic dispatch.

## 9. MVP Demo Script

The supported demo should show:

1. Customer submits a real request and receives a tracking link.
2. The request appears in the live Ops queue.
3. Ops reviews advisory technician signals and sends one targeted offer.
4. Technician accepts and the customer sees the named assignment.
5. Technician starts the route and shares a real or clearly labelled estimated
   ETA.
6. Customer and technician complete PIN arrival verification.
7. Technician starts and completes service.
8. Customer confirms or disputes.
9. Ops demonstrates one recovery action such as decline, cancellation, or
   reassignment.

The demo must explicitly disclose:

- No real payment is processed.
- SMS, email, and native push are not available.
- Location refresh is foreground/manual, not continuous background tracking.
- Dispatch is staffed and controlled by ClueXP Ops.

## 10. Deferred to Next Version

### Marketplace & network dispatch (the widened scope)

The current MVP is an **isolated-tenant SaaS**: each company has its own branded intake
link, its own technicians, and dispatches only to its own roster — no cross-tenant
visibility. The next version widens this:

- **Public intake** (not tied to one company's channel) routed/dispatched by ClueXP to
  **independent technicians or companies** — i.e. a marketplace.
- A **company sourcing independent technicians** beyond its own W-2/affiliated roster
  (network / overflow dispatch) when it can't cover a job itself.
- Policy-enforced private/overflow/open routing across the network.

### Dispatch Intelligence

- Weighted match scores and predictive recommendations.
- Current-job completion prediction and `next_available_at`.
- Automated SLA alerts, after-hours fallback, and dispatcher scheduling.
- Bulk dispatch actions and advanced capacity planning.

### Maps and Field Experience

- Continuous/background GPS.
- Animated live movement.
- Frequent traffic-aware ETA recalculation and advanced route caching.
- QR arrival verification.
- Native technician application.
- Offline mutation queues and advanced multi-device synchronization.

### Operations and Communications

- Full provider queue, assignment, timeline, and audit operations.
- Customer/technician/provider chat.
- Masked calling.
- SMS and email delivery.
- Native push notifications.
- Automated escalations and sophisticated SLA rules.
- Saved filters, full-text search, bulk actions, shift scheduling, and advanced
  reporting.

### Payments and Commercial Operations

- Merchant-of-record and settlement policy.
- Stripe payment-method collection and authorization hold.
- Final-price approval and final capture.
- Cancellation/no-show fees, refunds, and payment disputes.
- Provider/technician settlement ledger, earnings, and receipts.

### Compliance and Scale

- Automated document-expiry enforcement in assignment eligibility.
- Jurisdiction-specific licensing and insurance rules.
- Customer phone verification and returning-customer policy.
- Formal PII/media retention and deletion workflows.
- Event archival, backup restoration drills, and full incident response.
- SLOs, advanced monitoring, dispatch/payment alerting, and geographic expansion.
- Additional service verticals, domains, subscriptions, and languages.
- Standalone API extraction unless measured need justifies it.

## 11. Discussion Decisions Required

Before approving this plan, decide:

1. Is the MVP strictly a staffed controlled pilot, or must it support unattended
   public requests?
2. Is coarse ETA acceptable for MVP, or is Google Routes mandatory?
3. What targeted-offer TTL should the staffed pilot use?
4. Which three to five technicians form the approved pilot roster?
5. Which Ops user owns dispatch coverage during pilot sessions?
6. Is secure PIN arrival required before the first pilot, or may the first
   internal demo use an audited Ops arrival override?
7. Which production monitoring and compliance checks are mandatory before
   allowing real customers rather than internal test users?

### Critical path (what actually remains)

1. ~~Gate 2 — secure arrival PIN rebuild~~ ✅ **DONE** (migration `0013`; hashed, expiring, single-use, attempt-limited; token-gated issue + ops override).
2. **Gate 3 — Ops recovery endpoints + live job detail** (now the largest unbuilt surface; also unblocks the remaining Gate 2 recovery items).
3. **Gate 1 — apply migrations `0011` + `0012` to prod** (operational; code complete).
4. **Gate 4 — CI builds for all four apps + hardening** (readiness, pre-real-customer).

Internal demo can proceed on Gate 1 + an audited Ops arrival-override (per §11 Q6);
real customers are blocked until the PIN rebuild and Gate 4 hardening land.
