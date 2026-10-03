# Implementation Plan: Website → Provider Intake Handoff

**Spec**: `specs/006-website-intake-handoff/spec.md`

## Changes

- `apps/intake-web/src/app/intake-handoff.ts` (renamed from `ai-handoff.ts`): `parseHandoff()` returns
  `{source, accessType, situation, locationConfidence, location, address, zip, notes}`. Source lookup uses a
  `Map` (no prototype keys). `location` is non-null only for `COORDINATE_SOURCES`.
- `apps/intake-web/src/app/page.tsx`: prefill address + notes; send `intake_source` and, only when trusted,
  `location` at ticket creation; situation highlight; `addressTypedByCustomer` becomes state so a
  "Find this address" button can start autocomplete; safety step blocks an unconfirmed handoff address.
- `apps/intake-web/api/main.py`: `INTAKE_SOURCES` allow-list for `origin_channel`.

## Data / Security

- No schema change. No RLS impact. No new endpoint. Fragment values never enter request URLs before the
  customer confirms; ZIP never becomes a location; org is resolved server-side from the slug.

## Verification

- `node --test apps/intake-web/scripts/intake-handoff.test.mjs`: parser behavior (acceptance 1, 3-6).
- `uv run pytest apps/intake-web/api/tests -q`: attribution allow-list (`test_provider_matches.py`) and
  ownership/queue visibility (`test_dispatch.py::test_website_handoff_intake_lands_in_the_selected_providers_queue`,
  acceptance 2; InMemoryStore).
- `npm run build -w apps/intake-web`.

## Rollback

Revert the PR. No data written by this feature needs cleanup (`origin_channel='cluexp_website'` rows are
analytics labels only).
