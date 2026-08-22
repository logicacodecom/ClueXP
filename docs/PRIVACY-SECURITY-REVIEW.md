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

## Future ownership-proof design guardrails

- Provider setting first: off by default unless pilot operations approves it.
- Customer choice: upload proof now or present at arrival.
- Redaction: do not OCR or store license/registration text unless there is a separate legal/privacy decision.
- Visibility: provider dispatch can see proof status; technicians should see only what they need on-site.
- Retention: define expiry/deletion before enabling for real customers.
