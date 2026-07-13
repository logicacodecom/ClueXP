# ClueXP Execution Plan

> **This is the canonical plan: product backlog, releases, sprints, and tasks.**
> Consolidated 2026-06-19 to also absorb the former `ROADMAP.md` (release sequence +
> readiness gates), `TECHNICIAN-APP-PROGRESS.md` / `TECHNICIAN-APP-BUILD-PLAN.md`, and the
> provider-workforce slice plan (those standalone docs are retired). Architecture lives in
> [`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md); operations in [`PILOT-OPERATIONS.md`](PILOT-OPERATIONS.md).
>
> **Verified/reconciled:** 2026-06-18 — merged the former `EXECUTION-PLAN-MVP.md`
> gate-view into this canonical roadmap and corrected the dispatch model throughout
> to **provider-managed, isolated-tenant** (the ops-controlled draft is superseded).
> **Primary objective:** complete and prove the production business cycle:
> request -> dispatch -> accept -> fulfill -> customer confirm/review or dispute
> -> resolve/close.
>
> **Dispatch model (canonical):** ClueXP is a SaaS platform; **it does not dispatch.**
> Each provider company has its own branded intake channel, its own (W-2/affiliated)
> technicians, and dispatches **only to its own roster** — no cross-tenant visibility.
> The company's `dispatcher`/`provider_admin` controls dispatch via `provider-web`
> (`/provider/*`). ClueXP Ops (`/ops/*`) is **read-only** dispatch oversight plus
> user/resource administration — there is no platform assign mutation.
>
> Legend: `[x]` complete/live, `[~]` partial or in progress, `[ ]` planned,
> `[!]` decision/risk. Production database changes and release flips remain
> explicitly controlled.
>
> **Companion docs:** [`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) (architecture, DB, subsystems,
> ADRs) · [`PILOT-OPERATIONS.md`](PILOT-OPERATIONS.md) (pilot runbook) ·
> [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) (UI Guide).

## Contents

1. Canonical Status · **Product Backlog & Release Map** (R1–R6 + readiness gates) ·
2. Completed Foundation (Sprints 0–2B) · 3. Sprint 3 — Production Fulfillment Cutover ·
4. Sprint 4 — Field Fulfillment Integrity · 5. Sprint 5 — Human Operations & Communications ·
6. Sprint 6 — Provider-Direct Payments · 7. Sprint 7 — Production Hardening & Scale ·
8. Deferred Expansion · 9. Immediate Work Order · 10. Active Decisions & Risks ·
**11. Workstream Task Plans** (11.1 technician app · 11.2 provider workforce).

## 1. Canonical Status

| Capability | State | Notes |
|---|---|---|
| Intake app | `[x]` | Live on `intake.cluexp.com` and currently also `www.cluexp.com` |
| Technician app | `[~]` | Auth, offers, active fulfillment, issue reporting, profile editing and finished-job history are wired to the backend; production pilot verification remains |
| Provider app | `[~]` | Provider-managed dispatch, recovery, notes, timeline and completed-job history are wired **and deployed** (production migrations through `0024` applied); production pilot verification remains |
| Ops app | `[~]` | Auth, registration/compliance administration and read-only dispatch oversight are wired; production pilot verification remains |
| Authentication | `[x]` | First-party FastAPI/Postgres auth with JWT bridged through same-site httpOnly cookies; Clerk is not planned |
| Localization | `[x]` foundation | EN/ES, English fallback; intake uses browser preference first plus explicit toggle; authenticated apps persist user preference |
| Multi-tenancy | `[x]` | Trusted channel resolution; origin/customer-owner/fulfillment model; tenant-aware onboarding |
| Dispatch engine | `[x]` code / `[~]` operational | Provider-managed, isolated-tenant, single-targeted-offer dispatch and tenant-scoped recovery are implemented (`/provider/*`); ClueXP Ops is read-only oversight; production promotion and pilot proof remain |
| Customer dispatch tracking | `[x]` read contract | Customer sees: `waiting` (in the owning company's provider queue or offer active), `matched` (accepted), `expired_retry` (offer lapsed, back in queue), `cancelled`. `no_eligible` is a **derived tracking state, not a `jobs.status`**; it was emitted only by the legacy auto-dispatch path (driven by `dispatch_attempts`), which is gated off in the provider-managed model — so the current cutover flow does **not** produce it. Reserved (see SYSTEM-DESIGN §6) |
| Live customer cutover | `[~]` | All §3.2 items complete; `metro-key` is armed (`dispatch_cutover_enabled=true`). **As of 2026-06-21 the global kill-switch is OFF** (`global_settings.dispatch_cutover_global_off=false`, DB-backed via migration 0024) — so cutover is **live** for `metro-key`: new branded intakes enter the provider queue. **Authenticated end-to-end prod smoke run 2026-07-12 — passed** (see §3.3); found a real 3-day-stale unassigned job in the process, see §10. |
| Fulfillment lifecycle | `[x]` | Full lifecycle wired end-to-end: intake→token→tracking→technician→confirm/review/dispute/close. All error states + EN/ES complete (`87f6c4e`/`8ba6b62`) |
| Technician-reported collection | `[~]` advisory only | Technician-reported amount/method and finished-job history are implemented in code (`0015`); these are advisory operational records — **no real payment processing, no authorization hold, no capture, refund, payout or settlement**. Customer acknowledges by confirming completion |
| Notifications | `[ ]` | No production SMS/email/push delivery |
| CI | `[x]` | Local gates green — current verification (2026-07-13) API `160 passed, 1 skipped`; migration chain validates through `0024`; shared typecheck and all four production builds pass |

Current production migration head: **`0024_gs_more_tunables`** (applied 2026-06-21; chains
`0021_tech_doc_defaults → 0022_technician_invites → 0023_global_settings → 0024`). `0022` adds
technician invites; `0023` adds the `global_settings` runtime-settings table and seeds
`dispatch_offer_ttl_seconds=300`; `0024` migrates five more env-only tunables into `global_settings`
(`dispatch_cutover_global_off`, `token_action_max`/`_window_seconds`, `login_max_failures`/`login_window_seconds`)
— all DB-backed and runtime-editable via the admin API (verified live: `alembic_version=0024`, all six
rows present, both CHECK constraints in place).
`0011`–`0018` plus `0016` (affiliation fields + exclusive guard + backfill), `0017`
(affiliation history), `0018` (technician photo status), `0019` (organization status
enum), `0020` (technician documents) and `0021` (technician_documents defaults repair)
are live. **Deploy note:** the workforce + company-signup + technician-documents
**code** (affiliation eligibility/invite/photo, org onboarding, the technician-documents
bug fixes, type selection, view/download, and Ops review) is **deployed** — Vercel
`cluexp-intake` auto-deploys to production on push to `main`; tip commit `882664f` is
READY in production, and `python-multipart` is in the deployed image. The
`private-technician-docs` Storage bucket exists. An authenticated end-to-end runtime
smoke is still recommended (the build sandbox can't reach prod to verify).

## Product Backlog & Release Map

> Folded in from the former `ROADMAP.md`. This is the outcome-based backlog above the
> detailed sprints; each release maps to a sprint section below.

**Product position.** ClueXP is a **multi-tenant dispatch platform for urgent local
services** (locksmith/access first). The **current MVP is the isolated-tenant,
provider-managed slice**: each provider company owns its branded intake and dispatches its
own roster; ClueXP Ops is read-only oversight. The broader **neutral dispatch network** —
routing demand across provider organizations and independent technicians ("ClueXP Direct"),
marketplace/overflow — is the widened future (see §8 Deferred Expansion and SYSTEM-DESIGN §20.4).
Every job preserves three independent axes — **origin**, **customer owner**, **fulfillment**
— and two orthogonal state fields that must never be merged: `trust_state`
(`INTAKE→MATCHED→FULFILLMENT`, customer privacy) and `jobs.status` (operational lifecycle).

**Release → sprint map:**

| Release | Outcome | Sprint | State |
|---|---|---|---|
| R1 — Fulfillment Cutover | One pilot channel completes a real request→close cycle with no legacy/demo path | §3 | `[x]` shipped (code); pilot pending |
| R2 — Field Fulfillment Integrity | Truthful route/location/arrival; shared audited timeline | §4 | `[~]` core shipped |
| R3 — Human Operations & Comms | Observe/contact/reassign/escalate/resolve/audit any job; notifications | §5 | `[~]` provider recovery shipped; comms pending |
| R4 — Commercial Completion | Provider-account authorize/capture/refund/reconcile for a completed job | §6 | `[ ]` advisory-only today |
| R5 — Trust, Compliance & Scale | Compliance-gated eligibility, retention, observability, SLOs | §7 | `[ ]` partial |
| R6 — Expansion | New verticals, provider billing, network/marketplace dispatch | §8 | `[ ]` deferred |

**Delivery principles:**
1. Finish one real end-to-end cycle before broadening the feature surface.
2. Ship backend capabilities behind per-channel flags and pilot before widening.
3. Keep customer polling read-only; **only the owning company's dispatcher** may create/send
   offers — no automatic offer creation, and ClueXP does not dispatch.
4. A technician may report work complete, but only the customer, dispatcher, or timeout
   policy closes the customer-confirmation boundary.
5. Do not expose candidate identities, customer PII, internal scoring, or cross-tenant data.
6. Do not treat a polished mock screen as a functioning business capability.
7. Payments follow a stable fulfillment lifecycle; they do not define it.

**Business readiness gates:**

| Gate | Required evidence |
|---|---|
| Dispatch-ready | Real request enters the owning company's queue; its dispatcher assigns a technician; technician accepts; no privacy leak; first-accept-wins enforced at DB |
| Fulfillment-ready | Assigned technician progresses through audited statuses; customer sees truthful state |
| Closure-ready | Customer confirms, reviews, or disputes through a secure token; timeout and dispatcher resolution work |
| Revenue-ready | Provider-account payment authorization/capture/refund are idempotent and reconciled; ClueXP never holds or settles provider funds |
| Scale-ready | Compliance blocks invalid supply; tenant isolation, monitoring, retention, backups, and incident response are tested |

The next gate is **Closure-ready in production** (run the [`PILOT-OPERATIONS.md`](PILOT-OPERATIONS.md) matrix), not more mock screen coverage.

## 2. Completed Foundation

### Sprint 0 - Platform foundation `[x]`

- Monorepo with separate intake, technician, provider and ops deployables.
- Shared packages for API-facing types and console UI.
- Supabase Postgres and Storage, Alembic migrations, restricted CORS, protected
  server-owned fields, ticket restoration, human handoff, and CI foundation.
- Google geocoding and browser map keys separated by use.

### Sprint 1 - Real intake `[x]`

- Relational `customers`/`jobs` persistence with JSONB detail.
- Real geocoding and promoted dispatch columns.
- Signed private job-photo upload.
- Price/cancellation consent path and production/demo separation.

### Sprint 2A - Neutral multi-tenant network `[x]`

- Origin/customer-owner/fulfillment model (SYSTEM-DESIGN §20.4).
- Trusted organization intake channels.
- Private-by-default fulfillment policies and policy-aware dispatch.
- Neutral network terminology across product surfaces.

### Sprint 2B - Identity, provider operations and dispatch v1 `[x]`

- First-party authentication, registration, approval/rejection and role/session mapping.
- EN/ES localization foundation.
- Provider organization profile, teams, affiliated technicians and compliance documents.
- Technician availability and location updates.
- Deterministic dispatch, technician offers, expiry sweep and acceptance.
- Customer waiting/matched tracking read contract.
- Login brute-force rate limiting.

The old 2B checklist is closed. Remaining end-to-end work is intentionally
renumbered below rather than hidden inside 2B.

## 3. Sprint 3 - Production Fulfillment Cutover

**Priority:** P0
**Goal:** prove one real request-to-close cycle on one pilot intake channel.
**Detailed design:** the cutover design (two-field `trust_state`/`job.status`
model, capability `tracking_token`, 72h auto-close, per-`intake_channel` flag) is
**implemented and live** — see §3.1–§3.2 below and `docs/SYSTEM-DESIGN.md`. The
standalone `SPRINT-2B-CUTOVER-PLAN.md` design doc was removed 2026-06-17 as fully
delivered (it had gone stale at rev `0009`).

### 3.1 Backend and data contract

> **Deployed to production 2026-06-09** (PR #16 merged; migration `0010` applied;
> all flags default-OFF). Customer tracking + technician status UI followed in
> PRs #17–#19; tracking-token fixes in #17 were verified against prod. Exact
> endpoint contracts are posted in `docs/HANDOFF.md`.

- [x] Add migration `0010` (applied to prod 2026-06-09):
  - secure unique `jobs.tracking_token`;
  - full operational status domain and lifecycle timestamps;
  - `intake_channels.dispatch_cutover_enabled default false`;
  - ticket-scoped review/issue fields.
- [x] Generate secure tokens at job creation and avoid token values in logs.
- [x] Add token-gated customer read:
  `GET /api/t/{token}`.
- [x] Add customer actions:
  `POST /api/t/{token}/confirm`,
  `/review`, and `/dispute`.
- [x] Add assigned-technician-only forward transitions for
  `en_route`, `arrived`, `in_progress`, and
  `completed_pending_customer`.
- [x] Explicitly reject technician attempts to set
  `completed_confirmed`.
- [x] Add role-gated dispatcher resolve/manual-close behavior.
- [x] Extend the scheduled sweep to auto-close
  `completed_pending_customer` after 72 hours.
- [x] Add per-channel cutover and emergency global-off behavior
  (`DISPATCH_CUTOVER_GLOBAL_OFF`).
- [x] ~~Keep the legacy `/dispatch` route as rollback during the pilot (untouched).~~ **[Superseded by Sprint 3.4; mechanism updated by migration 0024]** The rollback mechanism is the global kill-switch `dispatch_cutover_global_off`, now **DB-backed** (`global_settings`) and flipped live via `PATCH /admin/global-settings/dispatch_cutover_global_off` — no redeploy, no code path. The `/dispatch` auto-match stub is **gated (410)** — not a usable dispatch path.
- [!] Isolate demo `/charge`, `/finalize`, and `/review` from the real path —
  the provider-managed path never invokes them, and the old auto-dispatch stub that once chained to
  them is gated (410). Hard removal of the demo endpoints is tracked as cleanup before widening.

### 3.2 Customer and technician application integration

- [x] Return and persist the token tracking link after cutover-enabled intake.
  _(`router.push(committed.tracking_path)` if backend returns tracking_path; non-cutover render fallback (no dispatch) retained for requests that produce no token. `2f3f334`.)_
- [x] Extend customer tracking from waiting/matched through:
  active status, completion confirmation, review, dispute and closed states.
  _(All statuses implemented incl. `no_show` as own screen; each with EN/ES. `87f6c4e`. `/api` prefix bug fixed `8ba6b62`.)_
- [x] Connect technician active-job state restoration to the assigned real job.
  _(Discriminated union `ActiveJobRead`, server-side cookie forwarding, empty/unauthorized/error states all handled. `2f3f334`.)_
- [x] Connect primary technician actions to real forward status mutations.
  _(arrival → `arrived`, service → `in_progress`/`completed_pending_customer`, approval → `completed_pending_customer` all wired `54d324d`.)_
- [x] Implement production loading, stale-session, unauthorized, conflict,
  offline/retry and terminal states.
  _(401/403/409/network errors handled on all five customer actions with EN/ES; 409 auto-refreshes. `87f6c4e`.)_
- [x] Keep customer and technician localization complete for every new state.
  _(All lifecycle screens EN/ES; cancel reason, no_show, error messages all localized. `87f6c4e`.)_
- [x] Remove mock completion controls from the cutover-enabled real path.
  _(Verified by qwen: all technician job status pages use real `updateTechnicianJobStatus`; complete page is summary-only. `87f6c4e`.)_

**PO decisions (2026-06-10 → 2026-06-14):** ~~dispatch stays fully automatic (no
human-in-loop ops step)~~ — **REVERSED 2026-06-13 to human-in-the-loop, then settled
2026-06-14 on provider-managed, isolated-tenant dispatch (see §3.4): the company that
owns the request dispatches it from its own console to its own roster; ClueXP does not
dispatch.** The customer search window stays backend-owned with no customer-facing
countdown.

**PO scope additions (2026-06-10) — pre-pilot:**

- [x] Backend: customer cancel `POST /api/t/{token}/cancel` — allowed from
  `pending_dispatch` through `en_route`, rejected (409) from `arrived` onward;
  a **non-empty cancellation reason is required (422 if empty)** and recorded as a
  `customer_cancel:{reason}` audit event (tightened from the original optional reason via
  PR #39); atomically revokes outstanding offers (no accept-after-cancel race); the assigned
  technician sees the job as cancelled. Exposed to the UI via `customer_actions.can_cancel`
  on the token read. _(Committed `032cf98`; reason made required in PR #39.)_
- [x] Backend: blind customer tracking — removes `attempts`, `max_attempts`,
  `offers_pending`, and `offer_expires_at` from the token read; the customer
  sees only searching / matched / failed (Uber-style, no dispatch internals).
  _(Committed `032cf98`.)_
- [x] Frontend: cancel UI — cancel button shows during search (no reason); reason textarea
  + keep/confirm flow shows after assignment; EN/ES. `customer_actions` nesting resolved.
  _(Committed `2f3f334`.)_
- [x] Frontend: searching screen shows no dispatch process internals.
  _(Backend strips `attempts`/`max_attempts`/`offers_pending`/`offer_expires_at` at source `032cf98`; frontend never receives them.)_
- [x] Google Places Autocomplete — backend proxy live (`fb02e57`); frontend wired with 350ms
  debounce, up to 5 predictions, `selectPlace()` geocodes selection (`2f3f334`).
  ✅ Places API (New) enabled in GCP (confirmed 2026-06-11).
  ✅ `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` confirmed in Vercel (confirmed 2026-06-11).

**PO-reported intake issues (reported pre-#17; status as of 2026-06-11):**

- [~] No Back control — fixed in #17 (`PREV_SCREEN` map); **PO re-test on prod pending**.
- [~] GPS "Something went wrong" — #17 maps geolocation errors to clear messages
  (denied/unavailable/timeout); **PO re-test pending**. If "unavailable" appears
  with device location ON, reopen as a new bug.
- [x] Address autocomplete — Places Autocomplete wired (`2f3f334`); GCP key confirmed.
- [~] Photo upload "Supabase Storage is not configured" — ✅ `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  confirmed in Vercel (2026-06-11); **PO re-test upload after next deploy to confirm end-to-end.**
- [~] Cannot delete a selected file — fixed in #17 (per-file ×); **PO re-test pending**.
- [~] Cannot upload multiple files — fixed in #17 (`multiple` + append); **PO re-test pending**.

### 3.3 Pilot and acceptance

**As of 2026-06-21 the live pilot is ON** — the global kill-switch `dispatch_cutover_global_off` is
`false` (DB-backed via migration 0024), so cutover is live for `metro-key`
(`dispatch_cutover_enabled=true`, the pilot channel). Confirm at runtime via `GET /ops/flags`. The
switch is now flipped live via `PATCH /admin/global-settings/dispatch_cutover_global_off` (no
redeploy); it is evaluated **only at intake create**, so a flip affects new requests only — in-flight
jobs and existing tracking tokens are unaffected (full matrix in SYSTEM-DESIGN §9). To roll back,
`PATCH` it to `true`.

**Authenticated end-to-end prod smoke — run 2026-07-12, PASSED.** Direct authenticated API calls
(no UI) against `intake.cluexp.com`, one synthetic/disposable request through `metro-key`: create →
`pending_dispatch` → dispatcher (`Nadia Reyes`) queue/candidates → targeted offer → technician
(`Lena Ortiz`) accept → `en_route` → customer-issued arrival PIN → technician verify → `arrived` →
`in_progress` → advisory collection report → `completed_pending_customer` → customer confirm →
`completed_confirmed`. Every step returned the expected status/shape; the one deviation (chosen
technician showed `is_online=false` because no demo technician has a recent location ping, so the
first assign attempt correctly 422'd and required `override_reason`) is expected behavior, not a
defect. The disposable job was left in place, closed, clearly labelled in `location.raw_text` /
`additional_details` as a smoke test — not deleted, per the rollback data-hygiene rule.

**Found in the process — a real stale unassigned job, see §10 "Dispatcher availability risk"
(incident specifics kept out of this public repo).** The pilot channel has been receiving real
traffic while unattended.

The full pilot evidence matrix and rollback procedure live in
[`docs/PILOT-OPERATIONS.md`](PILOT-OPERATIONS.md). Execution (not just code) is required
for each path:

- [x] Happy path: company-owned request → provider dispatcher offer → accept → en_route →
  PIN-verified arrival → in_progress → `completed_pending_customer` → customer confirm.
  **Executed 2026-07-12, passed.**
- [x] Decline + reassign; offer expiry returns the job to the company's provider queue.
  **Executed 2026-07-13, passed** (offer expiry drilled with a temporarily-lowered TTL, restored after).
- [x] No duplicate offers enforced — proven via the assignment-race drill (index `0011`
  partial unique constraint: two concurrent `assign` calls → one `200`, one `409`).
- [x] Single-targeted-offer model: **executed 2026-07-13**, passed (see assignment race +
  override-assignment rows in `PILOT-OPERATIONS.md` §7.1).
- [x] Technician status progression and audit timestamps. **Executed, passed** (exercised across
  every scenario below; audit timeline spot-checked).
- [x] Customer confirm, review and dispute; dispatcher dispute resolution. **Executed 2026-07-13,
  passed** — including a review that implies confirm.
- [x] Customer cancel before arrival; technician-failure handoff + replacement; no-show.
  **Executed 2026-07-13, passed** (all three).
- [ ] 72-hour automatic close (shortened for the drill). **Not executed** — draining the real
  72h window in production wasn't worth holding a job open that long; the same status
  transition is proven via other rows. Verify the timer itself in a non-prod environment.
- [x] Cross-tenant isolation: foreign job/technician/review are invisible and non-actionable.
  **Executed 2026-07-13, passed** (list/candidates/assign/cancel all `404` for a foreign dispatcher).
- [x] Disable the channel flag / global-off and verify instant rollback for new requests.
  **Executed 2026-07-13, passed** — flipped on, verified no dispatch, flipped back off, verified
  restored.
- [ ] Widen channel-by-channel only after the matrix passes.

Full row-by-row detail and the one open gap (auto-close timer) are in
[`PILOT-OPERATIONS.md`](PILOT-OPERATIONS.md) §7.1.

**Pilot disclosures (must be stated, no screen may claim otherwise):** no real payment
(advisory technician-reported collection only); no SMS/email/push delivery (the customer token
link and offer alerts depend on foreground PWA / polling / manual operations); **foreground**
location push (~25s while `en_route`/`arrived`/`in_progress`) with no dependable background/native
GPS — **not** Uber-style continuous tracking; **dispatch is performed by the provider company, not ClueXP.**

**Sprint 3 exit:** a pilot request reaches a real named technician — assigned by the
**owning company's dispatcher through its provider queue** — and ends in
`completed_confirmed`, `completed_auto_closed`, or dispatcher-resolved closure, with no
demo endpoint in the path.

### 3.4 Provider-Managed Dispatch  `[x]` code complete

**Priority:** P0 — prerequisite for a meaningful pilot.
**Decision date:** 2026-06-14 (settled the isolated-tenant, provider-managed model; the
earlier ops-controlled draft of 2026-06-13 is superseded).

Dispatching is exclusively a human action **performed by the provider company that owns
the request**. The system orders the candidate list (nearest-first for convenience) and
displays advisory signals, but never independently selects, scores for auto-assignment, or
re-dispatches. All auto-offer creation and the cron re-dispatch loop are removed; the cron
sweep runs cleanup only (offer expiry, auto-close).

**Authorization scope:** `/provider/*` endpoints are the dispatch surface, restricted to a
company's `dispatcher` / `provider_admin` and scoped to its active organization — a company
sees and dispatches **only its own jobs and its own (W-2/affiliated) technicians**, with no
cross-tenant visibility. ClueXP Ops uses `/ops/*` for **read-only** oversight + user/resource
administration; **there is no platform assign mutation**. Despite its `/admin/` path,
`/admin/jobs/{id}/resolve` is a **provider recovery** action restricted to the owning company's
`dispatcher`/`provider_admin` and scoped to its organization (close/cancel/redispatch); a
`platform_admin` is **not** an allowed caller (403) — ClueXP Ops does not recover provider jobs.
These two surfaces never share a bundle or auth domain (SYSTEM-DESIGN §20.3).

**Eligibility signals are advisory for the pilot.** The candidates view shows `is_online`,
`is_busy`, `skills_match`, and `dist_km` as information — not as hard gates. Dispatchers
exercise judgment. Compliance doc enforcement (expired licenses, etc.) is a Sprint 7 gate.

**Global kill-switch (to halt dispatch if needed):**
- [x] `dispatch_cutover_global_off` is DB-backed (`global_settings`, migration 0024) and flipped via
  `PATCH /admin/global-settings/dispatch_cutover_global_off`; verify the live value via
  `GET /ops/flags`. Currently `false` (cutover live for `metro-key`). _(operational)_

**Backend (provider-managed):**
- [x] No auto-offers on ticket creation; job enters `pending_dispatch` without offers; the cron sweep is cleanup-only (`expire_stale_offers`, `auto_close_pending`).
- [x] On offer expiry or decline with no active offers remaining, the job returns to `pending_dispatch`; decline reason persisted (`0012`) and surfaced in the queue.
- [x] Public/channelless dispatch disabled — cutover fires only for a branded channel with `dispatch_cutover_enabled`, honoring the global kill-switch. Legacy unauthenticated dispatch/offer stubs gated.
- [x] Migration `0011`: partial unique index on `dispatch_offers (job_id) WHERE status='offered'` — single active offer per job enforced at the DB level.
- [x] `GET /provider/queue` — the company's own `pending_dispatch` jobs in arrival order; jobs with an active offer carry `offer_active`/`offer_expires_at`/`offered_technician_id` for an "Offer sent" badge; `POST /provider/queue/{id}/assign` returns `409` while an offer is active.
- [x] `GET /provider/queue/{job_id}/candidates` — the company's own technicians (eligibility from
  active affiliation rows in `organization_technicians`: `status='active' AND ended_at IS NULL AND
  dispatch_allowed=true`; `primary_organization_id` is a deprecated compatibility cache, not the
  eligibility source) with dist_km, ETA, is_online, is_busy, active_job, skills_match (nearest-first, no scoring).
- [x] `POST /provider/queue/{job_id}/assign` — single targeted offer to the chosen technician; override (offline/busy/stale/skill-mismatch) requires a reason; audit-logged with actor + any override reason; `409` on changed/cancelled/assigned/already-offered.
- [x] `GET /provider/fleet` — the company's technicians + active job data for the fleet map.
- [x] ClueXP Ops oversight: `GET /ops/queue`, `/ops/queue/{id}/candidates`, `/ops/fleet`, `/ops/flags` are read-only; platform assignment and arrival override were removed.

**Provider console UI (`provider-web`):**
- [x] Dispatch console: queue screen → per-job candidates view wired to live `/provider/queue/*`; assign button per tech; override-reason capture.
- [x] Real `GoogleMapView` (job pin + own-fleet dots) in `packages/console-ui` as a shared component, with per-pair tech↔job connectors and `onMarkerClick`.
- [x] Fleet map screen (own technicians + active job pins).

**Tenant isolation (tested):** other-company job → 404, foreign technician → 422, missing org
→ 409, technician role → 403; no platform assign mutation exists.

**Tests and docs:**
- [x] `test_dispatch.py`: ticket creation creates no offers; cron does not re-dispatch; provider endpoints correct; decline/expiry returns the job to the company's queue; cross-tenant access rejected.
- [x] `SYSTEM-DESIGN.md`: dispatch section updated to the provider-managed model.

**§3.4 exit:** a company dispatches a real job from its own console; no other tenant or
background process can offer it. ✅ met (code); pilot proof is §3.3.

## 4. Sprint 4 - Field Fulfillment Integrity

**Priority:** P1
**Goal:** make route, arrival and field execution truthful and recoverable.

Note: the candidates view in §3.4 shows a straight-line coarse ETA (`eta_range_from_km`).
Real routing ETA is a Sprint 4 concern. Much of the field-integrity core landed alongside
the provider-managed dispatch work (MVP "Gate 2"); items below reflect that.

- [ ] Traffic-aware backend ETA through Google Routes API. _(decision: coarse ETA vs. Google Routes for the pilot — §10)_
- [~] Customer-safe technician location polling with freshness/accuracy — manual location
  refresh + 15-min staleness + stale-location privacy gating and customer live tracking are
  **merged + deployed** (PR #39, in prod tip `882664f`; runtime-smoke pending);
  continuous/traffic-aware position deferred.
- [~] Durable active-job read model and session restoration — `ActiveJobRead` discriminated
  union + cookie forwarding shipped; **verify** hydration on every pilot screen survives refresh.
- [~] Shared audited job timeline — `GET /provider/jobs/{id}/timeline` + Timeline panel
  shipped; extending the same shared timeline to all four apps remains.
- [x] Secure arrival PIN generation and verification — six-digit, customer-issued via the
  tracking token, HMAC-hashed, expiring/single-use/attempt-limited (`0013`); `en_route →
  arrived` only on verification; `ARRIVAL_PIN_SECRET` fails secure in production. (QR deferred.)
- [x] Dispatcher arrival override with mandatory reason — tenant-scoped `POST /provider/jobs/{id}/arrival/override`, audited.
- [x] Cancellation and no-show state rules — `POST /provider/jobs/{id}/{cancel,release,no-show}`, single-step transitions, reason required, atomic with `409` on stale conflict.
- [x] Technician decline reason persistence (`0012`), surfaced in the queue.
- [x] Customer cancellation + technician-failure handoff — customer cancel before arrival;
  `POST /jobs/{id}/report-issue` (`cannot_complete`/`customer_unavailable`/`unsafe`) surfaced
  to the recovery workspace as a ⚠ issue badge; the dispatcher decides recovery.
- [~] Replace demo maps/movement and active-job data on production paths — real data on the
  cutover path; **verify** no mock data remains on any pilot screen.

**Sprint 4 exit:** customer, technician and dispatcher see consistent route,
arrival and work states sourced from the same backend events.

## 5. Sprint 5 - Human Operations and Communications

**Priority:** P1
**Goal:** the responsible actor can manage exceptions through the UI (no DB intervention) — the
**provider dispatcher/`provider_admin`** recovers and resolves its **own** jobs (cancel / release /
no-show / recall / resolve), while **ClueXP Ops/`platform_admin`** observes dispatch and administers
users/resources/compliance. **Ops does not assign, dispatch, close, cancel, redispatch, or recover
provider jobs.**

Note: §3.4 wires the provider **dispatch queue** (pending_dispatch → assign → offer) and
fleet map, and the tenant-scoped recovery workspace landed with it (MVP "Gate 3"). Sprint 5
completes the remaining communications surfaces and ops oversight depth.

- [x] Wire provider queue, assignment, active jobs and tenant-scoped audit to real data
  (`/provider/queue`, `/provider/jobs`, `/provider/audit`, `GET /provider/jobs/{id}/timeline`).
- [x] Tenant-scoped recovery from the provider console (`/recovery`): cancel, release
  (→ `pending_dispatch`), no-show, recall an active offer, and resolve a disputed job via the
  tenant-scoped `/admin/jobs/{id}/resolve`. Reassignment = release → assign; history preserved;
  prior technician's access revoked. Reason required and audited (`actor:org:reason`).
- [x] Internal notes (author + timestamp, invisible to customers/technicians) — `0014`
  `job_notes`, `GET`/`POST /provider/jobs/{id}/notes` + `/recovery` panel.
- [~] Wire ops job detail, dispatch board, escalation queue and audit log to real data —
  ClueXP Ops read-only oversight (`/ops/queue`, `/ops/fleet`, `/ops/flags`) is wired + deployed;
  deeper ops escalation/board surfaces remain.
- [ ] Operational filters for stalled, expiring, safety, disputed and no-response jobs across queue and board.
- [x] Staffed-console acknowledgement/stalled indicators + opt-in browser notifications on the
  provider live queue. Thresholds are build-time public config
  (`NEXT_PUBLIC_DISPATCH_ACK_SLA_MINUTES`, default 5; `NEXT_PUBLIC_DISPATCH_STALLED_MINUTES`,
  default 15). The queue refreshes every 30s and labels critical, acknowledgement-breached and
  stalled jobs. This works only while the console is open; it is not durable production delivery.
- [ ] Define and approve the dispatcher acknowledgement SLA: staffed coverage window, primary + backup owner, acknowledgement target, stalled-job threshold and after-hours fallback.
- [ ] Deliver and verify background dispatcher alerts for new, stalled and safety-flagged jobs, with delivery monitoring and an audited escalation path when the first owner does not acknowledge.
- [ ] Tenant-safe customer, technician and provider communication threads.
- [ ] Masked call or mediated contact path.
- [ ] SMS/email delivery of the customer token link and critical status updates.
- [ ] Reliable technician offer notification strategy (push/SMS) with polling fallback.

**Sprint 5 exit:** the **owning company's dispatcher/`provider_admin`** can resolve every supported
failure path for its own jobs through the UI (with **ClueXP Ops** observing/administering, not
recovering), with an audit event for each action. Before any unsupervised real-customer widening,
the acknowledgement SLA, primary/backup coverage and tested new/stalled/safety alert path must also
be in place. _(Provider-side recovery is met in code; SLA/alerts and cross-app
comms/notifications remain.)_

## 6. Sprint 6 - Provider-Direct Payments

**Priority:** P2, after lifecycle stability
**Goal:** let each provider charge its own customer safely while ClueXP coordinates job state and
mirrors payment status without becoming merchant of record or holding provider funds.

**Accepted payment boundary (Human, 2026-07-13):** the provider is merchant of record. Use Stripe
Connect **direct charges** on a provider-owned connected account with full Stripe Dashboard access
(Standard-account behavior). The charge, processing fees, refunds, disputes, negative balance and
payouts belong to that provider account. ClueXP stores only the connected-account identifier and
the minimum processor object IDs/status needed to correlate the job and audit webhooks; it never
stores raw card data or provider secret keys. No ClueXP application fee in the first slice; a future
software/application fee is a separate pricing decision.

Four distinct payment events — keep them separate:

1. **Provider onboarding** — provider connects/owns its Stripe account; dispatch remains available,
   but card collection is unavailable until `charges_enabled` is true.
2. **Payment method + authorization** — at price-consent commit, create the PaymentIntent as a
   direct charge in the owning provider's connected account and place an authorization hold.
3. **Final capture** — at `completed_confirmed` (customer closes the job), the provider-account hold
   converts to a charge.
4. **Cancellation / no-show** — release the hold or let the provider charge the disclosed fee,
   depending on the accepted policy and job state.

The dispatch pivot does not change the capture trigger: final capture occurs at
`completed_confirmed`, never at dispatcher assignment.

- [~] Advisory technician-reported collection amount/method and finished-job
  history are implemented (`0015`), but remain non-ledger operational records.
- [x] Merchant of record decided: each provider charges its own customers; ClueXP does not collect
  or settle provider funds. Initial implementation takes no application fee.
- [ ] Provider-owned Stripe Connect onboarding/status (`stripe_account_id`, `charges_enabled`,
  `details_submitted`) with no secret-key storage.
- [ ] Stripe direct-charge PaymentIntent + payment-method collection and authorization hold at
  price-consent commit, scoped to the job's owning provider account.
- [ ] Provider-account final capture at `completed_confirmed`; separate cancellation-fee capture
  for no-show/late-cancel only after policy acceptance.
- [ ] Final-scope/price proposal and explicit over-estimate customer approval.
- [ ] Idempotent capture, release, cancellation/no-show fee and refund flows.
- [ ] Webhook inbox/idempotency + tenant-safe reconciliation of PaymentIntent, charge, refund and
  dispute states from each provider account.
- [ ] Provider-owned refund/dispute workflow (Stripe Dashboard or embedded components), linked to
  the job without conflating a payment dispute and a service issue.
- [ ] Provider-branded customer receipt; replace advisory collection totals/history with
  processor-backed provider-account values.
- [!] Decide later whether ClueXP charges a disclosed software/application fee. Do not block the
  initial provider-direct flow on this pricing decision.

**Sprint 6 exit:** happy-path and failure-path money movement reconcile against a
job, provider connected account, PaymentIntent/charge/refund state and audit trail; funds settle
directly from Stripe to the provider, never through ClueXP.

## 7. Sprint 7 - Production Hardening and Scale

**Priority:** P2

- [ ] Enforce compliance document validity in technician/organization eligibility (feeds the provider candidates view — expired docs surface as an `ineligible` signal for the dispatcher).
- [ ] Jurisdiction-specific licensing and insurance rules.
- [ ] Customer phone verification and returning-customer history policy.
- [ ] PII/media retention and deletion audit.
- [ ] Event archival and backup restore drills.
- [~] Sentry/error tracking, health endpoint, uptime checks and alerting — `GET /healthz`
  liveness (also confirms the fail-secure `ARRIVAL_PIN_SECRET` startup check) + `GET /ops/flags`
  shipped; error tracking, uptime checks and alerting remain.
- [x] Python pytest in CI + build/typecheck all four apps — offline Alembic validation,
  shared typecheck, and intake/technician/provider/ops builds run in CI.
- [~] Rate-limit token actions and security-test capability links — per-token sliding-window
  `429` on confirm/review/dispute/cancel/arrival-pin shipped (reads unaffected); the in-process
  limiter is per-instance, so a DB-backed version is a post-pilot follow-up.
- [ ] Reconcile `fulfillment_policy` names across organization, channel, and job — in the provider-managed model the policy is advisory for the company's dispatcher (they see their own roster); it becomes enforced again in the org-managed self-dispatch flow.
- [ ] Incident response and production rollback runbooks. _(channel-disable / global-off rollback is documented in `docs/PILOT-OPERATIONS.md`.)_
- [ ] Evaluate standalone API extraction using measured operational need.

**Sprint 7 exit:** defined security, reliability, compliance and recovery gates
pass before expansion.

## 8. Deferred Expansion

**Marketplace & network dispatch (the widened scope beyond isolated-tenant):**

- **Public / channelless marketplace intake** (not tied to one company's channel) routed and
  dispatched by a **"ClueXP Direct" dispatcher** to **independent technicians or companies**.
  (Public/channelless intake is *disabled* today — every dispatchable request must belong to a company.)
- A **company sourcing independent technicians** beyond its own roster (network / overflow)
  when it can't cover a job.
- Policy-enforced private / overflow / open routing across the network. (Reconcile
  `fulfillment_policy` semantics first — §7.)

**Provider SaaS workforce model:** global technician identities with a historical affiliation
ledger — one technician affiliates with Company A, moves to Company B, later re-affiliates with
A without overwriting earlier records; current dispatch eligibility derives from active
affiliation rows (`status=active`, `ended_at=null`) while ended/suspended/rejected rows remain
for audit, reactivation, disputes, compliance, and performance history. Supports
W-2/exclusive vs contractor/non-exclusive relationships, dispatch permission, company-scoped
suspension/removal, reactivation history, and future subscription limits; Ops retains global
technician suspension and the managed skills catalog. _(Migrations `0016`/`0017` lay the
affiliation foundation; model in [`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) §18.3.)_

**Other deferrals:**

- Additional service verticals.
- Custom provider domains and richer channel attribution.
- Provider subscriptions and billing.
- Advanced organization-managed routing/capacity.
- Native technician app for dependable background GPS and push.
- Languages beyond EN/ES.
- Marketplace bidding remains explicitly unscheduled.

## 9. Immediate Work Order

Provider-managed dispatch (§3.4), the field-integrity core (§4), and the tenant-scoped
recovery workspace (§5) are **code-complete** and merged. Production migration head is
`0024_gs_more_tunables` (applied 2026-06-21); the workforce + company-signup +
technician-documents code is deployed (`cluexp-intake` auto-deploys on push to `main`).
Remaining work to a meaningful pilot is operational, not new code:

1. **Runtime-smoke the advisory-payment / live-tracking work:** PR #39 (merge `808f108`, tip
   commit `cfb0b4d`: technician-reported/customer-acknowledged payment, customer live tracking,
   required cancellation reasons, stale-location privacy gating) is **merged to `main` and included
   in production tip `882664f`** (verified via git ancestry 2026-06-19). Migrations through `0015`
   are applied (production is verified at `0024`). Status: **deployed, partially runtime-smoked** —
   the 2026-07-12 happy path covered advisory collection and lifecycle transitions; run a dedicated
   authenticated browser/PWA pass for live-location behavior and cancellation/error states before
   relying on those surfaces in the pilot.
2. **Confirm the kill-switch state:** verify `dispatch_cutover_global_off` via `GET /ops/flags`
   (currently `false` → cutover live for `metro-key`, the pilot channel). It is DB-backed and
   flips live via `PATCH /admin/global-settings/dispatch_cutover_global_off` — no redeploy.
3. ~~Run an authenticated end-to-end prod smoke~~ **[DONE 2026-07-12 — passed, see §3.3.]**
4. **Resolve the stale job found by the smoke test** — a real intake with no contact info
   captured, multiple days unassigned in `metro-key`'s queue (private evidence log has the
   record) — close it via the recovery workspace/`POST /admin/jobs/{id}/resolve`, and **confirm
   `NEXT_PUBLIC_DISPATCH_PHONE` is set to a real staffed number in the intake-web production
   env** (the safety-flag "Call dispatch now" screen falls back to a placeholder
   `+1 800-555-1234` if unset — unverified from this environment).
5. ~~Execute the Sprint 3.3 pilot matrix~~ **[DONE 2026-07-13 — 15/16 rows passed against
   production with the real `metro-key` demo accounts; only the 72h auto-close *timer* is
   unexecuted (the underlying state transition is proven elsewhere). Detail in
   `PILOT-OPERATIONS.md` §7.1.]** Remaining before widening: PO sign-off (`PILOT-OPERATIONS.md`
   §10), then widen channel by channel. Rollback path (`PATCH
   dispatch_cutover_global_off=true`) is itself now proven, not just documented.
6. **Sprint 4 remaining items** (Google Routes ETA, live position, shared cross-app timeline)
   and **Sprint 5 communications/notifications** follow once the pilot passes.

**Broader-launch gates (not optional follow-ups):**

1. **Dispatcher coverage and SLA:** name a primary and backup dispatcher for every enabled channel;
   approve an acknowledgement target, stalled-job escalation threshold and after-hours fallback;
   then test the new/stalled/safety alert and escalation path with evidence. Polling/manual queue
   watching is acceptable only for a time-boxed, continuously staffed internal pilot — not for
   unattended real-customer traffic.
2. **Production notifications:** deliver and monitor critical dispatcher alerts, technician offers,
   and customer tracking/status messages with consent, retry/failure visibility and a documented
   manual fallback. Provider selection remains a product/architecture decision; this gate does not
   pretend SMS/email/push exists today.
3. **Real payments:** not required for a clearly disclosed non-commercial/internal pilot that uses
   advisory collection records only. Before marketing or using a real card flow, complete the
   provider-owned Stripe Connect direct-charge paths in Sprint 6. The provider is merchant of
   record; ClueXP must not hold or settle provider funds.

**Post-pilot follow-ups (non-blocking):** DB-backed token limiter; `/healthz` DB-ping
readiness variant.

## 10. Active Decisions and Risks

- `[!]` **Dispatcher availability risk + SLA gap — CONFIRMED IN PRODUCTION 2026-07-12:** in the provider-managed model, a customer waiting in `pending_dispatch` is invisible to technicians until the **owning company's** dispatcher acts. If no dispatcher is online, jobs sit indefinitely — there is currently no escalation threshold, queue alert, or after-hours fallback. The 2026-07-12 prod smoke test found a real (non-test), multi-day-stale `metro-key` job with **zero dispatcher action** and a safety flag set, with no customer contact info captured — incident specifics are intentionally not recorded in this public repo (private evidence log only, per the safety rule below); ask the human/Claude for detail. This also surfaced that the safety-flag real-time phone escape hatch (`NEXT_PUBLIC_DISPATCH_PHONE`) needs verification that it points to a real, staffed number rather than the code default placeholder. **For the pilot:** was assumed acceptable because pilot dispatch is "dedicated and controlled" — this incident shows that assumption doesn't hold once a branded channel is live and unattended. **Before widening (now more urgent):** define acknowledgement time target, on-call expectations, an auto-escalation rule (e.g. if a job stays `pending_dispatch` > N minutes, alert), the customer-facing message for long waits, and verify the safety-flag phone escape hatch.
- `[x]` **Six operational tunables are DB-backed (`global_settings`, migrations `0023`+`0024`).**
  Each is resolved **at request time** via `api/settings.py`'s generic `resolve(store, key)` with a
  tolerant `DB → env → hardcoded` chain (~30s cache), and is runtime-editable by a `platform_admin`
  via `PATCH /admin/global-settings/{key}` (unknown key → 404; bad type/range → 422). The env vars
  are now fallback-only, not the primary control:
  - `dispatch_offer_ttl_seconds` (int 60–900, default `300`; was `90s`, sized for the old automated
    model). Resolved at offer creation; changes affect **new offers only** (existing `expires_at`
    is stamped at creation).
  - `dispatch_cutover_global_off` (boolean, default `false`) — the global dispatch kill-switch
    (§3.3); flips live with no redeploy.
  - `token_action_max` / `token_action_window_seconds` (capability-link mutation rate limit).
  - `login_max_failures` / `login_window_seconds` (login throttle).
  Note: because the resolver reads DB **before** env, a seeded DB row overrides the matching env var
  — so the legacy `DISPATCH_CUTOVER_GLOBAL_OFF` Vercel var no longer governs cutover on its own.
- `[x]` **Payment ownership decided 2026-07-13:** providers charge their own customers as merchant
  of record through provider-owned connected accounts/direct charges. ClueXP does not hold or
  settle funds; initial implementation has no application fee. Payment processing is still unbuilt,
  so closure must continue to work without pretending a charge occurred.
- `[!]` PWA notification/background-location limits mean polling is acceptable
  for pilot operations but not the final reliability standard. Technician offer notification strategy (push/SMS) is Sprint 5.
- `[!]` Organization `fulfillment_policy` semantic values differ from channel/job values and must be reconciled before org-managed self-dispatch widens. In the provider-managed pilot, policy is advisory — the company's dispatcher sees its own roster regardless.
- `[!]` **Still to decide for the pilot:** coarse ETA vs. Google Routes; offer TTL for the staffed pilot; which pilot company + roster; which checks are mandatory before real (vs. internal test) customers.
- `[!]` API extraction is deferred unless the co-located backend becomes a
  delivery, reliability or security blocker.
- `[!]` Secrets previously shared outside a secret manager must be rotated and
  verified in deployment environments.
- `[resolved]` ~~"Sprint 2B cutover" document names~~ — the cutover plan is Sprint 3; the naming is historical only.

## 11. Workstream Task Plans

> Folded in 2026-06-19 from the former `TECHNICIAN-APP-PROGRESS.md`,
> `TECHNICIAN-APP-BUILD-PLAN.md` (historical), and the provider-workforce slice plan. The
> retired `SPRINT-2B-DISPATCH.md` (superseded automatic-dispatch design) and the historical
> mock-first build plan are not reproduced — their durable outcomes are in §2–§5 and
> [`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md). Subsystem specs live in `SYSTEM-DESIGN.md`.

### 11.1 Technician app (`technician-web` PWA)

The PWA is **no longer a mock prototype** — it runs on real app-server BFF routes that forward
the signed-in technician session to the intake API.

**Live:** sign-in/up; session shell + availability control; live offers feed (`/api/offers`,
multiple offers, sorted, privacy-gated); accept/decline; active-job restoration
(`/api/active-job`); active-job workflow (arrival/PIN, service, approval, completion);
issue reporting (`cannot_complete`/`customer_unavailable`/`unsafe`); location push
(`/api/location`, 25s while en_route/arrived/in_progress); collection reporting;
finished-job history (`/activity`); global profile + photo upload/review + affiliations.
Bottom tabs: Jobs/Home · Map · Messages · Activity · Account. (Slices T1–T3, T5–T7 done.)

**Remaining:**
- [ ] **Masked job chat (T4)** — next high-priority slice: customer↔assigned-technician
  messaging through ClueXP without exposing phone numbers (then unread states). _(Ties to §5 comms.)_
- [ ] Voice/masked call — after masked chat, once a comms provider is selected.
- [ ] Production push/sound/alarm delivery strategy; native background GPS. _(§5/§8.)_
- [ ] Activity pagination/date range as volume grows; keep "collected" separate from
  provider Stripe payouts or technician compensation language until processor-backed values exist (§6).
- [ ] Keep all active-job transitions as live backend mutations — never a technician-only lifecycle.

### 11.2 Provider workforce (technician global profile + affiliation ledger)

**Backend + core UI implemented and deployed** (migrations `0016`/`0017` affiliation ledger +
history, `0018` photo status, `0019` org-status enum, `0020`/`0021` technician documents;
subsequent platform migrations bring production to `0024`). Model and schema:
[`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) §18.3 + §7.2.

**Done (slices A, B, C, D-backend/frontend, E, G):** affiliation eligibility from active
rows; add/invite with exclusivity guard (DB partial unique index); leave/rejoin history;
technician self-service accept/decline + photo upload; Ops photo review; customer security
identity (approved photo only after assignment); provider `/teams` suspend/end; company
signup/onboarding + org-status lifecycle. Technician invite links go to the technician app
signup flow (`tech.cluexp.com/signup?invite=...`), never the company/partner signup flow.
Technician global profile ownership stays with the technician: providers can view affiliated
technicians and manage only their own affiliation relationship, not global profile fields,
skills, documents, or vetting.

**Affiliation flow (confirmed in code):** technician acceptance activates the affiliation with
**no provider re-approval**; the provider can **revoke** a pending invite before acceptance
(`…/affiliation/end` on the open `pending_invite` period), **suspend**, or **unaffiliate** later —
all scoped to the provider's own affiliation period (never global status).

**Done (slices A, B, C, D-backend/frontend, E, G, + team management):** affiliation eligibility
from active rows; add/invite with exclusivity guard; leave/rejoin history; technician self-service
accept/decline + photo upload; Ops photo review; customer security identity. **Team management
complete** — `POST/DELETE /provider/teams/{id}/technicians` add/remove already-affiliated
technicians, `DELETE /provider/teams/{id}` safe-delete (refused with sub-teams), with provider-web
membership UI. **Read-only provider technician detail** (`GET /provider/technicians/{id}`) surfaces
team memberships, **company + global review summaries**, and compliance documents. Skills use one
shared `SkillSelect` (technician signup/profile only; provider surfaces are read-only via `skillLabel`).

**Remaining (polish / deferred):**
- [ ] Ops **suspend/reactivate UI** in ops-web (backend endpoints exist; `/approvals` only covers pending approve/reject).
- [ ] Per-review **detail rows** (individual customer comments) — only company/global review
  **summaries** (count + average) are surfaced today; the comment-level contract is a follow-up.
- [ ] Team **hierarchy editing** (reparent/move sub-teams) and per-membership **roles** UI beyond add/remove.
- [ ] Deferred (post-MVP): full Ops-managed skill catalog (currently a shared frontend `SKILL_CATALOG`
  mirrored by a backend allowlist — keep in lockstep until Ops owns it);
  provider subscription limits (max technicians/seats); company document approval +
  suspension-reason taxonomy; invite-acceptance notifications.
