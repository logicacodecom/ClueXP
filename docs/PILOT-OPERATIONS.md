# ClueXP Pilot Operations

> **The single operational runbook for the MVP pilot** — readiness gates, the operator
> cutover playbook, the demo walkthrough, the acceptance matrix, and rollback. Consolidated
> 2026-06-19 from the former `MVP-PILOT-RUNBOOK.md`, `PILOT-DEMO.md`, and
> `PILOT-CUTOVER-PLAYBOOK.md`.
>
> **Model:** isolated-tenant, **provider-managed** dispatch. **ClueXP does not dispatch** —
> the provider company's own dispatcher assigns the company's own technicians. ClueXP Ops is
> **read-only** dispatch oversight + platform administration. Architecture: see
> [`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md); status: [`EXECUTION-PLAN.md`](EXECUTION-PLAN.md).
>
> **Safety (non-negotiable):** never paste secrets, tokens, tracking links, real customer
> PII, or real channel/org UUIDs into this repo or any shared doc. Use a **synthetic**
> customer identity and a **disposable** request for all preflight and matrix steps. Capture
> evidence in the **private** pilot evidence log, not here.
>
> **Pilot channel:** `metro-key`.

---

## 1. Access Links

| App | Audience | URL |
|---|---|---|
| Intake (branded channel) | Customer | `https://intake.cluexp.com/o/metro-key` |
| Customer tracking | Customer | `https://intake.cluexp.com/t/{token}` _(returned after submit)_ |
| Provider console (**dispatch + recovery**) | MetroKey dispatcher | `https://partners.cluexp.com` |
| Technician PWA | Technician | `https://tech.cluexp.com` |
| Ops console (**read-only oversight**) | ClueXP internal | `https://ops.cluexp.com` |

> **Use the production domains only.** Preview deploys have no `DATABASE_URL` and fall back
> to an in-memory store with no pilot channel.

## 2. Credentials (demo)

All demo accounts share the password **`123456`**. Emails are **literal** — `@cluexp.example`
and `@metrokey.example` are real addresses here, **not** placeholders.

| Name | Email | Role in the demo |
|---|---|---|
| **Nadia Reyes** | `dispatch@metrokey.example` | **MetroKey dispatcher** — assigns + recovers (provider console) |
| **Jordan Lee** | `jordan@cluexp.example` | MetroKey **affiliate technician** — assignable, online |
| **Marcus Reyes** | `marcus@metrokey.example` | MetroKey **affiliate technician** — assignable, online |
| **Lena Ortiz** | `lena@metrokey.example` | MetroKey **affiliate technician** — assignable, online |
| Avery Knox | `avery@cluexp.com` | Platform admin — **oversight only, does not dispatch** |

> For the demo, all three technicians belong to MetroKey, so MetroKey's dispatcher can assign
> any of them. (Dispatching to *independent* technicians — those with no organization — is a
> future "ClueXP Direct" capability, out of scope for this MVP.)

---

## 3. Readiness Gates

Do not enable a company channel for real customers until all of these are true:

- Company recovery controls (cancel/release/no-show/recall/resolve + notes + timeline) are merged and verified.
- CI passes API tests, Alembic offline validation, shared typecheck, and all four application builds.
- Production migration head is **at least `0015_job_payments`** (prod is currently at
  `0021_tech_doc_defaults`); `job_notes` (`0014`) and `job_payment_reports` (`0015`) are present.
- `ARRIVAL_PIN_SECRET`, `CRON_SECRET`, database credentials, and application authentication
  secrets are configured in the production secret manager.
- The pilot company and approved technician roster are recorded **outside this public repository**.
- A dispatcher is assigned for the complete pilot window.
- Rollback owners have access to Vercel and the production database.

---

## 4. Preflight (read-only, before any change)

Record each in the private pilot evidence log. Use a synthetic identity and a disposable
request — never a real customer's data to prove readiness.

| Check | Required evidence |
|---|---|
| Release | Git commit deployed by each of the four Vercel projects (prod `main` tip) |
| Database | `alembic_version.version_num` ≥ `0015_job_payments`; `job_notes` + `job_payment_reports` present |
| Global switch | Current `DISPATCH_CUTOVER_GLOBAL_OFF` value |
| Company channel | Channel ID, slug, owner organization, and `dispatch_cutover_enabled` |
| Provider access | Provider dispatcher can sign in and sees only its organization |
| Technician supply | Approved technicians are active, verified, correctly affiliated, and have required skills |
| Customer path | Branded `/o/{slug}` page loads and returns a tracking path after submission |
| Recovery | Company dispatcher can open the live recovery workspace |

### 4.1 Confirm runtime flags (must be OFF before any change)

Authenticate as **platform_admin** (first-party httpOnly-cookie session), then read the
effective runtime flags from the deployed intake function:

```
GET https://intake.cluexp.com/api/ops/flags
```

Expected **before** cutover:

```json
{
  "dispatch_cutover_global_off": true,
  "dispatch_cutover_public": false,
  "arrival_pin_configured": true,
  "is_production": true
}
```

- `dispatch_cutover_global_off` **must be `true`** here. If it is already `false`, STOP and
  reconcile — a channel could go live the moment it is enabled.
- `arrival_pin_configured` must be `true` (real `ARRIVAL_PIN_SECRET`, not the dev default).
- Record all four values in the private evidence log.

### 4.2 Identify the approved channel + org, confirm supply (DB, read-only)

Run in the Supabase SQL Editor. **Do not copy the returned UUIDs into this repo.**

```sql
-- Metro Key channel + owning org + current flag
select c.id          as channel_id,
       c.slug,
       c.organization_id,
       o.display_name as org_name,
       c.dispatch_cutover_enabled
from intake_channels c
join organizations o on o.id = c.organization_id
where c.slug = 'metro-key';
```

Confirm exactly **one** row, `dispatch_cutover_enabled = false`, and the org is the approved
**Metro Key** organization.

```sql
-- Technician supply for the owning org (affiliation / availability / skills)
select t.id, t.display_name, t.is_available, t.rating,
       t.location_updated_at, t.skills
from technicians t
where t.primary_organization_id = '<metro-key-org-uuid>'
order by t.display_name;
```

Confirm the approved roster is present, affiliated to the org, and carries the skills the
pilot needs. **Also confirm by login (not just DB):** a Metro Key **dispatcher** can sign in
at `partners.cluexp.com/signin`, sees **only** Metro Key's queue/fleet (tenant isolation),
and can open the **recovery workspace** (`/recovery`).

---

## 5. Enable One Company (operator playbook)

> Order matters: enable the channel row **first** (global switch still ON, so nothing goes
> live yet), then flip the global switch, then redeploy. **Do not enable public/channelless
> intake** — only the metro-key channel changes.

1. Re-confirm `dispatch_cutover_global_off = true` (§4.1).
2. Enable only the approved company's channel:

   ```sql
   update intake_channels
   set dispatch_cutover_enabled = true
   where id = '<approved-channel-uuid>'
     and organization_id = '<approved-organization-uuid>';
   ```

3. Verify **exactly one** intended row changed:

   ```sql
   select id, slug, dispatch_cutover_enabled
   from intake_channels where id = '<approved-channel-uuid>';
   ```

4. In Vercel, set `DISPATCH_CUTOVER_GLOBAL_OFF=false` on the **cluexp-intake** project's
   **Production** environment.
5. Redeploy **cluexp-intake** so the env change takes effect (redeploy the current production
   deployment, or push a no-op — env changes require a new deploy).
6. Re-read `GET /api/ops/flags` → `dispatch_cutover_global_off` is now `false`.
7. Submit one **synthetic** request through the branded channel and confirm it enters the
   owning company's provider queue as `pending_dispatch` with **no automatic offer**.

---

## 6. Demo Workflow Walkthrough

### Step 1 — Customer submits a request
1. Open `https://intake.cluexp.com/o/metro-key` (the branded channel ties the request to MetroKey).
2. Pick lockout type (Car → `vehicle` skill / Home / Business) and situation.
3. Enter a **NYC address** using the autocomplete dropdown (selecting a suggestion geocodes
   it — never type freehand, or `lat`/`lng` stay null and the job won't appear).
4. Add photos (optional) → identity screen → **Get estimate** → **Accept** → **Request help**.
5. The customer lands on `https://intake.cluexp.com/t/{token}`. The job enters MetroKey's
   queue as `pending_dispatch` — **no offer is created automatically.**

### Step 2 — MetroKey dispatcher assigns (provider console)
1. Sign in to **`https://partners.cluexp.com`** as **Nadia Reyes** (`dispatch@metrokey.example`).
2. Open **Queue** — the new job appears (MetroKey's jobs only).
3. Click the job → candidates = **MetroKey's own technicians** (Jordan, Marcus, Lena) with
   distance, ETA, online/busy, and skill-match highlight.
4. Click **Assign**. If the technician is offline/busy/skill-mismatch, the console requires an
   **override reason** before sending. One 90-second offer goes out; on expiry the job returns
   to MetroKey's queue.

### Step 3 — Technician accepts (tech PWA)
1. Open **`https://tech.cluexp.com`**, sign in as the assigned technician.
2. An offer card appears with a countdown → tap **Accept** (first-accept-wins).
3. The customer tracking page shows the named technician.

### Step 4 — Field lifecycle (with secure arrival PIN)

| Action | Result |
|---|---|
| **Start route** | shares GPS, sets `en_route` |
| **Confirm arrival** | opens **PIN entry** — the technician asks the customer for the 6-digit arrival PIN |
| **Start service** | `in_progress` |
| **Request customer confirmation** | `completed_pending_customer` (technician can never set `completed_confirmed`) |

**Arrival PIN (secure):** while `en_route`, the customer taps **"Show arrival PIN"** on the
tracking page → reads the 6-digit code to the technician on site → the technician enters it →
`en_route → arrived`. The PIN is hashed, single-use, expiring (15 min), and attempt-limited.
A direct "arrived" without the PIN is rejected; MetroKey's dispatcher can override arrival
(with a reason) from the recovery workspace if needed.

**Technician problem report:** from the active job the technician can **Report a problem**
(`can't complete` / `customer unavailable` / `unsafe`) — it flags MetroKey's recovery
workspace; the dispatcher decides what happens next.

### Step 5 — Customer closes the job
On `/t/{token}`: **Confirm** (`completed_confirmed`), **Dispute** (`disputed`), or no action
→ `completed_auto_closed` after 72h. The customer may **Cancel** before arrival.

### Step 6 — Recovery (MetroKey dispatcher, `partners.cluexp.com` → Recovery)
Tenant-scoped, reason-required, audited:
- **Cancel** a job · **Release** the technician (→ back to queue; revokes their access) ·
  **Mark no-show** · **Recall** an active offer · **Resolve** a disputed job.
- **Reassign** = Release → re-assign from the queue.
- **Internal notes** + a per-job **audit timeline** (notes are never shown to customers/technicians).

> ClueXP Ops (`https://ops.cluexp.com`, Avery) is **read-only** — it cannot assign or recover
> another company's jobs.

---

## 7. Pilot Acceptance Matrix

Capture job IDs, actor roles, timestamps, expected vs. actual result, and screenshots or
sanitized API responses in the private evidence log. Customer-side calls go to
`https://intake.cluexp.com/api`; provider/technician actions use authenticated sessions on
`partners` / `tech`.

| Scenario | Required result |
|---|---|
| Happy path | Branded request → provider assignment → technician acceptance → en route → PIN arrival → in progress → completion → customer confirmation |
| Decline | Optional reason persists when supplied; job returns to the same company's queue |
| Offer expiry | Expired offer returns the job to the same company's queue without automatic reassignment |
| Assignment race | One targeted offer wins; competing action receives `409` |
| Override assignment | Flagged technician requires and records an override reason |
| Customer cancellation | Allowed before arrival; active offer is revoked; technician/customer refreshes reflect cancellation |
| Technician failure | Failure reason recorded; provider can release and replace the technician |
| Reassignment | Previous technician loses access; replacement receives a new targeted offer; history remains visible |
| Arrival PIN failures | Wrong, expired, reused, locked, and wrong-technician PIN attempts fail without advancing status |
| Arrival override | Owning provider can override with a reason; foreign provider and platform admin cannot |
| No-show | Recorded with actor, reason, timestamp, and resulting state (kept in *provider* history; excluded from *technician* history) |
| Dispute | Customer disputes; owning provider resolves or closes with an audit event |
| Auto-close | Shortened non-production window closes `completed_pending_customer` exactly once |
| Tenant isolation | Foreign jobs, technicians, documents, reviews, recovery actions, and notes are inaccessible |
| Rollback | Global switch prevents new requests entering dispatch while existing jobs remain visible for recovery (§8) |

**Happy-path API sequence:** `POST /api/tickets {intake_channel:"metro-key", …}` → open
`/t/{token}` → dispatcher `GET /api/provider/queue` → `GET /api/provider/queue/{id}/candidates`
→ `POST /api/provider/queue/{id}/assign` → technician accepts → arrival PIN via
`POST /api/jobs/{job_id}/arrival/verify` → completion (`completed_pending_customer`, optional
`POST /api/jobs/{job_id}/collection`) → customer confirms. The live map shows the technician
only while `en_route`/`arrived`/`in_progress` **and** the location is fresh.

---

## 8. Emergency Rollback

Use the **global switch first** when the defect may affect more than one company:

1. Set `DISPATCH_CUTOVER_GLOBAL_OFF=true` in the **cluexp-intake** Production environment.
2. Redeploy cluexp-intake.
3. `GET /api/ops/flags` → `dispatch_cutover_global_off: true`.
4. Submit a synthetic branded request and verify it does **not** enter `pending_dispatch`.
5. Confirm existing operational jobs remain visible to the owning provider.
6. Record the incident time, deployed commit, affected jobs, and operator.

To disable only **one** company (affects new intake immediately, **no redeploy**):

```sql
update intake_channels
set dispatch_cutover_enabled = false
where id = '<affected-channel-uuid>'
  and organization_id = '<affected-organization-uuid>';
```

Verify exactly one row changed. If the application deployment itself is defective, promote the
last known-good deployment for the affected Vercel project **after** the dispatch switch is
off. **Never downgrade the database automatically or edit lifecycle columns directly** —
migrations require a separate, reviewed recovery decision.

**Existing jobs during rollback:** do not delete jobs or offers; do not edit lifecycle columns;
the owning provider continues recovery through supported controls; preserve events and internal
notes as the audit trail; escalate any job that cannot be safely recovered through the application.

---

## 9. Known Limitations (this pilot)

| Area | Status |
|---|---|
| Real payment | None — demo charge/finalize routes are removed (`410`) |
| SMS / email / push | Not available — share the tracking link manually |
| Live map / ETA | Coarse, clearly-labelled estimate (no continuous tracking) |
| Technician GPS | Foreground/manual — PWA must be open |
| Dispatch model | **Provider-managed** — ClueXP does not dispatch; public-marketplace + independent-tech dispatch is a future version |

---

## 10. Sign-Off

- [ ] Every required matrix row passed, or has an approved documented exception.
- [ ] No cross-tenant data or mutation access was observed.
- [ ] No fabricated payment, notification, ETA, or live-location behavior appeared.
- [ ] Rollback was demonstrated.
- [ ] Product owner, Metro Key dispatcher, and technical release owner approved the private
      evidence log.

When sign-off is complete, record the go-live commit, the enabled channel, and the operator in
the **private** log (not here).
