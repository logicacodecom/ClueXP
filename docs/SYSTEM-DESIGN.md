# ClueXP — System Design Reference

> **Who this is for:** Engineers, on-call humans, and AI agents working in this codebase.
> It is a living document — update it when the system changes.
> Last updated: 2026-06-13.

---

## 1. What ClueXP Is

ClueXP is an **emergency access marketplace**. A customer (car locked out, home lockout, broken key) submits a job via a web form. The job enters the **ops dispatch queue**. A ClueXP dispatcher reviews the job, selects a technician, and sends a targeted assignment offer. Once the technician accepts, the system drives the full service lifecycle — from the technician arriving on-site through the customer confirming the work is done.

There are four apps and one FastAPI backend in this monorepo:

| App | URL | Who uses it |
|-----|-----|-------------|
| `intake-web` | `intake.cluexp.com` | Customers submitting jobs (also hosts the FastAPI backend) |
| `technician-web` | `tech.cluexp.com` | Field technicians — accepts offers, navigates, updates job status |
| `ops-web` | `ops.cluexp.com` | ClueXP internal operations, approvals, escalations |
| `provider-web` | `provider.cluexp.com` | Service provider orgs — manage technicians, teams, intake |

---

## 2. The Two-Track State Model

This is the most important concept in the whole system. A job has **two orthogonal state fields** that must never be confused:

### `trust_state` — the privacy gate
Controls what the customer is allowed to see. Defined in `schema.py`.

| Value | Meaning |
|-------|---------|
| `intake` | Job is being collected; no technician committed. Customer sees a loading/waiting screen. |
| `matched` | A technician has accepted. Customer may see technician info. |
| `fulfillment` | Live operational data (en route, on-site, etc.) is flowing. |

`trust_state` only ever moves **forward**: `intake → matched → fulfillment`. It never goes backward. It is set by the backend — never trusted from the browser.

### `jobs.status` — the operational lifecycle
Tracks where the job is in its physical lifecycle. This is the Sprint 3 cutover addition (only populated for cutover-path jobs; legacy jobs leave this as `draft`).

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

**Public intake** — `intake.cluexp.com/` → renders `IntakeFlow` with no org slug. Uses the public dispatch path.

**Channel-specific intake** — `intake.cluexp.com/o/{slug}` → renders `IntakeFlow` with `organizationSlug=slug`. Wires the job to that org's channel and policy.

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
4. **Cutover check** — fires if either:
   - Channel has `dispatch_cutover_enabled = true`, OR
   - No channel + `DISPATCH_CUTOVER_PUBLIC=true` (env var)
   - AND `DISPATCH_CUTOVER_GLOBAL_OFF` is not set
5. If cutover fires:
   - `set_job_status(id, "pending_dispatch")` — job enters the ops dispatch queue
   - `get_tracking_token(id)` — returns the token; `tracking_path = /t/{token}` included in response
   - **No offers are created automatically.** A dispatcher must assign a technician via `POST /ops/queue/{job_id}/assign`.

### 3.4 What Happens at Commit (`POST /api/tickets/{id}/commit`)

- Records all form data (location, identity, price acceptance) into `jobs.detail` (JSONB)
- Geocodes address if not already geocoded (sets `lat`, `lng`)
- On legacy (non-cutover) path: calls `/dispatch` stub (instant fake match), returns legacy tracking
- On cutover path: returns the `tracking_path` so the frontend redirects to `/t/{token}`

---

## 4. Dispatch Engine (Ops-Controlled)

**Model:** Dispatching is exclusively a human decision. The system never automatically assigns a technician. When a job is committed it enters `pending_dispatch` and waits in the ops queue. A ClueXP dispatcher reviews the job, selects a technician, and sends a single targeted offer. The technician accepts or declines. Decline or expiry returns the job to `pending_dispatch` — the dispatcher tries again.

### 4.1 Where the Code Is

| File | What it contains |
|------|-----------------|
| `apps/intake-web/api/dispatch.py` | Pure functions — distance (`haversine_km`), ETA (`eta_range_from_km`), state machine helpers, status constants. No I/O. |
| `apps/intake-web/api/config.py` | Tunable constants and feature flags |
| `apps/intake-web/api/main.py` | `/ops/*` dispatch endpoints; `/cron/dispatch-sweep` (cleanup only) |
| `apps/intake-web/api/store.py` (PostgresStore) | `get_ops_queue`, `list_all_technicians_for_ops`, `get_fleet_state`, `create_dispatch_offers`, `accept_dispatch_offer`, `decline_dispatch_offer`, `expire_stale_offers`, `auto_close_pending` |

### 4.2 How a Job Gets Dispatched

#### Step 1 — Job enters the ops queue (`pending_dispatch`)
At ticket commit, `set_job_status(id, "pending_dispatch")` is called. No offers are created. The job sits in the queue until a dispatcher acts.

#### Step 2 — Dispatcher views the queue (`GET /ops/queue`)
Returns all `pending_dispatch` jobs ordered oldest-first. The queue read also runs lazy cleanup:
- `expire_stale_offers()` — marks any stale `offered` rows as `expired`, returns the job to `pending_dispatch` if no active offer remains
- `auto_close_pending()` — closes `completed_pending_customer` jobs past the auto-close window

#### Step 3 — Dispatcher views candidates (`GET /ops/queue/{job_id}/candidates`)
Returns **all** `status=active` + `vetting_status=verified` technicians — no area filter, no availability filter. Dispatcher sees everyone. Per-tech signals computed on the fly:

| Signal | Source |
|--------|--------|
| `dist_km` | `haversine_km(job.lat, job.lng, tech.current_lat or service_area_center_lat, ...)` |
| `eta_min`, `eta_max` | `eta_range_from_km(dist_km)` |
| `is_online` | `location_updated_at > now() − LOCATION_ONLINE_THRESHOLD_MINUTES` |
| `is_busy` | `get_technician_active_job(tech.id) is not None` |
| `active_job` | `{id, status, address}` if busy, else null |
| `skills_match` | `job.access_type in tech.skills` (bool — highlighted in UI, not a filter) |

#### Step 4 — Dispatcher assigns (`POST /ops/queue/{job_id}/assign`)
Body: `{ "technician_id": UUID }`. Steps:
1. Fetch job — 404 if not found, 409 if not `pending_dispatch`
2. Reject if an active `offered` offer already exists (partial unique index prevents duplicates at DB level)
3. Create single targeted offer: `expires_at = now() + OFFER_TTL_SECONDS`
4. Write audit event: `"ops:assign:tech={technician_id}:by={dispatcher_id}"`
5. Return `{ offer_id, technician_id, expires_at }`

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

Skills matching is shown as a highlight but is **not** a hard filter. The dispatcher may assign any verified technician regardless of area, availability toggle, or skill.

### 4.4 Cleanup-Only Cron (`POST /cron/dispatch-sweep`)

The cron endpoint no longer re-dispatches. It performs only maintenance:
```
1. expire_stale_offers() — marks all offers past expires_at as "expired"
2. auto_close_pending() — completed_pending_customer jobs older than AUTO_CLOSE_WINDOW_SECONDS → completed_auto_closed
```
The cron is also no longer strictly necessary — both operations run inline on `GET /ops/queue`. It may be retained as a safety net or removed entirely.

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
| 2 | Arrives on-site | `arrived` | `PATCH /api/tickets/{id}/status { status: "arrived" }` |
| 3 | Begins service | `in_progress` | `PATCH /api/tickets/{id}/status { status: "in_progress" }` |
| 4 | Work complete, awaiting customer | `completed_pending_customer` | `PATCH /api/tickets/{id}/status { status: "completed_pending_customer" }` |

Each transition writes a timestamp column (`en_route_at`, `arrived_at`, etc.) and validates forward-only movement with `can_technician_transition(current, target)`.

### 5.2 Completion (Customer-Driven)
The customer holds a token link (`/t/{token}`). When the tech marks `completed_pending_customer`:
- Customer tracking page shows a "Confirm" button
- Customer taps → `POST /t/{token}/confirm` → sets `status = completed_confirmed`, `trust_state = fulfillment`
- If customer doesn't confirm within `AUTO_CLOSE_WINDOW_SECONDS` (72h), cron auto-closes it to `completed_auto_closed`

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

**BFF API routes** (Next.js serverless, in `src/app/api/`):
- `GET /api/session` → proxies `GET /api/auth/me` (reads httpOnly cookie `cluexp_access_token`)
- `GET /api/offers` → proxies `GET /api/technicians/{id}/offers`
- `POST /api/offers/{id}/accept` → proxies to backend
- `POST /api/offers/{id}/decline` → proxies to backend
- `GET /api/active-job` → calls `/api/auth/me` then `/api/technicians/{id}/active-job`
- `GET /api/jobs/{id}` → validates caller owns the active job, returns job detail
- `PATCH /api/availability` → proxies `PATCH /api/technicians/me/availability`

---

## 6. Customer Tracking Page

`apps/intake-web/src/app/t/[token]/page.tsx` — rendered when cutover is active.

**Token resolution:**
- `GET /api/t/{token}` → resolves `tracking_token` column in `jobs` table → returns full tracking state
- Token is set at job creation time, stored in `jobs.tracking_token` (unique index)
- Customer never sees the job UUID — only the opaque token

**Tracking state machine** (pure function in `dispatch.py:resolve_dispatch_state`):

| `state` | Meaning | Customer sees |
|---------|---------|--------------|
| `waiting` | Job in `pending_dispatch` — dispatcher has not yet assigned a technician, or offer expired and queue returned | "Looking for a technician..." |
| `matched` | Tech accepted; trust_state = matched | Technician details card |
| `expired_retry` | Offer expired, job returned to `pending_dispatch`; dispatcher will re-assign | "Still searching..." |
| `no_eligible` | Terminal — no technician assigned after ops review | "No tech available; we'll follow up" |
| `matched` + status=`en_route`/`arrived`/`in_progress` | Live tracking | Progress stepper |
| `completed_pending_customer` | Tech done, customer action needed | Confirm / Dispute buttons |
| `completed_confirmed` / `completed_auto_closed` | Closed | Review prompt |
| `disputed` | Customer disputed | Ops notified |
| `cancelled` | Cancelled | Cancellation screen |

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

### 7.1 Where Migrations Live

`packages/db/` — Alembic migrations. Migration 0010 is the Sprint 3 cutover (fulfillment lifecycle columns, tracking token, dispatch_offers, etc.).

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

**`dispatch_offers`** — One row per offer sent to a technician. In the ops-controlled model, at most one `status='offered'` row exists per `job_id` at any time (enforced by partial unique index from migration 0011).
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

**`technicians`** — One row per field technician.
```
id uuid PK
user_id uuid → users
display_name text
skills text[]           -- ["vehicle", "home", "business"] — must match job access_type
is_available boolean    -- toggle-controlled; only available techs get offers
status text             -- "active" | "suspended" | etc.
vetting_status text     -- "verified" | "pending" | "rejected"
provider_type text      -- "independent" | "organization_member"
primary_organization_id uuid
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

**`user_roles`** — `{ user_id, role }` — roles: `technician`, `admin`, `provider_admin`, `dispatcher`

**`organizations`** — Service provider companies.

**`organization_technicians`** — Many-to-many: which techs are affiliated with which orgs.

**`events`** — Append-only audit log: `{ ticket_id, job_id, event, trust_state, at }`.

**`customers`** — `{ id, phone UNIQUE, name, created_at }` — global, not tenant-scoped.

**`job_reviews`** — Post-completion review: `{ job_id, rating, tags[], comment, ... }`.

**`media`** — Uploaded files: `{ owner_type, owner_id, kind, bucket, path, visibility, uploaded_by, uploaded_at }`.

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

All four apps deploy to Vercel. Monorepo — each app has its own `vercel.json` and its own Vercel project.

| Project | Vercel Project ID | Domain |
|---------|------------------|--------|
| cluexp-intake | `prj_Zpx84LKOnx0kSvHCiQythZvEwM6X` | `intake.cluexp.com` |
| cluexp-technician | `prj_TZJbJlZRCnTTUpNgTY1PGxs9otkg` | `tech.cluexp.com` |

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

**Note:** Both operations also run inline on `GET /ops/queue` (lazy cleanup on read), so the cron is a safety net rather than a hard requirement. It can be disabled without breaking dispatch — the ops queue read keeps itself clean.

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

### Backend (Python / FastAPI)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | Postgres DSN. If unset, in-memory store is used. Use Session Pooler URL (port 5432) not direct (port 5432 IPv6 only). |
| `JWT_SECRET` | — | Signs session JWTs. Must be set in prod. |
| `GOOGLE_MAPS_API_KEY` | — | Server-side geocoding + Places autocomplete. Must have Geocoding + Places API (New) enabled. |
| `CRON_SECRET` | `""` (disabled) | Secret for `POST /cron/dispatch-sweep`. Unset = endpoint returns 503. |
| `SUPABASE_URL` | — | Supabase project URL for storage signed URLs. |
| `SUPABASE_SERVICE_KEY` | — | Service role key for storage operations. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated list of allowed CORS origins. Set in prod. |
| `DEMO_SEED` | `true` | If true, seeds demo technicians/orgs on startup (in-memory store only). |

### Dispatch Tunables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DISPATCH_OFFER_TTL_SECONDS` | `90` | How long a targeted offer lives before it expires and the job returns to `pending_dispatch` |
| `AUTO_CLOSE_WINDOW_SECONDS` | `259200` | 72h — time before `completed_pending_customer` auto-closes |
| `LOCATION_ONLINE_THRESHOLD_MINUTES` | `15` | Techs whose `location_updated_at` is within this window are shown as "online" in the ops candidates view |

**Obsolete (ops-controlled model):** `DISPATCH_SWEEP_INTERVAL_SECONDS`, `DISPATCH_MAX_ROUNDS`, `DISPATCH_TOTAL_TIMEOUT_SECONDS`, `DISPATCH_TOP_N` — no longer used; the sweep is cleanup-only and dispatch is human-driven. Safe to remove from Vercel env vars.

### Cutover Flags

| Variable | Default | Purpose |
|----------|---------|---------|
| `DISPATCH_CUTOVER_GLOBAL_OFF` | `false` | Emergency kill-switch — forces ALL channels back to legacy stub |
| `DISPATCH_CUTOVER_PUBLIC` | `false` | Enable cutover for jobs submitted with no `intake_channel` slug (public intake) |

### Technician App (`technician-web`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_INTAKE_API_BASE` | Backend URL (e.g., `https://intake.cluexp.com`). Used by BFF routes to call the FastAPI backend. |
| `COOKIE_NAME` | Session cookie name (default: `cluexp_access_token`). httpOnly, Secure. |

---

## 10. Auth

### Session Tokens
JWT tokens signed with `JWT_SECRET`. Claims: `{ sub: user_id, roles: [], org: org_id, technician: { id, is_available, ... } }`. Stored as httpOnly cookie `cluexp_access_token`.

### Roles
| Role | Access |
|------|--------|
| `technician` | Can update availability, location, job status for their active job |
| `admin` | Approve/reject technicians and orgs, access all jobs |
| `provider_admin` | Manage their org's technicians, teams, and documents |
| `dispatcher` | Create/manage jobs for their org |

### Password Hashing
PBKDF2-SHA256 with 210,000 iterations. In `auth.py`.

### Rate Limiting (Login)
`LOGIN_MAX_FAILURES = 8` failures within `LOGIN_WINDOW_SECONDS = 900` (15 min) → account locked. Tracked in `login_attempts` table.

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
| `GET` | `/tickets/{id}` | public | Get ticket state (polling endpoint for legacy path) |
| `PATCH` | `/tickets/{id}` | public | Update ticket fields during intake form steps |
| `POST` | `/tickets/{id}/price-quote` | public | Generate price estimate |
| `POST` | `/tickets/{id}/commit` | public | Finalize intake and submit to dispatch |
| `POST` | `/tickets/{id}/dispatch` | — | **Gated (410)** — legacy auto-match stub, removed |

### Customer Tracking (Cutover Path)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/t/{token}` | public | Read tracking state by opaque token |
| `POST` | `/t/{token}/confirm` | public | Customer confirms job completion |
| `POST` | `/t/{token}/dispute` | public | Customer disputes the job |
| `POST` | `/t/{token}/cancel` | public | Customer cancels (allowed pre-arrival) |
| `POST` | `/t/{token}/review` | public | Customer submits a review |

### Ops Dispatch (Requires `dispatcher` or `platform_admin` role)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/ops/queue` | session (dispatcher) | List `pending_dispatch` jobs oldest-first; runs lazy cleanup inline |
| `GET` | `/ops/queue/{job_id}/candidates` | session (dispatcher) | All active+verified techs with computed distance, ETA, online, busy signals |
| `POST` | `/ops/queue/{job_id}/assign` | session (dispatcher) | Create single targeted offer for one technician |
| `GET` | `/ops/fleet` | session (dispatcher) | All active+verified techs with current location and active job data for fleet map |

### Dispatch (Technician-Facing)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/technicians/{id}/offers` | session | List active offers for a technician |
| `POST` | `/offers/{id}/accept` | session | Technician accepts an offer (atomic first-accept-wins) |
| `POST` | `/offers/{id}/decline` | session | Technician declines an offer; job returns to `pending_dispatch` |
| `GET` | `/tickets/{id}/dispatch-status` | public | Check dispatch state (legacy polling) |
| `POST` | `/tickets/{id}/offers` | — | **Gated (410)** — use `/ops/queue/{id}/assign` instead |
| `GET/POST` | `/cron/dispatch-sweep` | CRON_SECRET | Scheduled: expire stale offers + auto-close (no re-dispatch) |

### Job Lifecycle (Cutover Path)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `PATCH` | `/tickets/{id}/status` | session (technician) | Advance job status (technician-settable only) |
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

### Provider / Org
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/auth/register/organization` | public | Register an org |
| `GET/PATCH` | `/provider/workspace` | session (provider_admin) | Org profile |
| `GET/POST` | `/provider/technicians` | session (provider_admin) | List/create affiliated techs |
| `GET/PATCH` | `/provider/teams` | session (provider_admin) | Manage teams |
| `GET/POST` | `/provider/documents` | session (provider_admin) | Upload compliance docs |

### Admin
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/admin/technicians/{id}/approve` | session (admin) | Approve technician |
| `POST` | `/admin/technicians/{id}/reject` | session (admin) | Reject technician |
| `POST` | `/admin/organizations/{id}/approve` | session (admin) | Approve org |
| `PATCH` | `/admin/documents/{id}` | session (admin) | Review a compliance document |

---

## 14. Pilot Techs (Seeded)

For the pilot, these technicians are seeded in the DB:

| Name | Email | Password | Coverage |
|------|-------|---------|---------|
| Jordan Lee | `jordan@cluexp.example` | `123456` | NYC area, skills: vehicle/home/business |
| Marcus Reyes | `marcus@metrokey.example` | — | NYC area |
| Lena Ortiz | `lena@metrokey.example` | — | NYC area |

**Critical requirement:** `is_available` must be `true` in the DB for a tech to receive offers. The toggle in the technician app now reads the real DB value on mount — if it shows "Offline", tap it to go Online.

---

## 15. Key Invariants (Do Not Violate)

These are hard rules enforced by the API. Breaking them causes 403 or data corruption.

1. **`completed_confirmed` is never technician-settable.** Only `POST /t/{token}/confirm` (customer) sets it. Technician API calls trying to set it get 403.
2. **`trust_state` is forward-only and server-owned.** Never trust a `trust_state` value from the browser.
3. **Status is forward-only for technicians.** `can_technician_transition(current, target)` enforces this — only forward movement, only within TECHNICIAN_SETTABLE.
4. **Only a dispatcher may create offers.** `POST /ops/queue/{job_id}/assign` is the sole path to offer creation. `_dispatch_write()` is not called at ticket creation and does not run automatically. No background process creates offers.
5. **`save(ticket)` never overwrites an operational status.** Once a job enters the dispatch pipeline (status is any operational value from `pending_dispatch` onward), the JSONB upsert's CASE guard in `store.py` leaves `status` alone. Only `set_job_status()` and the fulfillment transitions may change it.
6. **Channel slugs are server-resolved; never trust the browser's `intake_channel` as an org ID.** `resolve_intake_channel()` is the single trust boundary.
7. **Offer privacy: area only before acceptance.** `list_technician_offers` returns `area_lat/area_lng` rounded to 1km — never the exact address. Exact address only after acceptance.

---

## 16. Common Failure Modes and Fixes

### "Job created but tech sees nothing in the app"

Checklist:
1. **Has a dispatcher assigned the job?** Dispatch is ops-controlled — no offer is created automatically. Sign in to `ops.cluexp.com`, open the queue, and assign a technician.
2. **Does the job have lat/lng?** `haversine_km` returns `inf` if either coordinate is null — the candidates view will show techs without distances. Fix: `UPDATE jobs SET lat = 40.7128, lng = -74.0060 WHERE id = '...'`
3. **Is the cutover active?** If you used the public intake form (`/`) and `DISPATCH_CUTOVER_PUBLIC` env var is not set, the job never enters `pending_dispatch`. Set `DISPATCH_CUTOVER_PUBLIC=true` in Vercel and redeploy.
4. **Is the offer expired?** If the offer was created but the tech didn't respond within `OFFER_TTL_SECONDS` (default 90s), the offer expired and the job returned to `pending_dispatch`. Dispatcher must assign again.

### "Tech can see offer but accept fails with 409"
Another session accepted the same targeted offer. Should not happen in the single-offer model (dispatcher sends to one tech), but the partial unique index on `dispatch_offers (job_id) WHERE status='offered'` prevents duplicates. Normal behavior on a race — tech should see the offer status update to `superseded` on next poll.

### "Tracking page is stuck at `waiting`"
The job is in `pending_dispatch` — no dispatcher has assigned a technician yet, or the offer expired and wasn't renewed. Sign in to the ops console and assign. The customer tracking page shows "Looking for a technician..." for the full waiting period; there is no automatic escalation to the customer.

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
