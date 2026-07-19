# Privacy and Security Review

Status: checklist for pilot readiness. Do not paste real customer data, tokens, signed URLs, org IDs, or technician IDs into this document.

## Data boundaries

| Data | Current handling | Rule |
|---|---|---|
| Customer tracking link | Capability token at `/t/{token}` | Treat as sensitive. Share only with the customer and authorized fulfillment staff. |
| Intake photos | Stored as private job media and exposed through signed URLs | Signed URLs must be short-lived and role-scoped through API reads. Do not put raw storage paths in customer/provider UI. |
| Customer address | Released to provider dispatch and assigned technician after accepted workflow state | Do not show exact address in anonymous/public capacity views. |
| Technician location | Used for dispatch freshness, ETA, and distance display | Show freshness/age honestly. Do not fabricate live tracking when the last server fix is stale. |
| Collection/closeout records | Recorded by ClueXP; payment remains outside ClueXP | UI must say records are not payment processing or payout determination. |
| Ownership proof | Deferred | If implemented later, store as private verification media; default to optional and minimize technician exposure. |

## Access-control checks

- Provider dispatch endpoints must remain scoped to `active_organization_id`.
- Technician active-job endpoints must allow the signed-in technician to read only their own active job unless the caller has a platform/dispatcher role.
- Customer tracking actions must resolve through `tracking_token`, never raw job IDs.
- `approval_url` may cross from technician-web to intake-web only as an absolute customer-origin URL.
- Private media URLs should be minted at read time through the API, not persisted as durable public URLs.

## Pre-merge / pre-deploy review

- Confirm no customer PII is written to docs, examples, screenshots, or logs.
- Confirm API tests cover tenant isolation and tracking-token reads.
- Confirm Vercel environment variables do not expose secrets to browser bundles.
- Confirm `ARRIVAL_PIN_SECRET` is set in production.
- Confirm `CUSTOMER_INTAKE_BASE_URL` or `NEXT_PUBLIC_INTAKE_BASE_URL` points to the production intake origin.
- Confirm dispatch/tech UI labels distinguish estimate, ETA, collection record, approval, and real payment.

## Future ownership-proof design guardrails

- Provider setting first: off by default unless pilot operations approves it.
- Customer choice: upload proof now or present at arrival.
- Redaction: do not OCR or store license/registration text unless there is a separate legal/privacy decision.
- Visibility: provider dispatch can see proof status; technicians should see only what they need on-site.
- Retention: define expiry/deletion before enabling for real customers.
