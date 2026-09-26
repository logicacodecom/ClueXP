# Tasks: ClueXP Digital Verification SMS

**Spec**: [`spec.md`](spec.md)
**Plan**: [`plan.md`](plan.md)

- [x] T001 [Codex] Record the Human product decision and supersede the provider-number/voice activation plan.
- [x] T002 [Codex] Add migration `0060` with hashed, expiring, single-use verification records and default-deny RLS.
- [x] T003 [Codex] Add store implementations for create, rate count, status, consume, and activation context.
- [x] T004 [Codex] Add safe-default platform SMS configuration and provider selection independent of `COMMUNICATIONS_PROVIDER`.
- [x] T005 [Codex] Add send, status, consume, and cookie-backed resume endpoints.
- [x] T006 [Codex] Gate provider-queue activation and commit when verification is required.
- [x] T007 [Codex] Add the intake verification/resume UI and first-party verification route.
- [x] T008 [Codex] Update canonical execution and architecture documentation.
- [x] T009 [Codex] Run focused API, migration/RLS, and web checks. Evidence: full API suite `522 passed, 12 skipped`; focused verification/RLS `17 passed`; Alembic offline upgrade passed; intake-web production build passed.
- [x] T010 [R] [Secondary reviewer] Review migration, token security, tenant/dispatch boundaries, safe defaults, and test evidence. `/root/digital_sms_review` approved on 2026-09-24 after all findings were resolved.
- [x] T011 [R] [Codex] Resolve findings and complete final technical review.

## Production Gates

- [ ] ClueXP A2P Brand and Campaign are complete.
- [ ] Production migration/deployment is explicitly authorized.
- [ ] Platform SMS environment activation is explicitly authorized.
- [ ] A live acceptance-test target is explicitly authorized.

No production gate is authorized by this task file.
