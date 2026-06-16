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

Status: `[ ]` not started.

Primary files:

- `apps/intake-web/api/store.py`
- `apps/intake-web/api/tests/test_dispatch.py`
- migration files under the intake API migration path
- any backend schema/seed helpers required by the repo

Do not edit:

- provider UI pages except for unavoidable API contract fixtures
- technician-web profile UI

Tasks:

- [ ] Inspect existing migrations and current `organization_technicians` usage.
- [ ] Add migration for missing affiliation fields: canonical status support,
  affiliation type, exclusivity, dispatch permission, `starts_at`, `ended_at`,
  reason fields, and timestamps as needed.
- [ ] Add the partial unique index preventing more than one active exclusive
  affiliation per technician.
- [ ] Backfill `technicians.primary_organization_id` into active
  `organization_technicians` rows.
- [ ] Rewire provider roster/candidate eligibility from
  `technicians.primary_organization_id` to active affiliation rows.
- [ ] Decide and document whether `primary_organization_id` is deprecated or a
  denormalized cache.
- [ ] Add tests for backfill, active eligibility, ended/suspended non-eligibility,
  exclusivity guard, tenant isolation, and global active-job lock.

Minimum verification:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
```

### Slice B — Backend Invite And Affiliation Behavior

Recommended owner: Claude or another backend-focused model after Slice A, or in
parallel only if the migration/API contract is agreed first.

Status: `[ ]` blocked on Slice A contract.

Primary files:

- provider technician create/invite API handlers
- store methods for provider workforce creation
- backend tests

Tasks:

- [ ] Update `create_affiliated_technician` or equivalent behavior.
- [ ] For a new email/phone: create global user/technician profile plus provider
  affiliation.
- [ ] For an existing technician: create `pending_invite`, not active
  affiliation.
- [ ] Enforce exclusivity before creating or activating affiliation.
- [ ] Preserve leave/rejoin history by creating new affiliation rows when needed.
- [ ] Return clear 409/422 errors for exclusivity conflicts.
- [ ] Keep provider mutations tenant-scoped and company-affiliation-only.

Minimum verification:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
```

### Slice C — Provider Workforce UI

Recommended owner: Qwen/frontend model.

Status: `[ ]` can start in parallel as UI shell, then integrate after Slice A/B.

Primary files:

- `apps/provider-web/src/app/teams/page.tsx`
- provider-web BFF routes only if needed and coordinated
- shared console UI only if a reusable component is truly needed

Do not edit:

- migrations
- backend eligibility logic
- technician-web invite/profile flows

Tasks:

- [ ] Keep the existing shared console style: `PageHeader`, `StatCard`, `Card`,
  `Badge`, `Table`, and visual skill chips.
- [ ] Add affiliation type, exclusivity, dispatch allowed, and affiliation status
  controls to the add/invite form.
- [ ] Make temporary password required only for new login creation.
- [ ] Render future affiliation fields defensively when backend fields are not
  present yet.
- [ ] Show pending invites distinctly from active dispatchable technicians.
- [ ] Show global status/vetting, skills, teams, and technician photo/headshot
  when authorized.
- [ ] Show clear exclusivity conflict copy.

Minimum verification:

```powershell
npm.cmd run build:provider
npm.cmd run typecheck
```

### Slice D — Technician Consent, Profile, And Photo Onboarding

Recommended owner: Qwen/frontend model or technician-app model after Slice B has
the invite contract.

Status: `[ ]` blocked on pending-invite API contract for full implementation.

Primary files:

- technician-web profile/onboarding pages
- technician-web invite acceptance UI
- API/BFF routes only after backend contract exists

Tasks:

- [ ] Show provider affiliation invites to the technician.
- [ ] Let technician accept or decline `pending_invite` affiliations.
- [ ] Add profile photo/headshot upload UX.
- [ ] Show photo review status: pending, approved, rejected/replacement needed.
- [ ] Keep global technician profile separate from provider affiliation settings.
- [ ] Do not expose provider-private data across affiliations.

Minimum verification:

```powershell
npm.cmd run build:tech
npm.cmd run typecheck
```

### Slice E — Customer Security Identity

Recommended owner: intake/customer frontend model after profile photo fields are
available.

Status: `[ ]` blocked on assigned-technician profile photo contract.

Primary files:

- customer tracking views in intake-web
- token/tracking response types and BFF/backend reads as needed

Tasks:

- [ ] Add assigned technician display name and approved profile photo to the
  customer tracking response after assignment/acceptance only.
- [ ] Prevent candidate technician identity leaks before assignment.
- [ ] Show fallback copy such as "Photo pending verification" when no approved
  photo is available.
- [ ] Update customer tracking screens for assigned, en route, arrived,
  in-service, and reassignment states.
- [ ] Preserve internal audit trail for reassignment.

Minimum verification:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
npm.cmd run build --workspace @cluexp/intake-web
npm.cmd run typecheck
```

### Slice F — Docs And Integration Review

Recommended owner: Codex/reviewer.

Status: `[ ]` continuous.

Primary files:

- `docs/PROVIDER-WORKFORCE-MODEL.md`
- `docs/HANDOFF.md`
- `docs/EXECUTION-PLAN.md`
- `docs/EXECUTION-PLAN-MVP.md`

Tasks:

- [ ] Keep this plan synchronized with implementation reality.
- [ ] Mark completed slices using the green strike convention.
- [ ] Review migration/source-of-truth changes before UI-only slices assume the
  backend is ready.
- [ ] Ensure each model records files changed, migrations, tests/builds, and
  follow-ups in `docs/HANDOFF.md`.

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

## Open Follow-Ups

- Full Ops-managed skill catalog.
- Provider subscription limits for max technicians/seats.
- Global technician suspension UI.
- Provider affiliation invite acceptance flow.
- Technician profile photo upload and Ops/platform review flow.
- Company document approval and suspension reason taxonomy.
- Provider workforce history screen or drawer.
