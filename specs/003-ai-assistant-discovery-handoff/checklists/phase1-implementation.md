# Checklist: Spec 003 Phase 1 Implementation

**Artifact Reviewed**: `implementation (feat/003-phase1-provider-discovery)`
**Reviewer**: `Codex (pending)`
**Date**: `2026-09-26`

Secondary-agent review required: yes
Secondary-agent review completed: no
Reviewer agent:
Review result:

## Scope

- MCP server: two read-only tools, no sign-in; OAuth and bearer paths removed (FR-001, FR-002).
- `POST /v1/provider-matches` with scope `providers:search` (FR-003..FR-009a, NFR-001, NFR-006).
- Migration `0061_intake_channel_ai_listing` (FR-016).
- Intake fragment pre-fill, attribution, and commit-step re-check (FR-010..FR-013).
- Docs and OpenAPI snapshot (FR-015).

## Author Evidence (Claude, local)

- [x] Full non-Postgres API suite: 545 passed, 1 skipped.
- [x] New `api/tests/test_provider_matches.py` (23 tests): opt-in filter, inactive/non-capable orgs,
  unaffiliated technicians, multi-org per-affiliation eligibility, null-org platform channel,
  ordering/cap/recommended, response allow-list, fragment link, event privacy, exactly-one-location
  validation, every FR-009a outcome, the pinned existing `geocode()` first-result behavior,
  allow-listed attribution, and provider-availability (eligible, suspended, out of range, no cookie).
- [x] MCP server suite: 19 passed, including a public `initialize` on `/mcp` and `/api/mcp`, the
  DNS-rebinding guard (421), and a local `/v1` integration that creates no ticket, offer, or dispatch.
- [x] `export_openapi_v1.py --check`, `generate_types.py` drift check, `compileall`, `tsc --noEmit`,
  and the `apps/intake-web` production build.
- [x] Migration SQL rendered offline (`alembic upgrade 0060:0061 --sql`).
- [ ] Postgres-backed `test_ai_listed_channels_query_and_one_listing_per_org` (CI only; no local
  Postgres).

## Reviewer Focus

- Router extraction leaves `/v1/coverage-checks` and dispatch-authorization behavior unchanged.
- Per-affiliation eligibility in `_listed_provider_matches`.
- FR-011: no ticket is created on load or on link prefetch (`page.tsx` fragment handling).
- Address outcomes, the `candidates` field on the public error envelope, and event/log privacy.
- Removal of OAuth and bearer auth, and the public `/mcp` with the host guard retained.
- `origin_channel` added to `PostgresStore.save` (insert plus coalesce-on-conflict).

## ClueXP Safety

- [x] No technician, ETA, price, rating, count, or internal ID is exposed by discovery.
- [x] No MCP tool creates or changes jobs, customers, offers, or dispatch state.
- [x] Migration is additive and default-off, with no RLS change on an existing table.
- [x] No production DDL, deployment, key creation, env change, platform submission, or workflow edit
  is performed or authorized by this change.
