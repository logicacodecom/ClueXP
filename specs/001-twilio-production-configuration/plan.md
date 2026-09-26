# Implementation Plan: Twilio Production Configuration

> **Superseded 2026-09-24:** Do not execute this rollout. The Human selected a digital-only communications scope: ClueXP-owned verification/intake-link SMS, no provider call-center operation, no shared-number tenant assignment, and no voice activation. See [`../002-cluexp-digital-verification-sms/plan.md`](../002-cluexp-digital-verification-sms/plan.md). Preserve `COMMUNICATIONS_PROVIDER=noop`.

**Spec**: [`spec.md`](spec.md)
**Branch**: `ops/twilio-production-configuration`
**Owner**: `Codex`
**Review Mode**: `Claude review`

## Technical Approach

Use the existing Twilio adapter and webhook routes without code changes. First stage the account SID, auth token, and callback base in the linked `cluexp-intake` Vercel Production project using secret-safe input, while keeping `COMMUNICATIONS_PROVIDER=noop`. Add the default from-number only after a production settings preflight proves no other enabled organization could inherit it. Obtain independent review before mutation. Switch the provider to `twilio` only inside the separately authorized deployment window. Do not point Twilio at the production callbacks until that redeploy makes the signing token available to the runtime and the Human authorizes inbound go-live. After the Human identifies the target organization, confirm the authenticated production project and obtain fresh assignment authorization before assigning its number; preserve the actual A2P state while leaving SMS and masked calling disabled. Enable channel flags only inside the authorized acceptance window. `Metro Key` was selected on 2026-09-24. Current Twilio evidence shows Brand `Not started` and Campaign `Can't start`, so A2P readiness must remain false and SMS cannot be enabled. Finish with read-only evidence and separately authorized live acceptance testing.

## Affected Surfaces

- **Frontend**: No code changes. Provider Settings is used only to verify/edit provider-owned forwarding and enablement fields.
- **Backend/API**: Existing `/api/twilio/voice/incoming`, `/api/twilio/voice/status`, `/api/twilio/sms/incoming`, and `/api/twilio/sms/status` routes.
- **Database/storage**: Existing `organization_phone_settings` row only; no DDL or migration.
- **Docs/operations**: This Spec Kit directory records authorization, evidence, review, rollout, and rollback.
- **CI/release**: Focused communications tests before rollout. Production redeploy remains a separate Human gate.

## Contracts And Invariants

- Twilio signatures are calculated against the public `https://intake.cluexp.com/api/...` URL and validated with `TWILIO_AUTH_TOKEN` before database work.
- The number maps to exactly one organization; provider admins cannot self-assign `twilio_number` or `a2p_registered`.
- SMS sends require both `sms_enabled` and `a2p_registered`; STOP/START handling remains active.
- ClueXP's database remains the product opt-out/audit source of truth; Twilio/carrier suppression is an additional provider boundary. The Messaging Service must continue forwarding inbound STOP/START to ClueXP.
- The inbound SMS webhook returns TwiML containing `<Message>`, so webhook activation itself enables automatic replies and is a Human go-live gate.
- Call recording remains disabled.
- No public `/v1`, MCP, generated contract, dispatch state, or payment behavior changes.

## Verification Plan

- **Unit/integration**: `python -m pytest apps/intake-web/api/tests/test_job_messages.py apps/intake-web/api/tests/test_alerts.py -q`
- **Type/build**: No code change; not required beyond existing green production release evidence.
- **Migration/data**: Verify deployed migration head is at or beyond `0050`; inspect only the selected organization's settings before/after any DML.
- **Tenant/RLS**: Verify number uniqueness and exact organization ID; verify no other organization has `sms_enabled=true` or `masked_calling_enabled=true` with `twilio_number IS NULL` before adding the default from-number; no cross-tenant mutation.
- **Public contract drift**: Not applicable.
- **Manual/browser/mobile**: Verify Twilio number capabilities, A2P completion, callback URLs/methods, Messaging Service association, and that STOP/START is forwarded to ClueXP. Verify Vercel variable names/targets without values. Verify `intake.cluexp.com` is admitted by production host controls; an unsigned webhook response of `403 Invalid Twilio signature` (rather than host rejection) is acceptable evidence.
- **Security/privacy**: Never reveal/copy credentials into logs or artifacts; use masked console controls and stdin-based secret entry.

## Rollout And Rollback

- **Flags/config**: staged `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_BASE_URL=https://intake.cluexp.com`; `COMMUNICATIONS_PROVIDER=noop` until the authorized deployment window, then `twilio`; conditional `TWILIO_DEFAULT_FROM_NUMBER=+17275136040` after preflight; existing per-org `twilio_number`, `a2p_registered`, `sms_enabled`, and `masked_calling_enabled`.
- **Production approval needed**: `yes` — non-deployment configuration was authorized 2026-09-23. Metro Key tenant hardening was completed 2026-09-24. Shared-number assignment, deployment, webhook activation, and live traffic tests remain separately gated.
- **Rollback path**: Set `COMMUNICATIONS_PROVIDER=noop` in Production and redeploy under explicit authorization; restore/remove Twilio callbacks if inbound traffic must be stopped; disable per-org SMS/masked calling without deleting audit history.

## Open Questions

- Should masked voice be enabled before A2P registration is complete? Transactional SMS remains blocked.
- Is the authenticated Supabase session confirmed as the intended ClueXP production project, and is shared-number assignment to Metro Key Partners explicitly authorized immediately before DML?
- Is production redeployment authorized immediately before execution?
- Is inbound voice webhook go-live authorized after the deployment is verified?
- Who is the approved live-test recipient for each authorized channel after deployment?
