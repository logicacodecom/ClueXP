# Checklist: Pilot Readiness Blocker — Stale Metro-Key Job + Staffed Safety Phone

**Artifact Reviewed**: `spec.md`
**Reviewer**: `Claude Code` (self-check on creation; independent secondary review still required per below)
**Date**: `2026-09-03`

Secondary-agent review required: yes
Secondary-agent review completed: no
Reviewer agent: Codex
Review result: pending

This item touches production dispatch-adjacent state (a `jobs` row resolve action) and a production safety-fallback environment variable, so it is treated as risky per the constitution's material-change definition even though no application code changes. Codex review is requested before either Human-gated task (T002/T003 in `tasks.md`) is executed against production.

## Requirements Quality

- [x] Requirements are testable and observable (T002/T003 evidence lines in `tasks.md`).
- [x] Scope and non-goals are explicit (spec.md Out Of Scope excludes the broader escalation-design slice and any live action performed by Claude Code).
- [x] Ambiguities are resolved or listed as Human decisions (spec.md Risks/Human decisions; plan.md Open Questions).

## ClueXP Safety

- [x] Tenant isolation is preserved — resolution stays within `metro-key`'s own recovery workspace / Ops read-only oversight; no cross-tenant action introduced.
- [x] Tenant isolation has documented non-applicability evidence — no new query path or code change.
- [x] Trust-state and privacy gates are named — spec.md and tasks.md explicitly forbid pasting PII, evidence-log content, or the actual phone number into this repo.
- [x] Provider-managed dispatch boundaries remain intact — ClueXP does not dispatch; resolution uses the existing provider/Ops-scoped recovery endpoint.
- [x] Public `/v1`, MCP, generated type, and OpenAPI contracts — not applicable, none touched.
- [x] Database migrations — not applicable, no schema change.
- [x] No technician, ETA, tracking, price, payment, or dispatch state is invented by UI or agent code — none introduced.
- [x] No production DDL, deployment, platform submission, payment, or dispatch action is authorized by this checklist alone — T002/T003 remain explicitly `[H]` Human-gated in `tasks.md`.

## Verification

- [x] Tests/checks are listed in `plan.md` and mapped to tasks — manual production verification steps only, no code to unit-test.
- [x] CI requirements are identified — this feature directory itself satisfies the `sdlc-policy` CI gate for touching production runbook/operational-policy content.
- [x] Manual acceptance evidence is identified — T002/T003 evidence lines in `tasks.md`, and `docs/EXECUTION-PLAN.md` update in T004.
