# Tasks: Dispatcher Alert Acknowledgement And Escalation

**Spec**: `specs/005-dispatch-alert-ack-escalation/spec.md`
**Plan**: `specs/005-dispatch-alert-ack-escalation/plan.md`
**Owner**: `Codex lead; delegated owners per task`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means the task requires Human input or authorization before execution.
- `[R]` means Codex final review is required before merge.

## Tasks

- [x] T001 [H] Human/Codex: approve dispatcher SLA policy values. Decision recorded: 5-minute acknowledgement target; 30-minute stalled threshold; provider-configured schedule with pilot default; all dispatchers first-line; provider admins backup; browser notifications plus durable inbox authorized; email/SMS fallback may be implemented disabled pending separate production authorization.
- [x] T002 Codex: inspect current alert store methods, Postgres parity, provider UI, and existing tests; record whether a schema migration is required before implementation. Decision: no new alert table; add `0062_dispatch_alert_sla_defaults` for DB-backed stalled threshold default only.
- [x] T003 [P] Claude: critique `spec.md` and `plan.md` for tenant isolation, provider-managed dispatch boundaries, communications side effects, auditability, and missing tests; return findings only. First review returned changes-requested and findings were addressed.
- [x] T004 Codex: resolve T003 findings and update the spec/plan/tasks before code changes.
- [x] T005 Codex: implement backend SLA policy resolution and idempotent escalation evaluation for open unacknowledged alerts behind default-off `DISPATCH_ALERT_ESCALATION_ENABLED`. Surfaces: `apps/intake-web/api/main.py`, store implementation, related tests. Local pilot records intended delivery policy separately from actual delivery attempts.
- [x] T006 Codex or Claude: implement provider UI state display for escalated/acknowledged/resolved alert evidence without adding customer-visible claims. Surface: `apps/provider-web/src/app/messages/page.tsx` and shared UI only if justified. SLA-breached is represented by durable `escalated_at` in this pilot.
- [x] T007 [P] Codex: extend API tests for provider-owned list/ack/resolve, foreign 404/no inference, platform read-only oversight, technician/customer denial, escalation threshold, and duplicate-sweep idempotency. Surface: `apps/intake-web/api/tests/test_alerts.py`.
- [x] T008 [P] Codex: add or update migration/RLS tests if T002 determines a schema migration is required. Surfaces: `packages/db/alembic/versions/**`, Postgres security tests. Added offline Alembic validation target for `0062`.
- [x] T009 Codex: update operational docs after implementation behavior is known. Current implementation/deferred behavior is recorded in this spec, plan, tasks, and checklist; broader docs can be updated during production rollout.
- [x] T010 Claude or other independent reviewer: perform secondary review of implementation because this touches dispatch lifecycle, communications/alerts, and production-readiness paths. Claude Code returned `approve` after blocking findings were resolved.
- [x] T011 [R] Codex final review: verified implementation, specs, docs, local tests, production-safe defaults, CI expectations, and unresolved rollout gates after rebasing onto current `main`.
- [ ] T012 [H] Human: separately authorize any production migration/deployment/config activation or live SMS/voice/push/email alert delivery target. Browser notification implementation/testing is authorized as a console-local adjunct, but this planning artifact does not authorize production deployment or live external sends.
- [ ] T013 [H] Human/Codex follow-up: choose and implement production scheduler/cadence for the 5-minute SLA, provider-configured staffed schedule storage/UI, and exact after-hours fallback behavior. This is deferred from the local pilot implementation and blocks production claims about 5-minute routing or staffed-hours handling.
- [x] T014 [H] Codex follow-up (blocks enabling `DISPATCH_ALERT_ESCALATION_ENABLED`): alerts never auto-resolve when their job progresses, and `new_job` alerts are created for every job, so with the flag on every un-acked alert (including assigned/completed jobs) escalates after the ack SLA. Scope escalation to actionable alerts (e.g. skip jobs past dispatch, or auto-resolve `new_job`/`stalled_job`/`stuck_offer` on assignment/terminal state) before activation. Found in 2026-09-27 Claude finalization review. Done 2026-09-27 (Claude, TDD): the sweep skips `new_job`/`stalled_job`/`stuck_offer` alerts whose job is not `pending_dispatch` in `get_ops_queue`; safety/help/delivery alerts still escalate. Tests: `test_alerts.py` lifecycle/non-lifecycle parametrized cases. Flag stays off.
- [ ] T015 Codex follow-up: add Postgres coverage for the changed alert SQL (`create_alert` unresolved pre-check, conditional ack/resolve, `mark_alert_escalated` jsonb merge). `test_postgres_security.py` has no alert tests, so CI's Postgres job does not exercise these paths. 2026-09-27 (Claude): added `test_postgres_alert_dedupe_ack_resolve_and_escalation_sql` and `test_postgres_sweep_escalates_only_actionable_dispatch_lifecycle_alerts`; they skip locally (no `POSTGRES_TEST_URL`). Close T015 only after the CI Postgres job runs them green.
- [x] T016 Claude: guard `new Notification(...)` in provider Messages with try/catch — Android Chrome throws `Illegal constructor`, which would crash the page inside `useEffect` once permission is granted.

## Verification

- [x] `cd apps/intake-web && uv run --with-requirements requirements.txt --with pytest pytest api/tests/test_alerts.py api/tests/test_dispatch.py -q` (covered again by the full run after integration fixes).
- [x] `cd apps/intake-web && uv run --with-requirements requirements.txt --with pytest pytest api/tests -q --ignore=api/tests/test_postgres_security.py` (2026-09-29: 575 passed, 1 skipped).
- [x] `npm run typecheck` (2026-09-29: pass).
- [x] `npm run build --workspace @cluexp/provider-web` (2026-09-29: pass).
- [x] `npm run test --workspace @cluexp/console-ui` (2026-09-29: 22 passed).
- [x] If migration added: `uv run --with alembic --with "sqlalchemy>=2" --with psycopg alembic -c packages/db/alembic.ini upgrade head --sql` (2026-09-29: reached `0062_dispatch_alert_sla_defaults`).
- [ ] If migration/RLS touched: run the CI Postgres/RLS sequence with `POSTGRES_TEST_URL` and `MIGRATION_DATABASE_URL`. 2026-09-29: the test file collected successfully with 15 expected local skips because `POSTGRES_TEST_URL` is unset; no production database command was run. Deferred to the CI `api` Postgres job.
- [x] `python .github/scripts/check-sdlc-policy.py --working-tree` (2026-09-29: pass).
- [x] `git diff --check` (2026-09-29: clean).
- [x] Secondary-agent review markers recorded in `checklists/sdlc-policy.md` or PR body before merge.
- [ ] Human acceptance/authorization recorded before any production side effect.
