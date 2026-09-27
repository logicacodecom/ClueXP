# Checklist: Spec 003 Phase 1 Production Cutover Record

**Artifact Reviewed**: `tasks.md T020/T023 record, mcp-production-health.yml, PRODUCTION-READINESS.md`
**Reviewer**: `Codex (pending)`
**Date**: `2026-09-27`

Secondary-agent review required: yes
Secondary-agent review completed: no
Reviewer agent:
Review result:

## Author Evidence (Claude)

- [x] Migration 0061 is present in production: column non-null with default false, partial unique
  index, 0 channels listed; `alembic_version` intentionally stays at 0059 (see plan).
- [x] Production API key: scoped client type `agent`, no organization; `services:read` and
  `providers:search` return 200 and `coverage:check` returns 403. The raw key exists only in the
  Vercel environment store; the local copy is deleted.
- [x] MCP env: the OAuth and bearer variables are removed; the new key and
  `CLUEXP_API_BASE_URL=https://api.cluexp.com` are set.
- [x] Firewall: 60 requests/60 s per IP on `/mcp` and `/api/mcp`; a burst gave 60 × 200, then 429.
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
