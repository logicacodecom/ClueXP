# Sprint 2B — Intake Cutover Plan (offer → accept → track → fulfill → confirm/review → close)

> **Status: APPROVED DETAILED DESIGN / queued as Sprint 3. Nothing in this
> cutover is applied yet.** No migration `0010`, lifecycle code, deploy, or
> channel flip has been made. This document is the agreed design for
> the deliberate cutover from the legacy instant-match stub to the real dispatch +
> fulfillment + review lifecycle. Implementation begins only after this doc is
> implementation. Canonical sequencing and current status live in
> `docs/EXECUTION-PLAN.md`.
>
> **Decisions locked (human, 2026-06-06):** (1) two-field model — `trust_state` is the
> privacy/trust gate, `job.status` is the operational lifecycle, never merged; (2)
> capability `tracking_token` on the job for the customer link; (3) auto-close window
> **72h**, configurable; (4) payments stay deferred — retire/isolate demo
> `/charge`,`/finalize`,`/review` from the real path; (5) **per-`intake_channel`** cutover
> flag (pilot one channel, instant rollback), not global-only; (6) link delivery v1 =
> on-screen return after intake, architecture must not block future SMS/email.

## 1. Current live baseline (what the cutover builds on)
**Live endpoints (prod):**
- `POST /api/tickets` — creates the job; resolves `intake_channel` (slug) → trusted
  `origin_org_id` / `customer_owner_org_id` / `intake_channel_id`. Browser-supplied org is
  never trusted.
- `POST /api/tickets/{id}/offers` — **dispatch WRITE**: policy-aware ranking → creates
  `dispatch_offers` (top-N). Owns offer creation.
- `POST /api/offers/{offer_id}/accept` — first-accept-wins (atomic) → sets
  `fulfillment_technician_id`/`fulfillment_org_id`, `trust_state=matched`, supersedes siblings.
- `GET /api/tickets/{id}/tracking` — pure read; explicit states
  `waiting|matched|no_eligible|expired_retry|error`; safe assignment only when matched.
- `POST /api/cron/dispatch-sweep` — secret-protected; expiry + policy-aware re-dispatch +
  max rounds (3) + ~8m total timeout. Active (pg_cron).
- **Legacy stub** `POST /api/tickets/{id}/dispatch` — instant-match (`tech_stub_247`). **Still
  what the live customer flow calls.** Remains as the rollback target until cutover is proven.

**Tables:** `jobs` (`trust_state` INTAKE/MATCHED/FULFILLMENT, `status`, `fulfillment_technician_id`,
`fulfillment_org_id`, `origin_org_id`, `customer_owner_org_id`, `intake_channel_id`,
`dispatch_attempts`, geo, …); `dispatch_offers`; `intake_channels` (slug → org, `fulfillment_policy`,
`active`); `technicians`; `organizations`; `job_reviews` + `rating_summaries` (rev `0005`);
`login_attempts` (`0008`); `organizations.fulfillment_policy` (`0009`). Current rev: **0009**.

**Gaps this plan fills:** no capability **token** on the customer link; no completion-lifecycle
`status` domain; no completion/confirm/dispute endpoints; no auto-close; no per-channel cutover
flag; stale demo `/charge`/`/finalize`/`/review` still reachable on the customer path.

## 2. Target lifecycle (two orthogonal fields)
**`trust_state` (privacy gate — unchanged contract):** `INTAKE → MATCHED → FULFILLMENT`. Controls
what may be revealed (no candidate/customer PII before MATCHED).

**`job.status` (operational lifecycle):**
```
            (dispatch phase: tracking.state = waiting|no_eligible|expired_retry)
 new ─► pending_dispatch ─►(accept)─► assigned ─► en_route ─► arrived ─► in_progress
                                                                              │
                                                              completed_pending_customer
                                                                /        |         \
                                                completed_confirmed  disputed  completed_auto_closed
 terminal off-ramps from earlier states: cancelled, no_show
```
| status | who sets it | trust_state | customer link shows | terminal |
|---|---|---|---|---|
| `new` / `pending_dispatch` | system (create / dispatch write) | INTAKE | "finding your technician" (dispatch `state`) | no |
| `assigned` | system, on accepted offer | MATCHED | safe assignment + coarse ETA | no |
| `en_route` / `arrived` / `in_progress` | **technician** (tech app) | FULFILLMENT | live status + assignment | no |
| `completed_pending_customer` | **technician** | FULFILLMENT | **confirm / rate / report-issue** view | no |
| `completed_confirmed` | **customer** (token) | FULFILLMENT | thank-you + receipt of review | yes |
| `completed_auto_closed` | **cron** (after 72h) | FULFILLMENT | closed (review still allowed?* — see §11) | yes |
| `disputed` | **customer** (token) | FULFILLMENT | "our team will follow up" | no (admin resolves) |
| `cancelled` / `no_show` | dispatcher/admin (or no-show rule) | — | closed | yes |

Rationale: `trust_state` guards *what can be revealed*; `job.status` drives *fulfillment progress,
completion, dispute, closure*. Keeping them separate preserves the trust/privacy contract.
**Technician can set `completed_pending_customer` but NOT `completed_confirmed`** (hard rule).

The existing **tracking read** composes both: it returns the dispatch `state` and, once matched,
the fulfillment `status` + the appropriate customer affordance (track → confirm/review when
`completed_pending_customer`).

## 3. Schema changes proposed (additive migration, e.g. `0010`)
> Additive only; no destructive changes. Applied as a deliberate, confirmed step.

**`jobs`:**
- `tracking_token text unique` — secure random (~32 bytes, URL-safe). Generated at create. Powers
  the customer link (tracking + confirm + review + dispute).
- `status` domain extended (via check or app-enforced) to:
  `new, pending_dispatch, assigned, en_route, arrived, in_progress, completed_pending_customer,
  completed_confirmed, completed_auto_closed, disputed, cancelled, no_show`.
- lifecycle timestamps (nullable): `assigned_at, en_route_at, arrived_at, in_progress_at,
  completed_pending_at, confirmed_at, closed_at, disputed_at, cancelled_at`.

**`intake_channels`:**
- `dispatch_cutover_enabled boolean not null default false` — the **per-channel flip**.

**`job_reviews`** (extend rev-0005 table to the ticket-scoped, customer-safe shape):
- ensure / add: `ticket_id` (= job id), `assigned_technician_id`, `fulfillment_provider_company_id`
  (= `fulfillment_org_id`), `customer_owner_org_id`, `rating`, `comment` (optional),
  `confirmed_at`, `issue_reported boolean default false`.

**Config (env, with defaults):** `AUTO_CLOSE_WINDOW_SECONDS` (default `259200` = 72h),
`DISPATCH_CUTOVER_GLOBAL_OFF` (emergency kill-switch; default false).

## 4. Endpoint changes proposed
**Customer (token-gated, no full auth):**
- `GET  /api/t/{token}` — token-resolved tracking/state read (the §1 tracking contract +
  fulfillment `status` + completion affordance). Read-only; **never creates offers**.
- `POST /api/t/{token}/confirm` — `completed_pending_customer → completed_confirmed`.
- `POST /api/t/{token}/review` — rating (+ optional comment); records customer-safe review;
  may imply confirm.
- `POST /api/t/{token}/dispute` — `→ disputed` (+ optional issue note).

**Technician (session-auth; assigned tech only; forward transitions only):**
- `PATCH /api/tickets/{id}/status` (or `/technicians/me/jobs/{id}/status`) for
  `en_route|arrived|in_progress|completed_pending_customer`. Rejects `completed_confirmed`.

**Dispatcher/admin (role-gated):**
- `POST /api/admin/jobs/{id}/resolve` — resolve `disputed`, manual close, or re-dispatch.

**Cron (existing sweep extended):**
- Auto-close: `completed_pending_customer` older than `AUTO_CLOSE_WINDOW_SECONDS` →
  `completed_auto_closed`. Lives in the existing `/api/cron/dispatch-sweep`.

**Intake create (the flip, channel-keyed):**
- `POST /api/tickets` — if the resolved channel has `dispatch_cutover_enabled=true`: create job →
  run the dispatch **write** (`/offers`) → return the **token link**. Else → legacy stub path
  (unchanged). The legacy `/dispatch` stub stays callable.

**Retire/isolate:** demo `/api/tickets/{id}/charge`, `/finalize`, `/review` — remove from the real
customer path / gate behind a demo flag so production fulfillment never hits payment/finalization.

## 5. Cutover flag strategy (per-channel)
- Primary control = `intake_channels.dispatch_cutover_enabled` (per channel).
- **Pilot:** enable on **one** channel (e.g., a single partner/test org's channel). Public ClueXP
  channel + all other partners stay on the legacy stub.
- Validate the full §9 test matrix on the pilot channel before widening.
- Widen channel-by-channel; never a single global flip first.
- Emergency global kill-switch (`DISPATCH_CUTOVER_GLOBAL_OFF=true`) forces all channels back to the
  stub without per-row edits.

## 6. Rollback strategy
- **Instant rollback:** set the channel's `dispatch_cutover_enabled=false` (DB flag) → new intakes
  on that channel use the legacy stub again. **No deploy required.**
- Rollback affects **new intakes only**; jobs already in the offer/accept loop continue their
  lifecycle (they're matched and being fulfilled). Document an admin path to resolve any in-flight
  job if a rollback is due to a real defect.
- The legacy `/dispatch` stub and the demo screens remain intact until the cutover is proven across
  the matrix on multiple channels.
- All new backend endpoints ship **flag-default-OFF** (additive) — deploying them changes no live
  behavior until a channel flag is turned on.

## 7. Privacy / security rules (enforced server-side)
- `tracking_token` verified with constant-time compare; the link grants only ticket-scoped,
  customer-safe reads/actions (no full account auth needed for urgent tracking/review).
- Customer responses expose **only** the safe assignment fields (customer_owner, fulfillment_type,
  provider_company, technician display name, role, rating, coarse ETA estimate, status). **Never**
  candidate technicians, rejected/superseded offers, internal scoring, internal IDs, or rosters.
- **Polling stays read-only**; offer creation happens only via the dispatch write + scheduled sweep.
- Customer may review **only** the assigned technician for **that** ticket.
- Technician **cannot** edit or delete the customer review.
- Reviews are **tenant-safe**: company admins see reviews for jobs they **own or fulfill** (membership/
  RLS); ClueXP admins see platform-wide for support/compliance; technicians read-only on their own.

## 8. Migration / deploy sequence (each step confirmed before applying)
1. **Migration `0010`** (additive): `jobs.tracking_token` + status domain + timestamps;
   `intake_channels.dispatch_cutover_enabled`; `job_reviews` extra columns. Apply to prod.
2. **Backend** (flag-default-OFF): token tracking/confirm/review/dispute, technician status
   transitions, dispatcher resolve, auto-close in the sweep, channel-keyed create. Deploy +
   smoke — no live behavior change (all channels still false).
3. **Frontend (Codex):** intake returns the token link; tracking page = waiting/matched →
   completion → confirm/review/dispute; technician completion controls.
4. **Pilot:** seed/enable **one** channel's `dispatch_cutover_enabled=true`; run §9 matrix end-to-end
   on that channel only.
5. **Validate** the full matrix on the pilot; fix-forward.
6. **Widen** channel-by-channel.
7. **Cleanup (later):** retire demo `/charge`/`/finalize`/`/review`; wire SMS/email link delivery
   (notification sprint).

## 9. Pre-cutover test matrix
Policy paths:
1. company-branded intake — `private_owner_only` (owner pool only).
2. company-branded intake — `network_overflow` (owner first → network on re-dispatch).
3. ClueXP public intake — `network_open`.
Dispatch edges:
4. no eligible technician → `no_eligible`.
5. expired offer → cron re-dispatch.
6. accepted offer → correct **matched** hydration in customer tracking (safe fields only).
7. tracking refresh → **no duplicate offers** (read-only).
Completion lifecycle:
8. technician → `completed_pending_customer`.
9. customer confirms via secure token link → `completed_confirmed`.
10. customer submits technician rating/review (tenant-safe, ticket-scoped).
11. customer reports issue → `disputed`.
12. no customer response in 72h → cron `completed_auto_closed`.
13. **tenant isolation** for reviews + completed jobs (cross-org cannot read).
Each runs as a scripted prod/pilot-channel smoke before widening.

## 10. NOT included (explicit)
- **Payments:** charge, settlement, refunds, final-payment, invoicing — **deferred to Sprint 4**. The
  demo `/charge`/`/finalize` are retired/isolated from the real path; no payment logic is wired into
  this cutover.
- **Notification delivery:** SMS / email / push delivery of the token link or status updates —
  **deferred to the notification sprint**. v1 surfaces the token link via the on-screen return after
  intake. The architecture leaves a clean seam (a per-status-change notify hook + the token link) so
  delivery can be added later without reworking the lifecycle.

## 11. Open follow-ups to settle during implementation
- Whether a review is still accepted after `completed_auto_closed` (lean: yes, within a grace window).
- `no_show` trigger (technician-reported vs dispatcher) and its trust/refund implications (refund =
  Sprint 4).
- Reconciling `organizations.fulfillment_policy` semantic names (`private_owner_only`…) with
  `jobs/intake_channels.fulfillment_policy` DB names (`private`…) when org-default → job wiring lands.
