# ClueXP Execution Plan

> **Verified/reconciled:** 2026-06-07
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
| Dispatch engine | `[x]` | Deterministic ranking, policy-aware offers, expiry/re-dispatch, atomic first-accept-wins |
| Customer dispatch tracking | `[x]` read contract | Waiting/matched/no-eligible/retry/error; safe assignment only after acceptance |
| Live customer cutover | `[ ]` | Existing customer flow still retains the legacy instant-match rollback path |
| Fulfillment lifecycle | `[ ]` production | En route, arrived, in progress, complete, confirm, dispute and close contracts not yet live |
| Payments | `[ ]` | Deferred; current charge/finalize/review behavior is demo-only |
| Notifications | `[ ]` | No production SMS/email/push delivery |
| CI | `[~]` | Existing workflow runs web/API checks; Python pytest gate still needs to be confirmed/added on `main` |

Current production migration head: **`0009`**. The approved fulfillment cutover
expects additive migration **`0010`**.

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

> **Built + tested locally, NOT yet deployed** (branch
> `feat/sprint3-fulfillment-cutover-backend@f51d03c`; 28 pytest pass, all flags
> default-OFF). Prod apply of `0010` + deploy + smoke remain — blocked on push/DB
> credentials from the current environment (see HANDOFF 2026-06-09). Exact
> endpoint contracts are posted in `docs/HANDOFF.md` for qwen.

- [~] Add migration `0010` (written, not applied to prod):
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
- [x] Keep the legacy `/dispatch` route as rollback during the pilot (untouched).
- [!] Isolate demo `/charge`, `/finalize`, and `/review` from the real path —
  deferred: the cutover create path never invokes them (the legacy stub does);
  hard removal/gating tracked as cleanup before widening.

### 3.2 Customer and technician application integration

- [ ] Return and persist the token tracking link after cutover-enabled intake.
- [ ] Extend customer tracking from waiting/matched through:
  active status, completion confirmation, review, dispute and closed states.
- [ ] Connect technician active-job state restoration to the assigned real job.
- [ ] Connect primary technician actions to real forward status mutations.
- [ ] Implement production loading, stale-session, unauthorized, conflict,
  offline/retry and terminal states.
- [ ] Keep customer and technician localization complete for every new state.
- [ ] Remove mock completion controls from the cutover-enabled real path.

### 3.3 Pilot and acceptance

- [ ] Keep every channel flag off after backend/frontend deployment.
- [ ] Enable one controlled pilot channel.
- [ ] Prove all policy paths: private owner, owner-first overflow and network-open.
- [ ] Prove no eligible technician, offer expiry/re-dispatch and max-attempt handoff.
- [ ] Prove no duplicate offers from customer polling.
- [ ] Prove first-accept-wins and safe matched hydration.
- [ ] Prove technician status progression and audit timestamps.
- [ ] Prove customer confirm, review and dispute.
- [ ] Prove dispatcher resolution and 72-hour automatic close.
- [ ] Prove cross-tenant review/job isolation.
- [ ] Disable the pilot flag and verify instant rollback for new requests.
- [ ] Widen channel-by-channel only after the matrix passes.

**Sprint 3 exit:** a pilot request reaches a real named technician and ends in
`completed_confirmed`, `completed_auto_closed`, or dispatcher-resolved closure,
with no demo endpoint in the path.

## 4. Sprint 4 - Field Fulfillment Integrity

**Priority:** P1
**Goal:** make route, arrival and field execution truthful and recoverable.

- [ ] Traffic-aware backend ETA through Google Routes.
- [ ] Customer-safe technician location polling with freshness/accuracy.
- [ ] Durable active-job read model and session restoration.
- [ ] Shared audited job timeline used by all four apps.
- [ ] Mutual arrival PIN/QR generation and verification.
- [ ] Dispatcher arrival override with mandatory reason.
- [ ] Cancellation and no-show state rules.
- [ ] Technician decline reason persistence.
- [ ] Customer cancellation and technician-failure handoff paths.
- [ ] Replace demo maps/movement and active-job data on production paths.

**Sprint 4 exit:** customer, technician and dispatcher see consistent route,
arrival and work states sourced from the same backend events.

## 5. Sprint 5 - Human Operations and Communications

**Priority:** P1
**Goal:** operators can manage exceptions without database intervention.

- [ ] Wire ops live queue, job detail, board, audit and escalation views to real data.
- [ ] Wire provider queue, assignment, active jobs and tenant-scoped audit to real data.
- [ ] Reassignment, cancellation, escalation ownership, internal notes and resolution.
- [ ] Tenant-safe customer, technician and provider communication threads.
- [ ] Masked call or mediated contact path.
- [ ] SMS/email delivery of the customer token link and critical updates.
- [ ] Reliable technician offer notification strategy with polling fallback.
- [ ] Operational filters for stalled, expiring, safety, disputed and no-response jobs.

**Sprint 5 exit:** an authorized operator can observe and resolve every supported
failure path through the UI, with an audit event for each action.

## 6. Sprint 6 - Payments and Settlement

**Priority:** P2, after lifecycle stability
**Goal:** turn completed service into a safe, reconcilable financial transaction.

- [!] Decide merchant-of-record, platform fee, provider settlement and independent
  technician payout policy.
- [ ] Stripe payment-method capture and authorization hold.
- [ ] Restore payment precondition at the correct commercial boundary.
- [ ] Final-scope/price proposal and explicit over-estimate customer approval.
- [ ] Idempotent capture, release, cancellation/no-show fee and refund flows.
- [ ] Dispute linkage without conflating payment dispute and service issue.
- [ ] Provider/technician settlement ledger and customer receipt.
- [ ] Replace demo earnings and payment history with ledger-backed values.

**Sprint 6 exit:** happy-path and failure-path money movement reconcile against a
job, payment intent, settlement record and audit trail.

## 7. Sprint 7 - Production Hardening and Scale

**Priority:** P2

- [ ] Enforce compliance document validity in technician/organization eligibility.
- [ ] Jurisdiction-specific licensing and insurance rules.
- [ ] Customer phone verification and returning-customer history policy.
- [ ] PII/media retention and deletion audit.
- [ ] Event archival and backup restore drills.
- [ ] Sentry/error tracking, health endpoint, uptime checks and alerting.
- [ ] Add/confirm Python pytest in CI and build/typecheck all four apps.
- [ ] Rate-limit token actions and security-test capability links.
- [ ] Reconcile organization/channel/job fulfillment-policy names.
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

1. Claude/backend owner posts migration `0010` and exact endpoint contracts.
2. Backend deploys with every channel flag off.
3. Codex/application owner connects intake and technician fulfillment UI.
4. Automated tests and four-app builds pass.
5. One channel is enabled for scripted end-to-end pilot.
6. Failures are fixed before any broader cutover.

## 10. Active Decisions and Risks

- `[!]` Existing document names still say "Sprint 2B cutover"; do not interpret
  that as unfinished 2B. It is the detailed design input for Sprint 3.
- `[!]` Payments are intentionally outside the first complete operational cycle;
  closure must work without pretending a payment occurred.
- `[!]` PWA notification/background-location limits mean polling is acceptable
  for pilot operations but not the final reliability standard.
- `[!]` Organization `fulfillment_policy` semantic values differ from channel/job
  values and must be reconciled before org defaults drive dispatch.
- `[!]` API extraction is deferred unless the co-located backend becomes a
  delivery, reliability or security blocker.
- `[!]` Secrets previously shared outside a secret manager must be rotated and
  verified in deployment environments.
