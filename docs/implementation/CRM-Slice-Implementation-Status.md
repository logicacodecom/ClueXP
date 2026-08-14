# Provider CRM Slice — Implementation Status

**Project:** ClueXP

**Application:** Provider Console

**Status:** Core slice implemented; deployment and automation work remains
**Updated:** August 14, 2026

## 1. Purpose

This slice adds customer relationship management to the provider console. It gives a provider one place to review customer contact information, related services and jobs, warranty coverage, callbacks, follow-ups, newsletter consent, and relationship notes.

The CRM reuses the existing customer-to-job relationship. It does not create a separate duplicate customer directory. CRM-specific information is scoped to the provider organization so one company cannot see or modify another company's notes, schedules, consent settings, or warranty terms.

## 2. Summary

The core CRM workspace is implemented and connected to application data.

Implemented:

- Customer records derived from provider-related jobs.
- Customer contact and service history view.
- Warranty calculation and remaining-time display.
- Callback and follow-up scheduling.
- Relationship notes and last-contacted tracking.
- Newsletter consent and audience filtering.
- Direct call, email, and consent-filtered audience email actions.
- App-initiated masked customer calls with job-linked call history.
- Integrated transactional SMS with approved CRM templates, delivery state, idempotency, and STOP enforcement.
- Organization-scoped API and persistence.
- Responsive desktop and mobile interfaces.

Not yet implemented:

- Managed bulk-newsletter delivery.
- Automated callback and follow-up reminders.
- Append-only CRM activity history.
- Service- or job-specific warranty rules.
- Server-side pagination, sorting, and search.
- Full deployed-environment browser testing.

## 3. Feature status

| Capability | Status | Notes |
| --- | --- | --- |
| Customer CRM workspace | Complete | Available at `/crm` in the provider console. |
| CRM navigation | Complete | `Customers` appears under the CRM navigation group. |
| Customer/job association | Complete | Customers are derived from jobs owned or fulfilled by the provider organization. |
| Contact information | Partial | Phone and name come from intake/job data; email is editable in CRM. Name and phone are not yet directly editable. |
| In-app customer calling | Complete | Starts a masked provider-to-customer call without exposing either party's private number. |
| Call audit history | Complete | Outbound CRM calls create job-linked call sessions visible in the Calls workspace. |
| Related services and jobs | Complete | The customer drawer displays all related jobs and links to job details. |
| Warranty visibility | Complete | The latest completed service anchors the warranty calculation. |
| Warranty configuration | Partial | A warranty term is stored per organization/customer relationship, not per service or job. |
| Callback scheduling | Complete | A callback date and time can be stored and surfaced as a due action. |
| Follow-up scheduling | Complete | A follow-up date and time can be stored and surfaced as a due action. |
| Last-contacted tracking | Complete | Operators can mark a customer as contacted. |
| Relationship notes | Complete | Organization-private notes are persisted. |
| Newsletter consent | Complete | Supports `unknown`, `subscribed`, and `unsubscribed`. |
| Newsletter audience | Complete | Audience includes only subscribed customers with a valid email address. |
| Newsletter delivery | Partial | Opens a BCC email draft in the operator's mail client. The application does not send campaigns itself. |
| Transactional SMS | Complete | Sends approved service, callback, warranty, and tracking templates through the configured Twilio communications path. |
| SMS opt-out enforcement | Complete | STOP opt-outs block sends; START restores transactional messaging. |
| SMS delivery audit | Complete | Sends are job-linked and persist provider status, delivery timestamps, failures, and error codes. |
| Automated reminders | Not yet | No background scheduler or notification worker exists for callbacks or follow-ups. |
| CRM activity timeline | Not yet | Calls, emails, note changes, and outcomes are not stored as append-only activities. |
| Responsive interface | Complete | Desktop table and mobile customer cards are implemented. |
| Tenant isolation | Complete | CRM reads and updates are scoped to the signed-in provider organization. |
| Production migration | Pending deployment | Migration exists but must be applied in each deployed environment. |

## 4. Implemented user experience

### 4.1 CRM overview

The CRM page provides the following metrics:

- Total customers.
- Actions due today.
- Customers currently under warranty.
- Customers eligible for newsletter communication.

### 4.2 Customer segments

Operators can filter the relationship desk by:

- All customers.
- Due callbacks or follow-ups.
- Active warranties.
- Newsletter audience.

### 4.3 Search

The customer list can be searched by:

- Customer name.
- Phone number.
- Email address.
- Service type.
- Service address.
- Operational job identifier.

### 4.4 Customer relationship drawer

Opening a customer displays:

- Customer name and contact actions.
- In-app masked calling with ringing, unavailable, and error feedback.
- Email address.
- Warranty term and expiration status.
- Callback date and time.
- Follow-up date and time.
- Newsletter consent.
- Relationship notes.
- Last-contacted state.
- Transactional SMS composer with approved templates.
- Latest job-linked SMS delivery state and actionable send feedback.
- Complete related service and job history.

### 4.5 In-app masked calling

Selecting `Call in app` starts the existing masked-call workflow against the customer's latest applicable service job.

The workflow:

1. Verifies that the job belongs to the signed-in provider organization.
2. Verifies that masked calling is enabled and provider/customer phone numbers are available.
3. Calls the provider's configured company or forwarding number.
4. Connects the answered provider call to the customer through the provider's Twilio number.
5. Keeps the private provider and customer phone numbers out of the API response.
6. Creates a job-linked call session for status callbacks and call history.
7. Updates the customer's CRM last-contacted timestamp after the call is successfully initiated.

Provider-to-customer CRM calls are allowed for active jobs and completed, disputed, cancelled, or no-show service records. Technician and customer call permissions retain their narrower active-job rules.

### 4.6 Integrated SMS

The CRM customer drawer supports these approved transactional templates:

- Service follow-up.
- Callback confirmation.
- Warranty reminder.
- Secure tracking-link reminder.

SMS behavior includes:

- Sends through the existing server-side Twilio integration.
- Uses the provider's configured SMS number.
- Requires transactional SMS to be enabled and A2P registration to be complete.
- Links every delivery to the selected customer service job.
- Uses a client message identifier for retry-safe idempotency.
- Records provider status, sent time, delivered time, failure time, and provider error code.
- Updates the CRM last-contacted timestamp after a successful send.
- Detects and blocks customers who opted out by replying `STOP`.
- Allows messaging to resume only after the customer replies `START`.
- Shows actionable feedback when SMS configuration or phone numbers are missing.

### 4.7 Warranty behavior

The current implementation:

1. Finds the customer's latest completed service.
2. Adds the configured warranty duration to the completion date.
3. Calculates whether coverage is active.
4. Displays the warranty end date and remaining days.
5. Displays both text and a progress indicator so meaning does not depend on color alone.

Completed statuses considered for warranty are:

- `completed_pending_customer`
- `completed_confirmed`
- `completed_auto_closed`

## 5. Data model

Migration `0053_provider_crm` adds `provider_customer_profiles`.

The relationship profile is keyed by:

- `organization_id`
- `customer_id`

Stored CRM fields include:

- `email`
- `newsletter_status`
- `warranty_days`
- `callback_at`
- `follow_up_at`
- `last_contacted_at`
- `notes`
- `updated_by`
- Created and updated timestamps

The composite key keeps CRM information organization-specific even when the underlying customer has interacted with multiple organizations.

SMS reuses the existing communications schema from migration `0050_twilio_communications`, including `communication_sms_deliveries` and `communication_opt_outs`. No additional SMS migration is required for this CRM extension.

## 6. API contracts

### `GET /provider/crm/customers`

Returns customers connected to jobs owned or fulfilled by the signed-in provider organization. Each record includes CRM fields and related job history.

### `PATCH /provider/crm/customers/{customer_id}`

Updates approved CRM fields after confirming that the customer belongs to the signed-in provider organization's job scope.

Validation includes:

- Email format and maximum length.
- Newsletter status enumeration.
- Warranty duration from 0 to 3,650 days.
- Notes limited to 4,000 characters.
- Valid date/time values for scheduled actions.

A customer outside the provider's scope returns `404` to avoid exposing cross-tenant customer existence.

### `POST /provider/communications/sms`

Sends an approved transactional SMS associated with a provider-scoped job.

The CRM sends `job_id`, `purpose`, `recipient_type: customer`, and a retry-safe `client_message_id`. The API verifies job ownership, phone availability, provider SMS settings, A2P registration, and recipient opt-out state before calling the communications provider.

### `POST /provider/jobs/{job_id}/calls/customer`

Starts a provider-scoped masked call to the customer. The provider's configured company phone rings first; after it is answered, the communications provider bridges the customer through the masked provider number. The resulting call session appears in `/calls`.

## 7. Main implementation files

| Component | Location |
| --- | --- |
| CRM page | `apps/provider-web/src/app/crm/page.tsx` |
| Provider navigation | `apps/provider-web/src/app/frame.tsx` |
| CRM list proxy | `apps/provider-web/src/app/api/provider/crm/customers/route.ts` |
| CRM update proxy | `apps/provider-web/src/app/api/provider/crm/customers/[id]/route.ts` |
| SMS proxy | `apps/provider-web/src/app/api/provider/communications/sms/route.ts` |
| API models and endpoints | `apps/intake-web/api/main.py` |
| In-memory and PostgreSQL persistence | `apps/intake-web/api/store.py` |
| Database migration | `packages/db/alembic/versions/0053_provider_crm.py` |
| Tenant-scope and update tests | `apps/intake-web/api/tests/test_dispatch.py` |
| SMS integration tests | `apps/intake-web/api/tests/test_job_messages.py` |

## 8. Verification completed

- Provider Next.js production build completed successfully.
- `/crm` is included in the production route output.
- CRM list and update proxy routes are included in the production route output.
- Python API, store, and migration modules compile successfully.
- CRM tenant-scoping and update tests pass.
- Existing Twilio SMS idempotency and STOP/START behavior remains covered.
- CRM SMS coverage includes approved templates, retry idempotency, and last-contacted updates.
- Communications regression result: `15 passed` in `test_job_messages.py`, including a masked CRM call from a completed service.
- Selected CRM regression result: `1 passed, 278 deselected` in `test_dispatch.py`.

## 9. Remaining work

### 9.1 Required before production release

- Apply Alembic migration `0053_provider_crm` to each target database.
- Deploy the updated intake API.
- Deploy the updated provider web application.
- Verify role access for `provider_admin` and `dispatcher`.
- Test against a deployed API and database with realistic customer and job data.
- Verify mobile, desktop, keyboard, loading, empty, and error states in a browser.

### 9.2 Managed newsletter delivery

The current `Email audience` action opens a BCC draft using the operator's local email client. It does not provide:

- Application-managed delivery.
- Campaign templates.
- Scheduled sending.
- Test sends.
- Delivery or open reporting.
- Bounce handling.
- Automatic unsubscribe processing.
- Provider-level suppression lists.
- Retry and failure handling.

A production newsletter feature requires an email delivery provider and a campaign data model.

### 9.3 Callback and follow-up automation

Callbacks and follow-ups are persisted and visible, but no background process currently:

- Sends reminders.
- Assigns tasks to an operator.
- Escalates overdue actions.
- Records outcomes.
- Clears or reschedules completed tasks automatically.

### 9.4 CRM activity history

The CRM needs an append-only activity model for:

- Calls.
- Emails.
- Newsletter sends.
- Notes and note changes.
- Callback and follow-up changes.
- Contact outcomes.
- Consent changes.
- Warranty adjustments.

### 9.5 Customer contact corrections

Customer name and phone currently originate from intake and job records. Direct CRM editing should be added with:

- Audit history.
- Phone normalization.
- Duplicate detection.
- Customer merge rules.
- Protection against accidentally changing the identity associated with historical jobs.

### 9.6 Service-specific warranties

The current warranty duration belongs to the organization/customer relationship. A later slice should support:

- Service-catalog warranty defaults.
- Warranty terms captured on individual completed jobs.
- Authorized job-level overrides.
- Warranty documents or terms.
- Pre-expiration and post-service outreach.
- Clear precedence between organization, service, and job settings.

### 9.7 Scale and reporting

For a large customer book, add:

- Server-side pagination.
- Server-side search and sorting.
- Database indexes supporting common CRM filters.
- Assigned relationship owner.
- Contact outcome reporting.
- Warranty workload reporting.
- Newsletter and follow-up performance reporting.

## 10. Recommended next phases

### Phase 1 — Production readiness

- Apply and verify the migration.
- Complete environment-level browser testing.
- Add server-side pagination and search.
- Add API monitoring and operational error reporting.

### Phase 2 — Contact operations

- Add an append-only CRM activity timeline.
- Add task ownership and outcomes.
- Add reminder processing and overdue escalation.
- Add daily callback and follow-up queues.

### Phase 3 — Campaigns and consent

- Integrate a managed email delivery platform.
- Add campaign drafts, templates, test sends, and scheduling.
- Enforce unsubscribe and suppression rules.
- Store delivery events and campaign reporting.

### Phase 4 — Service-specific warranty

- Add warranty policies to the service catalog.
- Persist warranty terms on completed jobs.
- Support controlled overrides.
- Add warranty-triggered customer communication.

## 11. Release acceptance checklist

- [ ] Migration `0053_provider_crm` is applied.
- [ ] A provider sees only customers connected to its owned or fulfilled jobs.
- [ ] CRM changes remain after a page refresh.
- [ ] Another provider organization cannot read or overwrite those CRM changes.
- [ ] The latest completed service drives warranty status.
- [ ] Zero-day, active, and expired warranty cases display correctly.
- [ ] Due callbacks and follow-ups appear in the Due segment.
- [ ] Only explicitly subscribed customers with valid email addresses enter the newsletter audience.
- [ ] Unsubscribed and unknown-consent customers are excluded from audience email.
- [ ] Empty, loading, error, desktop, and mobile states are usable.
- [ ] Keyboard focus and form error announcements work correctly.
- [ ] Starting a CRM call rings the provider's configured company or forwarding phone before bridging the customer.
- [ ] A successful CRM call creates a job-linked call session and updates the customer's last-contacted time.
- [ ] The call response and CRM interface do not expose either party's private phone number.
- [ ] Completed-service CRM calls are allowed without widening technician or customer call permissions.
- [ ] A successful CRM SMS creates a job-linked delivery and updates last-contacted time.
- [ ] Retrying the same SMS client message identifier does not create a duplicate send.
- [ ] A customer who replied STOP cannot receive another transactional SMS until START.
- [ ] Queued, delivered, failed, missing-number, disabled, and opted-out SMS states display correctly.

## 12. Functional boundary

The core CRM slice, including operator-triggered masked calls and transactional SMS, is implemented and usable. Newsletters and scheduled follow-ups must not be described as automated yet:

- CRM calling is an app-initiated PSTN bridge, not browser/WebRTC audio: the provider answers its configured company or forwarding phone, then the customer is connected through the masked Twilio number.
- Calling requires masked calls to be enabled plus a configured Twilio number and provider forwarding number.
- Newsletter support currently means consent management, audience filtering, and opening a BCC email draft.
- Follow-up support currently means storing, displaying, and filtering callback/follow-up dates.
- CRM SMS support means an operator can send approved transactional templates through the configured communications provider; it does not schedule messages automatically.
- Automated campaign delivery, scheduled reminders, escalation, and reporting require later slices.
