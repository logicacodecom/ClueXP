# ClueXP MVP Pilot Runbook

> **Scope:** isolated-tenant, provider-managed MVP.
> **Rule:** the provider company dispatches its own technicians. ClueXP Ops is
> read-only dispatch oversight and platform administration.
> **Safety:** do not place credentials, tokens, tracking links, or secret values
> in this document or in test evidence.

## 1. Readiness Gates

Do not enable a company channel for real customers until all of these are true:

- Gate 3 company recovery controls are merged and verified.
- CI passes API tests, Alembic offline validation, shared typecheck, and all four
  application builds.
- Production migration head is **`0015_job_payments`** for the current release;
  `job_notes` and `job_payment_reports` are present.
- `ARRIVAL_PIN_SECRET`, `CRON_SECRET`, database credentials, and application
  authentication secrets are configured in the production secret manager.
- The pilot company and approved technician roster are recorded outside this
  public repository.
- A dispatcher is assigned for the complete pilot window.
- Rollback owners have access to Vercel and the production database.

## 2. Preflight

Record the following in the private pilot evidence log:

| Check | Required evidence |
|---|---|
| Release | Git commit deployed by each of the four Vercel projects |
| Database | `alembic_version.version_num = 0015_job_payments`; `job_notes` and `job_payment_reports` present |
| Global switch | Current `DISPATCH_CUTOVER_GLOBAL_OFF` value |
| Company channel | Channel ID, slug, owner organization, and `dispatch_cutover_enabled` |
| Provider access | Provider dispatcher can sign in and sees only its organization |
| Technician supply | Approved technicians are active, verified, correctly affiliated, and have required skills |
| Customer path | Branded `/o/{slug}` page loads and returns a tracking path after submission |
| Recovery | Company dispatcher can open the live recovery workspace |

Use a synthetic customer identity and a disposable test request for preflight.
Do not use a real customer's data to prove deployment readiness.

## 3. Enable One Company

1. Confirm `DISPATCH_CUTOVER_GLOBAL_OFF=true` before changing the channel.
2. Enable only the approved company's channel:

```sql
update intake_channels
set dispatch_cutover_enabled = true
where id = '<approved-channel-uuid>'
  and organization_id = '<approved-organization-uuid>';
```

3. Verify exactly one intended row changed.
4. Set `DISPATCH_CUTOVER_GLOBAL_OFF=false` in the intake production environment.
5. Redeploy the intake project so the environment change takes effect.
6. Submit one synthetic request through the branded channel.
7. Confirm it enters the owning company's provider queue with no automatic offer.

Do not enable public/channelless intake.

## 4. MVP Pilot Matrix

Capture job IDs, actor roles, timestamps, expected result, actual result, and
screenshots or sanitized API responses in a private evidence log.

| Scenario | Required result |
|---|---|
| Happy path | Branded request → provider assignment → technician acceptance → en route → PIN arrival → in progress → completion → customer confirmation |
| Decline | Optional reason persists when supplied; job returns to the same company's queue |
| Offer expiry | Expired offer returns the job to the same company's queue without automatic reassignment |
| Assignment race | One targeted offer wins; competing action receives `409` |
| Override assignment | Flagged technician requires and records an override reason |
| Customer cancellation | Allowed before arrival; active offer is revoked and technician/customer refreshes reflect cancellation |
| Technician failure | Failure reason is recorded; provider can release and replace the technician |
| Reassignment | Previous technician loses access; replacement receives a new targeted offer; history remains visible |
| Arrival PIN failures | Wrong, expired, reused, locked, and wrong-technician PIN attempts fail without advancing status |
| Arrival override | Owning provider can override with a reason; foreign provider and platform admin cannot |
| No-show | Customer or technician no-show is recorded with actor, reason, timestamp, and resulting state |
| Dispute | Customer disputes; owning provider resolves or closes with an audit event |
| Auto-close | Shortened non-production window closes `completed_pending_customer` exactly once |
| Tenant isolation | Foreign jobs, technicians, documents, reviews, recovery actions, and notes are inaccessible |
| Rollback | Global switch prevents new requests entering dispatch while existing jobs remain visible for recovery |

## 5. Emergency Rollback

Use the global switch first when the defect may affect more than one company:

1. Set `DISPATCH_CUTOVER_GLOBAL_OFF=true` in the intake production environment.
2. Redeploy the intake project.
3. Submit a synthetic branded request and verify it does **not** enter
   `pending_dispatch`.
4. Confirm existing operational jobs remain visible to the owning provider.
5. Record the incident time, deployed commit, affected jobs, and operator.

To disable only one company:

```sql
update intake_channels
set dispatch_cutover_enabled = false
where id = '<affected-channel-uuid>'
  and organization_id = '<affected-organization-uuid>';
```

Verify exactly one row changed. This database switch affects new intake
requests immediately and does not require a redeploy.

If the application deployment itself is defective, promote the last known-good
deployment for the affected Vercel project after the dispatch switch is off.
Do not downgrade the database automatically. Migrations require a separate,
reviewed recovery decision.

## 6. Existing Jobs During Rollback

- Do not delete jobs or offers.
- Do not edit lifecycle columns directly.
- The owning provider continues recovery through supported controls.
- Preserve events and internal notes as the audit trail.
- Escalate any job that cannot be safely recovered through the application.

## 7. Sign-Off

Pilot sign-off requires:

- Every required matrix row passed or has an approved, documented exception.
- No cross-tenant data or mutation access was observed.
- No fabricated payment, notification, ETA, or live-location behavior appeared.
- Rollback was demonstrated.
- Product owner, provider dispatcher, and technical release owner approved the
  evidence log.
