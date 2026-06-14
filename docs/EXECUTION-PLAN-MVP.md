# ClueXP Execution Plan — MVP

> **Status:** provider-managed, isolated-tenant SaaS MVP. Rewritten 2026-06-14 to
> replace the earlier "ClueXP-Ops global-pool dispatch" framing (now superseded).
> **Prepared:** 2026-06-13 · **Rewritten:** 2026-06-14
> **Purpose:** the smallest credible controlled production pilot and product demo.
>
> Redline legend: ✅ <s style="color:#1a7f37">done & verified in code</s> · `- [ ]` not started ·
> _(partial)_ begun · _(operational)_ a deploy/process step, not code.

## 1. MVP Objective

Prove one complete, honest service cycle **for a single provider company operating
as an isolated tenant**:

> customer request (via the company's branded intake link) -> the **company's
> dispatcher** reviews its own technicians and sends one targeted offer ->
> technician acceptance -> field service -> customer confirmation, dispute,
> cancellation, or company resolution.

**ClueXP is a SaaS platform; it does not dispatch.** Each company has its own
branded intake link, its own (W-2/affiliated) technicians, and dispatches **only to
its own roster** — no cross-tenant visibility. ClueXP Ops is platform oversight +
user/resource administration only. The MVP is a **controlled pilot**, not an
unattended public launch, and no screen may claim payment, notification delivery,
live movement, or automation that does not exist.

## 2. MVP Product Decisions

- **Dispatch is controlled by the provider company that owns the request** — its
  `dispatcher`/`provider_admin`, scoped to its organization. ClueXP does not dispatch.
- **Isolated tenancy:** a request belongs to the company that owns its branded intake
  channel; a company sees and dispatches only its own jobs and its own technicians.
- The system shows **advisory** technician signals; it never auto-assigns or
  auto-re-dispatches.
- One targeted technician offer may be active for a job at a time.
- A decline or expired offer returns the job to that company's queue.
- The company's dispatcher may cancel/resolve/reassign with an audited reason.
- **Public / channelless intake is disabled** — every dispatchable request must
  belong to a company.
- **ClueXP Ops (`/ops/*`) is read-only oversight** + user/resource management. There
  is no platform dispatch mutation.
- The customer sees truthful waiting / assigned / fulfillment / closure states.
- Polling and manual refresh are acceptable for the controlled pilot.
- Real payment collection is out of MVP; the UI must state no production charge occurs.

## 3. Existing Foundation (reused, not rebuilt)

- Customer intake, geocoding, photo upload, price-consent UI, tracking token.
- Auth, roles (`platform_admin`, `provider_admin`, `dispatcher`, `technician`),
  registration approval, organizations + memberships, branded **intake channels**
  resolving a request to its owning company.
- Technician offer feed, acceptance, availability, location update, active-job API.
- Operational lifecycle `pending_dispatch → assigned → en_route → arrived →
  in_progress → completed_pending_customer → completed_confirmed/auto_closed/disputed/
  cancelled/no_show`.
- Customer confirmation, review, dispute, cancellation, 72-hour auto-close.
- Per-channel cutover flag (`dispatch_cutover_enabled`) + emergency global-off switch.
- EN/ES localization.

## 4. Gate 0 — Channel-gated cutover (company owns the request)

**Outcome:** a request becomes dispatchable only when it belongs to a company.

- ✅ <s style="color:#1a7f37">No automatic offers on ticket creation; the sweep is cleanup-only.</s>
- ✅ <s style="color:#1a7f37">Public/channelless dispatch disabled — cutover fires only for a branded channel with `dispatch_cutover_enabled`, honoring the global kill-switch.</s>
- ✅ <s style="color:#1a7f37">Rollback = global-off / channel disable.</s>
- [ ] Per-pilot-company: enable that company's channel flag in production. _(operational)_

**Exit:** only company-owned requests enter the operational ladder.

## 5. Gate 1 — Provider-managed dispatch  ✅ COMPLETE (code)

**Outcome:** a company's dispatcher sees its own queue, reviews its own technicians,
and sends one targeted offer — without DB access, without seeing other tenants.

- ✅ <s style="color:#1a7f37">Tenant-scoped endpoints (`dispatcher`/`provider_admin`, scoped to active org): `GET /provider/queue`, `GET /provider/queue/{id}/candidates`, `POST /provider/queue/{id}/assign`, `GET /provider/fleet`.</s>
- ✅ <s style="color:#1a7f37">Candidates = the company's own W-2/affiliated technicians (`primary_organization_id`).</s>
- ✅ <s style="color:#1a7f37">Nearest-first ordering, skill-match highlight, no predictive %.</s>
- ✅ <s style="color:#1a7f37">Override confirmation: offline/busy/stale/skill-mismatch requires a reason; the console captures + submits `override_reason`.</s>
- ✅ <s style="color:#1a7f37">`409` on changed/cancelled/assigned/already-offered; one-active-offer DB index (migration `0011`).</s>
- ✅ <s style="color:#1a7f37">Decline returns the job to the company's queue; reason persisted (`0012`) + surfaced in queue.</s>
- ✅ <s style="color:#1a7f37">Audit of dispatcher, technician, time, result, override reason.</s>
- ✅ <s style="color:#1a7f37">Provider-web dispatch console (queue + candidates + assign) wired to `/api/provider/*`.</s>

**Tenant isolation (tested):** other-company job → 404, foreign technician → 422,
missing org → 409, technician role → 403, no platform assign mutation exists.

**ClueXP Ops oversight:** ✅ <s style="color:#1a7f37">`/ops/queue`, `/ops/queue/{id}/candidates`, `/ops/fleet` are read-only; the platform assign mutation was removed.</s>

**Exit:** a company dispatches a real job from its console; no other tenant or
background process can offer it. ✅ met (code).

## 6. Gate 2 — Field integrity (secure arrival)

**Outcome:** the assigned technician completes one honest field-service job without
mock operational data.

- ✅ <s style="color:#1a7f37">Single-step transition rule (no milestone skipping).</s>
- ✅ <s style="color:#1a7f37">Secure arrival PIN (migration `0013`): six-digit, customer-issued via the tracking token, HMAC-hashed (never stored plain), expiring/single-use/attempt-limited; `en_route → arrived` only on verification.</s>
- ✅ <s style="color:#1a7f37">`ARRIVAL_PIN_SECRET` fails secure — production startup refuses an absent secret (no public default).</s>
- ✅ <s style="color:#1a7f37">Tenant-scoped arrival override for the company's dispatcher (`POST /provider/jobs/{id}/arrival/override`, reason mandatory + audited).</s>
- ✅ <s style="color:#1a7f37">Manual location refresh; stale after 15 min; customer cancel before arrival; no payment fee.</s>
- [ ] Confirm real active-job hydration on every pilot screen; job survives refresh. _(verify)_
- [ ] Stop customer location access after cancel/reassign/complete/closure. _(verify)_
- [ ] Technician failure reporting (`cannot_complete`/`customer_unavailable`/`unsafe`) end-to-end. _(partial)_
- [ ] Revoke former technician's access on reassignment. _(blocked on Gate 3)_

**Exit:** one real job reaches verified arrival + completion, or is recovered via
cancellation/no-show/reassignment (recovery half depends on Gate 3).

## 7. Gate 3 — Company recovery controls  ← LARGEST REMAINING GAP

**Outcome:** a company's dispatcher can observe and recover every supported pilot job
from its own console, tenant-scoped, without DB access.

- ✅ <s style="color:#1a7f37">Arrival override (Gate 2).</s>
- [ ] Provider live job view (real lifecycle data, audit timeline) for the company's active jobs.
- [ ] Tenant-scoped recovery: cancel, recall/expire offer, release technician,
  return to `pending_dispatch`, assign replacement, mark no-show.
- [ ] Reassignment preserves history and **revokes the prior technician's access**.
- [ ] Resolve/close a disputed job (org-scoped).
- [ ] Reason required for every override/recovery; mutations atomic with `409` on conflict.
- [ ] Internal notes (author + timestamp), invisible to customers/technicians.

**Exit:** every supported pilot failure is recoverable from the company console.

## 8. Gate 4 — Pilot readiness and proof

- ✅ <s style="color:#1a7f37">Python dispatch/lifecycle tests + offline Alembic validation in CI.</s>
- [ ] Build/typecheck all four apps in CI (currently only `intake-web`).
- [ ] Gate demo `/charge`/`/finalize`/legacy `/review` away from the MVP path.
- [ ] Authenticated health check / deployment smoke test.
- [ ] Rate-limit public tracking-token mutations.
- [ ] Verify cross-tenant isolation across jobs, reviews, documents, dispatch, recovery.
- [ ] Document channel-disable / global-off rollback.
- [ ] Controlled roster: only approved pilot technicians for the pilot company.
- [ ] Pilot matrix: happy path, decline+reassign, expiry, customer cancel,
  technician failure+replacement, no-show, dispute+resolution, 72h auto-close
  (shortened), duplicate-assign race, unauthorized/cross-tenant access, rollback.

**MVP exit:** at least one controlled pilot job completes for the pilot company, and
the failure matrix passes without DB intervention, fabricated data, privacy leakage,
cross-tenant access, or automatic dispatch.

## 9. MVP Demo Script

1. Customer submits a request via **the company's branded intake link**; receives a tracking link.
2. The request appears in **that company's** dispatch queue.
3. The **company's dispatcher** reviews its own technicians and sends one targeted offer.
4. Technician accepts; the customer sees the named assignment.
5. Technician starts the route; customer sees a clearly-labelled coarse ETA.
6. Customer reveals the arrival PIN; technician verifies it → arrived.
7. Technician completes service.
8. Customer confirms or disputes.
9. The dispatcher demonstrates one recovery action (decline/cancel/reassign — Gate 3).

Disclose explicitly: no real payment; no SMS/email/push; foreground/manual location
(not continuous tracking); **dispatch is performed by the provider company, not ClueXP**.

## 10. Deferred to Next Version

### Marketplace & network dispatch (the widened scope)

The MVP is isolated-tenant. The next version widens it:

- **Public marketplace intake** (not tied to one company's channel) routed/dispatched
  by a **"ClueXP Direct" dispatcher** to **independent technicians or companies**.
- A **company sourcing independent technicians** beyond its own roster (network /
  overflow) when it can't cover a job.
- Policy-enforced private/overflow/open routing across the network.

### Other deferrals

- Dispatch intelligence: weighted match scores, completion prediction, SLA alerts,
  scheduling, bulk actions, capacity planning.
- Maps/field: continuous GPS, animated movement, frequent traffic-aware ETA, QR
  arrival, native app, offline queues.
- Comms: chat, masked calling, SMS/email/push, automated escalations, saved
  filters/search/bulk/scheduling/reporting.
- Payments: merchant-of-record, Stripe auth holds, final capture, fees/refunds,
  settlement ledger.
- Compliance/scale: automated document-expiry enforcement, jurisdiction rules,
  phone verification, retention/deletion workflows, archival/restore drills, SLOs,
  additional verticals/domains/languages.

## 11. Discussion Decisions

Resolved (2026-06-13/14):
- **Dispatch model:** isolated-tenant, provider-managed. ✅
- **`/ops/*`:** kept as read-only oversight + user/resource management. ✅
- **Candidate pool:** the company's own W-2/affiliated technicians. ✅
- **Public/marketplace intake + independent-tech dispatch:** next version. ✅
- **Decline reason:** optional (preset chips + Skip). ✅
- **PIN secret:** explicit `ARRIVAL_PIN_SECRET` required in production. ✅

Still to decide for the pilot:
- Coarse ETA acceptable, or Google Routes required?
- Offer TTL for the staffed pilot (current default 90s).
- Which pilot company + which of its technicians form the approved roster.
- Which checks are mandatory before real customers (vs. internal test users).

## 12. Current code status (2026-06-14)

- Gate 0 ✅ (code) · Gate 1 ✅ (code) · Gate 2 arrival ✅ (code); active-job/location
  verification items open · Gate 3 mostly unbuilt (largest gap) · Gate 4 mostly open.
- Migrations `0011`/`0012`/`0013`: **pending production application / unverified.**
  Reported applied by the Human (2026-06-13) but **not independently verified** from
  this environment (no prod DB reach), and the canonical `EXECUTION-PLAN.md` still
  records production at `0010`. Confirm with `select version_num from alembic_version;`
  (expect `0013_arrival_verification`) and reconcile the canonical plan before relying
  on it. This PR applies no migrations.
- Live pilot held OFF (`DISPATCH_CUTOVER_GLOBAL_OFF=true`) pending Gate 3 + sign-off.
- Critical path: **Gate 3 company recovery controls**, then Gate 4 hardening + CI
  for all four apps.
