# Tasks: Pilot Readiness Blocker — Stale Metro-Key Job + Staffed Safety Phone

**Spec**: `specs/001-pilot-readiness/spec.md`
**Plan**: `specs/001-pilot-readiness/plan.md`
**Owner**: `Codex lead; delegated owners per task`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means the task requires Human input or authorization before execution.
- `[R]` means Codex final review is required before merge.

## One-Writer Ownership

- `specs/001-pilot-readiness/*` (this feature directory): **Claude Code** is sole writer for this consolidation pass (spec/plan/tasks/checklist creation, 2026-09-03). Any further edits to these files should be made by Claude Code or explicitly handed off in `tasks.md`/Orca task state — do not have two agents editing this directory concurrently.
- `docs/EXECUTION-PLAN.md` §9/§10 status lines for this item: **Codex** remains sole writer for canonical status updates once T002/T003 close.

## Tasks

- [x] T001 Claude Code: create `specs/001-pilot-readiness/spec.md`, `plan.md`, `tasks.md`, `checklists/sdlc-policy.md` consolidating EXECUTION-PLAN §9 item 4 and the matching §10 risk entry.
- [ ] T002 [H] Human/authorized dispatcher (recovery-workspace access, `metro-key` tenant): verify current state of the stale job found 2026-07-12; if still stale, resolve it via `POST /admin/jobs/{id}/resolve` (or the recovery-workspace UI) with a documented reason; record disposition in the private evidence log per `EXECUTION-PLAN.md` §10, and record "resolved: yes, date: ___" here (no job ID/PII in this repo).
- [ ] T003 [H] Human with Vercel production access (`intake-web` project): confirm `NEXT_PUBLIC_DISPATCH_PHONE` in the Production environment is set to a real, staffed number (not the `+1 800-555-1234` placeholder); correct it if wrong; record "verified: yes, date: ___" here (no phone number in this repo).
- [ ] T004 [R] Codex: after T002 and T003 both show "yes", update `docs/EXECUTION-PLAN.md` §9 item 4 status and §10 risk entry to reflect closure, and confirm `docs/PILOT-OPERATIONS.md` §10 PO sign-off is unblocked on this specific item.
- [ ] T005 [R] Codex or Claude Code (secondary, not the task's author on T002/T003): review that T002/T003 evidence lines are present without PII/secret leakage before this spec is marked `accepted`.

## Verification

- [ ] `tasks.md` T002 and T003 both show recorded evidence lines before this spec's `Status` moves to `accepted`.
- [ ] No job PII, private evidence-log content, or the literal `NEXT_PUBLIC_DISPATCH_PHONE` value appears anywhere in this repo, PR body, or checklist.
- [ ] `docs/EXECUTION-PLAN.md` §9/§10 reflects the same closure status as this file (no drift between canonical doc and spec).
- [ ] No production DDL, live dispatch/cancel action, or deployment was performed by Claude Code while producing this spec.
