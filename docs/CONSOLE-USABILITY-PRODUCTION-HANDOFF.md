# Console usability production handoff

Date: 2026-07-16  
Author: Codex  
Audience: Claude / future agents  
Status: built locally, not production-applied unless a later commit/deploy says so

## Why this exists

The Product Owner reviewed `console.cluexp.com` as a production operator and found a usability gap:
companies, technicians, and documents were visible, but the console did not behave like an admin
governance workspace. Row-level actions were hard to discover, destructive/lifecycle actions lacked
proper confirmation, documents were separated from the relevant company/technician detail context,
and required admin reasons were not durable.

This handoff captures the reusable production pattern added for that slice so Claude can review,
merge, apply migrations, and continue future console usability work without reverse-engineering the
diff.

## Product intent

For companies and technicians, every operational row/detail should expose the right action in place:

- approve
- reject
- suspend
- reactivate
- edit
- delete/archive

Risky or lifecycle-changing actions must use a confirmation dialog and collect a reason where it
matters. If a record has history or relationships, delete should fall back to archive/suspend rather
than breaking referential history.

Documents should be visible in the context where the operator decides: company detail and technician
detail, not only in a separate document queue.

## Reusable UI pattern

New shared console component:

- `apps/console-web/src/app/governance-action-dialog.tsx`

Use it for platform-governance actions that need confirmation and optional/required reason capture.
It replaces ad hoc `window.confirm`, `window.alert`, and `window.prompt` usage on this surface.

Current consumers:

- `apps/console-web/src/app/companies/page.tsx`
- `apps/console-web/src/app/companies/[id]/page.tsx`
- `apps/console-web/src/app/technicians/page.tsx`
- `apps/console-web/src/app/technicians/[id]/page.tsx`
- `apps/console-web/src/app/documents/page.tsx`

Pattern:

1. The row/detail page decides which action is relevant for the current status.
2. The button opens `GovernanceActionDialog`.
3. The dialog sends a JSON body with `{ "reason": "..." }` when needed.
4. The page updates local state or navigates after the API responds.

Do not add browser-native prompt/confirm back to console governance pages.

## Console BFF routes touched

The console app proxies platform-admin actions to the FastAPI backend through these route handlers:

- `apps/console-web/src/app/api/organizations/[id]/[action]/route.ts`
- `apps/console-web/src/app/api/organizations/[id]/route.ts`
- `apps/console-web/src/app/api/technicians/[id]/[action]/route.ts`
- `apps/console-web/src/app/api/technicians/[id]/route.ts`

Important behavior:

- action routes forward the JSON body so backend receives the operator reason;
- `PATCH /api/organizations/:id` and `PATCH /api/technicians/:id` support edit forms;
- `DELETE /api/organizations/:id` and `DELETE /api/technicians/:id` call safe delete/archive.

## Backend contract added

FastAPI admin endpoints now accept an optional `AdminActionRequest` body:

```json
{
  "reason": "expired insurance"
}
```

Reason is required for:

- reject
- suspend
- delete/archive

Reason is optional for:

- approve
- reactivate

Action routes record a governance event after a successful state change.

## Durable audit / governance events

Added migration:

- `packages/db/alembic/versions/0027_governance_events.py`

Table:

- `governance_events`

Columns:

- `id uuid primary key`
- `entity_type text` — `organization` or `technician`
- `entity_id uuid`
- `action text` — examples: `approve`, `reject`, `suspend`, `reactivate`, `delete`, `archive`
- `reason text`
- `actor_id uuid`
- `metadata jsonb`
- `created_at timestamptz`

Indexes:

- `(entity_type, entity_id, created_at desc)`
- `(actor_id, created_at desc)`

`apps/intake-web/api/store.py` also has idempotent startup fallback DDL so local/dev boot is resilient
if migrations lag.

Claude review point: this crosses the usual ownership split because it adds a migration and backend
SQL. Treat `0027_governance_events.py` plus the matching `store.py` DDL/write path as requiring
Claude infrastructure review before production migration apply.

## Safe delete/archive behavior

The intended behavior is:

- if the record has no references, delete it;
- if it has references/history, archive it instead;
- always require a reason;
- always record a governance event.

Current mapping:

- organization archive status: `closed`
- technician archive status: `archived`, `is_available=false`

This matches the preferred product rule: delete only unused records; otherwise archive/deactivate.

## Files changed by this slice

Console app:

- `apps/console-web/src/app/governance-action-dialog.tsx`
- `apps/console-web/src/app/companies/page.tsx`
- `apps/console-web/src/app/companies/[id]/page.tsx`
- `apps/console-web/src/app/technicians/page.tsx`
- `apps/console-web/src/app/technicians/[id]/page.tsx`
- `apps/console-web/src/app/documents/page.tsx`
- `apps/console-web/src/app/api/organizations/[id]/[action]/route.ts`
- `apps/console-web/src/app/api/organizations/[id]/route.ts`
- `apps/console-web/src/app/api/technicians/[id]/[action]/route.ts`
- `apps/console-web/src/app/api/technicians/[id]/route.ts`

Backend / migration:

- `apps/intake-web/api/main.py`
- `apps/intake-web/api/store.py`
- `apps/intake-web/api/tests/test_dispatch.py`
- `packages/db/alembic/versions/0027_governance_events.py`

Documentation:

- `docs/CONSOLE-USABILITY-PRODUCTION-HANDOFF.md`
- `docs/HANDOFF.md`

## Verification already run

Backend focused tests:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -k "admin_can_suspend or admin_delete_archives"
```

Result:

- 2 passed

Broader nearby backend/admin tests:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -k "admin_can_suspend or admin_delete_archives or admin_org_and_tech_directories or organization_limits"
```

Result:

- 4 passed

Python compile check:

```powershell
uv run python -m py_compile apps/intake-web/api/main.py apps/intake-web/api/store.py packages/db/alembic/versions/0027_governance_events.py
```

Result:

- passed

Earlier in the same slice, before the audit table was added:

```powershell
npm.cmd run typecheck
npm.cmd run build:console
rg -n "window\.confirm|window\.alert|window\.prompt" apps/console-web/src/app/companies apps/console-web/src/app/technicians apps/console-web/src/app/documents/page.tsx
```

Results:

- typecheck passed
- console build passed
- no browser-native prompt/confirm/alert matches in those surfaces

## Production application steps for Claude

1. Review the diff against this handoff.
2. Confirm migration order: production was previously documented around `0024`; repo now has `0025`,
   `0026`, and this new `0027`. Do not apply `0027` alone if production is missing earlier heads.
3. Apply Alembic migrations to production from a network with Supabase DB reachability, or use the
   Supabase SQL editor with the migration SQL if that is the active operational path.
4. Push/merge the app code only after migration plan is clear.
5. Let Vercel production deploy the console/API bundle from `main`.
6. Smoke `console.cluexp.com` using a `platform_admin` account:
   - open Companies list;
   - confirm row actions are visible;
   - open a company detail page;
   - confirm detail actions and documents are visible;
   - open Technicians list/detail;
   - reject/suspend/archive a safe synthetic record with a reason;
   - verify the action result in the UI;
   - verify `governance_events` row exists with entity, action, reason, actor metadata.

## Follow-up work not completed in this slice

- Build a visible governance history timeline on company/technician detail pages using
  `list_governance_events`.
- Add company-side in-memory delete/archive behavior if HTTP tests need local organization archive
  coverage; current focused local coverage is technician lifecycle/archive.
- Add richer document filters and saved views beyond the current usability pass.
- Add dashboard notification cards/counts for:
  - companies needing approval;
  - missing required documents;
  - documents near expiry;
  - rejected/suspended entities needing follow-up.
- Add end-to-end browser smoke with the in-app browser once credentials/session are available.
- Update canonical production migration head in `docs/SYSTEM-DESIGN.md` and
  `docs/EXECUTION-PLAN.md` only after production migration application is confirmed.

## Sharp edges / gotchas

- `governance_events.actor_id` is `uuid`; demo/local seeded users can have non-UUID ids. The helper
  stores UUID actor ids when possible and always includes `actor_user_id` in metadata for traceability.
- Some console status labels are product-facing. Keep backend canonical statuses stable; translate in
  UI copy where needed.
- Do not surface destructive actions without a reason field and confirmation.
- Do not delete records with relationships just because the operator clicked delete; archive instead.
- Browser testing of the deployed production site was not re-run for this handoff.
