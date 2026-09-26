# Tasks: Twilio Production Configuration

> **Superseded 2026-09-24:** T006 through T011 must not be executed. The shared number is now reserved for ClueXP-owned digital verification SMS and must not be assigned to a provider. No deployment, voice/webhook activation, or live traffic is authorized. Replacement work is tracked in [`../002-cluexp-digital-verification-sms/tasks.md`](../002-cluexp-digital-verification-sms/tasks.md).

**Spec**: [`spec.md`](spec.md)
**Plan**: [`plan.md`](plan.md)
**Owner**: `Codex lead; delegated reviewer per task`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means the task requires Human input or authorization before execution.
- `[R]` means Codex final review is required before completion.

## Tasks

- [x] T001 [Codex] Verify repository authority, implementation, existing production variable names, Twilio number capabilities, and A2P status.
- [x] T002 [P] [Claude Code] Independently review the production configuration plan, sequencing, rollback, privacy, and tenant-assignment gates; initial result `changes-requested`, with remediation incorporated into this revision.
- [x] T003 [Codex] Add `COMMUNICATIONS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WEBHOOK_BASE_URL` to Vercel Production using secret-safe input; do not deploy and do not yet add the fallback number. Completed 2026-09-23; Vercel confirmed each Production Secret by name and no value was printed. On 2026-09-24, after the tenant preflight failed, `COMMUNICATIONS_PROVIDER` was set back to `noop` so an unrelated deployment cannot activate Twilio prematurely.
- [x] T004 [H] [Human] Identify the organization that owns `+17275136040`. Human selected `Metro Key` on 2026-09-24. Channel capability flags remain unapproved; SMS is blocked by incomplete A2P.
- [x] T005 [Codex] Run the fallback preflight without exposing numbers. On 2026-09-24, Metro Key itself had `sms_enabled=true` and `masked_calling_enabled=true` with no assigned Twilio number and `a2p_registered=false`, so the preflight failed and `TWILIO_DEFAULT_FROM_NUMBER` was correctly withheld. Both Metro Key channel flags were then set to false and verified in Production.
- [ ] T006 [H] [Human] Explicitly authorize the production redeploy immediately before execution.
- [ ] T007 [Codex] After T006 and the full tenant preflight, switch `COMMUNICATIONS_PROVIDER` from `noop` to `twilio`, redeploy production, and verify host/signature boundaries safely without sending traffic.
- [ ] T008 [H] [Human] Confirm that the authenticated Supabase session targets the intended ClueXP production project and explicitly authorize assigning the shared number to `Metro Key Partners` (`metro-key`) immediately before DML. The Orca browser reached the Supabase sign-in page on 2026-09-24, so identity was not confirmed and no DML was attempted.
- [ ] T008A [Codex] After T008, assign Metro Key Partners' `twilio_number` through the authorized operations database path while preserving `a2p_registered=false`, `sms_enabled=false`, and `masked_calling_enabled=false`. The current application intentionally exposes no platform-admin API for the ops-owned number/A2P fields. Do not mark A2P ready until Twilio shows both Brand and Campaign complete.
- [ ] T009 [H] [Human] Explicitly authorize inbound webhook go-live for each permitted channel; acknowledge that activating the inbound SMS webhook sends an automatic TwiML reply. This authorization does not authorize a live acceptance test.
- [ ] T009A [H] [Human] Separately authorize the exact live voice/SMS acceptance-test target and channel. This authorization does not activate any webhook by itself.
- [ ] T010 [Codex] After T007/T008A/T009, configure only the authorized Twilio voice and/or messaging callbacks and verify the displayed URLs/methods. Do not run a live test under this task.
- [ ] T010A [Codex] After T010/T009A, enable only the authorized organization channel flags inside the supervised acceptance-test window and run only the specifically authorized test. Keep SMS disabled unless Twilio Brand and Campaign are both complete and verified.
- [ ] T011 [R] Codex final review: verify provider configuration, tenant ownership, rollback, tests, secondary review, and unresolved risks.

## Verification

- [x] Focused communications tests pass. Rechecked 2026-09-24: `25 passed, 1 warning`.
- [x] Vercel lists the four staged Production variable names without exposing values; `COMMUNICATIONS_PROVIDER=noop`, and the conditional fifth (`TWILIO_DEFAULT_FROM_NUMBER`) remains absent because T005 failed safely.
- [ ] Twilio displays the intended four callback destinations and POST methods.
- [x] A2P state is accurately recorded. Latest console evidence on 2026-09-24: Brand `Not started`; Campaign `Can't start`. SMS remains blocked.
- [x] `intake.cluexp.com` reaches the webhook routes and unsigned requests fail at signature validation with `403`, not host rejection. Evidence: Codex, 2026-09-23, read-only POSTs to voice/SMS incoming routes returned `403 {"detail":"Invalid Twilio signature"}`.
- [ ] Messaging Service forwards STOP/START to ClueXP; ClueXP DB remains the product opt-out/audit source of truth.
- [x] The Human-selected tenant is `Metro Key Partners`; its capability flags are verified disabled until their later gates.
- [ ] The shared number is assigned to Metro Key Partners after T008 authorization.
- [ ] No live call/SMS was sent before fresh T009A authorization for the exact target and channel.
