# Provider Workforce Model

Status: planned, not yet implemented as the full production model.

This document consolidates the product decision for provider company signup,
company approval, technician signup/onboarding, and the ClueXP provider workforce
model.

## Product Direction

ClueXP remains a SaaS platform for provider companies. Providers self-manage
their workforce, teams, and dispatch operations. However, a technician identity
belongs globally to ClueXP, not to a single provider company.

The core rule:

- A technician has one global ClueXP profile.
- A provider company has its own account, documents, subscription, teams, and
  workforce controls.
- Provider-company membership for a technician is represented by an affiliation
  record.
- Affiliation history is preserved. Do not overwrite old provider relationships.

This supports the real market: a technician may work with one company for a
period, move to another company, later rejoin the first company, or work with
multiple companies as a non-exclusive contractor.

## Company Signup And Approval

Provider companies should be able to sign up themselves.

Company signup should create a pending provider organization and a provider admin
user. The company should upload the required documents during onboarding or from
its provider workspace.

Ops/platform approval controls whether the provider can operate on ClueXP.

Recommended company lifecycle:

- `pending_review`: company registered, waiting for Ops review.
- `active`: company is approved and may operate.
- `suspended`: company is temporarily blocked.
- `rejected`: company was not approved.
- `closed`: company relationship ended.

Company lifecycle states are separate from technician lifecycle states, even when
they share labels such as `pending_review`. They live on different entities and
must not be treated as one shared enum.

Ops/platform may suspend a company later for reasons such as missing documents,
expired documents, poor reviews, subscription/payment problems, fraud risk,
compliance issues, or operational policy violations.

Provider company responsibilities:

- Maintain company profile and required documents.
- Add/invite technicians.
- Create and manage teams.
- Dispatch only eligible affiliated technicians.
- Stay within future subscription limits such as max active technicians or seats.

Ops/platform responsibilities:

- Approve/reject provider organizations.
- Review compliance documents.
- Suspend/reactivate providers.
- Maintain global platform policy and audit controls.

## Technician Signup And Global Profile

Technicians should be able to sign up independently, before or after being
affiliated with a provider company.

A technician global profile should include:

- User/login identity.
- Display name.
- Profile photo/headshot.
- Email and/or phone.
- Global technician status.
- Global vetting status.
- Skills.
- Service area.
- Documents/licenses, when required.
- Availability and location state.
- Current active-job lock through existing assignment logic.

Recommended global technician lifecycle:

- `pending_review`: technician registered, waiting for platform or provider flow.
- `active`: technician can be used when an active provider affiliation allows it.
- `suspended`: platform-level suspension blocks all provider affiliations.
- `rejected`: technician was not approved.
- `inactive`: technician is not currently operating.

Technician lifecycle states are separate from provider/company lifecycle states.
Global technician suspension is platform-wide; provider affiliation suspension is
company-scoped.

Provider companies should not own or duplicate this global identity. They manage
only their relationship with the technician.

Technician profile photo requirement:

- A technician should upload a clear profile photo/headshot during signup or
  onboarding.
- The photo belongs to the global technician profile, not to one provider.
- Ops/platform should be able to review, reject, or require replacement of an
  inappropriate or unclear photo.
- Providers may see the photo for affiliated technicians, but should not replace
  the technician's global identity photo unless an explicit delegated admin flow
  is added later.

The active-job lock is global to the technician, not scoped to an affiliation.
A non-exclusive technician affiliated with multiple providers must not be
double-dispatched across two companies at the same time. Existing active-job
reads should remain technician-scoped.

## Provider Affiliation Ledger

Provider affiliation is a historical relationship ledger. It is not a single
mutable `company_id` on the technician.

Use or extend the existing `organization_technicians` relationship table rather
than duplicating technician records per company.

Recommended fields:

- `id`
- `organization_id`
- `technician_id`
- `status`
- `affiliation_type`
- `exclusivity`
- `dispatch_allowed`
- `starts_at`
- `ended_at`
- `ended_reason`
- `suspension_reason`
- `invited_by_user_id`
- `approved_by_user_id`
- `created_at`
- `updated_at`

Canonical affiliation statuses:

- `pending_invite`
- `active`
- `suspended`
- `ended`
- `rejected`

The existing `organization_technicians.status` column already defaults to
`pending_invite` from migration `0003`. Use this enum as the canonical list
unless a future migration intentionally renames it. Do not introduce parallel
`invited` or `pending` values.

Recommended affiliation types:

- `employee_w2`
- `contractor`
- `subcontractor`
- `owner_operator`
- `unknown`

Recommended exclusivity values:

- `exclusive`
- `non_exclusive`
- `unknown`

Current provider dispatch eligibility should be derived from the active/current
affiliation row:

```text
status = active
ended_at is null
dispatch_allowed = true
technician.global_status allows work
technician.vetting_status allows work
```

Ended, suspended, and rejected affiliations remain queryable for audit,
reactivation, disputes, compliance, and performance history.

## Migration And Cutover From `primary_organization_id`

Current code still treats `technicians.primary_organization_id` as the provider
roster membership source of truth for eligibility and candidate queries. The full
workforce model changes that source of truth to active affiliation rows in
`organization_technicians`.

This is a cutover, not only a table extension.

Required migration/cutover steps:

1. Backfill existing rows:
   - for every technician with `technicians.primary_organization_id`,
     create an `organization_technicians` row for that organization and
     technician if one does not already exist;
   - use `status='active'`, `dispatch_allowed=true`, `starts_at` from the best
     available existing timestamp, and `ended_at=null`;
   - preserve existing team/role semantics where the current schema already has
     them.
2. Rewire eligibility and candidate reads:
   - provider candidate queries should join `organization_technicians`;
   - `list_all_technicians_for_ops`, `get_ops_technician`, provider workspace
     reads, and dispatch candidate selection should use active/current
     affiliation rows for provider-scoped eligibility;
   - the join condition should include `status='active'`,
     `dispatch_allowed=true`, and `ended_at is null`.
3. Decide the fate of `technicians.primary_organization_id`:
   - preferred: deprecate it as a writable source of membership and keep it only
     as a temporary compatibility/cache field during cutover;
   - if retained as a denormalized cache, define exactly which write path owns
     it and add tests or constraints preventing drift;
   - do not allow both `primary_organization_id` and
     `organization_technicians` to remain independent writable sources of
     provider membership.

Status migration rule:

- existing `pending_invite` rows stay `pending_invite`;
- any legacy `invited` value should map to `pending_invite`;
- any legacy `pending` value should map to `pending_invite`;
- active/suspended/ended/rejected rows keep their equivalent canonical value.

## Leave, Rejoin, And History Rules

Do not overwrite historical affiliation periods.

Example:

```text
Tech T + Company A
2026-01-01 to 2026-03-15, ended, reason: moved region

Tech T + Company B
2026-03-20 to null, active

Tech T + Company A
2026-06-01 to null, active
```

The second Company A relationship should preserve the earlier Company A period.
Prefer creating a new affiliation row when a technician rejoins the same provider
after an ended relationship, unless the repo already has a separate event ledger
that clearly preserves the prior period.

Reactivation should be explicit. If the product later supports reactivating an
old row, it must still preserve all prior active and ended periods through audit
events or a separate affiliation history table.

## Exclusivity Rules

Initial rule:

- A technician may have multiple active non-exclusive affiliations.
- A technician should not receive a new active provider affiliation if they have
  an active exclusive/W-2 affiliation with another provider.
- Later W-2 locking should be enforced from affiliation rules, not by changing the
  global technician identity model.

Exclusivity must be enforced at the database level, not only through a
transactional application check. Add a partial unique index following the same
pattern the repo uses for single active dispatch offers:

```sql
create unique index if not exists organization_technicians_one_active_exclusive
on organization_technicians (technician_id)
where status = 'active'
  and exclusivity = 'exclusive'
  and ended_at is null;
```

If the DB requires different syntax or naming, keep the same semantics: at most
one active exclusive affiliation per technician.

If a provider attempts to attach a technician who already has an active exclusive
affiliation with another provider, return a clear `409` or `422` error.

Suggested UI error:

```text
Technician already has an exclusive active affiliation with another provider.
```

## Provider Workforce Onboarding

Provider workforce onboarding happens from the provider workspace, currently the
`/teams` area.

Expected provider flow:

1. Provider adds or invites a technician.
2. Provider enters name, email and/or phone, affiliation type, exclusivity,
   dispatch permission, skills, and optional team assignment.
3. Backend searches for an existing global user/technician by email or phone.
4. If no technician exists:
   - create user/login identity if needed,
   - create global technician profile,
   - create provider affiliation.
5. If technician already exists:
   - do not create a duplicate technician,
   - create a `pending_invite` affiliation if rules allow it,
   - do not activate the affiliation until the technician accepts or an explicit
     Ops/platform-approved exception exists.
6. Provider manages only its own affiliation and team assignment.

Temporary password should only be required when creating a new login. If the
technician already exists, the provider should not reset or own that technician's
global credentials.

Existing-technician consent is required for activation. A provider knowing a
technician's email or phone should not be enough to silently attach that global
technician as active, because that creates privacy, consent, and enumeration
risk. MVP behavior should create or display an invite-pending state. Follow-up
work can build the technician-side invite acceptance flow, but the data model
should not assume automatic active attachment for existing global technicians.

## Provider Workforce UI

The provider Workforce page should keep the current SaaS console style and shared
`@cluexp/console-ui` primitives:

- `PageHeader`
- `StatCard`
- `Card`
- `Badge`
- `Table`
- visual skill chips

Technician add/invite form should include:

- Name.
- Email and/or phone.
- Temporary password only when a new user/login is being created.
- Affiliation type selector.
- Exclusivity selector.
- Dispatch allowed toggle.
- Visual skill chips, not comma-separated free text.
- Team assignment.

Roster should show:

- Technician name/contact.
- Technician profile photo/headshot.
- Global technician status.
- Global vetting status.
- Affiliation status.
- Affiliation type.
- Exclusivity.
- Dispatch allowed.
- Skills badges.
- Teams.
- Historical/rejoin context when useful, such as "worked with us before".

Invite-pending rows should be visibly distinct from active workforce rows and
must not be dispatchable.

## Customer-Facing Technician Identity

When a technician is assigned to a job, the customer tracking page should show
the assigned technician's name and verified profile photo for security and trust.

Customer-facing rules:

- Do not expose candidate technician identities before assignment/acceptance.
- After a technician accepts/is assigned, show the technician display name,
  profile photo, and provider/company affiliation label where useful.
- The photo should come from the global technician profile and should be reviewed
  or marked acceptable by Ops/platform policy before customer display.
- If no approved photo is available, show a clear fallback state such as
  "Photo pending verification" rather than a misleading generic identity.
- Customer should see the same technician identity throughout en route, arrival,
  in-service, and completion screens unless the provider releases/reassigns the
  job.
- If the job is reassigned, customer tracking should clearly update to the new
  technician's name/photo and preserve the audit trail internally.

This is a security feature, not only a UI polish item. It helps the customer
confirm that the person arriving is the assigned technician.

## Tenant Boundaries

Provider tenant isolation is mandatory.

Rules:

- A provider may see only its own affiliation rows.
- A provider may see enough global technician profile information for affiliated
  or invite-matched technicians, but must not browse unrelated technicians.
- A provider may suspend/end only its own affiliation.
- A provider must not mutate another provider's affiliation.
- A provider must not mutate global technician suspension/status.
- Ops/platform owns global technician suspension and global policy controls.
- Existing global technician lookup by email/phone must avoid exposing unrelated
  profile details before an affiliation invite is accepted or otherwise
  authorized.

## Backend Implementation Target

Implementation should inspect current migrations and store methods before
changing schema or API behavior.

Likely backend tasks:

1. Use or extend `organization_technicians` for provider affiliation records.
2. Add migration if required for status, affiliation type, exclusivity,
   dispatch permission, start/end timestamps, and reason fields.
3. Update `create_affiliated_technician` or equivalent provider workforce create
   behavior:
   - find existing user/technician by email or phone,
   - create a `pending_invite` affiliation for an existing technician if allowed,
   - create new technician only if none exists,
   - enforce exclusivity rules,
   - preserve skills, team IDs, and org membership behavior.
4. Make provider workspace return affiliation metadata:
   - affiliation status,
   - affiliation type,
   - exclusivity,
   - dispatch allowed,
   - team IDs,
   - global technician status/vetting.
   - global technician profile photo status/URL where authorized.
5. Add provider-side mutation for suspend/end affiliation only if it can stay
   small and tenant-scoped.

## Test Requirements

Add focused tests for:

- New technician creates global profile plus provider affiliation.
- Existing technician invite creates a pending affiliation without duplicate
  technician creation.
- Pending invite is not dispatch-eligible.
- Active exclusive affiliation blocks another provider from attaching.
- Active non-exclusive contractor can be attached to a second provider.
- Partial unique index or equivalent DB guard prevents concurrent active
  exclusive affiliations.
- Ended affiliation does not count as current dispatch eligibility.
- Rejoining the same provider preserves the earlier affiliation history.
- Provider workspace remains tenant-scoped.
- Provider cannot mutate another provider's affiliation.
- Provider cannot mutate global technician suspension/status.
- Cutover/backfill maps `technicians.primary_organization_id` to active
  affiliation rows and rewired candidate queries use affiliations.
- Customer tracking exposes assigned technician name/photo only after assignment
  and never leaks candidate technician identities before acceptance.

Minimum verification for an implementation slice:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
npm.cmd run build:provider
npm.cmd run typecheck
```

Run broader suites if shared API contracts, migrations, or cross-app auth are
touched.

## Parallel Development Plan

This model can be developed in parallel, but only if each model owns a clear
slice and avoids editing the same files at the same time.

Completion marking convention:

- Keep incomplete work as `- [ ]`.
- When a slice is done and verified, update this section to:
  `- ✅ <s style="color:#1a7f37">...</s> — short result/commit/tests.`
- Record the same completion in `docs/HANDOFF.md` with date, owner/model,
  changed files, verification, and remaining follow-ups.

### Slice A — Backend Schema And Eligibility

Recommended owner: Claude/backend model.

Status: ✅ completed as current increment — commit `90e8524`; reviewed by
Codex. Remaining consent/photo work belongs to Slice D/E and backend follow-ups,
not Slice A.

Primary files:

- `apps/intake-web/api/store.py`
- `apps/intake-web/api/tests/test_dispatch.py`
- migration files under the intake API migration path
- any backend schema/seed helpers required by the repo

Do not edit:

- provider UI pages except for unavoidable API contract fixtures
- technician-web profile UI

Tasks:

- ✅ <s style="color:#1a7f37">Inspect existing migrations and current
  `organization_technicians` usage.</s> — completed in Slice A review,
  commit `90e8524`.
- ✅ <s style="color:#1a7f37">Add migration for missing affiliation fields:
  canonical status support, affiliation type, exclusivity, dispatch permission,
  `starts_at`, `ended_at`, reason fields, and timestamps as needed.</s> —
  migration `0016_provider_affiliations.py`.
- ✅ <s style="color:#1a7f37">Add the partial unique index preventing more than
  one active exclusive affiliation per technician.</s> — reviewed index uses
  `status='active'`, `exclusivity='exclusive'`, and `ended_at IS NULL`.
- ✅ <s style="color:#1a7f37">Backfill `technicians.primary_organization_id`
  into active `organization_technicians` rows.</s> — migration/store backfill
  added.
- ✅ <s style="color:#1a7f37">Rewire provider roster/candidate eligibility from
  `technicians.primary_organization_id` to active affiliation rows.</s> —
  provider workspace, candidate, fleet, and provider-scoped technician reads
  now use active, dispatch-allowed, non-ended affiliations with legacy fallback
  only when no affiliation rows exist.
- ✅ <s style="color:#1a7f37">Decide and document whether
  `primary_organization_id` is deprecated or a denormalized cache.</s> —
  retained as a temporary denormalized compatibility cache, not an independent
  membership source of truth.
- ✅ <s style="color:#1a7f37">Add tests for backfill, active eligibility,
  ended/suspended non-eligibility, exclusivity guard, tenant isolation, and
  global active-job lock.</s> — `uv run pytest api/tests/test_dispatch.py -q`
  from `apps/intake-web` passed: 113 passed, 1 skipped, 1 warning.

Minimum verification:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
```

### Slice B — Backend Invite And Affiliation Behavior

Recommended owner: Claude or another backend-focused model.

Status: ✅ completed as current backend increment — Claude Slice B output
verified by Codex; migration `0017_affiliation_history.py` adds true
leave/rejoin affiliation history. Technician-side invite acceptance remains a
Slice D/backend follow-up.

Primary files:

- provider technician create/invite API handlers
- store methods for provider workforce creation
- backend tests

Tasks:

- ✅ <s style="color:#1a7f37">Update `create_affiliated_technician` or
  equivalent behavior.</s> — existing technician lookup now matches by email or
  phone.
- ✅ <s style="color:#1a7f37">For a new email/phone: create global
  user/technician profile plus provider affiliation.</s> — new technician path
  remains active affiliation creation.
- ✅ <s style="color:#1a7f37">For an existing technician: create
  `pending_invite`, not active affiliation.</s> — existing technician path no
  longer duplicates or silently activates.
- ✅ <s style="color:#1a7f37">Enforce exclusivity before creating or activating
  affiliation.</s> — active exclusivity guard remains; activation enforcement
  still belongs to the future technician acceptance flow.
- ✅ <s style="color:#1a7f37">Preserve leave/rejoin history by creating new
  affiliation rows when needed.</s> — migration `0017_affiliation_history.py`
  moves to surrogate `id` plus open-period uniqueness.
- ✅ <s style="color:#1a7f37">Return clear 409/422 errors for exclusivity
  conflicts.</s> — `exclusive_conflict` remains mapped through provider create.
- ✅ <s style="color:#1a7f37">Keep provider mutations tenant-scoped and
  company-affiliation-only.</s> — existing create path remains provider-org
  scoped; provider suspend/end endpoint is still a separate follow-up.

Minimum verification:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
```

### Slice C — Provider Workforce UI

Recommended owner: Qwen/frontend model.

Status: `[~]` implemented as current UI increment — commit `90e8524`; complete
for visible affiliation controls/roster states, with existing-technician
`pending_invite` creation now backed by Slice B. Still waiting on technician
accept/decline, provider-side suspend/end controls, and technician photo fields.

Primary files:

- `apps/provider-web/src/app/teams/page.tsx`
- provider-web BFF routes only if needed and coordinated
- shared console UI only if a reusable component is truly needed

Do not edit:

- migrations
- backend eligibility logic
- technician-web invite/profile flows

Tasks:

- ✅ <s style="color:#1a7f37">Keep the existing shared console style:
  `PageHeader`, `StatCard`, `Card`, `Badge`, `Table`, and visual skill
  chips.</s> — provider build passed in commit `90e8524`.
- ✅ <s style="color:#1a7f37">Add affiliation type, exclusivity, dispatch
  allowed, and affiliation status controls to the add/invite form.</s> —
  `/teams` form and API contract reconciled.
- [ ] Make temporary password required only for new login creation. Current UI
  still requires it because the provider UI cannot yet distinguish existing
  technician invite from new login creation before submit.
- ✅ <s style="color:#1a7f37">Render future affiliation fields defensively when
  backend fields are not present yet.</s> — reviewed by Codex.
- ✅ <s style="color:#1a7f37">Show pending invites distinctly from active
  dispatchable technicians.</s> — UI supports pending-invite display; backend
  invite creation is now implemented by Slice B.
- [ ] Show global status/vetting, skills, teams, and technician photo/headshot
  when authorized. Current UI shows global status/vetting/skills/teams; photo
  awaits the profile/photo contract.
- ✅ <s style="color:#1a7f37">Show clear exclusivity conflict copy.</s> —
  `exclusive_conflict` maps to a user-facing message.

Minimum verification:

```powershell
npm.cmd run build:provider
npm.cmd run typecheck
```

### Slice D — Technician Consent, Profile, And Photo Onboarding

Split into a backend contract (Claude) and the technician-web UI (Qwen/Codex), so
the two land in separate trees. The frontend BFF routes already exist and call the
`/technicians/me/*` backend contract below.

#### Slice D-backend — technician self-service affiliation + photo API (Claude)

Status: ✅ <s style="color:#1a7f37">completed</s> — implements the contract the
technician-web BFF routes (`apps/technician-web/src/app/api/affiliations*`,
`.../api/photo`) forward to, plus the provider suspend/end and Ops photo-review
mutations that complete the model. Verified **132 passed, 1 skipped**.

Technician self-service (signed-in tech via `session["technician"]`; self-scoped):

- `GET /technicians/me/affiliations` → `{ affiliations: [...] }` — the tech's
  affiliation rows (pending invites + active + ended/history) with org name + status.
- `GET /technicians/me/organizations` → `{ organizations: [...] }` — orgs the tech is
  actively affiliated with (BFF degrades gracefully if absent).
- `POST /technicians/me/affiliations/{id}/accept` → `{ affiliation }` — activate a
  `pending_invite` (→ `active`), enforcing exclusivity at activation (`409` on
  `exclusive_conflict`). `{id}` is the affiliation surrogate id (Slice B).
- `POST /technicians/me/affiliations/{id}/decline` → `{ affiliation }` — body
  `{ decline_reason? }`; set the `pending_invite` → `rejected` (closes the period).
- `POST /technicians/me/photo` (multipart `file`) → `{ photo_url, photo_status }` —
  upload to the public-tech-media bucket, set `profile_photo_url` +
  `profile_photo_status='pending'` (Slice E gates customer exposure on `approved`).
  Adds dependency **`python-multipart`**.

Provider workforce mutations (tenant-scoped to the caller's org):

- `POST /provider/technicians/{id}/affiliation/end` → ends the company's affiliation
  (`status='ended'` + closes the period → history preserved, rejoin allowed).
- `POST /provider/technicians/{id}/affiliation/suspend` → suspends it (dispatch-
  ineligible, period stays open so it can be reactivated). Both 404 for a technician
  the caller's org is not affiliated with (no cross-tenant mutation).

Ops/platform photo review (`platform_admin`; global profile is Ops-owned):

- `PATCH /admin/technicians/{id}/photo` body `{ status: approved|rejected }` →
  sets `profile_photo_status`. Only `approved` is ever customer-visible (Slice E).

Tasks:

- ✅ <s style="color:#1a7f37">Store + endpoints for the contract above (DB + in-memory).</s>
- ✅ <s style="color:#1a7f37">Enforce exclusivity at **activation** (accept), not just create.</s>
- ✅ <s style="color:#1a7f37">Keep self-scoped; never expose another provider's private data across affiliations.</s>
- ✅ <s style="color:#1a7f37">Provider suspend/end affiliation (tenant-scoped) + Ops photo approve/reject.</s>
- ✅ <s style="color:#1a7f37">Backend tests: accept activates + exclusivity 409; decline → rejected;
  self-scope isolation; photo pending→approved exposure; suspend/end + tenant scope.</s>

Minimum verification:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
```

#### Slice D-frontend — technician onboarding/consent/photo UI (Qwen/Codex)

Status: ✅ <s style="color:#1a7f37">completed for current model scope</s> —
technician-web BFF routes and UI run on the real Slice D-backend contract.
Codex review fixed photo-upload false-success handling, aligned BFF image types
with the backend, and ensured pending invites display provider names from the
affiliation payload. Verified by `npm.cmd run build:tech`.

Tasks:

- ✅ <s style="color:#1a7f37">Show provider affiliation invites to the technician.</s>
- ✅ <s style="color:#1a7f37">Accept/decline `pending_invite` from the technician app.</s>
- ✅ <s style="color:#1a7f37">Profile photo/headshot upload UX + review status
  (pending/approved/rejected).</s>
- ✅ <s style="color:#1a7f37">Keep global technician profile separate from
  provider affiliation settings.</s>

Minimum verification:

```powershell
npm.cmd run build:tech
npm.cmd run typecheck
```

### Slice E — Customer Security Identity

Recommended owner: intake/customer frontend model after profile photo fields are
available.

Status: ✅ <s style="color:#1a7f37">completed for current model scope</s> —
customer tracking exposes assigned technician name and approved photo only after
assignment; pending/rejected/no photo falls back to "Photo pending verification".
Codex review verified the privacy gate and intake build.

Primary files:

- customer tracking views in intake-web
- token/tracking response types and BFF/backend reads as needed

Tasks:

- ✅ <s style="color:#1a7f37">Add assigned technician display name and approved
  profile photo to the customer tracking response after assignment/acceptance
  only.</s>
- ✅ <s style="color:#1a7f37">Prevent candidate technician identity leaks before
  assignment.</s>
- ✅ <s style="color:#1a7f37">Show fallback copy such as "Photo pending
  verification" when no approved photo is available.</s>
- ✅ <s style="color:#1a7f37">Update customer tracking screens for assigned,
  arrived, in-service, and reassignment states.</s> — en-route focuses on live
  map/ETA; matched and arrived show the assigned specialist identity.
- ✅ <s style="color:#1a7f37">Preserve internal audit trail for
  reassignment.</s> — no recovery/audit behavior changed.

Minimum verification:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
npm.cmd run build --workspace @cluexp/intake-web
npm.cmd run typecheck
```

### Slice F — Docs And Integration Review

Recommended owner: Codex/reviewer.

Status: `[~]` active — Codex owns coordination/review while Slice D/E and the
remaining backend invite/profile-photo follow-ups continue.

Primary files:

- `docs/PROVIDER-WORKFORCE-MODEL.md`
- `docs/HANDOFF.md`
- `docs/EXECUTION-PLAN.md`
- `docs/EXECUTION-PLAN-MVP.md`

Tasks:

- [ ] Keep this plan synchronized with implementation reality.
- [ ] Mark completed slices using the green strike convention.
- ✅ <s style="color:#1a7f37">Review migration/source-of-truth changes before
  UI-only slices assume the backend is ready.</s> — Slice A/C reviewed and
  reconciled in commit `90e8524`.
- [ ] Ensure each model records files changed, migrations, tests/builds, and
  follow-ups in `docs/HANDOFF.md`.

Acceptance checklist:

- ✅ <s style="color:#1a7f37">Claude Slice A output reviewed for migration
  safety, tenant isolation, `primary_organization_id` cutover, affiliation
  status enum, and DB exclusivity guard.</s> — Codex review fixes committed in
  `90e8524`.
- ✅ <s style="color:#1a7f37">Qwen Slice C output reviewed for defensive field
  rendering, shared console-ui usage, `pending_invite` behavior,
  skill-code consistency, and no backend contract drift.</s> — Codex review
  fixes committed in `90e8524`.
- [ ] Backend/frontend contract reconciled for affiliation status,
  `affiliation_type`, `exclusivity`, `dispatch_allowed`, profile photo fields,
  and pending invite behavior. Affiliation fields and provider-created
  existing-technician `pending_invite` behavior are reconciled; technician-side
  accept/decline and profile photo fields remain open.
- ✅ <s style="color:#1a7f37">Targeted tests/builds independently re-run where
  needed.</s> — `uv run pytest api/tests/test_dispatch.py -q`,
  `npm.cmd run build:provider`, `npm.cmd run typecheck`, and
  `git diff --check` passed during Codex review.
- ✅ <s style="color:#1a7f37">Completed slices marked with green strike and exact
  verification notes.</s> — Slice A and current Slice C increment updated after
  commit `90e8524`; remaining open tasks stay unchecked.

## Implementation Prompt

Use this prompt for Qwen or another implementation model:

```text
Qwen, please implement the technician global profile + provider affiliation model
for ClueXP. Keep the current SaaS direction: providers self-manage their
workforce, but technician identity should be global and provider-company
membership should be represented as an affiliation.

Repo:
c:\__CODE__\ClueXP\intake

Important:
- Keep existing UI style and shared console components.
- Do not deploy.
- Do not apply production migrations.
- Discuss/record any migration clearly before commit.
- Preserve tenant isolation.
- Preserve existing provider workflow where possible.
- Run the relevant tests/builds before reporting.

Product decision:
Technicians should have one global profile. Provider companies attach to that
technician through affiliation records. Affiliations are historical relationship
ledger rows, not a single mutable company field. If a technician leaves a
provider and later rejoins, preserve the earlier affiliation period and create a
new affiliation row or explicit reactivation history. Do not overwrite old
affiliation history.

MVP behavior:
1. A provider can add/invite a technician from `/teams`.
2. If the technician email/phone does not exist:
   - create global technician profile
   - create user login
   - create provider affiliation
3. If the technician email/phone already exists:
   - do NOT create duplicate technician
   - create a `pending_invite` affiliation if allowed
   - do NOT make the affiliation active until the technician accepts or an
     explicit Ops/platform-approved exception exists
4. A technician may be affiliated with multiple companies if not exclusive.
5. If the technician has an active exclusive/W2 affiliation with another company:
   - block the new affiliation
   - return a clear 409/422 error
6. Provider can manage only its own affiliation, not the global technician
   identity.
7. Ops/platform can later suspend the global technician; provider can
   suspend/remove only its company relationship.
8. Affiliation history must be preserved: ended/suspended/rejected affiliations
   remain queryable for audit, reactivation, disputes, compliance, and
   performance context. Current dispatch eligibility is derived only from active
   affiliation rows (`status=active` and no end timestamp).

Data model target:
Use/extend existing `organization_technicians` rather than duplicating
technicians.

Add or ensure fields on `organization_technicians`:
- `organization_id`
- `technician_id`
- `status`: pending_invite | active | suspended | ended | rejected
- `affiliation_type`: employee_w2 | contractor | subcontractor | owner_operator
- `exclusivity`: exclusive | non_exclusive
- `dispatch_allowed`: boolean
- `suspension_reason`: nullable text
- `starts_at` / `ended_at` or equivalent period fields
- `ended_reason` nullable text
- timestamps if not already present

History rule:
- Do not mutate an old ended affiliation back into the only current record unless
  the repo already has a separate event ledger that preserves the prior period
  clearly.
- Prefer creating a new affiliation row when a technician rejoins the same
  provider after an ended relationship.
- Active workforce queries should filter to active/current rows; provider
  history/audit views may include ended/suspended/rejected rows.

Migration/cutover rule:
- Current code still keys roster eligibility off `technicians.primary_organization_id`.
  Backfill existing primary orgs into active `organization_technicians` rows, then
  rewire provider candidate/eligibility queries to join active affiliation rows
  (`status=active`, `dispatch_allowed=true`, `ended_at is null`).
- Decide whether `primary_organization_id` is deprecated or retained only as a
  denormalized cache. Do not leave it as an independent writable membership
  source.
- Map any legacy `invited`/`pending` status values to canonical `pending_invite`.

Exclusivity guard:
- Add a DB-level partial unique index so a technician can have at most one active
  exclusive affiliation (`status=active`, `exclusivity=exclusive`,
  `ended_at is null`). Do not rely only on app-level 409 checks.

Technician global profile remains in `technicians`:
- `id`
- display_name
- profile photo/headshot
- email/phone/login/user relationship
- skills
- status
- vetting_status
- global availability/location
- global active-job lock via existing job assignment logic

Active-job lock:
- The active-job lock is global to the technician, not scoped to one provider
  affiliation. A non-exclusive technician must not be double-dispatched across
  two companies at the same time.

Backend tasks:
1. Inspect current migrations and store methods before changing.
2. Add migration if required.
3. Update `create_affiliated_technician` behavior:
   - find existing user/technician by email or phone
   - create pending invite for existing technician if allowed
   - create new technician only if none exists
   - enforce exclusivity rules
   - preserve existing `skills`, `team_ids`, and org membership behavior
4. Make provider workspace return affiliation metadata:
   - affiliation_type
   - exclusivity
   - affiliation status
   - dispatch_allowed
   - team_ids
5. Add provider-side mutation if needed to suspend/end affiliation, but keep
   scope small if too much.
6. Add tests:
   - new technician creates global profile + affiliation
   - existing technician invite creates pending affiliation without duplicate
   - pending invite is not dispatch-eligible
   - exclusive active affiliation blocks another company
   - non-exclusive contractor can be attached to second company
   - DB guard prevents concurrent active exclusive affiliations
   - ended affiliation does not count as current dispatch eligibility
   - rejoining same provider preserves earlier affiliation history
   - provider workspace remains tenant-scoped
   - provider cannot mutate another provider's affiliation

UI tasks:
1. Update `apps/provider-web/src/app/teams/page.tsx` to make this model visible.
2. Keep the page styled with shared console components.
3. Technician add/invite form should include:
   - name
   - email/phone
   - temporary password only required for new technician if applicable
   - affiliation type selector
   - exclusivity selector
   - dispatch allowed toggle
   - visual skill chips, not comma free text
   - team assignment
4. Roster should show:
   - technician name/contact
   - technician profile photo/headshot
   - global vetting/status
   - affiliation status
   - affiliation type
   - exclusivity
   - dispatch allowed
   - skills badges
   - teams
5. If backend returns an exclusivity conflict, show a clear message:
   "Technician already has an exclusive active affiliation with another provider."

Skill UI:
Use frontend fixed MVP catalog for now:
- vehicle: Vehicle lockout
- home: Residential lockout
- business: Business/commercial lockout
- broken_key: Broken key extraction
- rekey: Rekey
- smart_lock: Smart lock
- key_programming: Key programming

These codes must match `packages/console-ui/src/ui/skill-select.tsx`.

Do not create full skills catalog tables in this task unless absolutely
necessary. This task is technician global profile + affiliation model first.

Verification:
Run at minimum:
- uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
- npm.cmd run build:provider
- npm.cmd run typecheck if shared package/API types changed

Docs/Handoff:
Before final response, update docs/HANDOFF.md with:
- files changed
- migration name if any
- API behavior changes
- tests/builds run
- remaining follow-ups:
  - full Ops-managed skill catalog
  - provider subscription limits for max technicians
  - global technician suspension UI
  - affiliation invite acceptance flow
  - technician photo review/moderation flow
```

### Slice G — Provider Company Signup / Onboarding UI

Status: `[x]` built (Claude). provider-web signup/onboarding + the backend reconcile.

**Built this slice:**
- ✅ <s style="color:#1a7f37">Restyled `/signup` (console-ui): company section (name, legal
  name, phone) + admin section, pending-approval explanation; on success the
  `/api/register` BFF now sets the session cookie and routes to `/onboarding`.</s>
- ✅ <s style="color:#1a7f37">Company profile fields persisted — `register_organization`
  stores `legal_name`/`phone` and inserts `status='pending_review'`.</s>
- ✅ <s style="color:#1a7f37">`/onboarding` status screen — shows pending_review / active /
  suspended / rejected / closed with copy + an "Upload documents" link (pending/
  suspended) and "Enter console" (active).</s>
- ✅ <s style="color:#1a7f37">Org-status gating in the provider frame — a non-`active`
  company is routed to `/onboarding`; `/documents` stays reachable so a pending
  company can upload docs while it waits. Session now carries `organization_status`.</s>
- ✅ <s style="color:#1a7f37">Migration `0019_organization_status_enum`: normalizes
  `organizations.status` to the canonical lifecycle (pending_review | active |
  suspended | rejected | closed), maps legacy values (pending_vetting→pending_review,
  verified→active, expired→suspended), sets default `pending_review`, adds the CHECK.</s>
- ✅ <s style="color:#1a7f37">Ops suspend/reactivate backend: `POST /admin/organizations/{id}/suspend`
  + `/reactivate` (platform_admin) → `set_organization_status`. Ops approve/reject
  unchanged in ops-web.</s>

Company lifecycle stays distinct from the technician lifecycle even where labels overlap.

Verified: `uv run pytest` → 134 passed/1 skipped; shared typecheck + all four app
builds pass; alembic offline green through `0019`.

**Remaining (small):**
- [ ] Ops **suspend/reactivate UI** in ops-web (backend endpoints exist; needs a control
  on active companies — the `/approvals` screen only covers pending approve/reject).
- [ ] Operational: apply `0019` to prod (prod at `0018`) + deploy.

## Open Follow-Ups

Backend for the model is complete (Slices A, B, C, D-backend, E + the provider
suspend/end and Ops photo-review mutations). The core review/consent/photo UI is
also complete; remaining items are **polish** or **deferred/operational**:

Frontend:
- ✅ <s style="color:#1a7f37">Technician invite list + accept/decline UI + photo upload (technician-web,
  Qwen) now run on the real backend; the session exposes `photo_url`/`photo_status`/
  `affiliations[]`.</s>
- ✅ <s style="color:#1a7f37">Provider `/teams` suspend/end affiliation controls wired to
  `/api/technicians/{id}/affiliation/{suspend,end}`.</s>
- ✅ <s style="color:#1a7f37">Ops photo approve/reject **screen** (`ops-web`).</s>
  — `GET /admin/technicians/photos` lists pending headshots, and the Ops
  compliance review screen approves/rejects via `PATCH /admin/technicians/{id}/photo`.
- [ ] Provider `/teams` temporary-password affordance + rejoin/history drawer (polish).

Operational:
- ✅ <s style="color:#1a7f37">Migrations `0016`, `0017`, `0018` applied to production
  (2026-06-16, Supabase SQL Editor; prod head `0018_technician_photo_status`, backfill ran).</s>
- [ ] **Deploy the workforce code** (committed locally, currently unpushed) with
  `python-multipart` in the image, so the affiliation eligibility/invite/photo
  behaviour goes live. The applied migrations are additive/backward-compatible, so
  the currently-deployed prior code keeps working until then.

Deferred (post-MVP):
- Full Ops-managed skill catalog (currently a frontend fixed list).
- Provider subscription limits for max technicians/seats.
- Company document approval and suspension-reason taxonomy.
- Provider workforce history screen or drawer; invite-acceptance notifications.
