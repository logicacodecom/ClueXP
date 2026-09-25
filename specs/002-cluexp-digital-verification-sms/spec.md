# Feature Specification: ClueXP Digital Verification SMS

**Feature Branch**: `feat/cluexp-digital-verification-sms`
**Spec Directory**: `specs/002-cluexp-digital-verification-sms`
**Created**: `2026-09-24`
**Owner**: `Codex with Human product authority`
**Status**: `implementation complete; production disabled`

## Summary

ClueXP is a digital intake and tracking platform. Customers enter through provider-branded websites, ClueXP web surfaces, ChatGPT, or approved digital integrations. ClueXP sends a narrowly scoped transactional SMS from its own platform number so the customer can verify possession of the phone and open a secure link to resume the intake. After the verified request is committed, the customer uses the existing tracking experience to follow provider and technician assignment.

Providers continue operating their own public phone lines and call centers outside ClueXP. ClueXP does not provision, answer, forward, or automate provider calls in this phase.

## Scope

### In Scope

- A ClueXP-owned platform SMS sender, independent of provider `twilio_number`, `sms_enabled`, and `a2p_registered` settings.
- A persistent, single-use, expiring phone-verification link stored only as a hash.
- A verification SMS containing the secure intake-resume link and no marketing content.
- Cross-device intake resume after link consumption without exposing a raw job UUID.
- A feature gate that leaves current production behavior unchanged until ClueXP A2P Brand and Campaign are complete and rollout is separately authorized.
- When verification is required, keep a new intake out of the provider dispatch queue until the phone is verified and the customer commits the request.
- Delivery audit and existing signed Twilio status-callback handling.

### Out Of Scope

- Marketing, promotions, newsletters, or bulk messaging.
- General conversational SMS or customer-technician SMS chat.
- Provider-specific SMS sender numbers or bring-your-own Twilio accounts.
- Provider call-center numbers, human/AI call answering, forwarding, voicemail, or call recording.
- Masked customer-technician calls; future calling remains an in-app product slice.
- Production deployment, environment activation, A2P submission, number assignment, webhook activation, or live messages in this implementation authorization.

## User Flow

1. A customer opens an approved digital intake channel and begins a provisional request.
2. The customer provides a mobile number and consents to receive the verification SMS.
3. ClueXP sends one transactional message from the official ClueXP number with an expiring link.
4. The customer opens the link. ClueXP consumes it once, verifies the current phone for that intake, restores the secure intake capability, and returns the customer to the provider-branded intake.
5. The customer completes or updates the request and accepts the applicable terms.
6. Only after verification and commit does the request enter the owning provider's dispatch queue.
7. The existing customer tracking page reports only backend-confirmed provider, technician, ETA, and lifecycle state.

## Requirements

- **FR-001**: Platform verification SMS must use `CLUEXP_SMS_PROVIDER` and `CLUEXP_VERIFICATION_FROM_NUMBER`; it must not depend on or mutate provider phone settings.
- **FR-002**: Sending requires all three server-side gates: `CLUEXP_VERIFICATION_SMS_ENABLED=true`, `CLUEXP_A2P_REGISTERED=true`, and an available platform SMS provider/number.
- **FR-002a**: Twilio delivery-status callbacks require the separate `CLUEXP_SMS_STATUS_WEBHOOK_ENABLED=true` gate, which defaults to false. Enabling verification SMS must not implicitly activate a webhook.
- **FR-003**: The raw verification token must never be stored, logged, returned by the API, or committed. Only a cryptographic hash is persisted.
- **FR-004**: A verification link expires, is single-use, and is superseded when a new link is issued.
- **FR-005**: Verification is bound to the intake and the exact normalized phone number. Changing the phone invalidates the verified state until the new number is verified.
- **FR-006**: Sends are atomically rate-limited both per intake and across intakes for the same phone number, respect the ClueXP opt-out list, and return generic errors that do not expose provider configuration.
- **FR-006a**: The send request requires affirmative consent to the versioned transactional verification disclosure, and the verification record stores the consent version and timestamp.
- **FR-007**: When `CLUEXP_PHONE_VERIFICATION_REQUIRED=true`, commit must fail closed until the current phone is verified.
- **FR-008**: When verification is required, creating a provisional intake must not enqueue it for dispatch or notify provider operations; successful verified commit performs that activation.
- **FR-009**: The verification link restores the HttpOnly intake capability and redirects to the originating provider-branded intake without a raw job identifier in the URL.
- **FR-010**: `COMMUNICATIONS_PROVIDER` remains `noop`; existing voice/provider communications routes are not activated by `CLUEXP_SMS_PROVIDER`.
- **FR-011**: SMS content is limited to ClueXP verification and secure intake continuation. No marketing or general conversation is introduced.

## Safety And Privacy

- Customer phone numbers and verification tokens remain server-side and are never placed in user-visible history or logs.
- The verification table is default-deny under RLS; backend owner-role access is the only direct database path.
- Intake capability cookies remain HttpOnly, Secure in production, SameSite Strict, and time-limited.
- Verification does not imply provider assignment, technician assignment, ETA, price, or dispatch acceptance.
- Provider-direct telephone traffic remains outside ClueXP.

## Acceptance Criteria

- [x] A valid fake-provider test sends one ClueXP-branded verification SMS containing an opaque link.
- [x] The API response never contains the raw token or verification URL; the SMS token stays in a URL fragment and is consumed through a same-origin POST body so it is absent from request-path logs.
- [x] The link can be consumed once, marks only the current normalized phone verified, restores the intake cookie, and redirects to the correct branded intake.
- [x] Expired, reused, malformed, and superseded links fail safely.
- [x] Changed phone numbers require a new verification.
- [x] Rate limits and opt-outs block sends; a failed resend preserves the last successfully delivered link.
- [x] Required verification prevents pre-verification dispatch and commit; verified commit activates the provider-owned queue exactly once.
- [x] With all new flags at their defaults, current production behavior is unchanged and no SMS can be sent.
- [x] Focused API tests, migration/RLS checks, full non-Postgres API suite, and intake-web build pass.
- [x] Independent secondary review approves the implementation.

## Human Gates

- Complete and verify the ClueXP A2P Brand and Campaign.
- Separately authorize production migration and deployment.
- Separately authorize `CLUEXP_SMS_PROVIDER=twilio`, `CLUEXP_VERIFICATION_SMS_ENABLED=true`, `CLUEXP_A2P_REGISTERED=true`, and the platform sender number.
- Keep `CLUEXP_SMS_STATUS_WEBHOOK_ENABLED=false` until delivery-status callbacks receive fresh explicit authorization.
- Separately authorize any live acceptance-test target. No current authorization covers a live message.
