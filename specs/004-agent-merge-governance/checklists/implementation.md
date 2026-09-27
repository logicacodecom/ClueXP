# Checklist: Spec 004 Implementation

**Artifact Reviewed**: `implementation (feat/004-agent-merge-governance)`
**Reviewer**: `Codex (pending; different family from Claude Code)`
**Date**: `2026-09-27`

The authoritative review verdict is the `## Review Record` in the PR body. The reviewer may copy it
here for local `--base/--head` checks.

## Author Evidence (Claude Code)

- [x] Gate unit tests: 29 pass; git-integration: 12 pass; post-deploy: 9 pass; projection: 5 pass.
- [x] MCP server suite and intake API suite pass with the `revision` health field.
- [x] Shared health/list_services checks run green against production (revision null until the next
  git deploy).
- [x] Vercel prerequisites verified (auto-exposed system env vars, no build-skip, production branch
  `main`).
- [x] Settings already switched (T033-early) and projected equal to intent via real fixtures.
- [ ] T031 live metadata check, T034 acceptance merge with post-deploy attribution, T035, T036
  (transition, after merge).

## Codex Implementation-Time Obligations (from the T003 approve)

- [x] Incident rule is operational, with the lookup/disarm steps documented (constitution, workflow
  doc); red runs are treated as incidents.
- [x] Health consumers: both endpoints, the ASGI exact-JSON tests, and the monitor changed together;
  the revision value is asserted explicitly.
- [x] Declared `required: yes` records are fully validated on non-material PRs (unit test).
- [x] Projection fixtures cover real responses, `-1`/null app, drift, ordering, bypass, and null reviews.
- [x] `.github/scripts/**` is risky, including helper-only changes (unit test).
- [x] Containment via the compare API, including "on main", with unknown never counting as success
  (unit tests).
- [x] Push diagnostics are read-only and fail closed on all-zero `before`.
