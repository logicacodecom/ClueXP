# Tasks: Dispatcher Alert Acknowledgement And Escalation

**Spec**: `specs/005-dispatch-alert-ack-escalation/spec.md`
**Plan**: `specs/005-dispatch-alert-ack-escalation/plan.md`
**Owner**: `Codex lead; delegated owners per task`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means the task requires Human input or authorization before execution.
- `[R]` means Codex final review is required before merge.

## Tasks

- [x] T001 [H] Human/Codex: record dispatcher SLA target policy. The pilot implements the 5-minute acknowledgement marker and prepares the 30-minute stalled-threshold migration; schedule storage, a temporary staffed-hours default, role-targeted routing, and after-hours behavior remain deferred. Browser notifications plus durable inbox are authorized for implementation/testing; email/SMS remain unauthorized.
- [x] T002 Codex: inspect current alert store methods, Postgres parity, provider UI, and existing tests; record whether a schema migration is required before implementation. Decision: no new alert table; add `0062_dispatch_alert_sla_defaults` for unresolved-alert uniqueness and the gated DB-backed stalled-threshold default.
- [x] T003 [P] Claude: critique `spec.md` and `plan.md` for tenant isolation, provider-managed dispatch boundaries, communications side effects, auditability, and missing tests; return findings only. First review returned changes-requested and findings were addressed.
- [x] T004 Codex: resolve T003 findings and update the spec/plan/tasks before code changes.
- [x] T005 Codex: implement backend SLA policy resolution and idempotent escalation evaluation for open unacknowledged alerts behind default-off `DISPATCH_ALERT_ESCALATION_ENABLED`. Surfaces: `apps/intake-web/api/main.py`, store implementation, related tests. Local pilot records intended delivery policy separately from actual delivery attempts.
- [x] T006 Codex or Claude: implement provider UI state display for escalated/acknowledged/resolved alert evidence without adding customer-visible claims. Surface: `apps/provider-web/src/app/messages/page.tsx` and shared UI only if justified. SLA-breached is represented by durable `escalated_at` in this pilot.
- [x] T007 [P] Codex: extend API tests for provider-owned list/ack/resolve, foreign 404/no inference, platform read-only oversight, technician/customer denial, escalation threshold, and duplicate-sweep idempotency. Surface: `apps/intake-web/api/tests/test_alerts.py`.
- [x] T008 [P] Codex: add or update migration/RLS tests if T002 determines a schema migration is required. Surfaces: `packages/db/alembic/versions/**`, Postgres security tests. Added offline Alembic validation target for `0062`.
- [x] T009 Codex: update this feature's artifacts and canonical `docs/SYSTEM-DESIGN.md` with the implemented durable marker behavior, default-off gate, daily-cadence limitation, and deferred routing scope.
- [x] T010 Claude: perform a preliminary implementation review. This review informed fixes but cannot satisfy the final merge gate because Claude also authored T014/T016.
- [x] T011 [R] Codex final review: re-verified implementation, specs, canonical docs, production-safe defaults, local tests, CI expectations, and unresolved rollout gates after resolving current-main review findings.
- [ ] T012 [H] Human: separately authorize any production migration/deployment/config activation or live SMS/voice/push/email alert delivery target. Browser notification implementation/testing is authorized as a console-local adjunct, but this planning artifact does not authorize production deployment or live external sends.
- [ ] T013 [H] Human/Codex follow-up: choose and implement production scheduler/cadence for the 5-minute SLA, provider-configured staffed schedule storage/UI, and exact after-hours fallback behavior. This is deferred from the local pilot implementation and blocks production claims about 5-minute routing or staffed-hours handling.
- [x] T014 [H] Codex follow-up (blocks enabling `DISPATCH_ALERT_ESCALATION_ENABLED`): alerts never auto-resolve when their job progresses, and `new_job` alerts are created for every job, so with the flag on every un-acked alert (including assigned/completed jobs) escalates after the ack SLA. Scope escalation to actionable alerts (e.g. skip jobs past dispatch, or auto-resolve `new_job`/`stalled_job`/`stuck_offer` on assignment/terminal state) before activation. Found in 2026-09-27 Claude finalization review. Done 2026-09-27 (Claude, TDD): the sweep skips `new_job`/`stalled_job`/`stuck_offer` alerts whose job is not `pending_dispatch` in `get_ops_queue`; safety/help/delivery alerts still escalate. Tests: `test_alerts.py` lifecycle/non-lifecycle parametrized cases. Flag stays off.
- [ ] T015 Codex follow-up: run the added Postgres coverage for serialized concurrent alert creation, unresolved uniqueness, conditional ack/resolve, JSONB escalation merge, and lifecycle filtering. The tests collect but skip locally without `POSTGRES_TEST_URL`; close T015 only after the CI Postgres job runs them green.
- [x] T016 Claude: guard `new Notification(...)` in provider Messages with try/catch — Android Chrome throws `Illegal constructor`, which would crash the page inside `useEffect` once permission is granted.

## Verification

- [x] `cd apps/intake-web && uv run --with-requirements requirements.txt --with pytest pytest api/tests/test_alerts.py api/tests/test_dispatch.py -q` (covered again by the full run after integration fixes).
- [x] `cd apps/intake-web && uv run --with-requirements requirements.txt --with pytest pytest api/tests -q --ignore=api/tests/test_postgres_security.py` (2026-09-29 final integration: 576 passed, 1 skipped).
- [x] `npm run typecheck` (2026-09-29: pass).
- [x] `npm run build --workspace @cluexp/provider-web` (2026-09-29: pass).
- [x] `npm run test --workspace @cluexp/console-ui` (2026-09-29: 22 passed).
- [x] If migration added: `uv run --with alembic --with "sqlalchemy>=2" --with psycopg alembic -c packages/db/alembic.ini upgrade head --sql` (2026-09-29: reached `0062_dispatch_alert_sla_defaults`).
- [ ] If migration/RLS touched: run the CI Postgres/RLS sequence with `POSTGRES_TEST_URL` and `MIGRATION_DATABASE_URL`. 2026-09-29: the test file collected successfully with 15 expected local skips because `POSTGRES_TEST_URL` is unset; no production database command was run. Deferred to the CI `api` Postgres job.
- [x] `python .github/scripts/check-sdlc-policy.py --working-tree` (2026-09-29: pass).
- [x] `git diff --check` (2026-09-29: clean).
- [ ] Final different-family review record must be added to the PR body against the exact commit before merge.
- [ ] Human acceptance/authorization recorded before any production side effect.
