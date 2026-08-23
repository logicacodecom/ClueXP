# Privacy and Security Review

Status: checklist for pilot readiness. Do not paste real customer data, tokens, signed URLs, org IDs, or technician IDs into this document.

## Data boundaries

| Data | Current handling | Rule |
|---|---|---|
| Customer tracking link | Capability token at `/t/{token}` | Treat as sensitive. Share only with the customer and authorized fulfillment staff. |
| Intake photos | Stored as private job media and exposed through signed URLs | Signed URLs must be short-lived and role-scoped through API reads. Do not put raw storage paths in customer/provider UI. |
| Customer address | Released to provider dispatch and assigned technician after accepted workflow state | Do not show exact address in anonymous/public capacity views. |
| Technician location | Used for dispatch freshness, ETA, and distance display | Show freshness/age honestly. Do not fabricate live tracking when the last server fix is stale. |
| Phone numbers and Twilio identifiers | E.164 phone numbers are stored server-side for routing; provider UI receives masked/redacted call-party values and provider-safe SIDs/status. | Never put raw customer/technician numbers in URLs, client logs, analytics, docs, or unauthorized API responses. |
| Collection/closeout records | Recorded by ClueXP; payment remains outside ClueXP | UI must say records are not payment processing or payout determination. |
| Ownership proof | Deferred | If implemented later, store as private verification media; default to optional and minimize technician exposure. |

## Access-control checks

- Provider dispatch endpoints must remain scoped to `active_organization_id`.
- Technician active-job endpoints must allow the signed-in technician to read only their own active job unless the caller has a platform/dispatcher role.
- Customer tracking actions must resolve through `tracking_token`, never raw job IDs.
- `approval_url` may cross from technician-web to intake-web only as an absolute customer-origin URL.
- Private media URLs should be minted at read time through the API, not persisted as durable public URLs.
- Raw customer job UUID routes require the HttpOnly, same-site per-job intake capability cookie;
  customer lifecycle/tracking continues to use `/t/{token}`. Missing/wrong capabilities return the
  same 404 as an unknown job.
- Private media signing fails closed: a storage path is never substituted for a failed signed URL.

## Sprint 0 implementation review (2026-08-22)

- **Logs/errors:** unexpected exceptions now return an opaque error plus a correlation ID; exception
  text and upstream storage responses are not returned to clients. Server event logs still use
  internal job/org identifiers where needed for operations; no request bodies, tracking tokens,
  signed URLs, phone numbers, or exact technician coordinates were added to logs.
- **Signed media:** customer intake photos and provider/technician compliance documents are issued
  through short-lived signed URLs. Signing failures return a generic unavailable response and do
  not expose durable bucket paths.
- **PII and location:** provider reads remain organization-scoped; technician job reads remain
  self-scoped; customer reads remain token/capability-scoped. Live technician location remains
  status- and freshness-gated. Platform-admin oversight remains a broad privileged role and should
  receive operational MFA/access-review controls before broader launch.
- **Service role:** the Supabase service-role credential remains server-only and is used for Storage.
  Database owner/Postgres and Supabase service-role RLS bypass are intentional; external clients
  have no direct PostgREST use case.
- **RLS:** migration `0055_default_deny_rls` covers every Alembic-managed application table with no
  allow policies. Deployment and live PostgREST denial verification remain release gates.

## Pre-merge / pre-deploy review

- Confirm no customer PII is written to docs, examples, screenshots, or logs.
- Confirm API tests cover tenant isolation and tracking-token reads.
- Confirm Vercel environment variables do not expose secrets to browser bundles.
- Confirm `ARRIVAL_PIN_SECRET` is set in production.
- Confirm `AUTH_SECRET`, `ARRIVAL_PIN_SECRET`, and `CRON_SECRET` are independent high-entropy values
  of at least 32 characters; production startup rejects missing, short, and known placeholders.
- Confirm `CUSTOMER_INTAKE_BASE_URL` or `NEXT_PUBLIC_INTAKE_BASE_URL` points to the production intake origin.
- If Twilio is enabled, confirm every Twilio webhook validates signatures using the public Vercel URL and submitted parameters before DB work.
- Confirm call recording/transcription is disabled until consent and jurisdiction policy are approved.
- Confirm transactional SMS sends are gated by provider SMS enablement and A2P 10DLC readiness; STOP/START opt-out is tested.
- Confirm dispatch/tech UI labels distinguish estimate, ETA, collection record, approval, and real payment.

## Public `/v1` API threat model (2026-08-22)

Scope: the external-client-facing surface only (`GET /v1/services`, `POST
/v1/coverage-checks`, and the shared `require_public_api_client` boundary). Internal
routes (`/tickets`, `/provider/*`, `/ops/*`, technician, admin) are out of scope here —
they are covered by the access-control checks above and are never reachable through
this boundary.

**Assets:** external API keys (bearer secrets), the verified-technician network
(location/skill/availability, even in aggregate), per-client rate-limit budgets, the
idempotency ledger, and the audit trail itself (`external_api_events`).

**Trust boundary:** anything in the request (headers, body) is untrusted until
`require_public_api_client` resolves it to a `client_id`/`api_key_id`/`scopes` tuple
from the database. No caller-supplied identifier is ever treated as authoritative —
same anti-spoofing principle ADR-4 already applies to intake-channel resolution.

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| API key theft/leak | Key logged, committed, or intercepted | Keys are opaque (`cxp_live_` + 32 bytes), stored only as SHA-256 hashes (`key_hash`), never re-displayed after issuance; `Bearer`/`X-API-Key` only, never a query param (so it doesn't land in access logs/referrers) | No key rotation/expiry enforcement UI yet; `expires_at` column exists but nothing sets it by policy. Revocation is a manual DB update — no self-service revoke endpoint. |
| Brute-force / credential stuffing against the key space | Repeated guesses via `Authorization` header | 32 bytes of entropy (`secrets.token_urlsafe(32)`) makes guessing infeasible; every failed attempt is audited (`auth_invalid`) with no user enumeration (constant-shape 401 regardless of reason) | No IP-level lockout/backoff on repeated `auth_invalid` — only the per-minute rate limit, which only applies *after* a valid key is presented. A pre-auth flood is bounded by Vercel/infra limits, not application code. |
| Scope escalation | A key issued for `services:read` used to call a `coverage:check`-scoped route | Scope checked server-side per route (`required_scope not in set(auth["scopes"])`) before any handler logic runs; denial is audited (`scope_denied`) | None identified — scopes are additive and server-resolved only, never client-supplied. |
| Coverage-check as a competitor/coverage-mapping oracle | A client with a valid key repeatedly polls `/v1/coverage-checks` across a grid of coordinates to reverse-engineer ClueXP's network footprint/density | Response is a single boolean, never technician count, identity, or distance — grid-polling only ever learns a binary in/out-of-range map, not density or capacity; per-client rate limiting bounds how fast a grid can be swept | Rate limiting is per-client-per-minute, not per-IP or anomaly-scored — a client provisioned with a generous `rate_limit_per_minute` could still sweep a coarse grid over hours/days. Accepted for this slice because the leaked signal (binary coverage) is the same information a real customer's own address-eligibility check already reveals one point at a time; revisit if `rate_limit_per_minute` defaults are raised without review. |
| Idempotency-key collision across clients | Two different external clients happen to send the same `Idempotency-Key` string | Primary key is `(client_id, idempotency_key)`, not `idempotency_key` alone — cross-client collision is structurally impossible (verified by `test_postgres_store_external_api_idempotency_reserve_replay_and_conflict`'s cross-client isolation case) | None identified. |
| Idempotency-key replay used to bypass a future rate limit or resubmit a stale request | Client resends the same key long after the original request | Replay returns the *original* stored response verbatim; it does not re-execute or re-consume a rate-limit slot, so it cannot be used to force fresh work, only to fetch what already happened | No TTL/expiry on `external_api_idempotency_keys` rows yet — a key from months ago still replays. Low severity while `/v1` has only a no-side-effect endpoint; **must be revisited before a consequential endpoint (`/v1/service-requests`) ships**, since an unbounded idempotency ledger for a real mutating action has different staleness/storage implications. |
| Unhandled exception leaking internals | An unexpected server error inside a `/v1` handler | The `/v1`-scoped exception handler returns `{error: "internal_error", request_id}` only; the exception type/message/traceback stays server-side in the log line keyed by the same id | None identified. |
| Cross-tenant data leakage through a future mutating endpoint | Not applicable to the current two routes (neither reads nor writes tenant-owned data) | N/A today | **Must be designed, not assumed, before `/v1/service-requests` or any endpoint that touches `origin_org_id`/`customer_owner_org_id`.** Tracked as the ADR-6 `dispatch_scope`/`origin_client_id` contract in `SYSTEM-DESIGN.md` §20.6 — this is a vocabulary freeze only, not an implementation, specifically so this threat gets a designed answer before code exists. |

**Explicitly out of scope for this threat model** (no code exists yet, so nothing to
threat-model): request creation, dispatch/routing, payment, and any AI-adapter-specific
behavior. Re-run this exercise when any of those ship.

## Future ownership-proof design guardrails

- Provider setting first: off by default unless pilot operations approves it.
- Customer choice: upload proof now or present at arrival.
- Redaction: do not OCR or store license/registration text unless there is a separate legal/privacy decision.
- Visibility: provider dispatch can see proof status; technicians should see only what they need on-site.
- Retention: define expiry/deletion before enabling for real customers.
