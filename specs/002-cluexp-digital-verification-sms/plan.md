# Implementation Plan: ClueXP Digital Verification SMS

**Spec**: [`spec.md`](spec.md)
**Branch**: `feat/cluexp-digital-verification-sms`
**Owner**: `Codex`
**Review Mode**: `independent secondary review`

## Technical Approach

Add a server-only `intake_phone_verifications` table and phone-verification columns on `jobs`. Generate a high-entropy token, persist only its SHA-256 hash, and send a ClueXP-branded link through a new `CLUEXP_SMS_PROVIDER` selector that is independent of the existing provider communications selector. A successful link consumption transaction marks the exact phone verified and returns the existing intake capability cookie. The browser resumes through a cookie-backed `/tickets/resume` endpoint.

The feature is disabled by default. When `CLUEXP_PHONE_VERIFICATION_REQUIRED` is enabled, provisional intake creation remains in `draft`; verified commit performs the existing provider-queue activation. Existing deployments retain their current behavior while all flags remain false/noop.

## Affected Surfaces

- `apps/intake-web/api/config.py`: safe-default feature gates and limits.
- `apps/intake-web/api/communications.py`: platform SMS provider selection independent of voice/provider communications.
- `apps/intake-web/api/store.py`: persistent verification creation, rate counting, consumption, status, and intake activation context.
- `apps/intake-web/api/main.py`: send/status/consume/resume endpoints and verification dispatch gate.
- `apps/intake-web/src/app/page.tsx`: verification step, resend/status actions, and cross-device resume.
- `apps/intake-web/src/app/verify/page.tsx`: first-party fragment-token verification bridge.
- `packages/db/alembic/versions/0060_intake_phone_verification.py`: data model and default-deny RLS.
- Canonical product and architecture docs.

## Verification

- API tests cover safe defaults, successful send, no raw-token response, consume-once, expiry, supersession, phone change, opt-out, resend limit, and commit/dispatch gating.
- Alembic offline validation and RLS registry tests cover the new table/columns.
- Existing communications tests confirm provider SMS/call behavior did not change.
- Intake-web typecheck/build confirms the resume and verification UI.

## Rollout And Rollback

- Rollout order after future Human authorization: production migration; deploy with all flags disabled; verify health; complete A2P; configure the ClueXP platform sender; enable SMS sending; then enable verification-required per approved rollout.
- Rollback: set `CLUEXP_PHONE_VERIFICATION_REQUIRED=false`, `CLUEXP_VERIFICATION_SMS_ENABLED=false`, `CLUEXP_SMS_STATUS_WEBHOOK_ENABLED=false`, and `CLUEXP_SMS_PROVIDER=noop`. Keep `COMMUNICATIONS_PROVIDER=noop`. Existing verification rows are retained as audit data and contain no raw tokens.

## Risks

- Enabling required verification before the sender is ready would block intake completion; readiness gates and rollout order prevent this.
- Dispatch could occur before verification if activation logic drifts; focused tests cover both creation and commit.
- A leaked link grants intake capability until consumed/expired; tokens are one-time, short-lived, hashed at rest, and never logged.
- Multiple resend attempts could spam a customer; atomic per-intake and cross-intake per-phone limits plus opt-out checks apply.
