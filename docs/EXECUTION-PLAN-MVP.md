# ClueXP Execution Plan MVP

> **Status:** Draft for discussion
> **Prepared:** 2026-06-13
> **Purpose:** reduce the remaining roadmap to the smallest credible controlled
> production pilot and product demo.
>
> This document does not replace `docs/EXECUTION-PLAN.md` until approved. It
> reorganizes its remaining work around MVP outcomes and moves nonessential work
> into the next-version backlog.

## 1. MVP Objective

Prove one complete, honest service cycle:

> customer request -> Ops dispatch -> technician acceptance -> field service ->
> customer confirmation, dispute, cancellation, or Ops resolution

The MVP is a **controlled pilot**, not an unattended public launch. It uses a
small roster of approved technicians and a staffed ClueXP dispatcher. No screen
may claim that payment, notification delivery, live movement, or automation
exists when it does not.

## 2. MVP Product Decisions

- Dispatch is exclusively controlled by ClueXP Ops.
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

- [ ] Set `DISPATCH_CUTOVER_GLOBAL_OFF=true` in production and redeploy before
  changing dispatch behavior.
- [ ] Confirm the current `metro-key` channel flag and record its exact state.
- [ ] Verify a new request does not create automatic offers.
- [ ] Keep existing jobs recoverable through current administrative controls.
- [ ] Define rollback as the global-off switch or channel disable, not the legacy
  instant-match route.

**Exit:** production cannot create an automatic technician offer.

## 5. MVP Gate 1 - Ops-Controlled Dispatch

**Outcome:** a dispatcher can see a new job, review technicians, and send one
targeted offer without database access.

### Backend

- [ ] Remove automatic offer creation from ticket creation.
- [ ] Remove automatic re-dispatch from the scheduled sweep.
- [ ] Keep offer expiry and 72-hour completion auto-close.
- [ ] Gate or remove public legacy dispatch and offer-creation endpoints.
- [ ] Add a database constraint allowing only one active `offered` row per job.
- [ ] Add authenticated, platform-Ops-only endpoints:
  - `GET /ops/queue`
  - `GET /ops/queue/{job_id}/candidates`
  - `POST /ops/queue/{job_id}/assign`
  - `GET /ops/fleet` only if required by the queue UI
- [ ] Return `409` when the job changed, was cancelled, was assigned, or already
  has an active offer.
- [ ] On decline or expiry, return the job to an assignable queue state.
- [ ] Audit dispatcher identity, selected technician, time, and result.
- [ ] Persist technician decline reason now, because Ops needs it for reassignment.

### Candidate Decision Support

Show all active, verified pilot technicians with:

- Skill match
- Current or last-known location
- Location freshness
- Coarse distance and ETA
- Online/offline signal
- Busy/free signal and active-job status
- Rating and organization

For MVP, sort nearest-first and highlight skill match. Do not claim a predictive
match percentage. The dispatcher owns the decision.

The Assign action must warn before selecting a technician who is offline, busy,
missing the skill, or has stale/missing location. An override requires a reason.

### Ops UI

- [ ] Replace the mock `/queue` with live pending and active-offer jobs.
- [ ] Show time waiting, access type, location, urgency, offer state, and decline
  reason.
- [ ] Add a live candidate view with one Assign action per technician.
- [ ] Show active-offer technician and expiry; disable duplicate assignment.
- [ ] Poll every 30 seconds and provide manual refresh.
- [ ] Handle loading, empty, unauthorized, stale-session, conflict, and error
  states.
- [ ] Use a simple list/table for MVP. A fleet map is optional.

### Acceptance

- [ ] Ticket creation produces no offer.
- [ ] Only an authorized ClueXP Ops user can assign.
- [ ] Provider dispatchers cannot access platform-wide Ops endpoints.
- [ ] Concurrent assignment attempts produce one offer and one safe conflict.
- [ ] Customer polling never creates an offer.
- [ ] Decline and expiry return the job to Ops.
- [ ] Acceptance atomically sets the named technician and `assigned` state.
- [ ] Customer identity remains hidden until authorized assignment/acceptance.

**Exit:** Ops can dispatch a real job from the UI, and no background process can
select or offer it to another technician.

## 6. MVP Gate 2 - Pilot Field Integrity

**Outcome:** the assigned technician can complete one honest field-service job
without mock operational data.

### Active Job

- [ ] Use the real active-job API on every pilot technician screen.
- [ ] Restore the job after refresh, sign-in, and normal reconnect.
- [ ] Remove mock job, movement, ETA, arrival, and completion data from the pilot
  path.
- [ ] Enforce that only the assigned technician can read or update the job.
- [ ] Revoke the former technician's access after cancellation or reassignment.

### Location and ETA

- [ ] Capture GPS when the technician presses `Start route`.
- [ ] Allow manual location refresh while the job is active.
- [ ] Mark location stale after 15 minutes.
- [ ] Use a traffic-aware route ETA if the Routes integration is quick and
  reliable; otherwise show the existing coarse estimate clearly labelled as an
  estimate.
- [ ] Never animate or imply continuous movement.
- [ ] Stop customer location access after cancellation, reassignment, completion,
  or closure.

### Arrival

- [ ] Generate a secure six-digit customer PIN.
- [ ] Bind it to the job and assigned technician.
- [ ] Store a hash, not the PIN.
- [ ] Make it expiring, single-use, and attempt-limited.
- [ ] Move `en_route -> arrived` only after successful verification.
- [ ] Allow an Ops override with a mandatory reason and audit event.
- [ ] Defer QR arrival verification.

### Recovery

- [ ] Customer can cancel before arrival under the existing policy.
- [ ] Technician can report `cannot_complete`, `customer_unavailable`, or
  `unsafe`.
- [ ] Ops can cancel, mark no-show, or return the job to `pending_dispatch`.
- [ ] Reassignment preserves job history and revokes prior technician access.
- [ ] Every cancellation, no-show, failure, override, and reassignment records
  actor, reason, time, and resulting state.
- [ ] No payment fee is charged in MVP.

### Acceptance

- [ ] Active job survives a page refresh.
- [ ] Wrong, expired, reused, or over-attempt PIN verification fails safely.
- [ ] Correct PIN records arrival.
- [ ] GPS and ETA never display fabricated values.
- [ ] Cancellation immediately revokes offers and location visibility.
- [ ] Reassignment removes the job from the previous technician.
- [ ] One job reaches `completed_pending_customer`.

**Exit:** one real job reaches verified arrival and service completion, or is
manually recovered through cancellation, no-show, or reassignment.

## 7. MVP Gate 3 - Pilot Operations

**Outcome:** Ops can observe and recover every supported pilot job without
database changes.

### Live Job View

- [ ] Replace mock Ops job detail with real lifecycle data.
- [ ] Show request context, current status, active offer, assigned technician,
  ETA type, location freshness, and latest failure reason.
- [ ] Show an append-only audit timeline.
- [ ] Auto-refresh every 30 seconds with manual refresh.

### Minimum Recovery Controls

- [ ] Cancel a job.
- [ ] Recall or expire an active offer.
- [ ] Release an assigned technician.
- [ ] Return a job to `pending_dispatch`.
- [ ] Assign a replacement technician.
- [ ] Mark customer or technician no-show.
- [ ] Override arrival.
- [ ] Resolve or close a disputed job.
- [ ] Require a reason for every override or recovery action.
- [ ] Make mutations atomic and return `409` for conflicting actions.

### Queue and Notes

- [ ] Show pending dispatch, offer active, assigned, en route, arrived, in
  progress, confirmation pending, disputed, cancelled, and stalled jobs.
- [ ] Provide minimum filters for status, long wait, stale location, no response,
  and dispute.
- [ ] Sort urgent and oldest unresolved jobs first.
- [ ] Add append-only internal notes with author and timestamp.
- [ ] Keep internal notes invisible to customers and technicians.

### Pilot Notifications

- [ ] Keep technician offer polling.
- [ ] Provide an in-app visual offer alert and optional browser sound.
- [ ] Show Ops whether an offer is active, accepted, declined, or expired.
- [ ] Display the customer tracking link after intake.
- [ ] Do not claim SMS, email, or push delivery.

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

### Minimum Hardening

- [ ] Retest Back navigation, GPS errors, photo upload, multiple-file selection,
  and file removal on production.
- [ ] Gate demo `/charge`, `/finalize`, and legacy `/review` away from the MVP
  path.
- [ ] Confirm Python dispatch/lifecycle tests run in CI.
- [ ] Build/typecheck all four apps in CI.
- [ ] Add a basic authenticated health check or deployment smoke test.
- [ ] Rate-limit public tracking-token mutations.
- [ ] Verify cross-tenant isolation for jobs, reviews, documents, and Ops routes.
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
- [ ] Duplicate assignment race.
- [ ] Unauthorized technician, provider, and cross-tenant access.
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

### Dispatch Intelligence

- Weighted match scores and predictive recommendations.
- Current-job completion prediction and `next_available_at`.
- Automated SLA alerts, after-hours fallback, and dispatcher scheduling.
- Organization-managed dispatch and policy-enforced private/overflow routing.
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

