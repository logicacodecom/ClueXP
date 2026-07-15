# Console Web Scope And Implementation Plan

**Status:** Implemented locally (backend + console-web + provider-web users page). Not committed, not deployed. See Current Repo Caveat.
**App:** `apps/console-web`
**Purpose:** Platform-admin tenant and network management console.
**Port:** `3004`
**Planned Vercel project:** `cluexp-console`
**Last updated:** 2026-07-14

## Product Intent

Build a clean ClueXP platform console for managing the network itself: companies,
technicians, users, approvals, compliance documents, tenant suspension/reactivation,
and tenant limits.

This app is not an operations console. It must not include dispatching, live queues,
job boards, maps, assignments, recovery, escalations, active jobs, or reports. Those
surfaces stay in the provider/ops operational apps and should not leak into
`console-web`.

## Source Decisions

- Public company registration reuses the existing provider signup flow.
- Public technician registration reuses the existing technician signup flow.
- Admin-added companies and technicians still land in the normal review states:
  `pending_review` for organizations and `pending_vetting` for technicians.
- Providers charge customers directly. Console work must not introduce
  platform-held provider funds or a ClueXP merchant-of-record flow.
- Providers manage day-to-day provider users and technicians in `provider-web`.
  Console manages platform approval, visibility, limits, and status.
- Plans, marketplace routing, admin-driven technician suspension, and ClueXP Direct
  fulfillment are out of scope for this slice.

## In Scope

### Platform Admin Console

- New `apps/console-web` app.
- Platform-admin auth shell cloned from `ops-web`.
- Navigation focused on network administration:
  - Companies
  - Technicians
  - Approvals
  - Documents
  - Settings
  - Account
- Company directory, detail, add, approve/reject, suspend/reactivate, limits,
  members, affiliated technicians, and documents.
- Technician directory, detail, add, approve/reject, affiliations, documents, and
  photo/compliance review.
- Approvals page cloned from `ops-web`.
- Documents/compliance page cloned from `ops-web`.
- Platform settings page for default tenant limits.
- Account page cloned from the shared account settings surface.

### Backend And Data

- Migration `0026_org_limits` seeds platform defaults:
  - `max_users_per_org = 5`
  - `max_technicians_per_org = 5`
- `api/settings.py` adds both keys as integer, runtime-editable,
  org-overridable `SettingSpec`s.
- Admin APIs:
  - `GET /admin/organizations?status=`
  - `GET /admin/organizations/{id}`
  - `POST /admin/organizations`
  - `GET /admin/organizations/{id}/limits`
  - `PATCH /admin/organizations/{id}/limits`
  - `GET /admin/technicians?status=`
  - `GET /admin/technicians/{id}`
  - `POST /admin/technicians`
- Provider user APIs:
  - `GET /provider/users`
  - `POST /provider/users`
- Limit enforcement:
  - Provider user creation must enforce `max_users_per_org`.
  - Provider technician invite/create paths must enforce
    `max_technicians_per_org` across active and pending affiliations/invites.

### Provider Web Addition

- Add a `provider-web` Users page.
- Providers can list users and add `dispatcher` or `provider_admin` users.
- No edit/delete user management in this slice.
- The page shows current usage against the effective user limit.

## Out Of Scope

- Dispatch queues, queue details, assignment, reassignment, candidate selection,
  board, map, active jobs, completed jobs, recovery, escalation, reports, and
  operational dashboards.
- New public registration forms. Reuse existing signup apps.
- Plans/subscriptions management.
- Real payment implementation.
- Durable production notification work.
- Marketplace/network dispatch.
- Console-side edit/delete of provider users.
- Admin-side technician suspension beyond existing review/approval actions.
- Production deployment unless explicitly authorized after implementation.

## Existing Pieces To Reuse

| Need | Existing source |
| --- | --- |
| Auth shell and sign-in | `apps/ops-web/src/proxy.ts`, `apps/ops-web/src/app/signin`, `apps/ops-web/src/app/frame.tsx` |
| Shared shell/nav | `packages/console-ui/src/components/index.tsx` |
| Approvals UI | `apps/ops-web/src/app/approvals` |
| Documents UI | `apps/ops-web/src/app/documents` |
| Account UI | `packages/app-core/src/account.tsx` plus ops/provider BFF patterns |
| Company registration | `store.register_organization` and provider signup |
| Technician registration | `store.register_technician` and technician signup |
| Organization status actions | Existing approve/reject/suspend/reactivate admin endpoints |
| Runtime settings | `global_settings`, `organization_settings`, `api/settings.py` |

## Build Order

1. Complete the already-started `0026_org_limits` backend slice.
   - Keep the migration, setting specs, admin limits APIs, enforcement, and tests
     together.
   - Do not commit `0026_org_limits.py` by itself.
2. Add admin directory/detail/create endpoints for organizations and technicians.
3. Add provider user list/create endpoints and provider-side user-limit enforcement.
4. Scaffold `apps/console-web` from the safe non-operational parts of `ops-web`.
5. Clone sign-in, account, approvals, and documents into `console-web`.
6. Build company and technician directory/detail/new pages.
7. Add console settings for platform tenant-limit defaults.
8. Add provider-web `/users`.
9. Run verification and only then consider commit/push/deploy.

## Console App Pages

| Route | Purpose |
| --- | --- |
| `/` | Redirect to `/companies` |
| `/companies` | Company directory with status filter, counts, and add button |
| `/companies/new` | Admin-created company registration form |
| `/companies/[id]` | Company profile, status actions, limits, members, affiliated techs, docs |
| `/technicians` | Technician directory with status filter and add button |
| `/technicians/new` | Admin-created technician registration form |
| `/technicians/[id]` | Technician profile, status actions, affiliations, docs, photo review |
| `/approvals` | Pending company/technician approval queue |
| `/documents` | Company and technician compliance review |
| `/settings` | Language settings and platform default limits |
| `/account` | Self-service admin account |
| `/signin` | Platform-admin sign-in |

## Verification Required

Backend:

- Add focused API tests for admin list/detail/create endpoints.
- Add 403 tests for non-platform-admin admin access.
- Add limit tests for inherited default vs org override.
- Add 409 tests for user creation at cap.
- Add 409 tests for technician invite/create at cap.
- Run `uv run pytest apps/intake-web/api/tests -q` or the full equivalent
  agreed for the branch.

Frontend:

- Add root scripts:
  - `dev:console`
  - `build:console`
- Run shared `npm.cmd run typecheck`.
- Run `npm.cmd run build:console`.
- Run `npm.cmd run build:provider`.

Manual local smoke:

- Sign in as a platform admin.
- Open Companies.
- Add a company.
- Confirm it appears in approvals.
- Approve it.
- Set company limits to `1`.
- Confirm a second provider user or technician invite is blocked with a clear
  409 message.
- Confirm no dispatch/operations pages are present in `console-web`.

## Current Repo Caveat

As of 2026-07-14, the full Build Order above has been implemented locally and
verified (`uv run pytest apps/intake-web/api/tests` — 179 passed; `npm run
typecheck`; `npm run build:console` and `build:provider` — both clean; a live
local walk with the FastAPI backend + both Next dev servers confirmed sign-in,
all new console-web pages (200, correct auth-gate redirect, 404 on unknown
company/technician), the platform-limits GET/PATCH round trip, and the
provider-web `/users` page rendering).

Nothing has been committed, pushed, or deployed — that is a separate,
explicit step per this repo's git-safety rules.

**Known pre-existing issue found during verification (not introduced by this
work, not fixed):** the demo-seed provider account
(`dispatch@metrokey.example`) has `active_organization_id = "org-metro"`,
which is not a valid UUID. `_provider_organization_id()` in `api/main.py` does
`UUID(str(organization_id))`, so *every* `/provider/*` endpoint 500s for that
seeded login — including the pre-existing `/provider/technicians`, not just
the new `/provider/users`. The test suite already works around this by
seeding a fresh `str(uuid4())` org for provider-scoped tests rather than
using the demo account. Worth a follow-up ticket, out of scope here.

**Not yet done:** committing, migration 0026 applied to prod Postgres, and
provisioning the `cluexp-console` Vercel project.
