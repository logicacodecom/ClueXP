# ClueXP Execution Plan — MVP

> **Status:** provider-managed, isolated-tenant SaaS MVP. Rewritten 2026-06-14 to
> replace the earlier "ClueXP-Ops global-pool dispatch" framing (now superseded).
> **Prepared:** 2026-06-13 · **Rewritten:** 2026-06-14
> **Code reconciliation:** merged `main` through `17559e4` (2026-06-14).
> **Purpose:** the smallest credible controlled production pilot and product demo.
>
> Redline legend: ✅ <s style="color:#1a7f37">done in merged code/tests</s> · `- [ ]` not started ·
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
- The MVP requires the company's dispatcher to cancel/resolve/reassign with an
  audited reason. The complete recovery workspace is Gate 3 work.
- **Public / channelless intake is disabled** — every dispatchable request must
  belong to a company.
- **ClueXP Ops (`/ops/*`) is read-only dispatch oversight** + user/resource
  management. Platform assignment and arrival-override mutations are removed, and
  `/admin/jobs/{id}/resolve` is now tenant-scoped (platform_admin → 403; org-owned
  jobs only) — no cross-tenant platform recovery remains.
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
- ✅ <s style="color:#1a7f37">Successful assignment audit records dispatcher, technician, timestamp, and any override reason.</s>
- ✅ <s style="color:#1a7f37">Provider-web dispatch console (queue + candidates + assign) wired to `/api/provider/*`.</s>

**Tenant isolation (tested):** other-company job → 404, foreign technician → 422,
missing org → 409, technician role → 403, no platform assign mutation exists.

**ClueXP Ops oversight:** ✅ <s style="color:#1a7f37">`/ops/queue`, `/ops/queue/{id}/candidates`, `/ops/fleet` are read-only; platform assignment and arrival override were removed.</s>
✅ <s style="color:#1a7f37">`/admin/jobs/{id}/resolve` is now tenant-scoped for every caller — platform_admin is no longer allowed (403) and the org-ownership check is unconditional (other-company job → 404). No cross-tenant platform recovery remains.</s>

**Exit:** a company dispatches a real job from its console; no other tenant or
background process can offer it. ✅ met (code).

## 6. Gate 2 — Field integrity (secure arrival)

**Outcome:** the assigned technician completes one honest field-service job without
mock operational data.

- ✅ <s style="color:#1a7f37">Single-step transition rule (no milestone skipping).</s>
- ✅ <s style="color:#1a7f37">Secure arrival PIN (migration `0013`): six-digit, customer-issued via the tracking token, HMAC-hashed (never stored plain), expiring/single-use/attempt-limited; `en_route → arrived` only on verification.</s>
- ✅ <s style="color:#1a7f37">`ARRIVAL_PIN_SECRET` fails secure — production startup refuses an absent secret (no public default).</s>
- ✅ <s style="color:#1a7f37">Tenant-scoped arrival-override backend + provider BFF (`POST /provider/jobs/{id}/arrival/override`, reason mandatory + audited).</s>
- ✅ <s style="color:#1a7f37">Manual location refresh; stale after 15 min; customer cancel before arrival; no payment fee.</s>
- [ ] Confirm real active-job hydration on every pilot screen; job survives refresh. _(verify)_
- [ ] Stop customer location access after cancel/reassign/complete/closure. _(verify)_
- ✅ <s style="color:#1a7f37">Technician failure reporting (`cannot_complete`/`customer_unavailable`/`unsafe`) end-to-end — `POST /jobs/{id}/report-issue` (audited event) → surfaced to the company recovery workspace as a ⚠ issue badge; the dispatcher decides recovery.</s>
- ✅ <s style="color:#1a7f37">Revoke former technician's access on reassignment.</s> — provider release/cancel/no-show clear `fulfillment_technician_id` and supersede the offer (Gate 3).

**Exit:** one real job reaches verified arrival + `completed_pending_customer`.
Recovery is proved separately in Gate 3; it does not substitute for the happy path.

## 7. Gate 3 — Company recovery controls  ✅ COMPLETE (code)

**Outcome:** a company's dispatcher can observe and recover every supported pilot job
from its own console, tenant-scoped, without DB access.

- ✅ <s style="color:#1a7f37">Arrival override (Gate 2).</s>
- ✅ <s style="color:#1a7f37">Tenant-scoped recovery mutations: cancel, release technician (→ `pending_dispatch`), mark no-show — `POST /provider/jobs/{id}/{cancel,release,no-show}`.</s> (Reassignment = release → existing `POST /provider/queue/{id}/assign`.)
- ✅ <s style="color:#1a7f37">Reassignment preserves history (events) and **revokes the prior technician's access**.</s>
- ✅ <s style="color:#1a7f37">Reason required for every recovery; mutations atomic with `409` on stale/expected-status conflict; foreign/missing job → 404 (no existence leak); audited (`actor:org:reason`).</s>
- ✅ <s style="color:#1a7f37">Restricted legacy `/admin/jobs/{id}/resolve` — tenant-scoped, no platform-admin cross-tenant override.</s>
- ✅ <s style="color:#1a7f37">Provider recovery workspace UI (`/recovery`): active-jobs list + per-job cancel/release/no-show with reason capture.</s>
- ✅ <s style="color:#1a7f37">Provider live job view + **audit timeline** for an individual job — `GET /provider/jobs/{id}/timeline` + a Timeline panel in `/recovery`.</s>
- ✅ <s style="color:#1a7f37">Recall an active offer — `POST /provider/jobs/{id}/recall-offer` + `/recovery` action.</s>
- ✅ <s style="color:#1a7f37">Resolve a **disputed** job from the provider console — `/recovery` action → tenant-scoped `/admin/jobs/{id}/resolve`.</s>
- ✅ <s style="color:#1a7f37">Internal notes (author + timestamp, invisible to customers/technicians) — migration `0014` `job_notes`, `GET`/`POST /provider/jobs/{id}/notes` + `/recovery` panel.</s>
- ✅ <s style="color:#1a7f37">Technician-reported field issues surfaced as a ⚠ `last_issue` badge in the recovery list (see Gate 2).</s>

**Exit:** every supported pilot failure is recoverable from the company console. ✅ met (code).
Core recovery (cancel/release/no-show/reassign) is shipped; internal notes and the
in-console dispute-resolution screen remain.

## 8. Gate 4 — Pilot readiness and proof

- ✅ <s style="color:#1a7f37">Python dispatch/lifecycle tests + offline Alembic validation in CI.</s>
- ✅ <s style="color:#1a7f37">Build/typecheck all four apps in CI.</s> — root
  workspace install, shared package typecheck, then intake/technician/provider/ops builds.
- ✅ <s style="color:#1a7f37">Gate demo `/charge`/`/finalize`/`/approve-final`/legacy `/review` away from the MVP path — all return `410`.</s>
- ✅ <s style="color:#1a7f37">Health check / deploy smoke — `GET /healthz` (liveness; a prod 200 also confirms the fail-secure `ARRIVAL_PIN_SECRET` startup check) + `GET /ops/flags` (platform_admin runtime flags).</s>
- ✅ <s style="color:#1a7f37">Rate-limit public tracking-token mutations — per-token sliding window (429) on confirm/review/dispute/cancel/arrival-pin; reads unaffected.</s>
- ✅ <s style="color:#1a7f37">Cross-tenant isolation verified — `/provider/*` derive org from session; dispatch/recovery/notes/timeline foreign→404/422 tested; `/admin/*` are platform_admin oversight.</s> _(in-process token limiter is per-instance — a DB-backed version is a post-pilot follow-up.)_
- ✅ <s style="color:#1a7f37">Document channel-disable / global-off rollback.</s> —
  see `docs/MVP-PILOT-RUNBOOK.md`.
- [ ] Controlled roster: only approved pilot technicians for the pilot company.
- ✅ <s style="color:#1a7f37">Define the pilot evidence matrix and rollback procedure.</s> —
  see `docs/MVP-PILOT-RUNBOOK.md`. Execution remains required for: happy path,
  decline+reassign, expiry, customer cancel,
  technician failure+replacement, no-show, dispute+resolution, 72h auto-close
  (shortened), duplicate-assign race, unauthorized/cross-tenant access, and rollback.

**Demo-ready exit:** one scripted internal company-owned job completes through the
real dispatch, technician, arrival, completion, and customer-confirmation path with
the disclosures below.

**Pilot-ready exit:** at least one controlled pilot job completes for the pilot
company, and the failure matrix passes without DB intervention, fabricated data,
privacy leakage, cross-tenant access, or automatic dispatch.

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

- Provider SaaS workforce model: global technician profiles with historical
  provider affiliation records. Companies may self-manage teams/technicians, but
  a technician identity should not be duplicated per company. Affiliation is a
  relationship ledger: one technician can affiliate with Company A for a period,
  move to Company B, then later re-affiliate with Company A without overwriting
  the earlier record. Current dispatch eligibility is derived from active
  affiliation rows (`status=active`, `ended_at=null`), while ended/suspended/
  rejected rows remain available for audit, reactivation, disputes, compliance,
  and performance history. Affiliation records should support W-2/exclusive vs
  contractor/non-exclusive relationships, dispatch permission, company-scoped
  suspension/removal, reactivation history, and future subscription limits;
  Ops/platform remains responsible for global technician suspension and the
  eventual managed skills catalog.
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

## 12. Current code status (2026-06-15)

- **Merged MVP implementation through PR #38:** Gate 0 ✅ · Gate 1 ✅ ·
  Gate 2 ✅ (secure arrival PIN + single-step transitions; technician failure
  reporting) · Gate 3 ✅ (cancel/release/no-show/reassign/recall/resolve + internal
  notes + per-job audit timeline, tenant-scoped + `/recovery` UI) · Gate 4 ✅ (CI for
  all four apps, demo-route gating, `/healthz` + `/ops/flags`, token rate-limit,
  runbook). Latest gate: **104 passed, 1 skipped**; shared typecheck and all four
  production builds pass. Pilot promotion is still blocked by the items below.
- Migrations: prod verified at **`0015_job_payments`** (2026-06-15) via
  `select version_num from alembic_version` + `job_notes` and `job_payment_reports`
  both present. `0014_job_notes` and `0015_job_payments` are applied — the notes and
  advisory-payment code can be promoted.
- Live pilot held OFF (`DISPATCH_CUTOVER_GLOBAL_OFF=true`); confirm at runtime via
  `GET /ops/flags` after redeploy.
- PR #39 is approved at `cfb0b4d`: technician-reported/customer-acknowledged
  payment, customer live tracking, required cancellation reasons, map-object reuse,
  stale-location privacy gating, and the reviewed history/currency fixes are complete.
- Remaining work is operational: merge PR #39, apply migrations
  through `0015`, redeploy the four Vercel projects from the approved commit, observe
  CI green, then execute the pilot matrix (`docs/MVP-PILOT-RUNBOOK.md`) before
  flipping the company channel on.
- Post-pilot follow-ups (non-blocking): DB-backed token limiter; `/healthz` DB-ping
  readiness variant.
