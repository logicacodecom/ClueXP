# Implementation Plan: Pilot Readiness Blocker — Stale Metro-Key Job + Staffed Safety Phone

**Spec**: `specs/001-pilot-readiness/spec.md`
**Branch**: `logicacodecom/task-001-pilot-readiness`
**Owner**: `Human` (execution); `Codex` (review)
**Review Mode**: `direct`

## Technical Approach

No application code changes. This slice is: (a) a one-time production data-state check/action on the specific stale `metro-key` job via the existing recovery-workspace resolve endpoint, and (b) a one-time production environment-variable read/verify (and correct if wrong) for `NEXT_PUBLIC_DISPATCH_PHONE` in Vercel. Both are Human-gated per `AGENTS.md`/`CLAUDE.md` — Claude Code documents and tracks them here rather than executing them.

## Affected Surfaces

- **Frontend**: none (no code change). If `NEXT_PUBLIC_DISPATCH_PHONE` is found unset/wrong, the affected surface is the intake-web safety-flag "Call dispatch now" screen — config only, not code.
- **Backend/API**: none changed. Existing `POST /admin/jobs/{id}/resolve` is used as-is by whoever performs the resolution.
- **Database/storage**: one `jobs` row (the specific stale job) transitions state via the existing resolve action; no migration.
- **Docs/operations**: `docs/EXECUTION-PLAN.md` §9/§10 remain canonical status; update them once both tasks close. `docs/PILOT-OPERATIONS.md` §10 (PO sign-off) depends on this closing.
- **CI/release**: none.

## Contracts And Invariants

- `POST /admin/jobs/{id}/resolve` contract is unchanged.
- Tenant isolation: resolution stays scoped to `metro-key`'s own recovery workspace / Ops read-only oversight.
- Provider-managed dispatch boundary: not applicable — no new dispatch mutation surface.
- Public `/v1`, MCP, or generated contract compatibility: not applicable.

## Verification Plan

- **Unit/integration**: not applicable — no code change.
- **Type/build**: not applicable.
- **Migration/data**: not applicable — no schema change; the resolve action is an existing, already-tested endpoint.
- **Tenant/RLS**: not applicable — no new query path.
- **Public contract drift**: not applicable.
- **Manual/browser/mobile**: Human confirms via `provider-web`/`ops` recovery workspace that the specific stale job's state reflects resolution; Human confirms via Vercel project settings (`intake-web`, Production environment) that `NEXT_PUBLIC_DISPATCH_PHONE` is set and is a real staffed number, not the `+1 800-555-1234` placeholder.
- **Security/privacy**: neither verification step pastes the job's contact info, the private evidence log content, or the actual phone number into this repo, a PR body, or a checklist — only "verified: yes/no" + date + verifier identity.

## Rollout And Rollback

- **Flags/config**: `NEXT_PUBLIC_DISPATCH_PHONE` (Vercel env var, `intake-web`, Production) — verification-only (confirming the current value) needs no deployment. If the value is wrong and must be corrected, the fix requires the normal authorized production env update through Vercel plus a redeploy/rebuild of `intake-web`; the browser-visible `NEXT_PUBLIC_*` value does not change until that rebuild completes.
- **Production approval needed**: `yes` — both the job resolve action and any env var change require explicit Human authorization for that exact target, per `CLAUDE.md`/AGENTS.md.
- **Rollback path**: not applicable to the stale-job resolution (terminal state). For the env var, revert to the prior value if a correction turns out wrong.

## Open Questions

- Is the 2026-07-12 stale job still unresolved as of today (2026-09-03), or was it already closed out-of-band? Must be checked before acting — see `spec.md` Edge Scenarios.
- Who currently holds Vercel production environment-variable write access for `intake-web`, to perform the verification/correction?
