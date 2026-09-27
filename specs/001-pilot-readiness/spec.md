# Feature Specification: Pilot Readiness Blocker — Stale Metro-Key Job + Staffed Safety Phone

**Feature Branch**: `logicacodecom/task-001-pilot-readiness`
**Spec Directory**: `specs/001-pilot-readiness`
**Created**: `2026-09-03`
**Owner**: `Human` (execution); `Codex` (engineering review)
**Status**: `draft`

## Summary

Consolidate the first confirmed pilot-readiness blocker from `docs/EXECUTION-PLAN.md` §9 Immediate Work Order item 4 and §10 Active Decisions & Risks into a trackable Spec Kit slice: (1) resolve the real, multi-day-stale, contact-info-less `metro-key` job the 2026-07-12 prod smoke test found sitting unassigned with zero dispatcher action, and (2) verify `NEXT_PUBLIC_DISPATCH_PHONE` in the intake-web production environment points to a real, staffed number rather than falling back to the code default placeholder `+1 800-555-1234`. Both are Human/PO-gated production actions; this spec records scope, evidence requirements, and task ownership only — it does not perform the resolve action or read/expose the private evidence log.

## Scope

### In Scope

- Define the two blocking actions from EXECUTION-PLAN §9 item 4 as trackable, owned tasks.
- Define the evidence each action must produce for pilot sign-off (`PILOT-OPERATIONS.md` §10).
- Record the one-writer ownership for the recovery-workspace resolve action and the env-var verification.
- Reference PRODUCTION-READINESS.md and EXECUTION-PLAN.md as canonical; do not restate or migrate their full content here.

### Out Of Scope

- Performing the actual `POST /admin/jobs/{id}/resolve` call or any other live dispatch/cancel/resolve action.
- Reading or reproducing the private evidence log (job PII, contact info, or intake-app trust-state exposure).
- Editing `NEXT_PUBLIC_DISPATCH_PHONE` or any other production environment variable.
- The broader dispatcher-availability-risk/SLA/escalation product design (EXECUTION-PLAN §10, first bullet) — that is a separate, larger backlog slice (candidate: `specs/002-dispatch-alert-escalation/` per prior planning note in `specs/000-orca-speckit-sdlc/tasks.md` T014), not this narrow blocker.
- Any other Immediate Work Order item (§9 items 1, 2, 5, 6, 7).

## Users And Scenarios

### Primary Scenario

1. Given the stale `metro-key` job identified during the 2026-07-12 prod smoke test is still open in the provider recovery workspace,
2. When a Human with recovery-workspace access reviews it via `provider-web` (or Ops read-only oversight) and confirms disposition,
3. Then they resolve it via `POST /admin/jobs/{id}/resolve` (or the recovery-workspace UI action backing it) with a documented reason, and the private evidence log is updated to reflect closure — outside this repo.

### Edge And Failure Scenarios

- The job was already resolved between 2026-07-12 and now — verify current state before re-acting; do not assume staleness persists.
- `NEXT_PUBLIC_DISPATCH_PHONE` is unset or misconfigured in one Vercel environment (e.g. Preview) but not Production — verification must be Production-environment-specific.
- The safety-flag phone escape hatch is reached by a real customer while the env var is still unverified — this is the exact harm the blocker exists to prevent; no code change is required, only configuration verification.
- Verifying the env var requires reading a value that could itself be treated as sensitive operational config — confirm via Vercel project settings (existence/non-default-ness), not by printing the number into any shared or committed artifact.

## Requirements

### Functional Requirements

- **FR-001**: This spec directory must exist so the blocker is tracked in Spec Kit rather than only in prose inside `EXECUTION-PLAN.md`.
- **FR-002**: `tasks.md` must list the stale-job resolution and the phone-number verification as separate `[H]` Human-gated tasks with explicit owners.
- **FR-003**: Neither task may be marked complete in `tasks.md` without evidence: for the stale job, confirmation of current job state and resolution action taken (recorded in the private evidence log, referenced but not reproduced here); for the phone number, confirmation that Production `NEXT_PUBLIC_DISPATCH_PHONE` is set to a real staffed number (recorded as "verified: yes/no", not the number itself, in `tasks.md`/`PILOT-OPERATIONS.md`).
- **FR-004**: This spec must not duplicate or fork the canonical status tracking already in `docs/EXECUTION-PLAN.md` §9/§10 — once both tasks are done, EXECUTION-PLAN.md must be updated to reflect it (Codex/Human, not invented here).

### Non-Functional Requirements

- **NFR-001**: No production mutation, DDL, dispatch, cancel, or resolve action is performed by Claude Code under this spec.
- **NFR-002**: No PII, contact info, or private evidence-log content is copied into this repo.

## Data, API, And Trust Boundaries

- **Data touched**: none by this spec directly; the resolve action (performed by a Human/authorized agent, not here) touches the `jobs` row for the stale `metro-key` record via `POST /admin/jobs/{id}/resolve`.
- **API contracts**: `POST /admin/jobs/{id}/resolve` (existing recovery-workspace endpoint) — no contract change.
- **Trust-state/privacy rules**: the stale job's contact info, if any, and the private evidence log must not be pasted into this repo, PR body, or checklist.
- **Tenant isolation**: the stale job belongs to `metro-key`'s own queue; resolution must stay within that tenant's dispatcher/Ops scope.
- **Dispatch state**: resolving the job transitions it out of `pending_dispatch`/stale-unassigned into a closed/resolved state per the existing recovery-workspace flow — no new state is introduced.
- **Payments/closeout**: not applicable.
- **External side effects**: the safety-flag phone escape hatch, once verified, is what a real customer reaches in an emergency — this is the reason the verification is a pilot-blocking gate, not optional polish.

## ClueXP-Specific Checks

- **Trust-state rule**: not applicable — no UI/agent code is invented here; both tasks are configuration/data verification, not new trust-state logic.
- **Provider-managed dispatch rule**: resolving the stale job uses the existing provider-managed recovery workspace / Ops read-only oversight model; this spec does not introduce platform-level dispatch mutation.
- **Public `/v1`/MCP rule**: not applicable.
- **Migration/RLS rule**: not applicable — no schema change.
- **Generated artifacts**: not applicable.

## Acceptance Criteria

- [ ] `specs/001-pilot-readiness/` contains `spec.md`, `plan.md`, `tasks.md`, and `checklists/sdlc-policy.md`.
- [ ] `tasks.md` lists the stale-job resolution and the `NEXT_PUBLIC_DISPATCH_PHONE` verification as distinct `[H]` tasks with named owners and no ambiguity about who acts.
- [ ] Neither task claims completion without the evidence described in FR-003.
- [ ] `docs/EXECUTION-PLAN.md` §9 item 4 is cross-referenced from this spec (not duplicated in full) and is the canonical place to record final resolution status.
- [ ] No production mutation, live dispatch action, or PII exposure occurred while producing this spec.

## Risks, Assumptions, And Human Decisions

- **Risks**: if the stale job is left unresolved, it remains inconsistent operational state in the pilot channel's queue; if the phone fallback is left unverified, a real customer who trips the safety flag could reach a placeholder or dead number instead of a staffed line — a life-safety-adjacent gap, not just a UX gap.
- **Assumptions**: the private evidence log referenced in `EXECUTION-PLAN.md` §10 still contains the specific job identifier; this spec does not have access to it and does not need it to define the task.
- **Human decisions needed**: (1) a Human/authorized dispatcher-with-recovery-access must review and resolve the specific stale job; (2) a Human with Vercel production environment access must confirm and, if needed, correct `NEXT_PUBLIC_DISPATCH_PHONE` for `intake-web` Production.
