# ClueXP Pilot Demo Guide

**Pilot channel:** `metro-key` · **Date:** 2026-06-12 · **Status:** Sprint 3 cutover live

---

## 1. Access Links

| App | Audience | URL |
|---|---|---|
| Intake (pilot channel) | Customer | `https://intake.cluexp.com/o/metro-key` |
| Customer tracking | Customer | `https://intake.cluexp.com/t/{token}` _(generated after submit)_ |
| Technician PWA | Technician | `https://tech.cluexp.com` |
| Ops / dispatch console | ClueXP internal | `https://ops.cluexp.com` |
| Provider console | MetroKey admin | `https://partners.cluexp.com` |

> **Test on production domains only.** Preview Vercel URLs lack the `DATABASE_URL` env var and fall back to an in-memory store with no pilot channel.

---

## 2. Credentials

All demo accounts share the same password: **`123456`**

### Platform admin

| Name | Email | Role |
|---|---|---|
| Avery Knox | `avery@cluexp.com` | Platform admin (ops console, global view) |

### Provider — MetroKey

| Name | Email | Role |
|---|---|---|
| Nadia Reyes | `dispatch@metrokey.example` | Provider admin + dispatcher |

### Technicians (all NYC area, active, verified)

| Name | Email | Skills | Service area |
|---|---|---|---|
| Jordan Lee | `jordan@cluexp.example` | home, business, vehicle | 30 km radius · Midtown Manhattan |
| Marcus Reyes | `marcus@metrokey.example` | home, business, vehicle | 25 km radius · Upper West Side |
| Lena Ortiz | `lena@metrokey.example` | home, business, vehicle | 25 km radius · Midtown South |

> Jordan is an independent technician. Marcus and Lena are MetroKey affiliates.

---

## 3. Pre-demo SQL (run once in Supabase SQL Editor)

```sql
-- Migrate any existing test jobs created before the car→vehicle rename
UPDATE jobs SET access_type = 'vehicle' WHERE access_type = 'car';
```

---

## 4. Full Workflow

### Step 1 — Customer submits a request

1. Open `https://intake.cluexp.com/o/metro-key`
2. Select lockout type: **Car**, **Home**, or **Business**
   _(pick Car for a vehicle lockout → dispatches to any tech with the `vehicle` skill)_
3. Select situation (e.g. Locked out)
4. Enter a **New York City address** — all seeded technicians are NYC-area
   Example: `350 5th Avenue, New York, NY 10118`
   Use the autocomplete suggestions; selecting a suggestion geocodes it automatically
5. Fill vehicle/lock details if prompted
6. Skip or add photos
7. **Identity screen** — enter your name, phone, and authority role, then tap **Continue**
8. Tap **Get estimate** → review the price range and cancellation policy → **Accept**
9. Tap **Request help**

After submit the customer is redirected to their tracking link:
`https://intake.cluexp.com/t/{token}`

---

### Step 2 — Dispatch runs automatically

The backend dispatches immediately on commit and retries every ~90 seconds for up to 8 minutes (3 rounds). The customer tracking page shows **"Searching for a specialist"** with no dispatch internals visible.

To verify dispatch is running:

```sql
SELECT id, status, access_type, dispatch_attempts, lat, lng
FROM jobs ORDER BY created_at DESC LIMIT 5;
```

#### Understanding `dispatch_attempts`

`dispatch_attempts` counts how many dispatch rounds have run for a job. Each round:

1. Engine queries all available, verified technicians
2. Filters by skill + distance
3. Creates offer rows for the top 3 ranked candidates
4. Offers expire after ~90 seconds
5. If nobody accepts, a background sweep picks up the job and runs the next round, incrementing `dispatch_attempts`
6. Repeats until someone accepts **or** `dispatch_attempts` reaches 3 (max) **or** the 480-second total window elapses

| Value | Meaning |
|---|---|
| `0` | Job never committed, or dispatch has not run yet |
| `1–2` | Rounds ran, offers expired, nobody accepted — more rounds pending |
| `3` | All rounds exhausted — falls to human handoff |

---

### Step 3 — Technician receives and accepts an offer

1. Open `https://tech.cluexp.com` and sign in as **Jordan Lee** (`jordan@cluexp.example` / `123456`)
2. Navigate to **Jobs** tab
3. An offer card appears with a 90-second countdown timer
4. Tap **Accept** — first-accept-wins; other technicians' offers are automatically revoked

The customer tracking page updates to **"Specialist assigned"** with the technician's first name and rating.

#### What makes a technician see an offer

A technician only receives an offer when **all** of the following are true at the moment dispatch runs:

**Job conditions:**
- `status = pending_dispatch` (job was fully committed — not draft)
- `lat` / `lng` are not null (requires address selected from autocomplete)
- `dispatch_cutover_enabled = true` on the intake channel
- Job is not yet matched and not timed out

**Technician conditions (all four required):**
- `status = active` and `vetting_status = verified`
- `is_available = true` — toggled online in the app
- `skills` array contains the job's `access_type` (e.g. job is `home`, tech must have `home` in skills)
- Distance from technician's service area center to job coordinates ≤ `service_area_radius_km`

**Policy filter:**
- `network_open` (metro-key default) — any verified tech in range qualifies
- `private` — only technicians in the owner org's pool are eligible

The engine picks the top 3 by nearest-first, then highest rating. If no technician passes all filters, the round produces 0 offers and `dispatch_attempts` increments silently.

> **Common reason for 0 offers:** job `lat`/`lng` are null — always select an address from the autocomplete dropdown, never type freehand. Freehand entry skips geocoding and leaves coordinates empty.

> If no offer appears within 90 seconds, check `dispatch_attempts` and `lat`/`lng` via the SQL above.

---

### Step 4 — Technician walks the job lifecycle

From the active job card on `tech.cluexp.com/jobs`, the technician taps through:

| Action | Status set | Customer sees |
|---|---|---|
| **En route** | `en_route` | "On the way" |
| **Arrived** | `arrived` | "Arrived" |
| **Start service** | `in_progress` | "Service in progress" |
| **Complete** | `completed_pending_customer` | "Service complete — please confirm" |

> The technician **cannot** set `completed_confirmed` — that is customer-only.

---

### Step 5 — Customer closes the job

On the tracking page (`/t/{token}`) the customer chooses:

- **Confirm** — closes the job as `completed_confirmed` ✓
- **Dispute** — moves to `disputed`; requires ops/dispatcher resolution
- _No action_ — auto-closes as `completed_auto_closed` after 72 hours

The customer may also **Cancel** at any point before the technician arrives (free before assignment; cancellation fee applies after assignment).

---

### Step 6 — Dispatcher resolution (dispute path only)

Sign in to `https://ops.cluexp.com` as **Avery Knox** (`avery@cluexp.com` / `123456`) and use the ops queue to review and resolve the disputed job manually.

---

## 5. Known Limitations for This Pilot

| Area | Status |
|---|---|
| SMS / email notifications | Not live — tracking link must be shared manually |
| Payment capture | Demo only — no real charge occurs |
| Live map / ETA routing | Coarse straight-line estimate only |
| Arrival PIN verification | Not yet built (Sprint 4) |
| Provider console dispatch view | Mostly mock-driven |
| Ops escalation queue | Live data; resolution UI partially mock |
| Technician background GPS | PWA only — location updates require app to be open |

---

## 6. Rollback

To disable the pilot channel instantly (no new requests enter the cutover path; existing jobs continue):

```sql
UPDATE intake_channels SET dispatch_cutover_enabled = false
WHERE id = '88c5517a-13ac-4353-a774-a0827cd7790d';
```

Emergency global kill-switch: set env var `DISPATCH_CUTOVER_GLOBAL_OFF=true` in Vercel and redeploy.
