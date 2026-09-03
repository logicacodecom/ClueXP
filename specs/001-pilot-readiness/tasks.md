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
- [ ] T002 [H] Human/authorized dispatcher (recovery-workspace access, `metro-key` tenant): verify current state of the stale job found 2026-07-12; if still stale, resolve it via `POST /admin/jobs/{id}/resolve` (or the recovery-workspace UI) with a documented reason; record disposition in the private evidence log per `EXECUTION-PLAN.md` §10, and record "resolved: yes, date: ___" here (no job ID/PII in this repo). **Evidence found 2026-09-03**: `docs/HANDOFF.md`'s 2026-07-13 entry states this specific job was already closed via `POST /admin/jobs/{id}/resolve` (action `close`) on 2026-07-13, redacted (no job ID). `docs/EXECUTION-PLAN.md` §9 item 4 still reads as open — this looks like doc drift, not an open production task. A Human/Codex should confirm current job state directly (not from this repo) and, if confirmed already closed, mark this "resolved: yes, date: 2026-07-13 (per HANDOFF.md)" and ask Codex to correct the EXECUTION-PLAN.md drift under T004.
- [ ] T003 [H] Human with Vercel production access (`intake-web` project): confirm `NEXT_PUBLIC_DISPATCH_PHONE` in the Production environment is set to a real, staffed number (not the `+1 800-555-1234` placeholder); correct it if wrong; record "verified: yes, date: ___" here (no phone number in this repo). **Evidence found 2026-09-03**: `docs/HANDOFF.md`'s 2026-07-13 entry confirms this was a real, unresolved bug as of that date (production JS bundle showed the unset-fallback expression) — still needs a Human with Vercel access to set the real number and redeploy; not yet closed.
- [ ] T004 [R] Codex: after T002 and T003 both show "yes", update `docs/EXECUTION-PLAN.md` §9 item 4 status and §10 risk entry to reflect closure (including the T002 doc-drift correction noted above), and confirm `docs/PILOT-OPERATIONS.md` §10 PO sign-off is unblocked on this specific item.
- [ ] T005 [R] Codex or Claude Code (secondary, not the task's author on T002/T003): review that T002/T003 evidence lines are present without PII/secret leakage before this spec is marked `accepted`.

### PO follow-up: associated stale demo jobs cleanup (added 2026-09-03)

Product Owner asked to clean up "associated stale demo jobs" related to this blocker. Treated as production-adjacent destructive data work. **No SQL DELETE, hard-delete, or bulk cleanup tool was run.** Findings from repo docs/runbooks only (no DB access used):

- The only real, non-demo stale job this blocker concerns (the 2026-07-12 incident job) already appears closed per the T002 evidence note above — it is not a "demo" job and is not in scope for a cleanup/delete action; it needs state confirmation, not deletion.
- The repo has one existing repeatable/idempotent demo-data path: `scripts/reset_demo_providers.py` (npm `demo:reset`, with `--dry-run`/`--no-clean`/`--no-jobs`), documented in `docs/PILOT-OPERATIONS.md` §2.1 and `docs/SYSTEM-DESIGN.md`. It does an FK-safe **delete-and-reseed** of legacy Metro Key demo *jobs* (company/technicians preserved), not a targeted resolve/close of one exact job. `metro-key` is also the **live pilot channel** — real customer jobs and demo jobs can coexist in the same tenant, and the repo docs do not establish a way to distinguish "safe to bulk-delete demo job" from "real pilot job" from outside a live DB query. Running this tool against production without that distinction risks deleting real customer data, which contradicts the PO's own instruction to avoid broad/hard deletion.
- No other exact stale "demo job" identifier is available from repo docs without pulling from the private evidence log or a live production query, both of which would risk exposing PII/secrets or performing an unauthorized production read/action from this environment.

- [ ] T006 [H] **STOP — Human/PO decision required before any cleanup action.** Needed before Claude Code or Codex can proceed:
  1. Exact identifier(s) of the specific job(s) the PO considers "stale demo jobs" (obtained by the Human directly from the recovery workspace/DB — not pasted into this repo), and confirmation each one is demo/synthetic data, not a real customer job.
  2. Confirmation of target environment (production `metro-key` vs. a non-prod/demo-only environment) for each identified job.
  3. Explicit Human authorization for the exact action per `AGENTS.md`/`CLAUDE.md` production-mutation rules.
  - **If** an exact job is confirmed demo-only and still needs closing, prefer `POST /admin/jobs/{id}/resolve` (or the recovery-workspace UI) — the same audited, per-job recovery path as T002 — over `scripts/reset_demo_providers.py`'s bulk delete-and-reseed, because it acts on one confirmed target instead of a class of records.
  - **Do not** run `scripts/reset_demo_providers.py`/`npm run demo:reset` against production unless the Human has independently confirmed (outside this repo) that it will not touch any real pilot customer job, and has given explicit authorization for that exact run.
  - Record the outcome here ("cleaned: yes/no, method: resolve-per-job | demo:reset --dry-run reviewed | declined, date: ___") without job IDs, PII, or evidence-log content.

## Verification

- [ ] `tasks.md` T002 and T003 both show recorded evidence lines before this spec's `Status` moves to `accepted`.
- [ ] No job PII, private evidence-log content, or the literal `NEXT_PUBLIC_DISPATCH_PHONE` value appears anywhere in this repo, PR body, or checklist.
- [ ] `docs/EXECUTION-PLAN.md` §9/§10 reflects the same closure status as this file (no drift between canonical doc and spec).
- [ ] No production DDL, live dispatch/cancel action, or deployment was performed by Claude Code while producing this spec.
- [ ] T006 stop condition is satisfied (exact demo job identity + environment + explicit Human authorization recorded) before any cleanup/delete/resolve action is taken on a "stale demo job."
- [ ] `scripts/reset_demo_providers.py`/`npm run demo:reset` is not run against production without independent Human confirmation it excludes real pilot customer jobs.
