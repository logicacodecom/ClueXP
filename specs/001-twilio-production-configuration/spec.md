# Feature Specification: Twilio Production Configuration

**Feature Branch**: `ops/twilio-production-configuration`
**Spec Directory**: `specs/001-twilio-production-configuration`
**Created**: `2026-09-23`
**Owner**: `Codex with Human production authorization`
**Status**: `configuration staged; awaiting authenticated production identity, number-assignment authorization, deployment, and go-live gates`

## Summary

Enable the existing ClueXP Twilio communications implementation for the production intake API using the ClueXP-managed Twilio number `+17275136040`. Preserve the existing tenant, privacy, opt-out, and no-recording boundaries. Configuration must be reversible and must not send a live call or SMS without a separate, target-specific authorization.

## Scope

### In Scope

- Stage `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WEBHOOK_BASE_URL=https://intake.cluexp.com` in the linked `cluexp-intake` Vercel Production environment without exposing their values. Keep `COMMUNICATIONS_PROVIDER=noop` until tenant assignment and the cross-organization preflight are complete, then switch it to `twilio` only inside the separately authorized deployment window. Stage `TWILIO_DEFAULT_FROM_NUMBER=+17275136040` only after the cross-organization fallback preflight passes.
- Configure Twilio voice and messaging callbacks to the existing `https://intake.cluexp.com/api/twilio/...` routes after the production runtime has the matching signing secret.
- Verify that the number supports voice/SMS and record the actual A2P Brand and Campaign registration state. SMS remains disabled until both registrations are complete.
- Assign the number only to the Human-selected production organization after authenticated production identity is confirmed and fresh assignment authorization is recorded. Preserve the verified A2P state, then enable only the explicitly approved communications capabilities.
- Run safe, non-sending health/configuration checks; record any separately authorized live acceptance test as a later gate.

### Out Of Scope

- Application code, API-contract, schema, or migration changes.
- Call recording, transcription, marketing/bulk messaging, newsletters, or partner-owned Twilio accounts.
- Sending a real SMS or placing a real call in this authorization.
- Production deployment/promotion until separately authorized immediately before execution.

## Users And Scenarios

### Primary Scenario

1. Given the production Twilio number, Human-selected organization, and completed A2P registration
2. When ClueXP production configuration and signed webhook routes are enabled
3. Then authorized masked calls, inbound forwarding, transactional SMS, delivery callbacks, and STOP/START handling can use the existing implementation.

### Edge And Failure Scenarios

- Missing or mismatched Twilio auth token causes webhooks to fail closed with `403`.
- Configuring Twilio callbacks before the production runtime has the signing token would interrupt inbound traffic and must not occur.
- An unassigned number returns the existing safe “not assigned” TwiML and must not route to an arbitrary organization.
- SMS remains disabled unless both `sms_enabled` and `a2p_registered` are true for the selected organization.
- Rollback sets `COMMUNICATIONS_PROVIDER=noop` and removes/changes provider callbacks only under Human authorization.

## Requirements

### Functional Requirements

- **FR-001**: Production must set `COMMUNICATIONS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WEBHOOK_BASE_URL=https://intake.cluexp.com` server-side. `TWILIO_DEFAULT_FROM_NUMBER=+17275136040` may be added only after verifying that no other organization has SMS or masked calling enabled while lacking its own assigned Twilio number.
- **FR-002**: Twilio inbound voice must POST to `/api/twilio/voice/incoming`; voice status must POST to `/api/twilio/voice/status`.
- **FR-003**: Twilio inbound messaging must POST to `/api/twilio/sms/incoming`; outbound delivery status must use `/api/twilio/sms/status`.
- **FR-004**: `+17275136040` must be assigned to exactly one approved production organization before inbound routing is considered ready.
- **FR-005**: A2P readiness and SMS enablement must reflect the verified Twilio registration and Human-approved organization configuration.
- **FR-006**: No live communication may be initiated without separate authorization naming the channel and target.
- **FR-007**: Activating the inbound SMS webhook is a live-traffic action because the route returns TwiML that sends an automatic transactional reply; it requires explicit go-live authorization even if no outbound test is initiated by Codex.

### Non-Functional Requirements

- **NFR-001**: Credentials must never be printed, logged, committed, pasted into chat, screenshots, or repository files.
- **NFR-002**: Webhook signature validation must remain fail-closed.
- **NFR-003**: Raw customer and technician phone numbers must remain server-side and redacted in user-visible histories.
- **NFR-004**: The change must have an explicit rollback path and independent secondary review.

## Data, API, And Trust Boundaries

- **Data touched**: Vercel Production environment names/values; Twilio number and Messaging Service configuration; one existing `organization_phone_settings` row only after authenticated production identity is confirmed and the Human explicitly authorizes the exact assignment.
- **API contracts**: Existing private webhook routes only; no contract changes.
- **Trust-state/privacy rules**: No credentials or raw call parties exposed; signed callbacks only; transactional templates only.
- **Tenant isolation**: The Twilio number may map to exactly one organization. No organization is inferred from the number's friendly name.
- **Dispatch state**: No dispatch lifecycle transitions are changed.
- **Payments/closeout**: Not applicable.
- **External side effects**: Production secret/config mutation and, after a separate go-live gate, inbound voice routing and inbound-SMS automatic replies. No agent-initiated message/call send in this scope.

## ClueXP-Specific Checks

- **Trust-state rule**: Existing call/SMS records report provider truth; `noop` remains the rollback mode.
- **Provider-managed dispatch rule**: Communications configuration does not grant ClueXP dispatch authority.
- **Public `/v1`/MCP rule**: Not applicable; no public contract changes.
- **Migration/RLS rule**: No migration or RLS change. Any organization settings update uses the existing row and exact organization ID.
- **Generated artifacts**: Not applicable.

## Acceptance Criteria

- [x] The four non-fallback variable names exist in Vercel Production and their values were never exposed. `COMMUNICATIONS_PROVIDER` is safely set to `noop` pending the deployment gate; the default number remains absent because the fallback preflight found an enabled organization without an assigned number.
- [ ] Twilio console shows the four required ClueXP callback destinations with POST semantics, after matching production runtime configuration is live.
- [x] A2P Brand and Campaign registration state is verified. On 2026-09-24, Brand was `Not started` and Campaign was `Can't start`; SMS must remain disabled.
- [ ] The Human-selected organization owns the number and has only the approved voice/SMS capabilities enabled.
- [x] Local focused communications tests pass (`25 passed, 1 warning`).
- [x] Independent secondary review approves the configuration plan/evidence.
- [ ] A separate deployment authorization and, later, a separate live-test authorization are recorded before those actions.

## Risks, Assumptions, And Human Decisions

- **Risks**: Webhook/signing mismatch can reject traffic; wrong organization assignment can misroute calls; a default from-number can leak across organizations whose channel flag is enabled without a number; inbound SMS TwiML creates an automatic reply; premature SMS enablement can create carrier/compliance failures; a production deploy is needed before newly added Vercel variables affect runtime. The 2026-09-24 Metro Key preflight found both SMS and masked calling enabled with no assigned Twilio number and A2P false; both channel flags were immediately disabled and verified false.
- **Assumptions**: `https://intake.cluexp.com` is the canonical public intake API host; the existing implementation and migration `0050` remain deployed.
- **Human decisions recorded**: `Metro Key` is the selected organization for `+17275136040` (2026-09-24).
- **Human decisions still needed**: Confirm the authenticated production Supabase project identity and explicitly authorize assigning the shared number to Metro Key Partners; decide whether voice should be enabled before A2P completion; explicitly authorize production deployment; explicitly authorize webhook go-live; authorize the exact live-test recipient and channel. SMS cannot be enabled while A2P Brand is `Not started` and Campaign is `Can't start`.
