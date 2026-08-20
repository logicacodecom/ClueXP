# Scheduling and Partner Dispatch MVP

**Status:** Implemented MVP specification; deployed code needs pilot/browser acceptance evidence before widening
**Product owner decision:** Keep immediate service intact and add a separate scheduled-service path. Include provider-managed scheduling and explicit, opt-in partner dispatch.  
**Architecture constraint:** ClueXP supplies workflow and routing software. It does not become a service provider or silently dispatch a provider's jobs.

## 1. Product outcome

ClueXP must let a customer request service either now or later, then let the company that owns the request schedule and dispatch the work to its own technician or, when policy permits, an approved fulfillment partner.

The product promise is:

> Book now or schedule later. The company handling the request confirms the appointment, assigns the right technician, and keeps the customer informed through completion.

Scheduling is not just a date picker. It requires customer choice, capacity management, technician reservations, provider approval, partner handoff, reminders, rescheduling, and an auditable conversion from a future reservation into an active job.

Implementation note, 2026-08-20: the customer/provider scheduling path, organization partnerships, and technician reservation records are implemented and deployed through migrations `0051_organization_partnerships` and `0052_technician_reservations`. The Aug 14 correctness/security review items were fixed in `bd2d839`. Scheduling confirmation now records `confirmed_unassigned`; reserving a named technician for future work remains deferred until scheduled-work offer/accept semantics are implemented.

## 2. Product principles

1. **Immediate remains immediate.** Scheduling must not slow, hide, or weaken the existing urgent-dispatch path.
2. **A request is not a promise.** A customer-selected window is `requested` until capacity and serviceability are confirmed.
3. **Future capacity is separate from active capacity.** A reservation must not bypass or misuse the global active-job lock.
4. **The request owner stays visible and accountable.** Partner fulfillment does not transfer the customer relationship.
5. **Private by default.** A provider's jobs and technician availability are not exposed to other providers unless the owner explicitly routes a specific job under an enabled partner policy.
6. **Reveal information progressively.** A prospective partner sees only what is necessary to decide whether it can serve the job. Customer identity and exact access details remain protected until a named assignment is accepted.
7. **No silent auto-dispatch in the MVP.** ClueXP may rank options and automate reminders, but a provider dispatcher confirms a technician or partner route.
8. **Every material change is auditable.** Confirmation, assignment, partner acceptance, rescheduling, cancellation, override, and activation must record actor, organization, time, and reason.

## 3. Users and responsibilities

### Customer

- Chooses `As soon as possible` or `Schedule for later`.
- Supplies the service details, location, contact information, and optional photos or access notes.
- Requests an available window, receives confirmation, and may reschedule or cancel within provider policy.
- Receives reminders and later uses the existing tracking and completion flow when the job becomes active.

### Owning provider dispatcher

- Controls the customer promise and owns the dispatch decision.
- Reviews scheduling requests, confirms or proposes a different window, and reserves capacity.
- Assigns an eligible technician from its roster or explicitly routes the request to an approved partner.
- Can recover, reassign, reschedule, or cancel its jobs.

### Fulfillment partner dispatcher

- Sees only partner offers sent to its organization.
- Accepts or declines the organization-level opportunity within a defined response period.
- After accepting, reserves and assigns one of its own eligible technicians.
- Cannot change customer ownership, solicit the customer, forward the job to another partner, or alter commercial terms outside the agreed workflow.

### Technician

- Maintains working availability and time off, subject to provider policy.
- Reviews and accepts or declines a scheduled assignment.
- Sees reserved work in a future schedule without treating it as an active job.
- Starts the existing fulfillment lifecycle when the reservation is activated.

### ClueXP operations

- Has read-only cross-tenant oversight, audit, safety, and compliance visibility.
- Does not choose the technician, accept partner work, or dispatch provider jobs.

## 4. Customer intake changes

The branded intake entry point adds an explicit need-time decision after the service situation is understood:

```text
When do you need service?
  As soon as possible
  Schedule for later
```

### 4.1 Immediate path

The existing flow remains:

```text
Service -> situation -> location -> identity -> price consent -> commit
        -> owning provider's live queue -> targeted technician offer
```

The default may remain immediate for emergency-capable channels. Safety answers can force the immediate or human-handoff path and must never offer a future appointment as the only response.

### 4.2 Schedule-for-later path

The scheduled path becomes:

```text
Service -> situation -> location -> requested day/window -> identity
        -> booking/price policy -> review -> request submitted
```

The customer selects an arrival window, not an exact arrival time, unless the provider explicitly enables exact-time appointments for that service. Each presented slot must be generated server-side from provider rules rather than trusted from browser input.

The completion screen must distinguish:

- **Requested:** "We received your preferred time. The company will confirm it."
- **Confirmed:** "Your appointment is confirmed for Tuesday, 8–10 AM."
- **Alternative proposed:** "That time is unavailable. Review the new time proposed by the company."

The customer receives a secure management link for viewing, accepting an alternative, rescheduling, or cancelling. This link is distinct from active-job live tracking until activation.

## 5. Availability and bookable slots

Availability is computed in the service-location timezone using:

- Provider business hours and holidays
- Service catalog duration and optional setup buffer
- Technician working hours and time off
- Technician skills, certifications, affiliation, and dispatch permission
- Service-area eligibility
- Existing confirmed reservations
- Existing active work
- Travel buffer between appointments
- Capacity deliberately reserved for same-day urgent work
- Minimum notice and maximum booking horizon

The public API returns capacity windows, never technician identities. A slot is advisory until the booking write succeeds. Confirmation must re-check capacity transactionally to prevent two customers or dispatchers from reserving the same technician and time.

MVP slot rules:

- Configurable arrival-window length, default two hours
- Configurable service duration by catalog item
- Provider-level minimum notice and booking horizon
- Provider blackout periods and technician time off
- One canonical IANA timezone stored with the appointment
- No waitlist, overbooking, recurring appointments, split crews, or route optimization in the first release

## 6. Scheduled appointment lifecycle

Scheduling uses a lifecycle separate from `jobs.status`:

```text
requested
  -> confirmed_unassigned
  -> technician_offered
  -> technician_reserved
  -> activation_due
  -> activated
```

Alternate and terminal transitions:

```text
requested/confirmed_unassigned -> alternative_proposed -> confirmed_unassigned
technician_offered             -> confirmed_unassigned      (declined/expired)
any pre-activation state       -> reschedule_requested
any pre-activation state       -> cancelled
confirmed past window          -> no_show                    (dispatcher action)
```

Meanings:

- `requested`: customer preference received; not yet promised.
- `confirmed_unassigned`: provider has promised the window but has not reserved a named technician.
- `technician_offered`: a future assignment is awaiting technician acceptance.
- `technician_reserved`: a technician accepted the future reservation.
- `activation_due`: the configured pre-service activation horizon has been reached.
- `activated`: reservation was atomically converted to the existing active dispatch/fulfillment lifecycle.

`jobs.status = assigned` remains an active-job state. Accepting a future reservation must not set it. At activation, the server atomically verifies that the reserved technician is eligible and not globally active elsewhere, then establishes the active assignment. If that check fails, the appointment enters dispatcher attention; it is never silently double-booked.

Before activation, the customer sees appointment states. After activation, the existing tracking states, arrival verification, service lifecycle, completion, payment, and review behavior apply.

## 7. Provider scheduling and dispatch surfaces

The provider console adds a **Schedule** surface alongside Live Queue and Dispatch Board.

### 7.1 Calendar views

- Day and week views with technicians as rows and time horizontally
- Unassigned scheduled jobs lane
- Confirmed, tentative, partner-routed, blocked, and at-risk visual states
- Filters for team, technician, service, territory, and status
- Capacity warning when emergency reserve is consumed
- Local display timezone clearly shown

### 7.2 Dispatcher actions

- Create a scheduled job for a phone or walk-in customer
- Confirm the requested window or propose another
- Drag an appointment to a new time, with server revalidation
- Offer a reservation to an eligible technician
- Reassign or remove a reservation before activation
- Route to an approved partner when policy allows
- Cancel with a required reason
- Notify affected customer and technician after material changes
- View a complete appointment and routing timeline

### 7.3 Assignment recommendations

Candidate ranking may use skills, certifications, team, service area, distance from the preceding job, travel buffer, availability, workload, and affiliation. Ranking is advisory. Ineligibility caused by compliance, affiliation, an overlapping reservation, or an active global job is a hard server-side block.

## 8. Partner dispatch

Partner dispatch supports overflow without turning ClueXP into a competing fulfillment provider.

### 8.1 Eligibility and trust setup

Before routing jobs, organizations must have an active partner relationship containing:

- Sending organization and receiving organization
- Directionality: one-way or mutual
- Permitted services and service areas
- Immediate, scheduled, or both
- Commercial terms or a referenced agreement version
- Response timeout
- Customer communication responsibility
- Cancellation and no-show responsibility
- `no_solicit_required`, default `true`
- Active dates and suspension status

Provider fulfillment remains `private` by default. Partner routing requires an explicit `network_overflow` or approved-partners policy and an active bilateral configuration.

### 8.2 Routing flow

```text
Owning provider selects Route to partner
  -> ClueXP validates policy and builds a masked offer
  -> One approved partner receives the offer
  -> Partner accepts or declines at organization level
  -> Partner assigns one of its own eligible technicians
  -> Technician accepts the scheduled reservation
  -> Named assignment unlocks the necessary job/customer details
  -> Reservation activates into the existing fulfillment lifecycle
```

The MVP uses a single targeted partner offer, consistent with the current single-targeted-technician model. A decline or timeout returns control to the owning provider. Broadcasting to multiple partners, auctions, and bidding are out of scope.

### 8.3 Information disclosure

Before partner acceptance, the partner offer may contain:

- Owning provider display name
- Service category and skill requirements
- Approximate service area, not exact address
- Requested or confirmed window and expected duration
- Safety/equipment indicators necessary to evaluate serviceability
- Agreed payout or commercial reference
- Offer expiry

It must not contain customer name, phone, exact address, access codes, uploaded documents, or free-text content that could accidentally reveal identity.

Organization acceptance records `fulfillment_org_id` but does not set `trust_state = matched`. The job becomes matched only after a named, verified technician accepts the assignment under the existing trust-state contract. The API then reveals only the details required to fulfill the job.

### 8.4 Ownership and communication

- `origin_org_id` records where the request began.
- `customer_owner_org_id` remains the customer-facing relationship owner through overflow.
- `fulfillment_org_id` identifies the partner performing the work.
- The owner controls customer promises, rescheduling approval, and customer-facing cancellation unless the agreement delegates a specific action.
- The fulfillment partner controls its technician and may report operational constraints through the job thread.
- Customer communication should remain branded as the owning provider, with the fulfillment company disclosed where legally or operationally required.
- Partner staff cannot browse the owner's customer directory or unrelated jobs.

### 8.5 Partner recovery

- Partner decline/timeout: return to the owning provider's scheduled queue.
- Technician decline/timeout: partner dispatcher may try another eligible technician while its organization offer remains valid.
- Partner cannot staff before the deadline: partner releases the job with a reason; owner is alerted immediately.
- Owner cancellation: invalidate partner and technician reservations atomically and notify all parties.
- Partner suspension or compliance loss: block new offers and flag affected future reservations for owner review; do not silently cancel customer appointments.
- Activation conflict: alert both dispatchers, keep tenant-safe details, and require owner-led recovery.

## 9. Data model proposal

Use relational columns for scheduling and dispatch decisions that must be queried or constrained. Do not store the complete feature only in `jobs.detail`.

### `service_appointments`

- `id`, `job_id` (unique)
- `status`
- `timezone`
- `requested_window_start`, `requested_window_end`
- `confirmed_window_start`, `confirmed_window_end`
- `estimated_duration_minutes`
- `activation_at`
- `confirmed_at`, `cancelled_at`, `activated_at`
- `confirmed_by_user_id`, `cancelled_by_user_id`
- `cancellation_reason`
- Optimistic lifecycle version and timestamps

### `technician_reservations`

- `id`, `appointment_id`, `technician_id`, `organization_id`
- `status`: `offered`, `accepted`, `declined`, `expired`, `released`, `activated`
- `starts_at`, `ends_at`, `travel_buffer_before`, `travel_buffer_after`
- `offered_at`, `expires_at`, `responded_at`, `released_at`
- `release_reason`

The database must prevent overlapping active reservations for the same technician. An accepted reservation is not the same as the existing active-job capacity lock.

### `organization_partnerships`

- Directional sender and receiver organization IDs
- Status and effective dates
- Allowed services, areas, and timing modes
- Response timeout and agreement reference
- Commercial and communication policy references
- No-solicit requirement

### `partner_dispatch_offers`

- `id`, `job_id`, `appointment_id`
- `owner_org_id`, `partner_org_id`
- `status`: `offered`, `accepted`, `declined`, `expired`, `released`, `cancelled`
- Masked offer snapshot and commercial-terms snapshot
- Offer, expiry, response, and release timestamps
- Actor and reason fields

Enforce one active partner offer per job in the MVP with a partial unique index. All writes require idempotency keys and transactionally re-check tenant, policy, lifecycle version, and capacity.

## 10. API capability proposal

Names are provisional; authorization and behavior are normative.

### Customer/branded intake

- `GET /o/{slug}/availability` — return anonymous bookable windows for service, location, and date range
- Existing ticket create/update accepts the need-time choice
- `POST /api/tickets/{id}/schedule-request` — transactionally record the requested window
- `GET /s/{token}` — appointment management snapshot
- `POST /s/{token}/reschedule`
- `POST /s/{token}/cancel`
- `POST /s/{token}/alternatives/{id}/accept`

### Owning provider

- `GET /provider/schedule`
- `POST /provider/scheduled-jobs` — dispatcher-created intake
- `POST /provider/appointments/{id}/confirm`
- `POST /provider/appointments/{id}/propose-alternative`
- `POST /provider/appointments/{id}/offer-technician`
- `POST /provider/appointments/{id}/route-partner`
- `POST /provider/appointments/{id}/reschedule`
- `POST /provider/appointments/{id}/cancel`

### Fulfillment partner

- `GET /provider/partner-offers`
- `POST /provider/partner-offers/{id}/accept`
- `POST /provider/partner-offers/{id}/decline`
- `POST /provider/partner-jobs/{id}/offer-technician`
- `POST /provider/partner-jobs/{id}/release`

### Technician

- `GET/PUT /technicians/me/availability`
- `GET /technicians/me/schedule`
- `POST /scheduled-offers/{id}/accept`
- `POST /scheduled-offers/{id}/decline`

The activation worker is scheduler-agnostic and idempotent. It promotes due reservations, records failures for dispatcher attention, sends reminders, expires offers, and never chooses a replacement technician or partner by itself in the MVP.

## 11. Notifications

Required events:

- Request received
- Appointment confirmed or alternative proposed
- Appointment reminder, initially 24 hours and two hours before the window
- Technician reservation offered, accepted, declined, expired, or released
- Partner offer received, accepted, declined, expired, or released
- Rescheduled or cancelled
- Appointment at risk or activation failed
- Active technician en route, after which existing tracking notifications take over

Messages must display the service-location timezone and avoid claiming a technician is assigned until the named assignment is accepted.

## 12. Permissions and security

- Customer management tokens are opaque, expiring or revocable, rate-limited, and scoped to one appointment.
- Availability reads expose slots only, never roster data.
- All provider actions are scoped to `session.active_organization_id`.
- An owning provider cannot reserve another organization's technician directly.
- A fulfillment partner cannot access a job without an active offer/acceptance relationship.
- Browser-provided organization IDs are never authorization inputs.
- Free text and attachments are excluded from masked partner offers unless sanitized and explicitly approved.
- Exact address, identity, and access instructions are revealed only when lifecycle and assignment rules permit.
- Cross-tenant audit events retain actor organization and action purpose.

## 13. MVP scope and release slices

### Slice A — Customer request and provider confirmation

- Need-now versus schedule-later intake branch
- Provider-defined windows and scheduling policies
- Appointment request, confirmation, alternative, cancellation, and reminders
- Provider unassigned calendar

### Slice B — Own-roster reservations

- Technician availability and time off
- Dispatcher future offer
- Technician accept/decline
- Conflict-safe reservations
- Activation into the existing job lifecycle

### Slice C — Approved partner overflow

- Partner relationship configuration
- Targeted masked organization offer
- Partner accept/decline and own-roster assignment
- Ownership-safe communication and audit
- Release and recovery paths

### Explicitly deferred

- Marketplace bidding or auctions
- Simultaneous partner broadcast
- Automated partner selection or automatic technician assignment
- Customer selection of a named technician
- Recurring service plans
- Waitlists and overbooking
- Route optimization and automatic schedule reshuffling
- Deposits, cancellation charges, or merchant-of-record changes
- Multi-technician crews and multi-day jobs
- Calendar-provider synchronization

## 14. Acceptance criteria

The MVP is ready when all of the following are demonstrably true:

1. An urgent customer can complete the current flow with no new scheduling delay.
2. A customer can request a future window and sees honest requested versus confirmed language.
3. Two concurrent writes cannot reserve the same technician for overlapping time.
4. A future reservation does not place the technician in the active-job lock.
5. Activation cannot give a technician two active jobs across affiliations.
6. A provider can create, confirm, reschedule, assign, and cancel a scheduled job.
7. A technician can accept a future reservation and view it separately from active work.
8. An owner can route only to an active, approved partner under allowed service and area rules.
9. A partner sees no customer identity or exact address before the permitted named assignment event.
10. Partner acceptance records fulfillment responsibility without transferring customer ownership.
11. A partner decline, timeout, release, or technician failure returns the job to visible owner attention.
12. Every lifecycle and cross-organization change is tenant-scoped, idempotent, and audited.
13. Customers, dispatchers, partners, and technicians receive correct notifications after changes.
14. Timezone and daylight-saving boundary tests preserve the promised local appointment window.

## 15. Product measures

- Scheduled request completion rate
- Request-to-confirmation time
- Percentage confirmed without changing the requested window
- Technician reservation acceptance rate
- Partner offer acceptance and time-to-acceptance
- On-time arrival-window performance
- Reschedule, cancellation, no-show, and activation-failure rates
- Percentage of overflow jobs recovered without breaking the customer promise
- Urgent capacity preserved versus consumed by scheduled work
- Customer satisfaction by own-roster versus partner fulfillment

Metrics must be segmented by owning provider, service, territory, and fulfillment mode without exposing one provider's operational data to another.
