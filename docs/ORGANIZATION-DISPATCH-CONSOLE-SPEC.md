# ClueXP Organization / ClueXP Dispatch Console — UI + Flow Specification

> **Status:** Product/UI specification for a dispatch console used by provider organizations and ClueXP operations.
> **Audience:** UI builder, designer, or another coding model.
> **Important:** This is a console specification, not an implementation task. Build screens and flows from this document; do not assume database or API contracts beyond what is stated here.

---

## 1. Product Purpose

The Dispatch Console is the work surface for assigning emergency access jobs to real technicians. It supports two operating modes:

- **Organization Dispatch Console:** a provider organization receives jobs routed to it and assigns its own affiliated technicians.
- **ClueXP Dispatch Console:** ClueXP operations monitors the marketplace, dispatches individual technicians, handles direct-release affiliated technicians, and escalates exceptions.

The console must feel like an operations tool: dense, clear, fast, and auditable. It is not a marketing dashboard. Dispatchers use it while jobs are live, customers are waiting, and technicians may be moving.

---

## 2. Primary Users

### 2.1 Organization Dispatcher

A dispatcher, manager, or owner inside a provider organization.

Key needs:
- See jobs routed to the organization.
- Assign one of the organization's affiliated technicians.
- Filter technicians by team, service type, distance, availability, document status, and current workload.
- Monitor accepted, en route, arrived, and in-service jobs.
- Reassign or escalate when a technician cannot complete the job.
- Communicate with affiliated technicians, customer, or ClueXP operations where allowed.

### 2.2 Organization Admin / Owner

An organization user responsible for operational setup.

Key needs:
- Manage organization dispatch posture.
- Create teams.
- Maintain technicians and team membership.
- Review organization-level documents.
- See performance/reporting.
- Configure who can dispatch.

### 2.3 ClueXP Dispatcher

A ClueXP operations user.

Key needs:
- See all platform jobs needing manual attention.
- Dispatch individual technicians.
- Dispatch affiliated technicians released by their organization for direct ClueXP dispatch.
- Route jobs to organizations in organization-managed mode.
- Intervene in stalled, safety, payment, or customer escalation cases.
- Override or cancel dispatch where policy allows.

### 2.4 ClueXP Admin

A platform admin responsible for configuration and compliance.

Key needs:
- Review provider documents.
- Activate, suspend, or block organizations/technicians.
- Configure dispatch policies.
- Audit events.
- Manage escalations and disputes.

---

## 3. Authority Model

This console must follow the dispatch authority direction in `SPEC.md` §2.10.

### 3.1 Individual Technician

Individual technicians are dispatched directly by ClueXP.

Console behavior:
- ClueXP can offer/assign jobs to individual technicians.
- Organizations cannot dispatch individual technicians unless a later partnership rule explicitly allows it.

### 3.2 Affiliated Technician

Affiliated technicians belong to a provider organization.

Default behavior:
- Organization-managed by default.
- ClueXP routes the job to the organization.
- The organization assigns one of its own technicians internally.

Direct-release behavior:
- An organization may release a specific affiliated technician for direct ClueXP dispatch.
- This permission lives on the organization membership, not on the technician's global profile.
- ClueXP can dispatch only released affiliated technicians directly.

### 3.3 Customer Trust-State Rule

Customer-facing `Ticket.trust_state` is separate from console job/offer states.

Non-negotiable:
- Organization acceptance does **not** flip the customer to `MATCHED`.
- The customer becomes `MATCHED` only when a specific verified technician is assigned to the job.
- Live tracking becomes visible only when the backend permits `FULFILLMENT`.
- The console may show internal organization/job states, but it must not cause customer-visible trust-state changes unless the backend contract is satisfied.

---

## 4. Console Modes

### 4.1 Organization Mode

Scope:
- Only jobs routed to the active organization.
- Only technicians affiliated with that organization.
- Only teams inside that organization.
- Organization documents and technician documents for that organization.

Primary question:
- "Which of our technicians should take this job?"

### 4.2 ClueXP Mode

Scope:
- Platform-wide jobs.
- Individual technicians.
- Direct-release affiliated technicians.
- Organizations eligible to receive organization-managed jobs.
- Escalations, safety cases, exceptions, and admin overrides.

Primary question:
- "What is the safest and fastest valid dispatch path for this job?"

### 4.3 Shared Console Shell

The same product can share common UI patterns across both modes:
- Job queue.
- Job detail.
- Technician picker.
- Map.
- Dispatch timeline.
- Chat/log.
- Escalation controls.

But authorization and available actions differ by mode.

---

## 5. Core Product Principles

1. **Assign a real person:** customer `MATCHED` requires a named verified technician.
2. **Make authority visible:** every job shows who owns dispatch: ClueXP, organization, or hybrid/direct-release.
3. **Prevent invalid assignments:** blocked, expired, unavailable, or out-of-scope technicians cannot be assigned without an explicit authorized override.
4. **Preserve auditability:** every assignment, reassignment, decline, timeout, override, and escalation writes an event.
5. **Separate internal states from customer promise:** internal routing does not equal customer-visible matching.
6. **Fast comparison:** dispatchers must compare eligible technicians quickly.
7. **Exception-first operations:** stalled, unsafe, expiring, or disputed jobs need priority treatment.
8. **Tenant isolation:** organization dispatchers see only their organization scope.

---

## 6. Information Architecture

Recommended left navigation for desktop console:

| Section | Purpose |
|---|---|
| **Live Queue** | Jobs awaiting route, assignment, reassignment, or escalation |
| **Dispatch Board** | Active assignments by status and owner |
| **Map** | Jobs, technicians, service areas, routes |
| **Technicians** | Availability, skills, location, teams, compliance |
| **Teams** | Organization teams and assignment lanes |
| **Messages** | Customer, technician, dispatcher, org communication |
| **Documents** | Compliance status and blockers |
| **Reports** | Completed jobs, response time, outcomes, settlement placeholders |
| **Settings** | Dispatch mode, permissions, service area, rules |
| **Audit Log** | Events, overrides, safety, disputes |

For mobile/tablet console use, collapse navigation into tabs or a drawer, but keep Live Queue and Active Job always reachable.

---

## 7. Global States

### 7.1 Job Queue State

Queue states:
- `new_unrouted`
- `routed_to_cluexp`
- `routed_to_organization`
- `awaiting_org_accept`
- `awaiting_technician_assignment`
- `offer_sent`
- `offer_expiring`
- `accepted`
- `en_route`
- `arrived`
- `in_service`
- `customer_approval_needed`
- `completed`
- `cancelled`
- `escalated`
- `stalled`

Rules:
- These are console/job states, not replacements for customer `trust_state`.
- A job may be internally routed to an organization while the customer still remains in `INTAKE` or pre-`MATCHED` visibility.

### 7.2 Technician Eligibility State

Eligibility states:
- `eligible`
- `offline`
- `busy`
- `outside_service_area`
- `missing_skill`
- `blocked_by_documents`
- `stale_location`
- `suspended`
- `manual_override_required`

Rules:
- Ineligible technicians should be visible when useful, but clearly blocked from normal assignment.
- Manual override requires permission and reason capture.

### 7.3 Organization Eligibility State

Organization states:
- `eligible`
- `inactive`
- `blocked_by_documents`
- `outside_service_area`
- `capacity_full`
- `dispatch_unavailable`
- `subscription_blocked`
- `manual_override_required`

Rules:
- ClueXP can route jobs only to eligible organizations unless authorized override exists.
- Organization document expiration can block organization-managed dispatch.

### 7.4 Dispatch Delivery State

Offer/delivery states:
- `pending`
- `sent`
- `seen`
- `accepted`
- `declined`
- `expired`
- `superseded`
- `failed_delivery`

Rules:
- Offer countdowns must be based on backend `expires_at`.
- First-accept-wins must be enforced server-side with transaction/constraint semantics.
- Polling is acceptable for early prototype/v1, but production mobile alert reliability requires push/websocket/native notification strategy.

---

## 8. Screen List

### 8.1 Sign In / Workspace Select

Purpose:
- Authenticate logged-in dispatch users.
- Select ClueXP workspace or organization workspace if the user has multiple scopes.

Fields:
- Email or phone.
- Password.

Rules:
- Auth follows `adr/0002-identity-and-clients.md`: platform `users` + JWT.
- OTP is not the default dispatcher login method.
- Role/scope determines available console mode and actions.

---

### 8.2 Live Queue

Purpose:
- Triage jobs needing dispatch attention.

Content:
- New jobs.
- Jobs routed to organization.
- Jobs awaiting technician assignment.
- Offers expiring.
- Stalled jobs.
- Safety/payment/customer escalations.

Filters:
- Source: ClueXP, organization, hybrid.
- Access type.
- Situation.
- Urgency.
- Area.
- Team.
- Age.
- Trust-state.
- Escalation reason.

Primary actions:
- Open Job.
- Route to Organization.
- Assign Technician.
- Escalate.
- Call Customer.
- Call Technician.

Rules:
- The highest priority queue items should be expiration, safety, and stalled jobs.
- Queue should support compact rows for repeated operations.

---

### 8.3 Job Detail

Purpose:
- Single operational record for a job.

Content:
- Job status.
- Customer safe display info.
- Access type and situation.
- Location.
- Safety flags.
- Photos/notes if permitted.
- Price/approval status if relevant.
- Dispatch owner: ClueXP or organization.
- Current assigned technician, if any.
- Trust-state.
- Timeline/events.

Primary actions:
- Assign Technician.
- Route to Organization.
- Reassign.
- Cancel.
- Escalate.
- Message/Call.
- Add Internal Note.

Rules:
- Sensitive customer data follows backend policy.
- Customer-visible values must be clearly separated from internal notes.

---

### 8.4 Route to Organization

Purpose:
- ClueXP sends a job to an eligible provider organization.

Content:
- Eligible organizations.
- Service area match.
- Document status.
- Available teams.
- Capacity/workload.
- Historical response time.
- Contact/dispatcher availability.

Primary actions:
- Route Job.
- Route to Team.
- Skip Organization.
- Escalate.

Rules:
- Routing to an organization is not customer `MATCHED`.
- If organization accepts but does not assign a technician in time, the job becomes stalled/expired and returns to ClueXP queue.

---

### 8.5 Organization Job Intake

Purpose:
- Organization receives a routed job and decides whether to accept responsibility.

Content:
- Job summary.
- Required skill.
- Area/distance.
- Customer timing.
- Safety flags.
- Suggested teams.
- Available technicians.
- Countdown/response deadline.

Primary actions:
- Accept Job for Organization.
- Decline Job.
- Assign Technician.
- Ask ClueXP for Help.

Rules:
- Organization acceptance is an internal milestone only.
- Customer `MATCHED` waits for a specific technician assignment.
- Decline requires reason capture.

---

### 8.6 Technician Assignment

Purpose:
- Select the best technician for the job.

Content:
- Eligible technician list.
- Map location.
- Skills match.
- Team membership.
- Distance/ETA.
- Availability.
- Current workload.
- Document status.
- Last GPS update.
- Rating/performance.

Primary actions:
- Assign.
- Send Offer.
- Hold / Reserve.
- View Profile.
- Override Block.

Rules:
- Assignment can be direct or offer-based depending on policy.
- If using offers, acceptance must be backend-enforced first-accept-wins.
- Blocked technicians cannot be assigned without a recorded override reason.

---

### 8.7 Dispatch Board

Purpose:
- Monitor active jobs after routing/assignment.

Columns or lanes:
- Awaiting assignment.
- Offer sent.
- Accepted.
- En route.
- Arrived.
- In service.
- Approval needed.
- Completed.
- Escalated.

Content:
- Job cards.
- Technician.
- Team/organization.
- Age.
- ETA.
- Last event.
- Warnings.

Primary actions:
- Open Job.
- Reassign.
- Escalate.
- Message.

Rules:
- Board must support quick scanning, not decorative cards.
- Stalled jobs should float to the top.

---

### 8.8 Map Operations

Purpose:
- Visualize jobs, technicians, service areas, routes, and team coverage.

Content:
- Job markers.
- Technician markers.
- Organization service area.
- Team/service-type filters.
- Route/ETA overlays when available.
- Location accuracy/staleness.

Primary actions:
- Select Job.
- Select Technician.
- Assign from Map.
- Open in Maps.

Rules:
- If production map is unavailable in a prototype, use realistic static map visuals.
- Do not show decorative fake movement.

---

### 8.9 Technician Profile Drawer

Purpose:
- Inspect a technician before assignment.

Content:
- Name/photo.
- Provider type: individual or affiliated.
- Organization.
- Teams.
- Skills.
- Availability.
- Current/last location.
- Current workload.
- Documents/compliance.
- Rating/performance.
- Direct-release status if affiliated.

Primary actions:
- Assign.
- Message.
- Call.
- Mark unavailable.
- View documents.

Rules:
- Organization dispatchers see only technicians inside their organization.
- ClueXP sees individual technicians and direct-release affiliated technicians for direct dispatch.

---

### 8.10 Team Dispatch View

Purpose:
- Dispatch within an organization by team.

Content:
- Recursive team hierarchy.
- Team description.
- Team members.
- Team workload.
- Team specialties.
- Jobs assigned to team.

Primary actions:
- Assign to Team.
- Assign Technician.
- Move Job to Another Team.
- Message Team.

Rules:
- Teams are virtual operational groups only.
- Teams do not hold legal/compliance documents.

---

### 8.11 Communications Center

Purpose:
- Keep customer, technician, organization, and ClueXP communication visible and auditable.

Threads:
- Customer thread.
- Technician thread.
- Organization dispatcher thread.
- ClueXP internal notes.

Primary actions:
- Send Message.
- Start Call.
- Add Internal Note.
- Escalate.

Rules:
- Internal notes must never be sent to customer accidentally.
- Customer and technician phone numbers should remain masked or mediated where possible.

---

### 8.12 Escalation Queue

Purpose:
- Handle exceptional cases.

Escalation types:
- Safety concern.
- Customer requested human.
- Offer expired.
- Organization did not assign.
- Technician no response.
- GPS stale.
- Customer dispute.
- Payment/final approval issue.
- Document/compliance block.

Primary actions:
- Take Ownership.
- Call Customer.
- Call Technician.
- Reassign.
- Cancel.
- Mark Resolved.

Rules:
- Escalations require audit events.
- Safety escalation should avoid theatrical or law-enforcement language.

---

### 8.13 Documents / Compliance

Purpose:
- Prevent dispatch to unqualified organizations or technicians.

Content:
- Organization documents.
- Technician documents.
- Expiration dates.
- Review status.
- Blocking reasons.
- Required vs optional docs.

Primary actions:
- View Document.
- Request Update.
- Approve/Reject, ClueXP admin only.
- Block/Unblock dispatch, permission-gated.

Rules:
- Organization documents can block organization-managed dispatch.
- Technician documents can block technician assignment.
- Teams have no legal documents.

---

### 8.14 Reports

Purpose:
- Operational performance visibility.

Content:
- Response time.
- Assignment time.
- Acceptance rate.
- Completion rate.
- Cancellation reasons.
- Stalled jobs.
- Customer rating.
- Organization/team performance.
- Settlement placeholders where supported.

Rules:
- Do not imply payout/settlement model is final.
- Organization-managed jobs may settle to the organization, not directly to the technician.

---

### 8.15 Settings / Dispatch Policy

Purpose:
- Configure operating rules.

Organization settings:
- Dispatch mode display.
- Service area.
- Teams.
- Dispatcher permissions.
- Assignment rules.
- Direct-release technicians, future.
- Organization contact.
- Documents.

ClueXP settings:
- Dispatch policy.
- Offer timeout.
- Ranking weights.
- Override permissions.
- Safety escalation policy.
- Provider activation rules.

Rules:
- Settings that affect assignment must be permission-gated.
- Risky changes require confirmation and audit entry.

---

### 8.16 Audit Log

Purpose:
- Provide the complete operational record.

Events:
- Job routed.
- Organization accepted/declined.
- Technician offered.
- Technician accepted/declined/expired.
- Technician assigned.
- Reassignment.
- Trust-state changes.
- Customer messages.
- Dispatcher notes.
- Overrides.
- Safety escalation.
- Completion/cancellation.

Rules:
- Audit log should be append-only.
- Entries should show actor, timestamp, scope, and reason where applicable.

---

## 9. Critical Flows

### 9.1 ClueXP Dispatch to Individual Technician

1. Job enters ClueXP queue.
2. Dispatcher or matcher finds eligible individual technicians.
3. Console sends offer or assigns directly, depending on policy.
4. Technician accepts.
5. Backend atomically marks winning offer accepted.
6. Job receives `technician_id`.
7. Customer may move to `MATCHED` only after named verified technician assignment.

Failure states:
- No eligible technician.
- Offer expired.
- Technician declined.
- Another technician accepted first.
- Technician documents expired.
- GPS stale.

---

### 9.2 ClueXP Route to Organization

1. Job enters ClueXP queue.
2. Dispatcher or matcher selects eligible organization.
3. Job is routed to organization.
4. Organization accepts responsibility or declines.
5. If accepted, organization assigns technician.
6. Backend records `provider_organization_id` and final `technician_id`.
7. Customer becomes `MATCHED` only after technician assignment.

Failure states:
- Organization declines.
- Organization response expires.
- Organization accepts but fails to assign.
- Organization documents block dispatch.
- No eligible technician inside organization.

---

### 9.3 Organization Assigns Affiliated Technician

1. Organization receives routed job.
2. Dispatcher opens assignment view.
3. Dispatcher filters by team, skill, distance, availability, document status.
4. Dispatcher assigns or offers job to technician.
5. Technician accepts if offer-based.
6. Backend confirms assignment.
7. Customer-visible match becomes available.

Failure states:
- Technician unavailable.
- Technician lacks skill.
- Technician document expired.
- Location stale.
- Offer expired.

---

### 9.4 Reassignment

1. Active job is flagged for reassignment.
2. Dispatcher records reason.
3. Current technician is released or marked unable.
4. Console returns job to assignment flow.
5. New technician is assigned.
6. Customer visibility is updated by backend according to trust-state rules.

Reasons:
- Technician cancelled.
- Technician delayed.
- Wrong skill.
- Customer escalation.
- Safety concern.
- Vehicle/equipment issue.

---

### 9.5 Escalation

1. Job is marked escalated by system, customer, technician, organization, or dispatcher.
2. Escalation appears in ClueXP queue and, if applicable, organization queue.
3. Authorized dispatcher takes ownership.
4. Dispatcher contacts parties and decides next action.
5. Resolution is recorded.

Rules:
- Safety escalation gets priority.
- Escalation handling must preserve audit trail.
- Organization mode may escalate to ClueXP when outside its authority.

---

## 10. Data Needed by UI

Identity:
- user_id
- role
- workspace scope: ClueXP or organization
- permissions

Organization:
- id
- legal_name
- display_name
- description
- status
- service_area
- dispatch_mode, future/planned
- subscription_status
- document_status

Team:
- id
- organization_id
- parent_team_id
- name
- description
- status
- members_count
- workload

Technician:
- id
- user_id
- display_name
- provider_type
- primary_organization_id
- teams
- status
- vetting_status
- skills
- service_area
- current_lat/current_lng
- location_updated_at
- is_available
- workload
- rating
- document_status
- direct_dispatch_allowed, membership-level future/planned

Job:
- id
- customer_id
- trust_state
- status
- console_status
- access_type
- situation
- urgency
- lat/lng
- address
- safety_flags
- provider_organization_id
- technician_id
- detail
- price_quote
- final_charge
- created_at
- updated_at

Dispatch offer:
- id
- job_id
- target_type, future/planned: technician, organization, team
- technician_id
- organization_id
- team_id
- status
- rank
- offered_at
- expires_at
- responded_at
- response_reason

Event:
- id
- job_id
- actor_user_id
- actor_scope
- event
- trust_state
- reason
- metadata
- at

---

## 11. API Surface for Future Implementation

Suggested endpoints for the post-extraction `cluexp-api` shape. These are aspirational interface targets and should not be treated as today's ticket-centric intake API.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Dispatcher/admin login |
| `GET` | `/me` | Current actor, role, permissions, workspaces |
| `GET` | `/workspaces` | ClueXP/org scopes available to the user |
| `GET` | `/dispatch/jobs` | Live queue |
| `GET` | `/dispatch/jobs/{id}` | Job detail |
| `POST` | `/dispatch/jobs/{id}/route-organization` | Route job to organization |
| `POST` | `/dispatch/jobs/{id}/accept-organization` | Organization accepts routed job |
| `POST` | `/dispatch/jobs/{id}/decline-organization` | Organization declines routed job |
| `GET` | `/dispatch/jobs/{id}/eligible-technicians` | Technician candidates |
| `POST` | `/dispatch/jobs/{id}/assign-technician` | Assign technician |
| `POST` | `/dispatch/offers` | Create offer |
| `POST` | `/dispatch/offers/{id}/accept` | Accept offer, backend first-accept-wins |
| `POST` | `/dispatch/offers/{id}/decline` | Decline offer |
| `POST` | `/dispatch/jobs/{id}/reassign` | Reassignment flow |
| `POST` | `/dispatch/jobs/{id}/escalate` | Escalate job |
| `GET` | `/dispatch/jobs/{id}/events` | Audit timeline |
| `POST` | `/dispatch/jobs/{id}/notes` | Internal note |
| `GET` | `/organizations/{id}/teams` | Organization teams |
| `GET` | `/organizations/{id}/technicians` | Organization technicians |
| `GET` | `/technicians/{id}` | Technician profile |
| `GET` | `/documents` | Compliance documents by scope |

---

## 12. UI Style Direction

Tone:
- Industrial operations.
- Calm under pressure.
- Dense but readable.
- Factual, not dramatic.

Layout:
- Desktop-first console.
- Table/queue plus detail split view.
- Persistent filters.
- Map panel available but not dominant on every screen.
- Active job drawer/panel for fast action.

Visual qualities:
- High contrast.
- Clear warning hierarchy.
- Compact rows.
- Status chips.
- No decorative dashboards.
- No marketing-style hero sections.
- No fake live movement.

Accessibility:
- Keyboard navigation for queues.
- Strong focus states.
- Color plus text/icon for statuses.
- Large enough touch targets for tablet use.
- Reduced-motion support.

---

## 13. Demo Dataset

### Job A — ClueXP to Individual

- Access type: Car
- Situation: Locked out
- Area: Downtown garage
- Trust-state: INTAKE
- Dispatch owner: ClueXP
- Candidate: Jordan Lee, individual technician
- Risk: none
- Status: awaiting technician offer

### Job B — Organization Managed

- Access type: Home
- Situation: Locked out
- Area: North Hills
- Dispatch owner: Metro Key Partners
- Organization team: Home Team
- Candidate technicians: Samir Patel, Lina Gomez
- Risk: customer alone at night
- Status: awaiting organization assignment

### Job C — Escalation

- Access type: Business
- Situation: Broken key
- Area: Strip mall
- Dispatch owner: ClueXP
- Assigned technician: Morgan Vale
- Issue: GPS stale for 18 minutes
- Status: escalated

---

## 14. Out of Scope for First UI Prototype

- Real auth implementation.
- Real dispatch algorithm.
- Real push/websocket offer delivery.
- Real payment/settlement reporting.
- Full compliance review workflow.
- Real map routing.
- Native notification delivery.
- Advanced org subscription billing.

The UI should still represent these states where they affect dispatcher decisions.

---

## 15. Definition of Done for UI Prototype

- Organization mode and ClueXP mode are visibly distinct.
- Live Queue, Job Detail, Technician Assignment, Dispatch Board, Map, Escalation, Documents, and Audit Log are represented.
- Organization-managed flow shows route-to-org, org accept, technician assignment, and customer `MATCHED` only after technician assignment.
- ClueXP flow shows individual technician dispatch.
- Direct-release affiliated technician state is represented as future/planned or policy-gated.
- Ineligible technician/organization blockers are visible.
- First-accept-wins is described as backend-enforced.
- Offer timers use backend `expires_at` in the spec/prototype data.
- Internal notes are visually separate from customer/technician messages.
- No screen implies organization acceptance alone is customer-visible matching.

---

## 16. Builder Notes

If another model builds the UI:
- Build desktop-first, then tablet-responsive.
- Start with Live Queue, Job Detail, Technician Assignment, Dispatch Board, and Escalation Queue.
- Use local mock data first.
- Keep this console separate from the Technician Mobile App and customer intake flow.
- Do not implement production API calls until the backend contract is scheduled.
- Treat this document as the UI flow contract for organization and ClueXP dispatch console design.

---

## 17. AI Design Prompt

Use this prompt when sending the spec to Google Stitch or another UI design model:

```text
Design a desktop-first dispatch operations console for ClueXP using the specification below.

Create high-fidelity UI screens and screen flows, not marketing pages.

Prioritize these screens:
1. Live Queue
2. Job Detail
3. Technician Assignment
4. Route to Organization
5. Organization Job Intake
6. Dispatch Board
7. Map Operations
8. Escalation Queue
9. Documents / Compliance
10. Audit Log

The console has two modes:
- Organization Mode: provider organization assigns its own affiliated technicians.
- ClueXP Mode: ClueXP dispatches individual technicians, routes jobs to organizations, and handles escalations.

Style: dense operations console, industrial, high contrast, fast to scan, no decorative SaaS dashboard, no landing page.

Critical rules:
- Organization acceptance alone does not make the customer MATCHED.
- Customer MATCHED requires a named verified technician assignment.
- Offer timers must use backend expires_at.
- First-accept-wins must be backend-enforced.
- Internal notes must be visually separate from customer/technician messages.

Use the full spec below as the source of truth.
[paste ORGANIZATION-DISPATCH-CONSOLE-SPEC.md here]

```
