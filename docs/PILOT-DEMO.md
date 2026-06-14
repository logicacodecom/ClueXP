# ClueXP Pilot Demo Guide

> **Model:** isolated-tenant, **provider-managed** dispatch. **ClueXP does not dispatch** —
> the provider company's own dispatcher assigns the company's own technicians. ClueXP Ops
> is read-only oversight + platform administration.
> **Authoritative pilot procedure + rollback:** `docs/MVP-PILOT-RUNBOOK.md`.
> **Pilot channel:** `metro-key` · **Rewritten:** 2026-06-14

---

## 1. Access Links

| App | Audience | URL |
|---|---|---|
| Intake (branded channel) | Customer | `https://intake.cluexp.com/o/metro-key` |
| Customer tracking | Customer | `https://intake.cluexp.com/t/{token}` _(returned after submit)_ |
| Provider console (**dispatch + recovery**) | MetroKey dispatcher | `https://partners.cluexp.com` |
| Technician PWA | Technician | `https://tech.cluexp.com` |
| Ops console (**read-only oversight**) | ClueXP internal | `https://ops.cluexp.com` |

> **Use the production domains only.** Preview deploys have no `DATABASE_URL` and fall back to an in-memory store with no pilot channel.

---

## 2. Credentials

All demo accounts share the password **`123456`**. Emails are **literal** — note `@cluexp.example`
and `@metrokey.example` are real addresses here, **not** placeholders.

| Name | Email | Role in the demo |
|---|---|---|
| **Nadia Reyes** | `dispatch@metrokey.example` | **MetroKey dispatcher** — assigns + recovers (provider console) |
| **Jordan Lee** | `jordan@cluexp.example` | MetroKey **affiliate technician** — assignable, online |
| **Marcus Reyes** | `marcus@metrokey.example` | MetroKey **affiliate technician** — assignable, online |
| **Lena Ortiz** | `lena@metrokey.example` | MetroKey **affiliate technician** — assignable, online |
| Avery Knox | `avery@cluexp.com` | Platform admin — **oversight only, does not dispatch** |

> **For the demo, all three technicians belong to MetroKey**, so MetroKey's dispatcher
> can assign any of them. (Dispatching to *independent* technicians — those with no
> organization — is a future "ClueXP Direct" capability, out of scope for this MVP.)

---

## 3. Full Workflow

### Step 1 — Customer submits a request
1. Open `https://intake.cluexp.com/o/metro-key` (the branded channel ties the request to MetroKey).
2. Pick lockout type (Car → `vehicle` skill / Home / Business) and situation.
3. Enter a **NYC address** using the autocomplete dropdown (selecting a suggestion geocodes it — never type freehand, or `lat`/`lng` stay null and the job won't appear).
4. Add photos (optional) → identity screen → **Get estimate** → **Accept** → **Request help**.
5. The customer lands on their tracking link `https://intake.cluexp.com/t/{token}`. The job enters MetroKey's queue as `pending_dispatch` — **no offer is created automatically.**

### Step 2 — MetroKey dispatcher assigns (provider console)
1. Sign in to **`https://partners.cluexp.com`** as **Nadia Reyes** (`dispatch@metrokey.example` / `123456`).
2. Open **Queue** — the new job appears (MetroKey's jobs only).
3. Click the job → candidates = **MetroKey's own technicians** (Jordan, Marcus, Lena) with distance, ETA, online/busy, and skill-match highlight.
4. Click **Assign**. If the technician is offline/busy/skill-mismatch, the console requires an **override reason** before sending. One 90-second offer goes out; on expiry the job returns to MetroKey's queue.

### Step 3 — Technician accepts (tech PWA)
1. Open **`https://tech.cluexp.com`**, sign in as the assigned technician — **Jordan** (`jordan@cluexp.example`), **Marcus** (`marcus@metrokey.example`), or **Lena** (`lena@metrokey.example`), all `123456`.
2. An offer card appears with a countdown → tap **Accept** (first-accept-wins).
3. The customer tracking page shows the named technician.

### Step 4 — Field lifecycle (with secure arrival PIN)
On the technician's active job:

| Action | Result |
|---|---|
| **Start route** | shares GPS, sets `en_route` |
| **Confirm arrival** | opens a **PIN entry** — the technician asks the customer for the 6-digit arrival PIN |
| **Start service** | `in_progress` |
| **Request customer confirmation** | `completed_pending_customer` (technician can never set `completed_confirmed`) |

**Arrival PIN (secure):** while `en_route`, the customer taps **"Show arrival PIN"** on the
tracking page → reads the 6-digit code to the technician on site → the technician enters it →
`en_route → arrived`. The PIN is hashed, single-use, expiring (15 min), and attempt-limited.
A direct "arrived" without the PIN is rejected; MetroKey's dispatcher can override arrival
(with a reason) from the recovery workspace if needed.

**Technician problem report:** from the active job, the technician can **Report a problem**
(`can't complete` / `customer unavailable` / `unsafe`) — it flags MetroKey's recovery
workspace; the dispatcher decides what happens next.

### Step 5 — Customer closes the job
On `/t/{token}`: **Confirm** (`completed_confirmed`), **Dispute** (`disputed`), or no action →
`completed_auto_closed` after 72h. The customer may **Cancel** before arrival.

### Step 6 — Recovery (MetroKey dispatcher, `partners.cluexp.com` → Recovery)
Tenant-scoped, reason-required, audited:
- **Cancel** a job · **Release** the technician (→ back to queue; revokes their access) · **Mark no-show** · **Recall** an active offer · **Resolve** a disputed job.
- **Reassign** = Release → re-assign from the queue.
- **Internal notes** + a per-job **audit timeline** per job (notes are never shown to customers/technicians).

> ClueXP Ops (`https://ops.cluexp.com`, Avery) is **read-only** — it cannot assign or recover another company's jobs.

---

## 4. Known Limitations for This Pilot

| Area | Status |
|---|---|
| Real payment | None — demo charge/finalize routes are removed (`410`) |
| SMS / email / push | Not available — share the tracking link manually |
| Live map / ETA | Coarse, clearly-labelled estimate (no continuous tracking) |
| Technician GPS | Foreground/manual — PWA must be open |
| Dispatch model | **Provider-managed** — ClueXP does not dispatch; public-marketplace + independent-tech dispatch is a future version |

---

## 5. Rollback

Authoritative procedure: **`docs/MVP-PILOT-RUNBOOK.md` §5**. Quick reference:

- **Disable one company's channel** (immediate, no redeploy):
  ```sql
  UPDATE intake_channels SET dispatch_cutover_enabled = false
  WHERE id = '<metro-key-channel-uuid>' AND organization_id = '<metrokey-org-uuid>';
  ```
- **Emergency global kill-switch:** set `DISPATCH_CUTOVER_GLOBAL_OFF=true` in the intake Vercel project and redeploy. (Verify at runtime via `GET /ops/flags` as a platform admin.)

---

## 6. Prerequisites (operational)

- Production migration head must be current — internal notes require **migration `0014` (job_notes)** applied (see the runbook's release gate).
- Redeploy all four Vercel projects from `main` before the demo.
- The pilot company's channel (`metro-key`) flag is enabled only when ready; otherwise the global switch keeps dispatch off.
