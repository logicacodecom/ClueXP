# ClueXP Pilot Cutover — Operator Playbook (metro-key)

> **Purpose:** the concrete, copy-paste steps to take the **already-deployed** MVP
> from "channel OFF" to a verified live pilot for the **Metro Key** company, then
> roll back. This is the operator-driven companion to `docs/MVP-PILOT-RUNBOOK.md`
> (which defines the gates and the full matrix). Run it top to bottom.
>
> **Safety (non-negotiable):** never paste secrets, tokens, tracking links, real
> customer PII, or real channel/org UUIDs into this repo or any shared doc. Use a
> **synthetic** customer identity and a **disposable** request for all preflight and
> matrix steps. Capture evidence in the **private** pilot evidence log, not here.
>
> **Who runs this:** a release owner with (a) a `platform_admin` app login,
> (b) prod database access (Supabase SQL Editor / Session Pooler), and (c) Vercel
> access to the four projects. A `dispatcher` login for Metro Key and a `technician`
> login from the approved roster are needed for the matrix.

---

## 0. Current state (verified 2026-06-15, before any channel change)

Deployed commit on `main`: **`808f108`** (Merge PR #39). All four prod deploys green.
Already smoke-verified read-only (no auth):

- Prod migration head **`0015_job_payments`**; `job_notes` + `job_payment_reports` present.
- `intake.cluexp.com/` → 200; `/o/metro-key` resolves the **Metro Key** branded channel.
- `ops` / `partners` / `tech` → redirect to their `/signin` pages (healthy).
- `/api/ops/flags` → 401 (gated), `/api/cron/dispatch-sweep` → 401 (CRON_SECRET set),
  `/api/t/{bogus}` → clean 404 (the `job_payment_reports` read path works in prod).

**Not yet confirmed (this playbook does it):** runtime flag values, the Metro Key
channel/org IDs and `dispatch_cutover_enabled`, technician supply, provider sign-in,
recovery workspace, and every §4 matrix scenario.

---

## 1. Confirm runtime flags (must be OFF before any change)

Authenticate as **platform_admin**, then read the effective runtime flags from the
deployed intake function (first-party httpOnly-cookie session — call it from your
authenticated browser session or with that session cookie):

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

- `dispatch_cutover_global_off` **must be `true`** here. If it is already `false`,
  STOP and reconcile — a channel could go live the moment it is enabled.
- `arrival_pin_configured` must be `true` (real `ARRIVAL_PIN_SECRET`, not the dev default).
- Record all four values in the private evidence log.

---

## 2. Identify the approved channel + org, and confirm supply (DB, read-only)

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

Confirm exactly **one** row, `dispatch_cutover_enabled = false`, and the org is the
approved **Metro Key** organization.

```sql
-- Technician supply for the owning org (affiliation / availability / skills)
select t.id, t.display_name, t.is_available, t.rating,
       t.location_updated_at, t.skills
from technicians t
where t.primary_organization_id = '<metro-key-org-uuid>'
order by t.display_name;
```

Confirm the approved roster is present, affiliated to the org, and carries the skills
the pilot needs. (Verification status lives in your provider/ops admin flows.)

**Also confirm by login (not just DB):**
- A Metro Key **dispatcher** can sign in at `partners.cluexp.com/signin` and sees
  **only** Metro Key's queue/fleet (tenant isolation).
- The dispatcher can open the **recovery workspace** (`/recovery`).

---

## 3. Enable exactly one company (runbook §3)

> Order matters: enable the channel row **first** (global switch still ON, so nothing
> goes live yet), then flip the global switch, then redeploy.

**3.1** Re-confirm `dispatch_cutover_global_off = true` (Step 1).

**3.2** Enable only the approved channel:

```sql
update intake_channels
set dispatch_cutover_enabled = true
where id = '<metro-key-channel-uuid>'
  and organization_id = '<metro-key-org-uuid>';
```

**3.3** Verify **exactly one** row changed:

```sql
select id, slug, dispatch_cutover_enabled
from intake_channels
where id = '<metro-key-channel-uuid>';
```

**3.4** In Vercel, set `DISPATCH_CUTOVER_GLOBAL_OFF=false` on the **cluexp-intake**
project's **Production** environment.

**3.5** Redeploy **cluexp-intake** so the env change takes effect (redeploy the
current production deployment, or push a no-op — env changes require a new deploy).

**3.6** Re-read `GET /api/ops/flags` → `dispatch_cutover_global_off` is now `false`.

**3.7** Smoke the gate with a **synthetic** branded request (see Step 4.1). Confirm it
enters `pending_dispatch` with **no automatic offer**.

> Do **not** enable public/channelless intake. Only the metro-key channel changes.

---

## 4. Pilot matrix walkthrough (synthetic data only)

All customer-side calls go to `https://intake.cluexp.com/api`. Provider/technician
actions use authenticated sessions on `partners` / `tech`. Capture job IDs, actor
role, timestamps, expected vs. actual, and sanitized responses in the private log.

### 4.1 Happy path
1. **Create branded request** (synthetic):
   ```
   POST https://intake.cluexp.com/api/tickets
   { "intake_channel": "metro-key", ... }   # situation, location, access_type, etc.
   ```
   With the channel ON + global OFF, the response carries `tracking_path` `/t/{token}`
   and the job is `pending_dispatch`. Open `https://intake.cluexp.com/t/{token}`.
2. **Dispatcher assigns** (Metro Key session): `GET /api/provider/queue` →
   `GET /api/provider/queue/{id}/candidates` → `POST /api/provider/queue/{id}/assign`.
   One targeted offer is created; **no** auto-dispatch.
3. **Technician accepts** (roster session on `tech`): offer feed → accept.
4. **En route → arrival PIN**: customer reveals the PIN on `/t/{token}`; technician
   verifies via `POST /api/jobs/{job_id}/arrival/verify`. Status only advances on a
   correct PIN.
5. **In progress → completion**: technician completes
   (`completed_pending_customer`); optionally records advisory collection via
   `POST /api/jobs/{job_id}/collection` (technician-reported, USD-only).
6. **Customer confirms** on `/t/{token}`. Live map shows the technician only while
   en_route/arrived/in_progress **and** the location is fresh; otherwise it shows
   "Live location temporarily unavailable".

### 4.2 Remaining matrix rows (see runbook §4 for the required result of each)
Run and log each: **Decline**, **Offer expiry**, **Assignment race (409)**,
**Override assignment**, **Customer cancellation** (requires a reason; revokes the
active offer), **Technician failure** (`report-issue` → release/replace),
**Reassignment** (old tech loses access; history preserved — note a **no-show** is
intentionally excluded from *technician* history but kept in *provider* history),
**Arrival PIN failures** (wrong/expired/reused/locked/wrong-technician all fail
without advancing), **Arrival override** (owning provider only; foreign provider +
platform_admin → denied), **No-show**, **Dispute** (owning provider resolves/closes
with audit), **Auto-close** (exactly once), **Tenant isolation** (foreign jobs /
techs / docs / reviews / recovery / notes inaccessible), **Rollback** (Step 5).

---

## 5. Rollback drill (must be demonstrated for sign-off — runbook §5)

Global switch first (covers a multi-company defect):

1. Set `DISPATCH_CUTOVER_GLOBAL_OFF=true` on **cluexp-intake** Production.
2. Redeploy cluexp-intake.
3. `GET /api/ops/flags` → `dispatch_cutover_global_off: true`.
4. Submit a synthetic branded request → confirm it does **not** enter
   `pending_dispatch` (stays non-dispatchable).
5. Confirm existing operational jobs remain visible to the Metro Key provider.
6. Log incident time, deployed commit, affected jobs, operator.

Single-company disable (no redeploy needed — affects new intake immediately):

```sql
update intake_channels
set dispatch_cutover_enabled = false
where id = '<affected-channel-uuid>'
  and organization_id = '<affected-org-uuid>';
```

Verify exactly one row changed. Never downgrade the database or edit lifecycle
columns directly; migrations are a separate reviewed decision.

---

## 6. Sign-off (runbook §7)

- [ ] Every matrix row passed, or has an approved documented exception.
- [ ] No cross-tenant data or mutation access observed.
- [ ] No fabricated payment, notification, ETA, or live-location behavior appeared.
- [ ] Rollback demonstrated.
- [ ] Product owner + Metro Key dispatcher + technical release owner approved the
      private evidence log.

When sign-off is complete, record the go-live commit (`808f108` unless a newer deploy
supersedes it), the enabled channel, and the operator in the private log.
