# Checklist: Twilio Production Configuration

**Artifact Reviewed**: `production configuration plan and execution evidence`
**Reviewer**: `Claude Code`
**Date**: `2026-09-23`

Secondary-agent review required: yes
Secondary-agent review completed: yes
Reviewer agent: Claude Code
Review result: approve

Initial review findings were: gate organization/channel activation before live testing; prevent cross-organization fallback through `TWILIO_DEFAULT_FROM_NUMBER`; pin the webhook base URL; verify production host controls; define opt-out ownership; and treat inbound SMS TwiML auto-replies as a live-traffic action. The spec, plan, and tasks were revised to address each item. Claude Code re-reviewed the complete revision on 2026-09-23 and approved it, with only evidence/wording corrections incorporated here.

## 2026-09-24 Gate Re-review

Secondary-agent review required: yes
Secondary-agent review completed: yes
Reviewer agent: Other
Review result: approve

Independent reviewer `/root/twilio_gate_review` initially requested that the resume checkpoint name all four pending authorization gates and that webhook activation remain separate from live-test authorization. The Orca comment and tasks were corrected, including the final T009A verification cross-reference. The reviewer then approved the current artifacts and independently observed `25 passed, 1 warning`, with no credential-shaped strings in the spec directory.

## Requirements Quality

- [x] Required environment variables and webhook routes are explicit.
- [x] Production deployment and live traffic tests are separate Human gates.
- [x] Inbound webhook activation is explicitly a Human go-live gate because inbound SMS returns an automatic reply.
- [x] Target organization is confirmed as `Metro Key` on 2026-09-24.
- [ ] Initial channel enablement is confirmed. SMS is ineligible while A2P is incomplete.

## ClueXP Safety

- [x] No credential value may appear in repository files, logs, chat, or screenshots.
- [x] Webhook signature validation remains fail-closed.
- [x] Number assignment is limited to one Human-selected organization.
- [x] The default from-number is blocked until a cross-organization settings preflight passes.
- [x] SMS remains gated by `sms_enabled` and `a2p_registered`.
- [x] ClueXP DB opt-out/audit ownership and Twilio's additional carrier suppression boundary are explicit.
- [x] Call recording remains disabled.
- [x] No live SMS/voice send is authorized by this checklist.

## Verification

- [x] Secondary reviewer approves the remediated sequencing and rollback: Claude Code, 2026-09-23.
- [x] Secondary reviewer approves the explicit assignment/deployment/webhook/live-traffic gates and the separated webhook/test tasks: `/root/twilio_gate_review`, 2026-09-24.
- [x] Focused communications tests pass: Codex and Claude Code independently ran `python -m pytest apps/intake-web/api/tests/test_job_messages.py apps/intake-web/api/tests/test_alerts.py -q`; each observed `25 passed, 1 warning` on 2026-09-23. Codex rechecked the same result on 2026-09-24.
- [x] Production `intake.cluexp.com` accepts the webhook host and rejects unsigned voice/SMS requests at signature validation with `403`. Evidence: Codex ran read-only unsigned POSTs to `/api/twilio/voice/incoming` and `/api/twilio/sms/incoming` on 2026-09-23; both returned `{"detail":"Invalid Twilio signature"}` rather than host rejection.
- [x] Four non-fallback Production Secrets were staged by name in Vercel without deployment or value disclosure: `COMMUNICATIONS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WEBHOOK_BASE_URL`. After the tenant preflight failed, `COMMUNICATIONS_PROVIDER` was safely returned to `noop` on 2026-09-24; credentials and callback base remain staged.
- [x] Production tenant identity was resolved as `Metro Key Partners` / `metro-key`. A read-only communications preflight found SMS and masked calling enabled with no assigned Twilio number and A2P false; Codex disabled both channel flags and verified the resulting non-sending state on 2026-09-24. The default-number fallback remains absent.
- [ ] Authenticated production Supabase project identity and fresh shared-number assignment authorization are confirmed. The Orca browser reached Supabase sign-in on 2026-09-24, so no direct DML was attempted.
- [ ] Twilio A2P Brand and Campaign registration are accepted/complete. Latest console evidence on 2026-09-24 shows Brand `Not started` and Campaign `Can't start`; do not enable SMS.
- [x] Vercel Production variable names are verified without values.
- [ ] Twilio callback URLs/methods are verified after matching runtime configuration is deployed.
- [ ] Codex completes final review.
