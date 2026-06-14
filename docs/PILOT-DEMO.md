# ClueXP Pilot Demo Guide

> **Superseded for the provider-managed MVP.** This June 12 guide documents the
> retired ClueXP-Ops dispatch flow and contains stale arrival/provider-console
> instructions. Do not use it to run the current pilot. Use
> `docs/MVP-PILOT-RUNBOOK.md` and `docs/EXECUTION-PLAN-MVP.md`.

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

### Step 2 — Dispatcher assigns a technician

Dispatch is **ops-controlled** — no offer is created automatically. After the customer submits, the job enters `pending_dispatch` and waits in the ops queue.

1. Sign in to `https://ops.cluexp.com` as **Avery Knox** (`avery@cluexp.com` / `123456`)
2. Open **Queue** — the new job appears with address, access type, and time-in-queue
3. Click the job → view candidates list: all verified technicians with distance, ETA, online/offline, busy/free signals, and skill-match highlight
4. Click **Assign** next to the chosen technician

The system sends a single 90-second offer to that technician. If it expires without a response, the job returns to `pending_dispatch` — the dispatcher assigns again.

To verify queue state via SQL:

```sql
SELECT id, status, access_type, dispatch_attempts, lat, lng
FROM jobs ORDER BY created_at DESC LIMIT 5;
```

> **Common reason for job missing from queue:** `lat`/`lng` are null — always select an address from the autocomplete dropdown, never type freehand.

---

### Step 3 — Technician receives and accepts an offer

1. Open `https://tech.cluexp.com` and sign in as **Jordan Lee** (`jordan@cluexp.example` / `123456`)
2. Navigate to **Jobs** tab
3. An offer card appears with a 90-second countdown timer
4. Tap **Accept** — first-accept-wins at DB level

The customer tracking page updates to **"Specialist assigned"** with the technician's first name and rating.

#### What makes a technician eligible to be assigned

The dispatcher may select **any** `status=active` + `vetting_status=verified` technician from the candidates view. The view highlights these signals to guide the decision:

- `is_online`: `location_updated_at` within the last 15 minutes
- `is_busy`: technician already has an active job
- `skills_match`: job's `access_type` is in the technician's skills (highlight only — not enforced)

> The dispatcher is the sole decision maker. There is no automatic filtering by distance or availability toggle.

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
