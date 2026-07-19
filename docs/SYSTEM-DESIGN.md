# ClueXP — System Design Reference

> **Who this is for:** Engineers, on-call humans, and AI agents working in this codebase.
> It is a living document — update it when the system changes.
> Last updated: 2026-06-19 — folded in the database/storage reference, DevOps/CI, the four
> **subsystem specs** (§18), and the **architecture decisions** (§20, formerly `docs/adr/`).
> Dispatch model is **provider-managed** (the earlier "ops-controlled" framing was superseded).
>
> **Companion docs:** [`EXECUTION-PLAN.md`](EXECUTION-PLAN.md) (backlog/sprints/tasks + current
> status) · [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) (UI Guide) · [`PILOT-OPERATIONS.md`](PILOT-OPERATIONS.md)
> (pilot runbook) · [`HANDOFF.md`](HANDOFF.md) (agent channel).

## Contents

1. What ClueXP Is · 2. The Two-Track State Model · 3. Intake Flow · 4. Dispatch Engine
(Provider-Managed) · 5. Fulfillment — Technician Lifecycle · 6. Customer Tracking Page ·
7. Database · 8. Infrastructure & Deployment · 9. Environment Variables · 10. Auth ·
11. Storage · 12. Packages · 13. Complete API Endpoint Reference · 14. Pilot Techs ·
15. Key Invariants · 16. Common Failure Modes · 17. File Quick-Reference · **18. Subsystems**
(18.1 intake · 18.2 technician · 18.3 partner/provider · 18.4 ops) · **19. DevOps & CI** ·
**20. Architecture Decisions** (ADR-1…ADR-4).

---

## 1. What ClueXP Is

ClueXP is a **SaaS dispatch platform for provider companies** — it does **not** dispatch. A customer (car locked out, home lockout, broken key) submits a job via a provider company's branded intake link. The job enters **that company's** dispatch queue as `pending_dispatch`. The **company's own dispatcher** reviews the job, selects one of **its own** affiliated technicians, and sends a single targeted assignment offer. Once the technician accepts, the system drives the full service lifecycle — from the technician arriving on-site through the customer confirming the work is done.

**Isolated tenancy:** a company sees and dispatches only its own jobs and its own technicians — no cross-tenant visibility. ClueXP Ops (`/ops/*`) is **read-only** dispatch oversight plus user/resource administration; there is no platform assign mutation. (A future "ClueXP Direct" routing/marketplace surface — dispatching independent technicians — is deferred; see [`docs/EXECUTION-PLAN.md`](EXECUTION-PLAN.md) §8.)

There are four apps and one FastAPI backend in this monorepo:

| App | URL | Who uses it |
|-----|-----|-------------|
| `intake-web` | `intake.cluexp.com` | Customers submitting jobs (also hosts the FastAPI backend) |
| `technician-web` | `tech.cluexp.com` | Field technicians — accepts offers, navigates, updates job status |
| `ops-web` | `ops.cluexp.com` | ClueXP internal ops — read-only dispatch oversight, approvals, compliance, escalations (does **not** dispatch) |
| `provider-web` | `provider.cluexp.com` | Service provider orgs — **dispatch + recovery**, manage technicians, teams, documents |

---

## 2. The Two-Track State Model

This is the most important concept in the whole system. A job has **two orthogonal state fields** that must never be confused:

### `trust_state` — the privacy gate
Controls what the customer is allowed to see. Defined in `schema.py`.

| Value | Meaning |
|-------|---------|
| `intake` | Job is being collected; no technician committed. Customer sees a loading/waiting screen. |
| `matched` | A named technician has accepted. Customer may see technician identity (name/photo/rating). |
| `fulfillment` | Completion/closeout phase — set when the customer confirms (or the job auto-closes). |

`trust_state` only ever moves **forward**: `intake → matched → fulfillment`. It never goes backward. It is set by the backend — never trusted from the browser.

**`trust_state` gates customer-visible _identity_, not live tracking.** `matched` reveals the named
technician; `fulfillment` marks closeout (it is set at customer confirmation / auto-close, **not**
when the technician goes en route). Live technician **position** is gated separately by
`jobs.status` via `may_show_live_tracking(status)` — true only for `en_route` / `arrived` /
`in_progress` (§6). Do **not** describe `trust_state = fulfillment` as the live-tracking gate.

### `jobs.status` — the operational lifecycle
Tracks where the job is in its physical lifecycle. This is the Sprint 3 cutover addition (only populated for cutover-path jobs; non-cutover/non-dispatched jobs leave this as `draft`).

```
pending_dispatch → assigned → en_route → arrived → in_progress
                                                          ↓
                                             completed_pending_customer
                                                          ↓
                                  completed_confirmed  |  completed_auto_closed
                                                          ↓
                                       disputed  |  cancelled  |  no_show
```

Key rule: **`completed_confirmed` can ONLY be set by the customer** (via their tracking link). Technicians may set `en_route`, `arrived`, `in_progress`, `completed_pending_customer`. Nothing else. The API enforces this with a 403 hard error.

These are the canonical status constants in `dispatch.py`:
```python
STATUS_PENDING_DISPATCH = "pending_dispatch"
STATUS_ASSIGNED         = "assigned"
STATUS_EN_ROUTE         = "en_route"
STATUS_ARRIVED          = "arrived"
STATUS_IN_PROGRESS      = "in_progress"
STATUS_COMPLETED_PENDING = "completed_pending_customer"
STATUS_COMPLETED_CONFIRMED = "completed_confirmed"
STATUS_COMPLETED_AUTO_CLOSED = "completed_auto_closed"
STATUS_DISPUTED         = "disputed"
STATUS_CANCELLED        = "cancelled"
STATUS_NO_SHOW          = "no_show"

TECHNICIAN_SETTABLE = {en_route, arrived, in_progress, completed_pending_customer}
TERMINAL_STATUSES   = {completed_confirmed, completed_auto_closed, cancelled, no_show}
```

---

## 3. Intake Flow (Customer Journey)

### 3.1 Entry Points

**Channel-specific intake** — `intake.cluexp.com/o/{slug}` → renders `IntakeFlow` with `organizationSlug=slug`. Wires the job to that org's channel and policy. **This is the only path that dispatches** — a job must belong to a company (via a branded channel with `dispatch_cutover_enabled`) to enter the operational ladder.

**Public / channelless intake** — `intake.cluexp.com/` → renders `IntakeFlow` with no org slug. The form still works, but **channelless requests are never dispatched** (ClueXP is SaaS and does not dispatch). The legacy `DISPATCH_CUTOVER_PUBLIC` flag that once enabled public dispatch is deprecated/disabled (§9).

### 3.2 The Form (Multi-Step)
`apps/intake-web/src/app/page.tsx` — a single-page state machine with these steps:

1. **Opener** — Customer picks service type: `vehicle`, `home`, `business`, `other`
2. **Situation** — What happened: `locked_out`, `lost_key`, `broken_key`, `key_in_car`, `malfunction`, `rekey`
3. **Location** — Address entry with Google Places autocomplete (proxied through backend to keep API key off the browser); geocoded server-side to lat/lng
4. **Identity** — Name + phone
5. **Price** — Quote displayed; customer gives consent
6. **Commit** — Customer confirms; `POST /api/tickets/{id}/commit` fires

### 3.3 What Happens at Create (`POST /api/tickets`)

1. `resolve_intake_channel(slug)` — looks up the channel in `intake_channels` table. Returns org context or `null` for public intake.
2. `sanitize_client_payload(payload)` — strips all server-owned fields (trust_state, status, tech info, prices). Allows only: `access_type`, `situation`, `urgency`, `safety_flag`, `location`, `automotive`, `property`, `identity`, `additional_details`, `channel`.
3. Ticket created with `trust_state = intake`, `status = draft`.
4. **Cutover check** — fires when the job's channel has `dispatch_cutover_enabled = true` AND `DISPATCH_CUTOVER_GLOBAL_OFF` is not set. (The legacy `DISPATCH_CUTOVER_PUBLIC` channelless path is deprecated/disabled — see §9.)
5. If cutover fires:
   - `set_job_status(id, "pending_dispatch")` — job enters the owning company's dispatch queue
   - `get_tracking_token(id)` — returns the token; `tracking_path = /t/{token}` included in response
   - **No offers are created automatically.** The company's dispatcher must assign one of its own technicians via `POST /provider/queue/{job_id}/assign`.

### 3.4 What Happens at Commit (`POST /api/tickets/{id}/commit`)

- Records all form data (location, identity, price acceptance) into `jobs.detail` (JSONB)
- Geocodes address if not already geocoded (sets `lat`, `lng`)
- **Commit does not dispatch.** It only finalizes the intake record (sets the ticket lifecycle
  status, e.g. `complete`/`partial`) and returns the envelope. Dispatch is decided earlier, at
  create (§3.3) — never here.
- On the **cutover path**: the tracking token already exists, so commit returns the `tracking_path`
  and the frontend redirects to `/t/{token}`.
- On a **non-cutover path** (channelless/public, or a channel without cutover): the ticket is saved
  as a non-dispatchable intake record — it has no token and never enters the operational ladder. The
  old `/dispatch` auto-match stub is **gated (410)**; there is no instant/fake match. Such a request
  is not dispatched and would need human handoff.

---

## 4. Dispatch Engine (Provider-Managed)

**Model:** Dispatching is exclusively a human decision **made by the company that owns the request**. The system never automatically assigns a technician. When a job is committed it enters `pending_dispatch` and waits in **the owning company's** queue. That company's dispatcher (`dispatcher` / `provider_admin`, scoped to the active organization) reviews the job, selects one of **its own** affiliated technicians, and sends a single targeted offer. The technician accepts or declines. Decline or expiry returns the job to `pending_dispatch` — the dispatcher tries again.

**ClueXP does not dispatch.** The `/ops/*` queue/candidates/fleet endpoints are **read-only platform oversight** for `platform_admin`; there is intentionally no `/ops/.../assign` mutation. Everything on the dispatch path is tenant-scoped via `session.active_organization_id` — a dispatcher can never see or act on another company's jobs or technicians.

### 4.1 Where the Code Is

| File | What it contains |
|------|-----------------|
| `apps/intake-web/api/dispatch.py` | Pure functions — distance (`haversine_km`), ETA (`eta_range_from_km`), state machine helpers, status constants. No I/O. |
| `apps/intake-web/api/config.py` | Tunable constants and feature flags |
| `apps/intake-web/api/main.py` | `/provider/*` dispatch + recovery endpoints (org-scoped); read-only `/ops/*` oversight; `/cron/dispatch-sweep` (cleanup only) |
| `apps/intake-web/api/store.py` (PostgresStore) | `get_ops_queue(org_id=…)`, `list_all_technicians_for_ops(org_id=…)`, `get_fleet_state(org_id=…)`, `get_ops_technician`, `create_dispatch_offers`, `accept_dispatch_offer`, `decline_dispatch_offer`, `expire_stale_offers`, `auto_close_pending` — store methods take an optional `org_id` to scope the provider surface; the `/ops/*` oversight reads call them unscoped |

### 4.2 How a Job Gets Dispatched

#### Step 1 — Job enters the company's queue (`pending_dispatch`)
At ticket commit, `set_job_status(id, "pending_dispatch")` is called. No offers are created. The job sits in the owning company's queue until that company's dispatcher acts.

#### Step 2 — Dispatcher views the queue (`GET /provider/queue`)
Returns the org's own `pending_dispatch` jobs ordered oldest-first (`get_ops_queue(org_id=…)`). The queue read also runs lazy cleanup:
- `expire_stale_offers()` — marks any stale `offered` rows as `expired`, returns the job to `pending_dispatch` if no active offer remains
- `auto_close_pending()` — closes `completed_pending_customer` jobs past the auto-close window

(Platform oversight reads the same data unscoped via the read-only `GET /ops/queue`.)

#### Step 3 — Dispatcher views candidates (`GET /provider/queue/{job_id}/candidates`)
Returns the company's **own** `status=active` + `vetting_status=verified` technicians (eligibility derived from active affiliation rows — see §7.2). No area filter, no availability filter — the dispatcher sees its whole eligible roster. Per-tech signals computed on the fly:

| Signal | Source |
|--------|--------|
| `dist_km` | `haversine_km(job.lat, job.lng, tech.current_lat or service_area_center_lat, ...)` |
| `eta_min`, `eta_max` | `eta_range_from_km(dist_km)` |
| `is_online` | `location_updated_at > now() − LOCATION_ONLINE_THRESHOLD_MINUTES` |
| `is_busy` | `get_technician_active_job(tech.id) is not None` |
| `active_job` | `{id, status, address}` if busy, else null |
| `skills_match` | `job.access_type in tech.skills` (bool — highlighted in UI, not a filter) |

#### Step 4 — Dispatcher assigns (`POST /provider/queue/{job_id}/assign`)
Body: `{ "technician_id": UUID, "override_reason"?: str }`. Steps:
1. Resolve the active org (`_require_dispatch_org`) — 409 if the session has no organization; 403 if the caller is not `dispatcher`/`provider_admin`
2. Fetch the job from **this org's** queue — 404 if not found (no cross-tenant existence leak)
3. Reject (409) if an active `offered` offer already exists (partial unique index prevents duplicates at DB level)
4. Resolve the technician scoped to this org (`get_ops_technician(…, org_id=…)`) — 422 if not the org's active/verified technician
5. Create single targeted offer: `expires_at = now() + OFFER_TTL_SECONDS`. An override (offline/busy/stale/skill-mismatch) requires `override_reason`.
6. Write audit event with the `provider` prefix, capturing actor, technician, and any override reason
7. Return `{ offer_id, technician_id, expires_at }`

#### Step 5 — Technician accepts (`POST /offers/{id}/accept`)
1. DB check: offer must be `status=offered`
2. **Atomic first-accept-wins:** `UPDATE jobs WHERE fulfillment_technician_id IS NULL SET ...` — prevents race conditions
3. Sets `jobs.fulfillment_technician_id`, `jobs.status = assigned`, `jobs.trust_state = matched`
4. Supersedes all other open offers for this job

#### Step 6 — Decline or expiry → return to queue
- **Decline** (`POST /offers/{id}/decline`): marks offer declined; if zero `offered` offers remain for the job → `jobs.status = 'pending_dispatch'`
- **Expiry** (`expire_stale_offers()`): marks offers expired; same return-to-queue logic

### 4.3 Candidate Signals (Display Only — No Automatic Filtering)

`dispatch.py` provides two reusable pure functions. The dispatcher has full discretion.

| Function | Purpose |
|----------|---------|
| `haversine_km(lat1, lng1, lat2, lng2)` | Great-circle distance in km; `inf` if any coord missing |
| `eta_range_from_km(dist_km)` | Returns `(min, max)` estimate; ~8 min base + travel at 30 km/h |

Skills matching is shown as a highlight but is **not** a hard filter. The dispatcher may assign any of **its own** active+verified technicians regardless of area, availability toggle, or skill.

### 4.4 Cleanup-Only Cron (`POST /cron/dispatch-sweep`)

The cron endpoint no longer re-dispatches. It performs only maintenance:
```
1. expire_stale_offers() — marks all offers past expires_at as "expired"
2. auto_close_pending() — completed_pending_customer jobs older than AUTO_CLOSE_WINDOW_SECONDS → completed_auto_closed
```
The cron is also no longer strictly necessary — both operations run inline on every `GET /provider/queue` (and the read-only `GET /ops/queue`) as lazy cleanup on read. It may be retained as a safety net or removed entirely.

### 4.5 Partial Unique Index (Race Protection)

Migration 0011 adds:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_offers_job_active
  ON dispatch_offers (job_id) WHERE status = 'offered';
```
This prevents two concurrent targeted offers for the same job at the DB level — enforces the single-offer model even under concurrent dispatcher sessions.

---

## 5. Fulfillment — Technician Lifecycle

### 5.1 Job Status Flow (Technician-Driven)

After offer is accepted (`status = assigned`):

| Step | Technician action | Status after | API call |
|------|------------------|-------------|---------|
| 1 | Starts driving | `en_route` | `PATCH /api/tickets/{id}/status { status: "en_route" }` |
| 2 | Arrives on-site | `arrived` | **PIN-gated — `POST /jobs/{id}/arrival/verify { pin }`** (see §5.1a). A plain `PATCH …/status { status: "arrived" }` is **rejected with 422**. |
| 3 | Begins service | `in_progress` | `PATCH /api/tickets/{id}/status { status: "in_progress" }` |
| 4 | Work complete, awaiting customer | `completed_pending_customer` | `PATCH /api/tickets/{id}/status { status: "completed_pending_customer" }` |

Each transition writes a timestamp column (`en_route_at`, `arrived_at`, etc.) and validates forward-only movement with `can_technician_transition(current, target)`. The `en_route → arrived` step is the one exception: it is **not** reachable through the generic status PATCH — it requires arrival-PIN verification (or a dispatcher override), detailed next.

### 5.1a Arrival Verification (Gate 2 — PIN)

`en_route → arrived` requires the technician to enter a customer-held six-digit PIN. The PIN is single-use, expiring (`ARRIVAL_PIN_TTL_SECONDS`, default 15 min), and attempt-limited (`ARRIVAL_PIN_MAX_ATTEMPTS`, default 5). Only a keyed HMAC of the PIN is stored (§9). Flow:

| Step | Actor | Endpoint | Behavior |
|------|-------|----------|----------|
| Issue | Customer (tracking-token holder) | `POST /t/{token}/arrival-pin` | Returns `{ pin, expires_at }`. Available only once the job is `en_route`; issuing a new PIN invalidates any prior PIN and resets the attempt counter. |
| Verify | Assigned technician | `POST /jobs/{id}/arrival/verify { pin }` | On match, advances `en_route → arrived` and logs `arrival:pin_verified`. Failures (`no_pin` / `expired` / `locked` / `already_used` / `technician_mismatch` / `incorrect`) return 422 with the remaining-attempts count and never advance status. |
| Override | Owning company's dispatcher | `POST /provider/jobs/{id}/arrival/override { reason }` | Forces `en_route → arrived` **without** a PIN; a non-empty `reason` is mandatory (422 otherwise) and the override is audited (`arrival:provider_override`). Tenant-scoped. |

(The old `POST /tickets/{id}/arrival-handshake` is removed — it now returns 410 pointing to the two endpoints above.)

### 5.2 Completion (Customer-Driven)
The customer holds a token link (`/t/{token}`). When the tech marks `completed_pending_customer`:
- Customer tracking page shows a "Confirm" button
- Customer taps → `POST /t/{token}/confirm` → sets `status = completed_confirmed`, `trust_state = fulfillment`
- If customer doesn't confirm within `AUTO_CLOSE_WINDOW_SECONDS` (72h), cron auto-closes it to `completed_auto_closed`

### 5.2a Payment (Technician-Reported, Customer-Acknowledged)
The **technician is the single source of truth** for the payment. The customer **views and
acknowledges** it — they do not enter their own amount, and Ops never compares two values. These
are advisory records (the MVP processes no real charge).

- **Technician reports** amount + method once service is underway (`in_progress` /
  `completed_pending_customer`) via `POST /jobs/{id}/collection` (assigned-tech only). Stored as one
  `job_payment_reports` row (`reported_by='technician'`, unique on `(job_id, reported_by)`).
- **Customer views** the reported amount + method on the tracking page (`GET /t/{token}` exposes a
  read-only `payment` object) and **acknowledges it by confirming completion** (`POST /t/{token}/confirm`).
  The confirmation *is* the acknowledgment — there is no separate customer payment endpoint.
- **Method** is one of `PAYMENT_METHODS` (`api/dispatch.py`): credit_card, debit_card, cash, check,
  zelle, cash_app, apple_pay, google_pay, venmo, paypal, other. Unknown → 422.

### 5.2b Real Payment Ownership (Provider Direct Charge — Accepted 2026-07-13)

Each provider company is the **merchant of record** and charges its own customer. ClueXP is the
dispatch/workflow SaaS layer; it does not hold provider funds, create platform-owned destination
charges, settle providers, or pay technicians.

The planned card flow uses Stripe Connect **direct charges** on a provider-owned connected account
with full Stripe Dashboard access (Standard-account behavior):

- the PaymentIntent/charge and resulting balance live on the provider connected account;
- the provider pays processing fees and owns refunds, disputes, negative balances and payouts;
- ClueXP initially takes no application fee (a future software/application fee is a separate
  commercial decision);
- ClueXP stores `stripe_account_id`, onboarding capability/status fields, and the minimum
  PaymentIntent/charge/refund/dispute IDs + state needed for job correlation and webhook audit;
- ClueXP stores no raw card data and no provider secret keys;
- processor objects must always be created/read in the owning provider account context, and every
  local payment row remains tenant-scoped through the job's `customer_owner_org_id`;
- provider-owned Stripe Dashboard or Connect embedded components handle refunds/disputes, while
  ClueXP mirrors their status without conflating payment disputes with service issues.

The existing `job_payment_reports` record remains advisory until this direct-charge ledger is
implemented. It is not proof that money moved.

### 5.2c Finished-Job History
History covers `HISTORY_STATUSES` (`api/dispatch.py`): `completed_pending_customer` (so a job the
tech just finished shows **immediately**, before the customer confirms) plus the terminal states
`completed_confirmed`, `completed_auto_closed`, `cancelled`, `no_show`. (`disputed` stays in the
live recovery workspace, not history.) Endpoints return jobs enriched with the customer review and
the technician's reported payment:
- `GET /provider/jobs/history` — tenant-scoped; backs the provider **Completed** view (totals
  **reported collected** (the technician-reported advisory amount) + a job count; no two-value
  comparison). These are advisory operational records, **not** ledger-backed earnings or payout.
- `GET /technician/jobs/history` — the signed-in technician's finished jobs; backs the technician
  **Activity** view (with a **Total reported collected** summary — advisory, not a payout/settlement total).

### 5.3 Where Technician App Code Lives

All pages are Next.js App Router server/client components in `apps/technician-web/src/app/`:

| Page | File | What it does |
|------|------|-------------|
| Jobs dashboard | `jobs/page.tsx` | Shows active job card or "Standing by" offer feed |
| Job detail | `jobs/[id]/page.tsx` | Fetches active job via BFF, shows address/situation/status |
| Arrival | `jobs/[id]/arrival/page.tsx` | Confirms arrival, calls `PATCH status → arrived` |
| Service | `jobs/[id]/service/page.tsx` | En route → arrived → in_progress → completed_pending flow |
| Approval | `jobs/[id]/approval/page.tsx` | Waiting screen — customer confirms externally |
| Complete | `jobs/[id]/complete/page.tsx` | Summary screen after confirmed |
| Activity | `activity/page.tsx` | Finished-job history: reported collected + customer review + total reported collected (advisory) |

The in-service screen (`components/active-job-workflow.tsx`) also carries the **"Payment collected"**
form (amount + method → `POST /api/jobs/{id}/collection`) while the job is `in_progress` / `completed_pending_customer`,
and pushes the technician's **location every 25s** while the job is `en_route` / `arrived` / `in_progress`
so the customer's live map and the dispatcher's fleet map follow real movement.

**BFF API routes** (Next.js serverless, in `src/app/api/`):
- `GET /api/session` → proxies `GET /api/auth/me` (reads httpOnly cookie `cluexp_access_token`)
- `GET /api/offers` → proxies `GET /api/technicians/{id}/offers`
- `POST /api/offers/{id}/accept` → proxies to backend
- `POST /api/offers/{id}/decline` → proxies to backend
- `GET /api/active-job` → calls `/api/auth/me` then `/api/technicians/{id}/active-job`
- `GET /api/jobs/{id}` → validates caller owns the active job, returns job detail
- `POST /api/jobs/{id}/collection` → proxies the technician collection report
- `GET /api/jobs/history` → proxies `GET /api/technician/jobs/history`
- `PATCH /api/availability` → proxies `PATCH /api/technicians/me/availability`

---

## 6. Customer Tracking Page

`apps/intake-web/src/app/t/[token]/page.tsx` — rendered when cutover is active.

**Token resolution:**
- `GET /api/t/{token}` → resolves `tracking_token` column in `jobs` table → returns full tracking state
- Token is set at job creation time, stored in `jobs.tracking_token` (unique index)
- Customer never sees the job UUID — only the opaque token

**Live map (`components/tracking-map.tsx`):** while the job is `en_route` / `arrived` / `in_progress`,
the tracking read exposes the assigned technician's coarse **`assignment.live_lat/live_lng`** plus the
customer's own **`destination`**, and the page plots both with Google Maps (`NEXT_PUBLIC_MAPS_BROWSER_KEY`),
refreshing on the existing 5s poll. The live location is **gated** by `may_show_live_tracking(status)` in
`dispatch.py` — never exposed before `en_route`, and only the position (no internal IDs / roster / scoring).
Falls back to a static placeholder when the browser key is absent.

**Payment view:** when the technician has reported a collection, the tracking read includes a read-only
`payment` object; the customer sees the amount + method on the completion screen and acknowledges it by
confirming completion (see §5.2a).

**Cancellation:** `POST /t/{token}/cancel` requires a non-empty customer reason (422 otherwise); the
reason is recorded as a `customer_cancel:{reason}` audit event. Allowed `pending_dispatch`→`en_route`.

**Tracking state machine** (pure function in `dispatch.py:resolve_dispatch_state`):

| `state` | Meaning | Customer sees |
|---------|---------|--------------|
| `waiting` | Job in `pending_dispatch` — dispatcher has not yet assigned a technician, or offer expired and queue returned | "Looking for a technician..." |
| `matched` | Tech accepted; trust_state = matched | Technician details card |
| `expired_retry` | Offer expired, job returned to `pending_dispatch`; dispatcher will re-assign | "Still searching..." |
| `no_eligible` | **Reserved/legacy** (see note below) — derived state, not a `jobs.status` | "No tech available; we'll follow up" |
| `matched` + status=`en_route`/`arrived`/`in_progress` | Live tracking | Progress stepper |
| `completed_pending_customer` | Tech done, customer action needed | Confirm / Dispute buttons |
| `completed_confirmed` / `completed_auto_closed` | Closed | Review prompt |
| `disputed` | Customer disputed | Flagged for resolution by the owning company |
| `cancelled` | Cancelled | Cancellation screen |

> **`no_eligible` note.** This is a **derived, customer-facing tracking state** computed by
> `resolve_dispatch_state` — it is **not** a `jobs.status` constant. It was produced only by the
> **legacy auto-dispatch** path (when `dispatch_attempts` exhausted the rounds or no eligible tech
> ranked). In the provider-managed model nothing increments `dispatch_attempts` (no auto-offers), so
> the current cutover flow **never reaches `no_eligible`** — it stays `waiting` until the company's
> dispatcher acts. It is retained as **reserved**: surfacing it deliberately would require a provider
> "close as no provider capacity" action, which is **not yet implemented**. Until then, treat it as
> legacy/reserved, not current behavior.

Customer affordances are driven by `customer_actions(status)`:
```python
{
  "can_cancel":  status in {pending_dispatch, assigned, en_route},
  "can_confirm": status == completed_pending_customer,
  "can_dispute": status == completed_pending_customer,
  "can_review":  status in {completed_pending_customer, completed_confirmed, completed_auto_closed}
}
```

---

## 7. Database

### 7.0 Data-layer principles

- **Relational core + JSONB detail.** Columns that dispatch must *query* (location, skill,
  availability, status, trust_state) are real columns; the flexible intake payload stays as
  JSONB in `jobs.detail`, so the Pydantic `Ticket` contract (`api/schema.py`) stays the single
  source of truth (§7.4).
- **Raw SQL + Alembic.** Explicit, reviewable DDL; no ORM magic.
- **One Supabase project** for both Postgres and Storage (§11).
- **Postgres stores pointers, not bytes.** Files live in Supabase Storage; the `media` table
  holds bucket + path + visibility.

### 7.1 Where Migrations Live

`packages/db/` — Alembic migrations. **Current production head: `0034_settlement_periods`** (applied 2026-07-16). Landmarks: `0010` Sprint 3 cutover (fulfillment lifecycle columns, tracking token, dispatch_offers); `0011` single-active-offer index; `0012` decline reason; `0013` arrival verification (PIN); `0014` job notes; `0015` job payments; `0016`/`0017` provider affiliation ledger + history; `0018` technician photo status; `0019` organization status enum; `0020`/`0021` technician documents; `0022` technician invites; `0023` global runtime settings; `0024` additional DB-backed operational tunables; `0029` managed service catalog; `0030` organization capabilities; `0031` financial closeout settings; `0032` job closeout reports; `0033` technician agreements; `0034` settlement periods.

The `PostgresStore.startup()` method in `store.py` also runs `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` guards so the API boots cleanly even if a migration is behind.

### 7.2 Core Tables

**`jobs`** — The central table. One row per customer job.
```
id uuid PK
customer_id uuid → customers
fulfillment_technician_id uuid → technicians (null until matched)
fulfillment_org_id uuid (null for independent tech)
origin_org_id uuid (org that created the job, if channel)
customer_owner_org_id uuid (who owns the customer relationship — stays on overflow)
intake_channel_id uuid → intake_channels
trust_state text            -- "intake" | "matched" | "fulfillment"
status text                 -- see operational lifecycle above; default "draft"
access_type text            -- "vehicle" | "home" | "business" | "other"
situation text
urgency text
lat, lng double precision   -- geocoded job location (null if geocoding failed)
address text
detail jsonb                -- full Pydantic Ticket model serialized here
price_quote jsonb
final_charge jsonb
tracking_token text UNIQUE  -- opaque customer-facing token (cutover only)
dispatch_attempts integer default 0
-- Lifecycle timestamps (set once, never updated):
assigned_at, en_route_at, arrived_at, in_progress_at,
completed_pending_at, confirmed_at, closed_at, disputed_at,
cancelled_at timestamptz
created_at, updated_at timestamptz
```

**`dispatch_offers`** — One row per offer sent to a technician. In the provider-managed model, at most one `status='offered'` row exists per `job_id` at any time (enforced by partial unique index from migration 0011).
```
id uuid PK
job_id uuid → jobs
technician_id uuid → technicians
organization_id uuid (org the tech was acting for, if any)
rank integer (0 = top candidate)
status text -- "offered" | "seen" | "accepted" | "declined" | "expired" | "superseded" | "failed_delivery"
dist_km double precision
offered_at, expires_at, responded_at timestamptz

UNIQUE INDEX (job_id) WHERE status = 'offered'  -- prevents duplicate active offers (0011)
```

**`technicians`** — One row per field technician. This is the **global** technician
identity (one profile per person, not duplicated per company). Provider membership lives
in the affiliation ledger, not here — see `organization_technicians` below and §18.3.
```
id uuid PK
user_id uuid → users
display_name text
profile_photo_url text          -- global headshot (Ops-reviewed)
profile_photo_status text       -- "pending" | "approved" | "rejected" — only "approved" is customer-visible (0018)
skills text[]           -- ["vehicle", "home", "business"] — must match job access_type
is_available boolean    -- toggle-controlled; only available techs get offers
status text             -- global lifecycle: "active" | "suspended" | "rejected" | "inactive" | "pending_review"
vetting_status text     -- "verified" | "pending" | "rejected"
provider_type text      -- "independent" | "organization_member"
primary_organization_id uuid    -- DEPRECATED as membership source — now a denormalized
                                -- compatibility cache; eligibility derives from active
                                -- organization_technicians rows (0016/0017)
current_lat, current_lng double precision  -- last GPS ping
service_area_center_lat, service_area_center_lng double precision  -- dispatch filter
service_area_radius_km double precision    -- dispatch filter
rating numeric(3,2)
```

**`intake_channels`** — One row per intake channel (org-specific intake page).
```
id uuid PK
slug text UNIQUE        -- matches /o/{slug} URL path
organization_id uuid    -- owning org (null for public channels)
active boolean
dispatch_cutover_enabled boolean default false  -- per-channel cutover flip
fulfillment_policy text -- "private" | "network_overflow" | "network_open"
```

**`users`** — Authentication table (email + password_hash).
```
id uuid PK, email text UNIQUE, phone text UNIQUE
password_hash text  -- PBKDF2-SHA256, 210k iterations
display_name text, status text
created_at, updated_at timestamptz
```

**`user_roles`** — `{ user_id, role }` — roles: `technician`, `platform_admin`, `provider_admin`, `dispatcher`

**`organizations`** — Service provider companies. `status` is the company lifecycle
(`pending_review` | `active` | `suspended` | `rejected` | `closed`, normalized by migration
`0019`) — distinct from the technician lifecycle even where labels overlap.

**`organization_technicians`** — The **provider affiliation ledger** (migrations `0016`/`0017`),
not a simple join. One row per technician↔company relationship period; the canonical source of
truth for provider membership and dispatch eligibility. Key fields: `status`
(`pending_invite` | `active` | `suspended` | `ended` | `rejected`), `affiliation_type`
(`employee_w2` | `contractor` | `subcontractor` | `owner_operator` | `unknown`), `exclusivity`
(`exclusive` | `non_exclusive` | `unknown`), `dispatch_allowed`, `starts_at`/`ended_at`,
reason fields. Dispatch eligibility = `status='active' AND ended_at IS NULL AND dispatch_allowed`.
A partial unique index enforces at most one active **exclusive** affiliation per technician.
History is preserved (leave/rejoin creates new rows). Full model: §18.3 (Partner subsystem).

**`organization_teams`** — Recursive departments/groups/branches inside an organization:
`{ id, organization_id, parent_team_id, name, description, team_type, status, timestamps }`.
Teams are **virtual operating groups only** — legal/compliance documents never attach to a team.

**`organization_team_technicians`** — Many-to-many team membership for affiliated technicians:
`{ team_id, technician_id, role, assigned_at }`.

**`provider_documents`** — Compliance/legal documents for organizations and technicians:
`{ id, owner_type, owner_id, document_type, document_number, issuing_authority, jurisdiction,
issued_at, expires_at, status, storage_bucket, storage_path, notes, review timestamps }`.
Document validity will gate dispatch eligibility (Sprint 7).

**`events`** — Append-only audit log: `{ ticket_id, job_id, event, trust_state, at }`.

**`customers`** — `{ id, phone UNIQUE, name, created_at }` — global, not tenant-scoped.

**`job_reviews`** — Post-completion review: `{ job_id, rating, tags[], comment, ... }`.

**`job_payment_reports`** — Advisory technician-reported collection (migration `0015`):
`{ job_id, reported_by ('technician'|'customer'), amount, currency, method, reported_at }`,
`UNIQUE (job_id, reported_by)`. The current contract writes `reported_by='technician'`; the
customer only acknowledges it through completion confirmation. This is not a payment ledger.

**`media`** — Uploaded files: `{ owner_type, owner_id, kind, bucket, path, visibility, uploaded_by, uploaded_at }`.

**`global_settings`** — The **primary runtime operational settings store** (migration `0023`;
expanded by `0024`). One row per setting: `{ key text PK, value jsonb, value_type text
(integer|boolean|string|object|array), description, is_secret bool, is_runtime_editable bool,
updated_at, updated_by → users(id) }`.
**Not a secret store and not deployment/infra config** — a `CHECK (is_secret = false)` makes that a
DB-level invariant; secrets stay in env/Vercel/secret manager. `value` is jsonb for flexibility but
**never free-form**: every supported key has strict per-key validation in `api/settings.py` (an
allowlist registry). Read/write only via the platform-admin API (§13); a foreign role gets 403.

Keys today (each seeded with the same default as its env fallback, so behavior is unchanged until an
operator tunes it):

| Key | Type | Default | Migration | Controls |
|-----|------|---------|-----------|----------|
| `dispatch_offer_ttl_seconds` | integer 60–900 | `300` | 0023 | Offer expiry (§7.2a) |
| `dispatch_cutover_global_off` | boolean | `false` | 0024 | Global dispatch kill-switch (§9 Cutover Flags) |
| `token_action_max` | integer 1–10000 | `30` | 0024 | Capability-link mutation rate-limit count (§10) |
| `token_action_window_seconds` | integer 1–3600 | `60` | 0024 | Capability-link rate-limit window (§10) |
| `login_max_failures` | integer 1–1000 | `8` | 0024 | Login-throttle failure count (§10) |
| `login_window_seconds` | integer 1–86400 | `900` | 0024 | Login-throttle window (§10) |

### 7.2a Runtime setting resolution

`api/settings.py` exposes a generic `resolve(store, key)` that reads a setting **at request time**
(never at import — `config.py` stays DB-free) with a tolerant fallback chain, and a small in-process
cache (~30s; stale acceptable). The chain is the same for every key:

```
global_settings.<key>   (DB, validated against the key's per-key contract)
  → <ENV_VAR>           (env, validated — e.g. DISPATCH_OFFER_TTL_SECONDS)
  → <hardcoded default> (last resort)
```

If the DB row is missing, invalid, or the read fails, resolution falls through to env then the
hardcoded default — **callers never break** while a fallback exists. Both integer and boolean keys
are supported; an admin `PATCH` clears the resolver cache so a change applies on the next request.

**Editing a setting affects future evaluations only, not in-flight state.** The offer TTL is read
**only when creating an offer** (`expires_at = now() + ttl`, in `_send_targeted_offer`); existing
offers keep their stamped `expires_at`. The kill-switch is read at ticket create (see §9). The
rate-limit/login windows are read per request.

**The InMemoryStore seed is derived from the `SETTINGS` registry**, so the test store always mirrors
a freshly-migrated DB and the two cannot drift.

### 7.3 Important Indexing Notes

- `jobs.tracking_token` has a UNIQUE index (`idx_jobs_tracking_token`)
- Dispatch queries filter heavily on `technicians.status`, `technicians.vetting_status`
- `dispatch_offers` queries filter on `technician_id + status + expires_at`
- **Partial unique index** (migration 0011): `CREATE UNIQUE INDEX idx_dispatch_offers_job_active ON dispatch_offers (job_id) WHERE status = 'offered'` — prevents duplicate active offers per job at DB level, enforcing the single-targeted-offer model

### 7.4 The JSONB `detail` Column

The full `Ticket` Pydantic model is serialized into `jobs.detail` as JSONB. This holds everything the intake form captured — vehicle make/model/year, key type, lock class, automotive details, safety flags, identity info. The top-level scalar columns (`access_type`, `situation`, `address`, `lat`, `lng`, `trust_state`, `status`) are **denormalized** out of detail for querying and dispatch. When the backend reads a ticket back, it rehydrates the `Ticket` object from `detail`.

---

## 8. Infrastructure and Deployment

### 8.1 Vercel

One repo (`logicacodecom/ClueXP`), **four Vercel projects** (one per app, team
`logicacode-projects`), all tracking **`main`** as production. Each project is distinguished by
its **Root Directory**, not by branch; feature branches get preview deploys.

| Project | Domain(s) | Root Directory | Project ID |
|---------|-----------|----------------|------------|
| cluexp-intake | intake/www.cluexp.com | `apps/intake-web` (+ Python `api/`) | `prj_Zpx84LKOnx0kSvHCiQythZvEwM6X` |
| cluexp-ops | ops.cluexp.com | `apps/ops-web` | — |
| cluexp-provider | partners.cluexp.com | `apps/provider-web` | — |
| cluexp-technician | tech.cluexp.com | `apps/technician-web` | `prj_TZJbJlZRCnTTUpNgTY1PGxs9otkg` |

**Critical dashboard settings (not expressible in `vercel.json`, which lives *inside* the Root
Directory):** in Project → Settings → Build & Deployment, **Root Directory** must be the app dir
(a `null`/repo-root value produces an **empty deployment that returns 404 while showing READY** —
this exact bug hit `cluexp-technician` on 2026-06-05). **"Include files outside of the Root
Directory" = ON** (so the workspace install resolves `@cluexp/*` from the monorepo root — leave
Install/Build commands default; do **not** set `installCommand: "npm install"`).
**Verifying a deploy:** READY alone is not proof — always curl a real route (e.g. `/jobs`) and
expect 200 with real markup. Each `vercel.json` pins `framework: "nextjs"`, and an `ignoreCommand`
skips the build unless the app's own files or its shared packages changed.

**The Python backend runs as a Vercel Serverless Function:**
`apps/intake-web/vercel.json`:
```json
{
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/main" }]
}
```
All `/api/*` requests are rewritten to `api/main.py` (FastAPI app). FastAPI handles internal routing from there.

**Middleware in FastAPI strips the `/api` prefix** so local dev (`uvicorn api.main:app`) and Vercel production see the same route paths.

### 8.2 Cron / Scheduled Cleanup

The dispatch sweep endpoint has been reduced to **cleanup only** — it no longer creates offers or re-dispatches:

`POST https://intake.cluexp.com/api/cron/dispatch-sweep`

**Authentication:** `Authorization: Bearer {CRON_SECRET}` — set as Vercel env var `CRON_SECRET`. If unset, the endpoint returns 503.

**What it does (cleanup only):**
1. `expire_stale_offers()` — marks past-`expires_at` offers as `expired`; returns jobs with no remaining active offer to `pending_dispatch`
2. `auto_close_pending()` — closes `completed_pending_customer` jobs past `AUTO_CLOSE_WINDOW_SECONDS`

**Note:** Both operations also run inline on every `GET /provider/queue` (and the read-only `GET /ops/queue`) as lazy cleanup on read, so the cron is a safety net rather than a hard requirement. It can be disabled without breaking dispatch — the queue reads keep themselves clean.

### 8.3 Supabase

- **Database:** Postgres, accessed via `DATABASE_URL` (Session Pooler endpoint for IPv4 compatibility from Vercel)
- **Storage:** Two buckets:
  - `private-verification` — technician license/insurance docs (private, signed URLs)
  - Intake photos use a separate bucket referenced in `storage.py`
- **Migrations:** Apply via Supabase SQL Editor or Session Pooler; direct connection is IPv6-only and unreachable from this dev environment

### 8.4 Google Maps / Places

Both APIs proxied through the FastAPI backend so the API key never reaches the browser:
- `GET /api/geocode?q={address}` — resolves address to lat/lng + confidence
- `GET /api/places/autocomplete?q={input}` — address suggestions while typing

Environment variable: `GOOGLE_MAPS_API_KEY` — must have both **Geocoding API** and **Places API (New)** enabled in Google Cloud Console.

**Note:** The key needs Application Restrictions = None in the Google Cloud Console (server key, not browser key).

---

## 9. Environment Variables

All environment variables for `intake-web`. Set in Vercel project dashboard under each environment (Production/Preview/Development).

### Backend (Python / FastAPI) — Core

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | Postgres DSN. If unset, in-memory store is used. Use Session Pooler URL (port 5432) not direct (port 5432 IPv6 only). |
| `AUTH_SECRET` | `cluexp-dev-auth-secret-change-me` (dev only) | Signs/verifies session JWTs (`auth.py`). **Must be a strong, unique value in prod** — the default literal is public, so an unset prod secret means forgeable tokens. |
| `GOOGLE_MAPS_API_KEY` | — | Server-side geocoding + Places autocomplete. Must have Geocoding + Places API (New) enabled, Application Restrictions = None. |
| `SUPABASE_URL` | — | Supabase project URL for storage signed URLs. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service-role key for storage operations. Legacy fallback `SUPABASE_SERVICE_KEY` is still read if the role-key name is absent. Server-only — never expose to the browser. |
| `CRON_SECRET` | `""` (disabled) | Bearer secret for `POST /cron/dispatch-sweep`. Unset = endpoint returns 503. Sent as `Authorization: Bearer ${CRON_SECRET}` by Vercel Cron / pg_cron / any caller. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated list of allowed CORS origins. Set explicitly in prod. |
| `DEMO_SEED` | `true` | If true, seeds demo technicians/orgs on startup. Applies to **both** the in-memory store and a Postgres store: `PostgresStore._seed_demo_auth` idempotently upserts the demo accounts and calls `demo_seed.seed_florida_locksmith` so the Tampa demo provider is always present in a fresh demo DB. Set `false` to disable. |
| `DEMO_SEED_PASSWORD` | `123456` | Login password for the seeded demo accounts. Intentionally simple for demos; the JWT signing secret (`AUTH_SECRET`) is separate and must still be strong. |

#### Demo provider seed — Florida Locksmith

[`api/demo_seed.py`](../apps/intake-web/api/demo_seed.py) is the single source of truth for
the provider-shaped demo data. It is **idempotent** (lookups by slug/email, so reseeding upserts
and never duplicates) and exposes two entry points:

- `seed_florida_locksmith(conn, *, password_hash)` — upserts the Tampa provider **Florida
  Locksmith** (slug `florida-locksmith`): the company, its branded intake channel, a dispatcher
  login (`dispatch@florida-locksmith.demo`), and three verified/available technicians (Carlos
  Rivera `home/business/vehicle`, Maya Thompson `home/business`, Andre Wilson `vehicle/home`).
  Called on every demo boot via `DEMO_SEED`.
- `reset_demo(conn, …)` — the on-demand reset: FK-safe cleanup of the legacy **Metro Key** demo
  *jobs* (and the offers/tracking/notes/reviews/payments + orphan customers hanging off them —
  the Metro Key company and technicians are **preserved**), then `seed_florida_locksmith` plus a
  few clean unassigned demo jobs (`pending_dispatch`) so the dispatch flow has something to show.

All technician skills and job access types pass through `normalize_skill`, which maps the
`car`/`auto` aliases to the canonical `vehicle` token the dispatch engine compares against
(`AccessType.CAR.value == "vehicle"`) — guarding the historical `car`-vs-`vehicle` dispatch
mismatch. The standalone runner is `scripts/reset_demo_providers.py` (see the demo-prep runbook
in `PILOT-OPERATIONS.md`).

### Backend — Environment Detection

The backend decides it is "production" (which makes `ARRIVAL_PIN_SECRET` mandatory — see below) from any of these. None need an explicit value beyond what the host already sets.

| Variable | Purpose |
|----------|---------|
| `VERCEL_ENV` | Set automatically by Vercel. `production` ⇒ `IS_PRODUCTION = true`. |
| `APP_ENV` / `ENVIRONMENT` | Either set to `production`/`prod` also flips `IS_PRODUCTION` on (for non-Vercel hosts). |

### Backend — Arrival Verification (Gate 2)

Secure customer-held PIN the technician must enter to move `en_route → arrived`. Only a keyed hash is stored.

| Variable | Default | Purpose |
|----------|---------|---------|
| `ARRIVAL_PIN_SECRET` | dev fallback (`dev-arrival-pin-secret`) | HMAC key for the stored PIN hash — stable per deployment so the hash can be recomputed for comparison; protects PINs if the DB leaks. **Fail-secure: production refuses to start if this is unset** (no silent fallback). Generate with `openssl rand -hex 32`. |
| `ARRIVAL_PIN_TTL_SECONDS` | `900` | How long a generated PIN stays valid (15 min). |
| `ARRIVAL_PIN_MAX_ATTEMPTS` | `5` | Wrong-PIN attempts before the PIN is burned. |

### Backend — Customer Link Rate-Limit (Gate 4)

Per-token sliding window guarding capability-link mutations (confirm / review / dispute / cancel / arrival-pin). In-process (per-instance) — a first layer of abuse protection on a leaked tracking link.

**DB-backed (primary) since migration 0024.** The values below are now resolved from
`global_settings` at request time (env → hardcoded fallback); the env vars are fallback-only and the
live values are tunable via the platform-admin API (§7.2a, §13) without a redeploy.

| Key / env var | Default | Purpose |
|---------------|---------|---------|
| `token_action_max` / `TOKEN_ACTION_MAX` | `30` | Max mutating actions per token within the window. |
| `token_action_window_seconds` / `TOKEN_ACTION_WINDOW_SECONDS` | `60` | Length of the sliding window. |

### Backend — Auth Hardening (Login)

**DB-backed (primary) since migration 0024** — same resolution chain as above; env vars are fallback-only.

| Key / env var | Default | Purpose |
|---------------|---------|---------|
| `login_max_failures` / `LOGIN_MAX_FAILURES` | `8` | Failed logins within the window before the account is locked. Tracked in `login_attempts`. |
| `login_window_seconds` / `LOGIN_WINDOW_SECONDS` | `900` | Lockout sliding window (15 min). |

### Dispatch Tunables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DISPATCH_OFFER_TTL_SECONDS` | `300` | **Fallback/default only.** How long a targeted offer lives before it expires and the job returns to `pending_dispatch`. The **primary** control is the DB-backed `global_settings.dispatch_offer_ttl_seconds` (§7.2a); this env var is the middle fallback, `300` the last resort. Pilot value is `300`. |
| `AUTO_CLOSE_WINDOW_SECONDS` | `259200` | 72h — time before `completed_pending_customer` auto-closes |
| `LOCATION_ONLINE_THRESHOLD_MINUTES` | `15` | Techs whose `location_updated_at` is within this window are shown as "online" in the provider candidates view |

**Obsolete (ops-controlled model):** `DISPATCH_SWEEP_INTERVAL_SECONDS`, `DISPATCH_MAX_ROUNDS`, `DISPATCH_TOTAL_TIMEOUT_SECONDS`, `DISPATCH_TOP_N` — no longer used; the sweep is cleanup-only and dispatch is human-driven. Safe to remove from Vercel env vars.

### Cutover Flags

**What "cutover" means.** It is the migration of a request's fulfillment path from the **legacy auto-dispatch stub** (old code auto-creates offers on intake) to the **provider-managed model** (the job enters the owning company's dispatch queue as `pending_dispatch` with *no* automatic offer; the company's own dispatcher assigns a technician via `POST /provider/queue/{id}/assign`). It is rolled out **per company channel**, never as a single global flip. See the intake decision in `api/main.py` (`channel_on … cutover`).

**Two gates decide the path** (`cutover = channel_on AND NOT dispatch_cutover_global_off`):

1. **Per-channel (DB):** `intake_channels.dispatch_cutover_enabled` — turns the new model **on** for one company. This is the normal rollout knob.
2. **Global (DB-backed):** `dispatch_cutover_global_off` (`global_settings`) — turns the new model **off** for **everyone** at once, overriding every per-channel flag.

| Key / env var | Default | Purpose |
|---------------|---------|---------|
| `dispatch_cutover_global_off` / `DISPATCH_CUTOVER_GLOBAL_OFF` | `false` | **Emergency kill-switch.** When `true`, `cutover` evaluates `false` for *every* channel regardless of its `dispatch_cutover_enabled` flag, so **new** intakes are not placed on the operational ladder (created as `draft`, with no `pending_dispatch`, no tracking token, no offer). The legacy auto-match `/dispatch` stub is itself gated (410), so nothing auto-dispatches those requests either — they need manual/human handoff. **DB-backed since migration 0024** — flip it live via `PATCH /admin/global-settings/dispatch_cutover_global_off` (§13); it takes effect on the next intake within the resolver cache (~30s), **no redeploy required**. The `DISPATCH_CUTOVER_GLOBAL_OFF` env var remains as a fallback. The official pilot rollback mechanism. Verify the live value as a platform admin via `GET /ops/flags`. |
| `DISPATCH_CUTOVER_PUBLIC` | `false` | **Deprecated / disabled.** Once enabled cutover for channelless (public) intake. ClueXP is a SaaS platform that never dispatches channelless requests — every dispatchable job must belong to a provider company via a branded channel. No longer read by the intake path; retained only so environments that still define it don't break. |

**When the kill-switch is evaluated, and what happens to in-flight jobs.** The `cutover` decision
(`channel_on AND NOT dispatch_cutover_global_off`) is computed **once, at ticket create** (`POST
/tickets`), resolving `dispatch_cutover_global_off` from `global_settings` at that moment; `commit`
does not re-evaluate it and there is no background reconciler. Flipping the kill-switch therefore
**only affects new requests** — it does **not** retroactively cancel, freeze, reassign, or invalidate
anything already in flight:

| Existing state at flip | Effect of toggling `DISPATCH_CUTOVER_GLOBAL_OFF` |
|------------------------|--------------------------------------------------|
| `draft` (created, not committed) | None to the row. If still `draft` it never entered the ladder; whether a *future* create dispatches depends on the flag at that create. |
| Committed, pre-`pending_dispatch` | None. A cutover job reaches `pending_dispatch` at create, not commit; a non-cutover job stays off the ladder regardless. |
| `pending_dispatch` (in the provider queue) | **Unaffected.** Stays in the owning company's queue; the dispatcher can still assign. |
| Active offer outstanding | **Unaffected.** The offer lives to `expires_at`; accept/decline/expiry behave normally. |
| `assigned` | **Unaffected.** Stays assigned; the technician proceeds. |
| `en_route` / `arrived` / `in_progress` | **Unaffected.** Fulfillment continues; PIN, status transitions, live tracking all work. |
| Existing tracking tokens | **Still valid.** Customers keep reading `/t/{token}` and using confirm / dispute / cancel / review / arrival-pin. |

In short: the kill-switch **stops new cutover traffic** but leaves in-flight jobs and their tracking
tokens fully functional. To halt an in-flight job you must use a provider recovery action
(cancel / release / no-show), not the flag.

### Frontend (Next.js apps: `intake-web`, `ops-web`, `provider-web`, `technician-web`)

These are read by the BFF API routes and client components. `NEXT_PUBLIC_*` vars are inlined into the browser bundle — never put secrets there. The session cookie name is hardcoded (`cluexp_access_token`, httpOnly + Secure), not env-configurable.

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_CLUEXP_API_BASE_URL` | `https://intake.cluexp.com` | Backend FastAPI base URL the BFF routes proxy to. |
| `LOCAL_API_BASE_URL` | `http://127.0.0.1:8000` | Dev-only rewrite target in `next.config.mjs` (proxies `/api` to the local backend; production uses real route handlers). |
| `CLUEXP_AUTH_LOCALE_PATH` | `/api/auth/me/locale` | Backend path the locale route posts the user's language preference to. |
| `NEXT_PUBLIC_MAPS_BROWSER_KEY` | — | Browser Google Maps key for the map views (separate from the server `GOOGLE_MAPS_API_KEY`; should be HTTP-referrer restricted). **Required in every console that renders a map — `technician-web`, `provider-web`, AND `ops-web`.** Unset ⇒ the map renders the "Map key not configured" fallback. Because it's `NEXT_PUBLIC_*` it's inlined at build time, so set it per Vercel project and **redeploy** to take effect. |
| `NEXT_PUBLIC_DEMO_MODE` | `true` (any value but `"false"`) | Demo affordances on the public intake page; set `"false"` to disable. |
| `NEXT_PUBLIC_DISPATCH_PHONE` | `+18005551234` | Fallback dispatch phone number shown on the intake page. |

---

## 10. Auth

### Session Tokens
JWT tokens signed with `AUTH_SECRET`. Claims: `{ sub: user_id, roles: [], org: org_id, technician: { id, is_available, ... } }`. Stored as httpOnly cookie `cluexp_access_token`.

### Roles
| Role | Access |
|------|--------|
| `technician` | Update availability, location, job status for their active job; manage own global profile + affiliations |
| `platform_admin` | ClueXP Ops: approve/reject technicians and orgs, compliance/photo review, read-only dispatch oversight, tenant-scoped dispute resolution. **Does not dispatch.** |
| `provider_admin` | Manage their org's technicians, teams, and documents; dispatch + recovery for the org |
| `dispatcher` | Dispatch + recover the org's own jobs (org-scoped `/provider/*`) |

### Password Hashing
PBKDF2-SHA256 with 210,000 iterations. In `auth.py`.

### Rate Limiting (Login)
`login_max_failures` (default `8`) failures within `login_window_seconds` (default `900`, 15 min) → account locked. Tracked in `login_attempts` table. Both are DB-backed runtime settings (`global_settings`, migration 0024) resolved per request, with `LOGIN_MAX_FAILURES` / `LOGIN_WINDOW_SECONDS` env vars as fallback (§7.2a).

---

## 11. Storage

Supabase Storage. Managed in `api/storage.py`.

**Buckets:**
- `private-verification` — Compliance documents (license, insurance). Signed upload/download URLs, private visibility.
- Intake photos — Uploaded during the intake form if customer attaches photos of the lock/vehicle.

**Upload flow:**
1. Client calls `POST /media/sign-upload` → returns signed URL + `media_id`
2. Client uploads directly to Supabase Storage using the signed URL
3. Client calls `POST /media/confirm` with `media_id` → records in `media` table

**Limits:** Max 10MB per file, image + PDF types only.

---

## 12. Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@cluexp/api-client` | `packages/api-client/` | TypeScript types matching the Python schema, mock data for dev/testing. Contains `updateTechnicianJobStatus()` which calls `PATCH /api/tickets/{id}/status`. |
| `@cluexp/app-core` | `packages/app-core/` | React hooks: `useLocale()`, `useSession()`, session context provider. Used by all frontend apps. |
| `@cluexp/console-ui` | `packages/console-ui/` | Shadcn/ui component library. Used by ops-web and provider-web. |
| `@cluexp/db` | `packages/db/` | Alembic migration scripts. Apply manually via Supabase SQL Editor in prod. |

---

## 13. Complete API Endpoint Reference

All routes are on `intake.cluexp.com/api/` in production. In `apps/intake-web/api/main.py`.

### Auth
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/auth/login` | public | Email/password → JWT cookie |
| `POST` | `/auth/register/technician` | public | Register a new technician account |
| `POST` | `/auth/register/organization` | public | Register a provider org |
| `GET` | `/auth/me` | session | Returns `{ session, user, roles, technician?, organization? }` |
| `DELETE` | `/auth/session` | session | Sign out (clears cookie) |
| `PATCH` | `/auth/me/locale` | session | Update preferred locale (en/es) |

### Intake
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/tickets` | public | Create job; fires dispatch if cutover active |
| `GET` | `/tickets/{id}` | public | Get ticket state (polling endpoint for the non-cutover intake path) |
| `PATCH` | `/tickets/{id}` | public | Update ticket fields during intake form steps |
| `POST` | `/tickets/{id}/price-quote` | public | Generate price estimate |
| `POST` | `/tickets/{id}/commit` | public | Finalize the intake record (does **not** dispatch — dispatch is decided at create; §3.4) |
| `POST` | `/tickets/{id}/dispatch` | — | **Gated (410)** — legacy auto-match stub, removed |

### Customer Tracking (Cutover Path)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/t/{token}` | public | Read tracking state by opaque token |
| `POST` | `/t/{token}/confirm` | public | Customer confirms job completion (sets `completed_confirmed`, `trust_state = fulfillment`) |
| `POST` | `/t/{token}/dispute` | public | Customer disputes the job |
| `POST` | `/t/{token}/cancel` | public | Customer cancels (allowed `pending_dispatch`→`en_route`; **non-empty reason required, else 422**) |
| `POST` | `/t/{token}/review` | public | Customer submits a review |
| `POST` | `/t/{token}/arrival-pin` | public (token) | Issue a fresh six-digit arrival PIN (only once `en_route`); see §5.1a |

### Provider Dispatch + Recovery (Requires `dispatcher`/`provider_admin`, org-scoped)
The dispatch surface. Every endpoint is scoped to `session.active_organization_id`; a foreign job/technician returns 404/422 (no cross-tenant leak).
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/provider/queue` | session (dispatcher) | The org's `pending_dispatch` jobs oldest-first; lazy cleanup inline |
| `GET` | `/provider/queue/{job_id}/candidates` | session (dispatcher) | The org's own active+verified techs with distance, ETA, online, busy signals |
| `POST` | `/provider/queue/{job_id}/assign` | session (dispatcher) | Create single targeted offer to one of the org's technicians (`override_reason` when flagged) |
| `GET` | `/provider/fleet` | session (dispatcher) | The org's techs with location + active-job data for the fleet map |
| `POST` | `/provider/jobs/{id}/{cancel,release,no-show}` | session (dispatcher) | Tenant-scoped recovery; reason required, atomic, audited |
| `POST` | `/provider/jobs/{id}/recall-offer` | session (dispatcher) | Recall an active offer |
| `POST` | `/provider/jobs/{id}/arrival/override` | session (dispatcher) | Mark arrival without PIN; mandatory reason, audited |
| `GET/POST` | `/provider/jobs/{id}/notes` | session (dispatcher) | Internal notes (invisible to customer/technician) |
| `GET` | `/provider/jobs/{id}/timeline` | session (dispatcher) | Per-job audit timeline |
| `GET` | `/provider/jobs`, `/provider/jobs/history` | session (dispatcher) | Active jobs / completed-job history (tenant-scoped) |

### Ops Oversight (Read-only — `platform_admin`)
ClueXP does **not** dispatch; there is intentionally no `/ops/.../assign`.
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/ops/queue` | session (platform_admin) | All `pending_dispatch` jobs platform-wide; lazy cleanup inline |
| `GET` | `/ops/queue/{job_id}/candidates` | session (platform_admin) | All active+verified techs with advisory signals (oversight, no assign) |
| `GET` | `/ops/fleet` | session (platform_admin) | All active+verified techs with location + active-job data |
| `GET` | `/ops/flags` | session (platform_admin) | Effective runtime dispatch flags (e.g. `DISPATCH_CUTOVER_GLOBAL_OFF`) |

### Dispatch (Technician-Facing)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/technicians/{id}/offers` | session | List active offers for a technician |
| `POST` | `/offers/{id}/accept` | session | Technician accepts an offer (atomic first-accept-wins) |
| `POST` | `/offers/{id}/decline` | session | Technician declines an offer; job returns to `pending_dispatch` |
| `GET` | `/tickets/{id}/dispatch-status` | public | Check dispatch state — **non-cutover/legacy polling only**; the provider-managed path uses `/t/{token}` (no auto-dispatch behind this) |
| `POST` | `/tickets/{id}/offers` | — | **Gated (410)** — use `/provider/queue/{id}/assign` instead |
| `GET/POST` | `/cron/dispatch-sweep` | CRON_SECRET | Scheduled: expire stale offers + auto-close (no re-dispatch) |

### Job Lifecycle (Cutover Path)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `PATCH` | `/tickets/{id}/status` | session (technician) | Advance job status (technician-settable only). `arrived` is **rejected (422)** here — use the arrival-verify endpoint below |
| `POST` | `/jobs/{id}/arrival/verify` | session (technician) | Verify the customer-held PIN; advances `en_route → arrived` (§5.1a) |
| `POST` | `/provider/jobs/{id}/arrival/override` | session (dispatcher) | Dispatcher arrival override without PIN; mandatory reason, audited (§5.1a) |
| `GET` | `/technicians/{id}/active-job` | session | Get the technician's current active job |
| `GET` | `/tickets/{id}/lifecycle` | session | Full lifecycle detail for ops view |

### Geocode / Places
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/geocode?q=` | public | Resolve address → lat/lng |
| `GET` | `/places/autocomplete?q=` | public | Address autocomplete suggestions |

### Media
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/media/sign-upload` | session | Get signed URL for direct Supabase Storage upload |
| `POST` | `/media/confirm` | session | Confirm upload, record in DB |
| `GET` | `/media/{id}/download-url` | session | Get signed download URL |

### Provider / Org Workforce (model: §18.3)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/auth/register/organization` | public | Register an org (creates `pending_review` org + provider admin) |
| `GET/PATCH` | `/provider/workspace` | session (provider_admin) | Org profile |
| `GET` | `/provider/technicians` | session (provider_admin) | List this company's affiliated technicians (tenant-scoped, read-only profile data) |
| `GET` | `/provider/technicians/{id}` | session (provider_admin) | **Read-only** detail of one affiliated technician: base profile, affiliation, **team memberships**, **company + global review summaries**, and **compliance documents**. Foreign/unaffiliated → 404. No edit actions (the technician owns the global profile) |
| `POST` | `/provider/technicians/invite` | session (provider_admin) | Create a company affiliation invite; new people receive a technician signup token, existing technicians receive a pending affiliation |
| `POST` | `/provider/technicians` | session (provider_admin) | Retired (`410`): providers cannot create or own global technician profiles |
| `POST` | `/provider/technicians/{id}/affiliation/{end,suspend}` | session (provider_admin) | End/suspend this org's affiliation (tenant-scoped; history preserved). `end` on a `pending_invite` row is the **revoke-before-acceptance** path |
| `GET/PATCH` | `/provider/teams` | session (provider_admin) | List / create / update teams |
| `DELETE` | `/provider/teams/{id}` | session (provider_admin) | Safe-delete a team — `409` while it has sub-teams; otherwise drops memberships + team (affiliations untouched). Tenant-scoped |
| `POST` | `/provider/teams/{id}/technicians` | session (provider_admin) | Add an actively-affiliated technician to a team (`422` if not affiliated; `404` foreign team). Idempotent |
| `DELETE` | `/provider/teams/{id}/technicians/{technician_id}` | session (provider_admin) | Remove a technician from a team (structure only; affiliation untouched) |
| `GET/POST` | `/provider/documents` | session (provider_admin) | Upload compliance docs |

### Technician Self-Service (global profile + affiliations)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/technicians/me/affiliations`, `/technicians/me/organizations` | session (technician) | The tech's affiliation rows / active orgs |
| `POST` | `/technicians/me/affiliations/{id}/{accept,decline}` | session (technician) | Accept/decline a `pending_invite` (exclusivity enforced at accept) |
| `POST` | `/technicians/me/photo` | session (technician) | Upload global profile headshot (→ `pending` review) |
| `GET` | `/technician/jobs/history` | session (technician) | The tech's finished-job history |

### Admin / Ops
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/admin/technicians/{id}/{approve,reject}` | session (platform_admin) | Approve/reject technician |
| `POST` | `/admin/organizations/{id}/{approve,suspend,reactivate}` | session (platform_admin) | Org lifecycle controls |
| `PATCH` | `/admin/technicians/{id}/photo` | session (platform_admin) | Approve/reject a global profile photo (only `approved` is customer-visible) |
| `GET` | `/admin/technicians/photos` | session (platform_admin) | List pending headshots for review |
| `PATCH` | `/admin/documents/{id}` | session (platform_admin) | Review a compliance document |
| `POST` | `/admin/jobs/{id}/resolve` | session (**dispatcher / provider_admin**) | **Provider recovery, despite the `/admin/` path.** Close / cancel / redispatch a job the caller's org owns or fulfills; tenant-scoped (foreign job → 404). `platform_admin` is **not** an allowed caller (403) — ClueXP Ops does not recover provider jobs. |
| `GET` | `/admin/global-settings` | session (platform_admin) | List runtime operational settings (`global_settings`, §7.2a). Never returns secrets (table forbids them). |
| `PATCH` | `/admin/global-settings/{key}` | session (platform_admin) | Update one allowlisted setting. Unknown key → 404; invalid type/range → 422; records `updated_by`/`updated_at`; clears the resolver cache. |

---

## 14. Pilot Techs (Seeded)

For the pilot, these technicians are seeded in the DB:

| Name | Email | Password | Coverage |
|------|-------|---------|---------|
| Jordan Lee | `jordan@cluexp.example` | `123456` | NYC area, skills: `locksmith.vehicle_lockout`, `locksmith.residential_lockout`, `locksmith.commercial_lockout` |
| Marcus Reyes | `marcus@metrokey.example` | — | NYC area |
| Lena Ortiz | `lena@metrokey.example` | — | NYC area |

**Critical requirement:** `is_available` must be `true` in the DB for a tech to receive offers. The toggle in the technician app now reads the real DB value on mount — if it shows "Offline", tap it to go Online.

---

## 15. Key Invariants (Do Not Violate)

These are hard rules enforced by the API. Breaking them causes 403 or data corruption.

1. **`completed_confirmed` is never technician-settable.** Only `POST /t/{token}/confirm` (customer) sets it. Technician API calls trying to set it get 403.
2. **`trust_state` is forward-only and server-owned.** Never trust a `trust_state` value from the browser.
3. **Status is forward-only for technicians.** `can_technician_transition(current, target)` enforces this — only forward movement, only within TECHNICIAN_SETTABLE.
4. **Only the owning company's dispatcher may create offers.** `POST /provider/queue/{job_id}/assign` (org-scoped) is the sole path to offer creation — there is no `/ops/.../assign` mutation. `_dispatch_write()` is not called at ticket creation and does not run automatically. No background process creates offers.
5. **`save(ticket)` never overwrites an operational status.** Once a job enters the dispatch pipeline (status is any operational value from `pending_dispatch` onward), the JSONB upsert's CASE guard in `store.py` leaves `status` alone. Only `set_job_status()` and the fulfillment transitions may change it.
6. **Channel slugs are server-resolved; never trust the browser's `intake_channel` as an org ID.** `resolve_intake_channel()` is the single trust boundary.
7. **Offer privacy: area only before acceptance.** `list_technician_offers` returns `area_lat/area_lng` rounded to 1km — never the exact address. Exact address only after acceptance.
8. **`global_settings` never holds secrets, and every key is validated.** A `CHECK (is_secret = false)` is a DB invariant; the admin API rejects unknown keys (404) and out-of-contract values (422). It is for runtime operational settings only — secrets and deployment/infra config stay in env/Vercel (§7.2a, §9).

---

## 16. Common Failure Modes and Fixes

### "Job created but tech sees nothing in the app"

Checklist:
1. **Has the company's dispatcher assigned the job?** Dispatch is provider-managed — no offer is created automatically. Sign in to `provider.cluexp.com` (as the owning company's dispatcher), open the queue, and assign one of the org's technicians.
2. **Does the job have lat/lng?** `haversine_km` returns `inf` if either coordinate is null — the candidates view will show techs without distances. Fix: `UPDATE jobs SET lat = 40.7128, lng = -74.0060 WHERE id = '...'`
3. **Is the job channel-owned and cutover active?** Channelless (public) requests are never dispatched. The job must come through a branded channel with `dispatch_cutover_enabled=true`, and `DISPATCH_CUTOVER_GLOBAL_OFF` must not be set. Verify runtime flags via `GET /ops/flags`.
4. **Is the offer expired?** If the offer was created but the tech didn't respond within `OFFER_TTL_SECONDS` (default 90s), the offer expired and the job returned to `pending_dispatch`. Dispatcher must assign again.

### "Tech can see offer but accept fails with 409"
Another session accepted the same targeted offer. Should not happen in the single-offer model (dispatcher sends to one tech), but the partial unique index on `dispatch_offers (job_id) WHERE status='offered'` prevents duplicates. Normal behavior on a race — tech should see the offer status update to `superseded` on next poll.

### "Tracking page is stuck at `waiting`"
The job is in `pending_dispatch` — the owning company's dispatcher has not assigned a technician yet, or the offer expired and wasn't renewed. Sign in to the provider console and assign. The customer tracking page shows "Looking for a technician..." for the full waiting period; there is no automatic escalation to the customer.

---

## 17. File Quick-Reference for AI Agents

When asked to change or debug something, these are the key files:

| Topic | File |
|-------|------|
| Dispatch pure functions (distance, ETA, state machine, status constants) | `apps/intake-web/api/dispatch.py` |
| All tunable constants + feature flags | `apps/intake-web/api/config.py` |
| All HTTP endpoints | `apps/intake-web/api/main.py` |
| DB schema (runtime) + all SQL queries | `apps/intake-web/api/store.py` |
| Pydantic ticket schema / enums | `apps/intake-web/api/schema.py` |
| Geocoding + Places proxy | `apps/intake-web/api/geocode.py` |
| Auth / JWT | `apps/intake-web/api/auth.py` |
| Supabase Storage | `apps/intake-web/api/storage.py` |
| Customer intake form | `apps/intake-web/src/app/page.tsx` |
| Customer tracking page | `apps/intake-web/src/app/t/[token]/page.tsx` |
| Channel-specific intake | `apps/intake-web/src/app/o/[slug]/page.tsx` |
| Tech app — jobs dashboard | `apps/technician-web/src/app/jobs/page.tsx` |
| Tech app — job lifecycle pages | `apps/technician-web/src/app/jobs/[id]/` |
| Tech app — offer feed | `apps/technician-web/src/components/live-offers.tsx` |
| Tech app — availability/location toggle | `apps/technician-web/src/components/client-widgets.tsx` |
| Tech app — BFF API routes | `apps/technician-web/src/app/api/` |
| Vercel routing (intake-web) | `apps/intake-web/vercel.json` |
| DB migrations | `packages/db/` |
| Shared TS types + mocks | `packages/api-client/src/` |

---

## 18. Subsystems

The product is four surfaces over one FastAPI backend (§13). This section is the
per-subsystem spec; the cross-cutting **visual** system is the UI Guide
([`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md)), and the dispatch/fulfillment/tracking mechanics are
§4–§6. Durable product principles (trust-state contract, "no promise the backend hasn't
committed to", human-fallback, three axes) are recorded in §2 and §20.4.

### 18.1 Intake (customer) — `intake-web`

**Purpose:** take a panicked customer from "I'm locked out" to a committed request and a
tracking link, honestly. Mobile-web-first PWA; **never** force an app install.

**Trust-state contract (non-negotiable):** the UI renders in one of three states —
`INTAKE` / `MATCHED` / `FULFILLMENT` — and shows technician name/ETA/live-tracking **only**
when the backend's guard methods (`may_show_technician()` / `may_show_eta()` /
`may_show_live_tracking()`) permit. No fabricated ETAs, names, or map movement; animate only
real operations (§2).

**Flow (INTAKE → MATCHED → FULFILLMENT), the screens:**
1. Opener (Car/Home/Business/Other) · 2. Situation chips · 3. Location + safety (GPS/address) ·
4. Branch details (vehicle/property) · 5. NL-parse (optional) · 6. Additional details (optional) ·
7. Photos (optional, never gate dispatch) · 8. Identity (light) · 9. Price range + cancellation
policy (explicit deliberate consent) · 10. Payment method on file (captured, **not charged** —
deferred in MVP) · 11. Commit · 12. OTP (parallel, non-blocking — deferred in MVP) →
13. Technician assigned (MATCHED) → 14. Live tracking · 15. Arrival PIN verification ·
16. Payment/review (estimate-vs-final; over-estimate needs explicit approval). **17. Human-handoff**
("Call a person instead") reachable from every screen, framed as an upgrade.

Ordering rules: price acceptance before any "confirmed" language; cancellation policy lives on
the price screen; technician data only at MATCHED+; final > estimate requires an explicit tap.

**Entry points & runtime:** branded `/o/{slug}` (the only dispatchable path) and public `/`
(form works but channelless requests never dispatch). Backend create/commit, tracking-token
read, and the customer tracking state machine are detailed in §3 and §6.

**Status:** live in production. OTP + real payment-method capture remain deferred (§2 of the
build history; restore the payment precondition before any real charge).

### 18.2 Technician app — `technician-web` (PWA)

**Purpose:** the field-work companion — stay available, receive offers, accept, navigate, prove
arrival, complete, and maintain compliance. Operational and calm; usable outdoors under stress.

**Primary users:** individual technicians (dispatched directly — a future ClueXP-Direct path)
and **affiliated technicians** (org-managed by default). Technician identity is **global**; company
membership is an affiliation record (§18.3), not a company-owned identity.

**Information architecture (bottom tabs):** Jobs/Home · Map · Messages · Activity · Account.
An active job takes priority over ordinary tabs (persistent job bar).

**Global states:** availability (`offline`/`online`/`busy`/`break`/`blocked_by_documents`/
`suspended`); GPS (`tracking_active`/`paused`/`permission_needed`/`low_accuracy`/`stale`/
`background_limited`); sound/alarm for incoming offers. Location status is always visible.

**Job lifecycle (technician-facing projection over the shared `events` — never a separate
lifecycle):** `offer_received → accepted → assigned → en_route → arrived (PIN-verified) →
in_service → customer_approval_needed → completed`, plus `declined`/`expired`/`cancelled`.
Offer timers derive from backend `expires_at`; **first-accept-wins is backend-enforced** (the UI
reflects the result, including the "another technician accepted first" superseded state).

**Acceptance _is_ the named-assignment event.** The provider dispatcher *creating/sending* a targeted
offer does **not** make the customer `MATCHED`. Only the **technician accepting** the offer commits
the assignment, atomically: it sets `fulfillment_technician_id`, `jobs.status = assigned`,
`trust_state = matched`, and makes the named technician customer-visible (§4.2 Step 5). Do not
conflate this with a future org-routed **"org accept"** flow (§20.4) — that is a separate,
not-yet-built event; in the current provider-managed model the only acceptance is the technician's.

**Hard contracts:** honest status (no fake customer data/ETA/route/movement); no customer/job
detail before acceptance; customer phone masked/mediated; expired docs block availability.

**Status:** live on real BFF routes (offers, accept/decline, active-job, location push, collection,
history, profile/photo/affiliations). Remaining: masked job chat, voice/call, native background
GPS/push — tracked in [`EXECUTION-PLAN.md`](EXECUTION-PLAN.md) §11.1.

### 18.3 Partner / provider console — `provider-web`

**Purpose:** the **shipped dispatch surface**. A provider company receives the jobs **it owns**
and dispatches **its own** affiliated technicians, tenant-scoped — then recovers them. The company
admin also manages workforce, teams, and compliance documents.

**Primary users:** organization `dispatcher` (dispatch + recovery of the org's own jobs) and
`provider_admin` (workforce/teams/documents + dispatch). Everything is scoped to
`session.active_organization_id`; a company never sees another tenant's jobs or technicians.

**Dispatch + recovery:** queue → candidates (own roster, advisory signals) → single targeted
offer (`/provider/queue/{id}/assign`, override-reason when flagged); recovery = cancel / release /
no-show / recall / resolve-dispute, plus internal notes and a per-job audit timeline. Mechanics and
endpoints: §4 and §13.

**Workforce model (technician global profile + affiliation ledger):**
- A technician has **one global** `technicians` profile; company membership is an
  `organization_technicians` **affiliation row** (a historical ledger, not a mutable `company_id`).
- Eligibility = active, non-ended, `dispatch_allowed` affiliation rows (§7.2). Ended/suspended/
  rejected rows are retained for audit, reactivation, disputes, and history.
- A technician may hold multiple **non-exclusive** affiliations; at most **one active exclusive
  (W-2)** affiliation, enforced by a DB partial unique index. A conflicting attach returns 409/422.
- Add/invite: an existing global technician gets a `pending_invite` (consent required to activate —
  enforced at accept, with exclusivity re-checked); a brand-new email gets a
  technician-signup invite link (`https://tech.cluexp.com/signup?invite=...`). The invited person
  signs up as a technician first, then accepts the company affiliation. Provider/company signup is
  never used for technician invites. Leave/rejoin preserves prior periods (new rows).
- **Affiliation lifecycle (no provider re-approval).** Once the technician **accepts**, the
  affiliation is `active` immediately — there is no further provider approval step. Before
  acceptance the provider may **revoke** the pending invite (`POST …/affiliation/end` closes the
  still-open `pending_invite` period). After activation the provider may **suspend** (period stays
  open, dispatch-ineligible) or **unaffiliate** (`end` sets `ended_at`; history preserved, rejoin
  allowed). All of these touch only the caller's own affiliation period — never global status.
- **Teams** are virtual structure over already-affiliated technicians: `POST/DELETE
  /provider/teams/{id}/technicians` add/remove members (membership ≠ affiliation; removing from a
  team never changes the affiliation), and `DELETE /provider/teams/{id}` safe-deletes (refused while
  sub-teams exist). A provider technician's read-only detail (`GET /provider/technicians/{id}`)
  surfaces team memberships, company + global review summaries, and compliance documents.
- The active-job lock is **global** to the technician (no double-dispatch across two companies).
- Tenant boundaries: a provider mutates only its own affiliations, never global technician
  status (that is Ops). Company lifecycle (`pending_review`/`active`/`suspended`/`rejected`/`closed`,
  migration `0019`) is distinct from the technician lifecycle.
- Profile ownership: the technician owns and updates the global profile (display name, phone/contact,
  approved profile photo, skills from the managed catalog, service preferences). A provider may view
  affiliated technicians, company-scoped performance/compliance signals, and end/suspend its own
  affiliation, but cannot edit global profile fields, technician skills, documents, or global vetting.

**Console IA (shared shell, §20.3):** Live Queue · Dispatch Board · Map · Technicians ·
Teams · Messages · Documents · Reports · Settings · Audit Log. The current MVP labels the
affiliated-technician surface as **Workforce/Technicians**, not "Network"; providers see only their
own affiliated roster. Customer `MATCHED` requires a named
verified technician — organization acceptance alone never flips customer visibility.

**Status:** dispatch, recovery, notes, timeline, completed-job history, workforce, and company
signup/onboarding are wired and deployed. Remaining items: [`EXECUTION-PLAN.md`](EXECUTION-PLAN.md)
§11.2. **Forward design** (team-based dispatch, org job-intake/accept screens) is designed-ahead.

### 18.4 Ops console — `ops-web`

**Purpose:** ClueXP internal operations: **read-only dispatch oversight** + user/resource
administration. **Ops does not dispatch** — there is no platform assign mutation.

**Primary users:** `platform_admin`. Capabilities: read-only oversight of the platform-wide queue,
candidates, and fleet (`/ops/queue`, `/ops/queue/{id}/candidates`, `/ops/fleet`, `/ops/flags`);
technician/org approval + rejection; compliance + technician-photo review; global technician
suspension. **Ops does not resolve, close, cancel, or redispatch provider jobs** — job recovery and
dispute resolution (`/admin/jobs/{id}/resolve`, despite its path) are **provider-side**, restricted
to the owning company's `dispatcher`/`provider_admin` and tenant-scoped; a `platform_admin` calling
it gets 403.

**Status:** oversight, approvals, compliance/photo review, and org lifecycle controls are wired.
The ClueXP-managed **routing/marketplace** dispatch surface ("ClueXP Direct" — dispatching
independent technicians, routing jobs to organizations) is **deferred forward design**
(§20.4, [`EXECUTION-PLAN.md`](EXECUTION-PLAN.md) §8), not current behavior.

---

## 19. DevOps & CI

How code goes from a branch to production (Vercel + Supabase + GitHub). Infra/runtime detail is
§8; environment variables are §9.

**Environments:**

| Env | Frontend/API | Database | Trigger |
|---|---|---|---|
| Local | `npm run dev` + `uvicorn` (or in-memory) | in-memory, or Supabase pooler | manual |
| Preview | Vercel preview deploy | Supabase (Preview env) | every PR / branch push |
| Production | the four `cluexp-*` Vercel projects | Supabase (Production env) | merge/push to `main` |

- Each app is its own Vercel project; `cluexp-intake` hosts the FastAPI backend. Git integration
  is connected (`logicacodecom/ClueXP`) → pushes to `main` auto-deploy. Supabase project ref:
  `gzgrkzvhotjolvcbqiku`.
- **Trunk-based:** `main` is always deployable + protected; short-lived branches off it; open a PR;
  CI must be green before merge. Production DDL / prod promotion needs explicit human authorization.
- `.github/workflows/` changes need the GitHub `workflow` OAuth scope (or the web UI).

**CI gate (must pass before merge):** Python `pytest` (`apps/intake-web/api/tests`), Alembic
offline validation, shared TypeScript typecheck, and production builds of all four apps
(`build:ops` / `build:provider` / `build:tech` / intake-web).

**Migrations to production:** the prod DB direct host is IPv6-only/unreachable from CI; apply
migrations via the **Supabase SQL Editor** (or Session Pooler) and confirm with
`select version_num from alembic_version`. Migrations are additive/backward-compatible where
possible so the currently-deployed code keeps working until the new code ships.

---

## 20. Architecture Decisions

The durable decision records (formerly `docs/adr/0001`–`0004`, folded in here 2026-06-19). The rest
of this document is the **current-state** architecture; this section preserves the **decision,
rationale, and rejected alternatives** — the *why*. Each keeps its original status/date for
traceability. Numbering is stable (ADR-1 … ADR-4); later sections may reference them as such.

### 20.1 ADR-1 — Foundation architecture (Accepted 2026-05-31)

- **Monorepo**, not polyrepo: `apps/` (deployables) + `packages/` (shared `schema`, `db`). A small
  team shares one domain contract; polyrepo would force publishing/duplicating the schema. Vercel
  runs multiple projects from one repo via per-project Root Directory.
- **One logical FastAPI backend** shared by all frontends, **physically co-located** in
  `apps/intake-web/api` (one Vercel project). Standalone `cluexp-api` extraction is **deferred** until
  client/reliability/security/scaling evidence justifies it (reaffirmed by ADR-2).
- **Maps: Google Maps Platform** (chosen over Mapbox) for geocoding accuracy and traffic-aware Routes
  ETAs — honest ETAs are a trust requirement. Browser render token; geocoding/routing on the backend.
- **DB: raw SQL + Alembic**, relational core + JSONB `detail` (§7.0).
- **Storage: Supabase** — public bucket for technician media, private RLS bucket for IDs/photos,
  signed-URL direct uploads, Postgres stores object paths only.
- **Migration connection policy:** direct (5432) when reachable, transaction pooler (6543) as the
  verified fallback; the app runtime always uses the pooler.

### 20.2 ADR-2 — Identity, access & clients (Superseded in part 2026-06-06)

- **Decision (2026-06-06 amendment): first-party FastAPI/Postgres identity.** Signed JWTs bridged
  through same-site httpOnly cookies; local `users`/roles/org-memberships/technicians authoritative.
- **Rejected: Clerk** (the original 2026-06-06-superseded choice) — do **not** add Clerk SDKs,
  organizations, or external-ref columns unless a future decision explicitly replaces this.
  **Supabase Auth** also rejected as primary (couples identity to the DB provider).
- **Authorization is API-enforced**, not RLS/UI — every query scoped by backend-resolved authority;
  deny-by-default RLS is a backstop against the anon key only.
- **Roles & scope:** org memberships → `provider_admin`/`dispatcher`; `platform_admin` is app-level.
  Technician dispatch eligibility comes from `technicians`/`organization_technicians`/compliance/
  availability.
- **Clients:** customer = mobile web/PWA, no forced install; technician PWA (native later only if
  background GPS/push requires it); provider + ops are separate authenticated clients.

### 20.3 ADR-3 — Dispatch console: two surfaces, shared shell (Accepted 2026-06-02)

- **Two separate deployable apps** — `provider-web` (org) and `ops-web` (ClueXP) — built on a shared
  console core (`packages/console-ui` + `api-client`), **not one dual-mode app**.
- **Rejected: a single role/workspace-gated app.** Tenant isolation is a **security boundary, not a
  UI preference** — an org dispatcher and a ClueXP admin must not share a JS bundle or auth surface; a
  single permission slip could leak cross-tenant PII/dispatch authority. Screen *count* is identical;
  the difference is packaging, not rebuilt UI (the shared shell prevents duplication).
- **Phasing note:** the original ADR expected ClueXP-managed dispatch to ship first; in delivery this
  **inverted** — the provider/organization-managed slice shipped (provider-web is the live dispatch
  surface) and ClueXP-managed routing/marketplace is deferred (ops-web is read-only today). See
  §18.3–§18.4.

### 20.4 ADR-4 — Tenancy & intake: neutral dispatch network (Accepted 2026-06-04)

The tenancy/intake decisions (A–G, human-signed) the data model, API, consoles, and plan follow. The
**current MVP is the isolated-tenant, provider-managed slice** of this vision; the neutral-network /
marketplace is the widened future (§18, [`EXECUTION-PLAN.md`](EXECUTION-PLAN.md) §8).

- **Neutral network — no "ClueXP Direct" fulfillment.** ClueXP never operates a fulfillment arm or
  competes with partners. All fulfillment is a **provider org** or a **verified individual
  technician**; direct customer requests use **ClueXP-managed *routing*** (not ClueXP fulfillment).
  **Rejected: modeling "ClueXP Direct" as a first-party provider org.** *Partner trust outweighs
  short-term fulfillment control; the SaaS-as-supply flywheel breaks if partners fear a competitor.*
- **Three independent axes:** origin (`origin_org_id`/`origin_channel`) · customer-owner
  (`customer_owner_org_id`) · fulfillment (`fulfillment_org_id` nullable + `fulfillment_technician_id`).
  The legacy single `dispatch_owner` field is **retired**.
- **Customer identity: global resolution (by phone), org-scoped ownership.** Global de-dup/safety
  record, **never tenant-browsable**; the customer *relationship* is org-scoped + RLS-isolated.
- **Ownership defaults to the origin owner;** the fulfiller earns the job fee, ClueXP earns the
  platform fee; no-poach default (`no_solicit_required=true`) — partners won't release overflow if
  fulfillers can steal customers.
- **Two fields, not one enum:** `dispatch_mode` (`organization_managed` | `cluexp_managed_routing`)
  controls routing; `fulfillment_policy` (`private` | `network_overflow` | `network_open`) is the
  overflow ladder. Private-by-default; cross-tenant exposure is opt-in/explicit (anonymous capacity
  shows only masked data — identity revealed on assignment).
- **No bidding/auction in MVP** — matching is deterministic/ranked; `marketplace_state` + bidding
  tables are **reserved, not built**.
- **Trusted-channel resolution server-side;** a browser-supplied `org_id` is **attribution only,
  never authority** (anti-spoofing).
- **ClueXP is a platform actor, never a `fulfillment_org_id`.** Merchant-of-record/insurance is
  **deferred** (a nullable `responsible_organization_id` is reserved so the legal answer can be set
  later without a retrofit).
- **Trust-state contract reinforced:** `matched` fires only on a named verified
  `fulfillment_technician_id`; org-accept ≠ matched; no customer/tech identity before assignment.
