# Checklist: Spec 003 Phase 1 Production Cutover Record

**Artifact Reviewed**: `tasks.md T020/T023 record, mcp-production-health.yml, PRODUCTION-READINESS.md`
**Reviewer**: `Codex`
**Date**: `2026-09-27`

Secondary-agent review required: yes
Secondary-agent review completed: yes
Reviewer agent: Codex
Review result: approve

## Author Evidence (Claude)

- [x] Migration 0061 is present in production: column non-null with default false, partial unique
  index, 0 channels listed; `alembic_version` intentionally stays at 0059 (see plan).
- [x] Production API key: scoped client type `agent`, no organization; `services:read` and
  `providers:search` return 200 and `coverage:check` returns 403. The raw key exists only in the
  Vercel environment store; the local copy is deleted.
- [x] MCP env: the OAuth and bearer variables are removed; the new key and
  `CLUEXP_API_BASE_URL=https://api.cluexp.com` are set.
- [x] Firewall: 60 requests/60 s per IP on `/mcp` and `/api/mcp`; a burst gave 60 x 200, then 429.
- [x] Deploy from a clean `origin/main` export (`3c08e65`). The live protocol run showed two
  read-only tools, a live catalog, `providers: []`, ambiguous-address candidates, and a 404 OAuth
  route.
- [x] Git link with `rootDirectory=apps/cluexp-mcp-server`; a git preview build of `main` is Ready.
- [x] The simplified monitor step, run against live production, passes: "public discovery OK".
- [ ] T018 in-product Claude/ChatGPT runs (Human accounts), T021 opt-in (written consent), and T022
  Auth0 (dashboard access) remain open.

## Reviewer Focus

- The monitor now fails on any non-200, on an MCP error, on an API error inside `structuredContent`,
  or on an empty catalog.
- The accuracy of the recorded production state and the 0061/alembic decision.

## Independent Codex Review - 2026-09-27

Reviewed PR #81 at `6fb8ea25c830795f592137f434c13e239ac3c1c3` as the
non-author secondary reviewer. Codex owns this checklist for this review.
**Result: approve; no blocking findings.** This approves the cutover record and
monitor change, not any further production action or provider opt-in.

### Independently observed

- Executed both exact workflow Bash steps against production: health returned
  `{"status":"ok"}` and public `list_services` returned one service category.
  Thirteen offline exact-step fixtures passed: JSON/SSE success; rejection of
  401/403/429/500, JSON-RPC errors, tool errors, nested API errors, empty or invalid
  catalogs, missing structured content, and invalid JSON.
- Public initialization works; `tools/list` advertises only `list_services` and
  `find_providers`, both read-only. The former OAuth resource route returns 404.
- Production SQL used a read-only transaction with statement timeout, then rollback:
  `alembic_version = 0059_job_origin_client`; `ai_assistant_listed` is boolean,
  NOT NULL, default false; the unique organization index has predicate
  `WHERE ai_assistant_listed`; listed channel count is zero. Neither the 0060
  verification table nor its two jobs columns exists.
- The recorded external client is active, type `agent`, organization null,
  scopes exactly `providers:search` and `services:read`, rate limit 120/minute.
  Today's audit rows show successful service/provider calls and a scope-denied
  403. Provider-search metadata keys are only `outcome`, `result_count`, and
  `service_skill`; no location keys were present. No API key was retrieved.
- Vercel production environment names include the API key/base URL and exclude
  OAuth/bearer variables. Project Git linkage is `logicacodecom/ClueXP`, production
  branch `main`, root `apps/cluexp-mcp-server`, ignored-build command null.
  The production domain resolves to Ready deployment
  `dpl_G1FNqXG1KFEpUTJ9NqcWnAKwKzDH`.
- Live firewall configuration has the enabled per-IP fixed-window rule, 60/60s,
  covering paths starting with `/mcp` or `/api/mcp`. No burst test was repeated.
- Recorded production monitor run `36316798862` succeeded. Original-head required
  CI checks `secret-scan`, `web`, `api`, and `mcp-server` passed; `sdlc-policy`
  failed solely because the review markers were pending. Updated markers must
  pass that gate before merge.

### Migration decision and limits

0061's SQL only adds the default-off column/index to the existing intake table;
it does not depend on 0060's schema. Both statements use IF NOT EXISTS. Applying
that SQL while retaining 0059 is acceptable for this explicitly gated cutover:
it does not falsely stamp unexecuted 0060. A later authorized upgrade can apply
0060 and replay 0061, provided the existing column/index still match the reviewed
DDL. `alembic upgrade head` is not authorization to execute gated 0060. Alembic
at 0059 also cannot automatically downgrade the manually applied 0061; any
schema rollback needs a separately authorized explicit reconciliation.

The clean-export source provenance (`3c08e65`), exact secret value/base URL,
local key deletion, and historical burst remain Claude's execution evidence,
not independently re-proven here. No credentials were exposed or changed.
T018 assistant UI tests, T021 written-consent opt-in, and T022 Auth0 cleanup
remain open; T023's completion is protocol-level verification only, as its
record explains. No merge, deployment, production mutation, or provider listing
was performed by this review.

## Supplemental Review — `329d771` (2026-09-27)

**Result: approve.** Reviewed the docs-only T018/T021/T022 update after pulling
`329d771484ce68362905a95e88f51ddbc969a7be`. This supplement supersedes the earlier
snapshot's zero-listed count and open T021 status; those observations were valid
at the time of the initial review.

- Human confirmation of provider consent is recorded in the task and confirmed
  by the Human's review request. Written requests remain an operational record
  to retain; Codex did not inspect the underlying consent documents.
- Independent read-only production SQL now shows exactly `florida-locksmith`
  and `metro-key` listed. Active affiliations with active, verified technicians
  number 3 and 6 respectively; none of either channel's affiliated technicians
  is available. Pending invitations are not included in those active counts.
- A public `find_providers` call for catalog skill
  `locksmith.residential_lockout` at Tampa coordinates returned a successful
  result with `providers: []`. Availability remains one of the eligibility
  conditions, not a promise that going on shift alone guarantees a match.
- The T018 browser/network/job-count observations remain Claude's execution
  evidence, not a browser rerun by this reviewer. T018 stays open: assistant UI
  tests remain outstanding, and this embedded-browser record does not by itself
  prove private-window or link-preview-fetch coverage.
- No Auth0 references were found under current `apps/` or `packages/` code.
  The broader all-Vercel-project usage assertion remains author evidence. T022
  remains Human-gated and open: absence of repository usage does not establish
  absence of external tenant consumers or authorize whole-tenant deletion;
  inspect tenant applications/APIs before any authorized decommission.
- `git diff --check` passed. This update changes no executable code; the prior
  monitor/migration review remains applicable. No production writes, provider
  listing changes, deployment commands, or merge were performed by Codex.
