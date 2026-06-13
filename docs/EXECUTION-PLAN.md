# ClueXP Execution Plan

> **Verified/reconciled:** 2026-06-11
> **Primary objective:** complete and prove the production business cycle:
> request -> dispatch -> accept -> fulfill -> customer confirm/review or dispute
> -> resolve/close.
>
> Legend: `[x]` complete/live, `[~]` partial or in progress, `[ ]` planned,
> `[!]` decision/risk. Production database changes and release flips remain
> explicitly controlled.

## 1. Canonical Status

| Capability | State | Notes |
|---|---|---|
| Intake app | `[x]` | Live on `intake.cluexp.com` and currently also `www.cluexp.com` |
| Technician app | `[x]` shell / `[~]` operations | Live PWA; auth, offer feed, acceptance, availability and location are real; active fulfillment remains mostly mock-driven |
| Provider app | `[~]` | Auth, organization workspace, teams, technicians and document submission are real; dispatch operations are mostly mock-driven |
| Ops app | `[~]` | Auth, registration approval and compliance review are real; live queue/dispatch/escalation operations are mostly mock-driven |
| Authentication | `[x]` | First-party FastAPI/Postgres auth with JWT bridged through same-site httpOnly cookies; Clerk is not planned |
| Localization | `[x]` foundation | EN/ES, English fallback; intake uses browser preference first plus explicit toggle; authenticated apps persist user preference |
| Multi-tenancy | `[x]` | Trusted channel resolution; origin/customer-owner/fulfillment model; tenant-aware onboarding |
| Dispatch engine | `[~]` | Pure functions (ranking, distance) live; ops-controlled model (§3.4) replaces auto-dispatch — backend/UI wiring in progress |
| Customer dispatch tracking | `[x]` read contract | Customer sees: `waiting` (in ops queue or offer active), `matched` (accepted), `expired_retry` (offer lapsed, back in queue), `cancelled`; `no_eligible` terminal state no longer auto-triggered — requires manual ops closure |
| Live customer cutover | `[~]` | All §3.2 items complete; `metro-key` channel live (`dispatch_cutover_enabled=true`); pilot smoke test pending |
| Fulfillment lifecycle | `[x]` | Full lifecycle wired end-to-end: intake→token→tracking→technician→confirm/review/dispute/close. All error states + EN/ES complete (`87f6c4e`/`8ba6b62`) |
| Payments | `[ ]` | Deferred; current charge/finalize/review behavior is demo-only |
| Notifications | `[ ]` | No production SMS/email/push delivery |
| CI | `[x]` | Green on `2f3f334`; latest push `8ba6b62` (fix /api prefix on token actions) |

Current production migration head: **`0010`** (applied 2026-06-09).

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

- ADR 0004 origin/customer-owner/fulfillment model.
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
**Detailed design:** `docs/SPRINT-2B-CUTOVER-PLAN.md` (historical filename;
this execution plan treats it as Sprint 3).

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
- [x] ~~Keep the legacy `/dispatch` route as rollback during the pilot (untouched).~~ **[Superseded by Sprint 3.4]** The rollback mechanism is now `DISPATCH_CUTOVER_GLOBAL_OFF=true` (env var flip, no code path needed). The `/dispatch` stub will be gated/removed in §3.4.
- [!] Isolate demo `/charge`, `/finalize`, and `/review` from the real path —
  deferred: the cutover create path never invokes them (the legacy stub does);
  hard removal/gating tracked as cleanup before widening.

### 3.2 Customer and technician application integration

- [x] Return and persist the token tracking link after cutover-enabled intake.
  _(`router.push(committed.tracking_path)` if backend returns tracking_path; legacy path retained as fallback. `2f3f334`.)_
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

**PO decisions (2026-06-10):** ~~dispatch stays fully automatic (no human-in-loop
ops step)~~ — **REVERSED 2026-06-13: dispatch is exclusively ops-controlled (see §3.4).**
The customer search window stays backend-owned with no customer-facing countdown.

**PO scope additions (2026-06-10) — pre-pilot:**

- [x] Backend: customer cancel `POST /api/t/{token}/cancel` — allowed from
  `pending_dispatch` through `en_route`, rejected (409) from `arrived` onward;
  optional reason persisted; atomically revokes outstanding offers (no
  accept-after-cancel race); the assigned technician sees the job as cancelled.
  Exposed to the UI via `customer_actions.can_cancel` on the token read.
  _(Committed `032cf98`; 34 tests pass.)_
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

- [ ] **Before Sprint 3.4 development begins:** set `DISPATCH_CUTOVER_GLOBAL_OFF=true` in Vercel and redeploy. Reason: `metro-key` already has `dispatch_cutover_enabled=true` in prod, so the old auto-dispatch code path is still firing for new intake requests. The kill switch halts it without a DB change. Leave `metro-key` channel flag as-is — it will be the pilot channel once the new model is deployed.
- [ ] After Sprint 3.4 is live and smoke-tested: remove `DISPATCH_CUTOVER_GLOBAL_OFF` (or set `false`) to re-enable the cutover path with the new ops-controlled model.
- [ ] Prove all policy paths: private owner, owner-first overflow and network-open.
- [ ] ~~Prove no eligible technician, offer expiry/re-dispatch and max-attempt handoff~~ — **model changed (§3.4): re-dispatch is manual; expiry returns job to ops queue.**
- [ ] Prove no duplicate offers from customer polling.
- [ ] Prove first-accept-wins and safe matched hydration (single targeted offer).
- [ ] Prove technician status progression and audit timestamps.
- [ ] Prove customer confirm, review and dispute.
- [ ] Prove dispatcher resolution and 72-hour automatic close.
- [ ] Prove cross-tenant review/job isolation.
- [ ] Disable the pilot flag and verify instant rollback for new requests.
- [ ] Widen channel-by-channel only after the matrix passes.

**Sprint 3 exit:** a pilot request reaches a real named technician — assigned by an
ops dispatcher through the live ops queue — and ends in `completed_confirmed`,
`completed_auto_closed`, or dispatcher-resolved closure, with no demo endpoint in the path.

### 3.4 Ops-Controlled Dispatch

**Priority:** P0 — prerequisite for a meaningful pilot (§3.3 proves the wrong model without this)
**Decision date:** 2026-06-13
**Design:** `~/.claude/plans/fuzzy-waddling-wind.md`

Dispatching is exclusively a human action. The system orders the candidate list (nearest-first for convenience) and displays advisory signals, but never independently selects, scores for auto-assignment, or re-dispatches. All auto-offer creation and the cron re-dispatch loop are removed. The cron sweep runs cleanup only (offer expiry, auto-close).

**Authorization scope:** `/ops/` endpoints are for ClueXP internal dispatchers (`dispatcher` / `platform_admin` role on `ops-web`). They see all active+verified technicians across the network. Provider dispatchers use `provider-web` with org-scoped access and separate endpoints (Sprint 5). These two surfaces must never share a bundle or auth domain (ADR-0003).

**Eligibility signals are advisory for the pilot.** The candidates view shows `is_online`, `is_busy`, `skills_match`, and `dist_km` as information — not as hard gates. Dispatchers exercise judgment. Compliance doc enforcement (expired licenses, etc.) is a Sprint 7 gate. For the pilot (3 seeded, fully-verified techs), this is sufficient.

**Step 0 — Halt auto-dispatch before any code change:**
- [ ] Set `DISPATCH_CUTOVER_GLOBAL_OFF=true` in Vercel → redeploy intake-web. This is a prerequisite — `metro-key` is currently live with the old auto-dispatch code path still running.

**Backend:**
- [ ] Remove `_dispatch_write()` call from ticket creation; job enters `pending_dispatch` without offers.
- [ ] Remove auto re-dispatch loop from `/cron/dispatch-sweep`; keep `expire_stale_offers` and `auto_close_pending`.
- [ ] On offer expiry or decline: if no active offers remain, flip job status back to `pending_dispatch`.
- [ ] Gate/remove unauthenticated legacy `POST /tickets/{id}/dispatch` stub (tech_stub_247).
- [ ] Gate/remove unauthenticated `POST /tickets/{id}/offers` endpoint.
- [ ] Migration `0011`: partial unique index on `dispatch_offers (job_id) WHERE status='offered'` to enforce single active offer per job at DB level.
- [ ] Add `LOCATION_ONLINE_THRESHOLD_MINUTES` config (default 15); used to compute `is_online` signal per tech.
- [ ] New store methods: `get_ops_queue()`, `list_all_technicians_for_ops()`, `get_fleet_state()`.
- [ ] `GET /ops/queue` — all `pending_dispatch` jobs in arrival order (auth: dispatcher/platform_admin). **Jobs with an active offer (status='offered') are included** but returned with `offer_active: true`, `offer_expires_at`, and `offered_technician_id` so the queue UI can show an "Offer sent" badge and countdown. `POST /ops/queue/{id}/assign` returns 409 while an offer is active — the partial unique index enforces this at DB level. When the offer expires, `offer_active` becomes false and the Assign button re-enables.
- [ ] `GET /ops/queue/{job_id}/candidates` — all active+verified techs with dist_km, ETA, is_online, is_busy, active_job, skills_match (no area filter, no scoring).
- [ ] `POST /ops/queue/{job_id}/assign` — single targeted offer to chosen tech; audit-logged with actor id.
- [ ] `GET /ops/fleet` — all techs + active job data for the fleet map.

**Ops console UI:**
- [ ] Ops queue screen (replaces Live Queue at `/queue`): jobs in arrival order, click → candidates view.
- [ ] Candidates view wired to live `/ops/queue/{id}/candidates`: tech list with online/busy/distance/ETA/skill-match signals; assign button per tech.
- [ ] Replace static `MapCard` in candidates view with real `GoogleMapView` (job pin + tech dots).
- [ ] Move `GoogleMapView` from `apps/technician-web` into `packages/console-ui` as shared component.
- [ ] Extend `GoogleMapView`: per-pair connectors (tech↔job) and `onMarkerClick` callback.
- [ ] Fleet map screen at `/map` (replaces MapOperations mock): all tech dots + active job pins with connectors; click/hover shows combined tech+job info card.

**Tests and docs:**
- [ ] `test_dispatch.py`: ticket creation no longer creates offers; cron no longer re-dispatches; ops endpoints correct; decline/expiry returns job to queue.
- [x] `SYSTEM-DESIGN.md`: update dispatch section. _(Done 2026-06-13)_

## 4. Sprint 4 - Field Fulfillment Integrity

**Priority:** P1
**Goal:** make route, arrival and field execution truthful and recoverable.

Note: the candidates view in Sprint 3.4 shows a straight-line coarse ETA (`eta_range_from_km`). Real routing ETA is a Sprint 4 concern.

- [ ] Traffic-aware backend ETA through Google Routes API.
- [ ] Customer-safe technician location polling with freshness/accuracy (replace coarse estimate with live position).
- [ ] Durable active-job read model and session restoration.
- [ ] Shared audited job timeline used by all four apps.
- [ ] Mutual arrival PIN/QR generation and verification.
- [ ] Dispatcher arrival override with mandatory reason.
- [ ] Cancellation and no-show state rules.
- [ ] Technician decline reason persistence (stored on the offer row).
- [ ] Customer cancellation and technician-failure handoff paths.
- [ ] Replace demo maps/movement and active-job data on production paths.

**Sprint 4 exit:** customer, technician and dispatcher see consistent route,
arrival and work states sourced from the same backend events.

## 5. Sprint 5 - Human Operations and Communications

**Priority:** P1
**Goal:** operators can manage exceptions without database intervention.

Note: Sprint 3.4 wires the ops **dispatch queue** (pending_dispatch → assign → offer) and fleet map. Sprint 5 completes the remaining ops and provider surfaces.

- [ ] Wire ops job detail, dispatch board, escalation queue and audit log to real data.
- [ ] Wire provider queue, assignment, active jobs and tenant-scoped audit to real data.
- [ ] Reassignment (dispatcher recalls offer and assigns new tech), cancellation, escalation ownership, internal notes and resolution.
- [ ] Operational filters for stalled, expiring, safety, disputed and no-response jobs across queue and board.
- [ ] Tenant-safe customer, technician and provider communication threads.
- [ ] Masked call or mediated contact path.
- [ ] SMS/email delivery of the customer token link and critical status updates.
- [ ] Reliable technician offer notification strategy (push/SMS) with polling fallback.

**Sprint 5 exit:** an authorized operator can observe and resolve every supported
failure path through the UI, with an audit event for each action.

## 6. Sprint 6 - Payments and Settlement

**Priority:** P2, after lifecycle stability
**Goal:** turn completed service into a safe, reconcilable financial transaction.

Three distinct payment events — keep them separate:

1. **Payment method capture** — at price-consent commit. Customer provides card; authorization hold placed.
2. **Final capture** — at `completed_confirmed` (customer closes the job). The hold converts to a charge.
3. **Cancellation / no-show** — releases hold or charges the cancellation fee depending on when cancelled.

No payment model changes from the dispatch pivot. The trigger for final capture is `completed_confirmed`, not dispatcher assignment.

- [!] Decide merchant-of-record, platform fee, provider settlement and independent
  technician payout policy.
- [ ] Stripe payment-method collection and authorization hold at price-consent commit.
- [ ] Final capture at `completed_confirmed`; separate cancellation-fee capture for no-show/late-cancel.
- [ ] Final-scope/price proposal and explicit over-estimate customer approval.
- [ ] Idempotent capture, release, cancellation/no-show fee and refund flows.
- [ ] Dispute linkage without conflating payment dispute and service issue.
- [ ] Provider/technician settlement ledger and customer receipt.
- [ ] Replace demo earnings and payment history with ledger-backed values.

**Sprint 6 exit:** happy-path and failure-path money movement reconcile against a
job, payment intent, settlement record and audit trail.

## 7. Sprint 7 - Production Hardening and Scale

**Priority:** P2

- [ ] Enforce compliance document validity in technician/organization eligibility (feeds the ops candidates view — expired docs surface as an `ineligible` signal for the dispatcher).
- [ ] Jurisdiction-specific licensing and insurance rules.
- [ ] Customer phone verification and returning-customer history policy.
- [ ] PII/media retention and deletion audit.
- [ ] Event archival and backup restore drills.
- [ ] Sentry/error tracking, health endpoint, uptime checks and alerting.
- [ ] Add/confirm Python pytest in CI and build/typecheck all four apps.
- [ ] Rate-limit token actions and security-test capability links.
- [ ] Reconcile `fulfillment_policy` names across organization, channel, and job — in the ops-controlled model the policy is advisory for the ClueXP dispatcher (they see all techs); it becomes enforced again in the org-managed flow where the provider system self-dispatches.
- [ ] Incident response and production rollback runbooks.
- [ ] Evaluate standalone API extraction using measured operational need.

**Sprint 7 exit:** defined security, reliability, compliance and recovery gates
pass before expansion.

## 8. Deferred Expansion

- Additional service verticals.
- Custom provider domains and richer channel attribution.
- Provider subscriptions and billing.
- Advanced organization-managed routing/capacity.
- Native technician app for dependable background GPS and push.
- Languages beyond EN/ES.
- Marketplace bidding remains explicitly unscheduled.

## 9. Immediate Work Order

Sprint 3 backend + technician UI is live (migration `0010`, PR #16, tracking/status wiring complete). The next gate is Sprint 3.4 (ops-controlled dispatch) before the Sprint 3.3 pilot can run meaningfully.

1. **Sprint 3.4 — backend** (Claude/backend owner):
   - Migration `0011`: partial unique index on `dispatch_offers (job_id) WHERE status='offered'`
   - Remove `_dispatch_write()` call from ticket creation; return-to-queue on expiry/decline
   - Remove auto re-dispatch loop from `/cron/dispatch-sweep`
   - Gate legacy `/tickets/{id}/dispatch` and `/tickets/{id}/offers` endpoints
   - New store methods + `/ops/queue`, `/ops/queue/{id}/candidates`, `/ops/queue/{id}/assign`, `/ops/fleet` endpoints
2. **Sprint 3.4 — ops console UI** (Codex/qwen):
   - Ops queue screen replacing Live Queue at `/queue`
   - Candidates view wired to live API; `Assign` button per tech
   - `GoogleMapView` moved to `packages/console-ui`; fleet map at `/map`
3. **Sprint 3.3 — pilot** (after ops console live):
   - Enable `metro-key` channel; dispatcher-in-the-loop acceptance matrix
   - Fix failures; then widen channel by channel
4. **Sprint 4** begins after the pilot passes.

## 10. Active Decisions and Risks

- `[!]` **Ops availability risk + SLA gap:** in the ops-controlled model, a customer waiting in `pending_dispatch` is invisible to technicians until a dispatcher acts. If no dispatcher is online, jobs sit indefinitely — there is currently no escalation threshold, queue alert, or after-hours fallback. **For the pilot:** acceptable because dispatch is Avery Knox (dedicated, controlled); no customer SLA is advertised. **Before widening:** define acknowledgement time target, on-call rotation, auto-escalation rule (e.g. if job stays `pending_dispatch` > N minutes, send an alert), and the customer-facing message for long waits.
- `[!]` **Offer TTL for ops model:** the current `OFFER_TTL_SECONDS = 90s` was sized for an automated system. A dispatcher-assigned offer may need a longer TTL if the tech can't be expected to respond immediately. Review before pilot.
- `[!]` Payments are intentionally outside the first complete operational cycle;
  closure must work without pretending a payment occurred.
- `[!]` PWA notification/background-location limits mean polling is acceptable
  for pilot operations but not the final reliability standard. Technician offer notification strategy (push/SMS) is Sprint 5.
- `[!]` Organization `fulfillment_policy` semantic values differ from channel/job values and must be reconciled before org-managed dispatch (provider-web) is live. In the ClueXP ops console, policy is advisory — the dispatcher sees all techs regardless.
- `[!]` API extraction is deferred unless the co-located backend becomes a
  delivery, reliability or security blocker.
- `[!]` Secrets previously shared outside a secret manager must be rotated and
  verified in deployment environments.
- `[resolved]` ~~"Sprint 2B cutover" document names~~ — the cutover plan is Sprint 3; the naming is historical only.
