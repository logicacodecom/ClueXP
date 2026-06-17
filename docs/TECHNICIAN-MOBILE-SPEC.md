# ClueXP Technician Mobile App — UI + Flow Specification

> **Status:** Product/UI specification for a mobile Technician App.
> **Audience:** UI builder, designer, or another coding model.
> **Important:** This is a mobile app specification, not an implementation task. Build screens and flows from this document; do not assume database or API contracts beyond what is stated here.
> **Current progress:** see `docs/TECHNICIAN-APP-PROGRESS.md` for what the
> PWA has already implemented and the next development slices.

---

## 1. Product Purpose

The Technician App is the field-work companion for ClueXP technicians. It helps a technician stay available, receive dispatch offers, accept or auto-accept jobs, navigate to the customer, communicate safely, prove arrival, complete the job, and maintain compliance documents.

The experience must feel operational, urgent when needed, and calm during execution. This is not a marketing app. It is a work tool used in cars, parking lots, customer doorways, and noisy emergency situations.

---

## 2. Primary Users

### 2.1 Individual Technician

A solo technician vetted by ClueXP and dispatched directly by ClueXP.

Key needs:
- Go online/offline.
- Receive ClueXP dispatch offers.
- Accept manually or enable auto-accept.
- Share live GPS location while working.
- Chat/call customer or dispatcher.
- Complete jobs and view job history.
- Maintain technician documents.

### 2.2 Affiliated Technician

A technician attached to an organization/company/group provider.

Key needs:
- See jobs assigned by their organization.
- Receive organization-managed assignments by default.
- Receive direct ClueXP dispatch only when the organization releases that technician for direct dispatch, per `SPEC.md` §2.10.
- Belong to one or many teams such as car lockout, home team, key team, night shift, region team.
- Share live GPS location with the organization and, when on an active job, the customer-facing tracking flow.

Model note:
- Technician identity is global. Company/provider membership is represented by
  affiliation records, not by changing the technician into a company-owned
  identity. Affiliations keep history, so a technician can leave, rejoin, or
  belong to multiple providers over time according to the workforce model.

### 2.3 Organization Dispatcher / Manager

Not part of this Technician App build, but the Technician App must be compatible with the organization-managed dispatch direction in `SPEC.md` §2.10.

Organization-managed dispatch behavior:
- Organization receives a job.
- Organization assigns one of its own technicians.
- Customer only sees a named verified technician after assignment.
- A specific affiliated technician may be released for direct ClueXP dispatch through the membership-level permission, not by changing the technician's global provider type.

---

## 3. Core Product Principles

1. **Field-first:** Every primary action must be thumb-friendly, readable outdoors, and usable under stress.
2. **Honest status:** Do not show fake customer data, fake ETA, fake route, or fake acceptance.
3. **Fast job response:** Incoming jobs must be impossible to miss when the app is active.
4. **Technician control:** Manual accept is default; auto-accept is opt-in and clearly visible.
5. **Location transparency:** The app shows whether GPS is active, stale, blocked, or low accuracy.
6. **Customer privacy:** The technician sees only the customer information required for the job.
7. **Compliance-aware:** Expired or missing required documents can block availability or dispatch.
8. **Organization-ready:** The app must distinguish ClueXP-dispatched jobs from organization-assigned jobs.

---

## 4. Mobile Technical Assumptions

Design as a native mobile app flow for iOS/Android.

For a demo build, this may be implemented as a PWA or mobile web prototype, but the UI should behave like a mobile app.

Important technical notes:
- Continuous background GPS requires native app permissions and OS background-location handling. A PWA can track reliably only while open or installed with platform limits.
- Alarm sound cannot autoplay in most browsers until the user enables sound or interacts with the app.
- Internet voice call requires a real-time provider later, such as WebRTC infrastructure, Twilio, Daily, Agora, or similar.
- Push notifications require native/APNs/FCM or web push setup.
- Production job offers require a server-to-device delivery strategy and backend concurrency control. A prototype may poll or simulate offers, but expiry countdowns and "another technician accepted first" must ultimately be backed by durable offer state and atomic accept semantics.

The UI should include states for these capabilities, even if a demo uses mocked behavior.

---

## 5. Information Architecture

Bottom navigation should have five main areas:

| Tab | Purpose |
|---|---|
| **Jobs** | Incoming offers, active job, assigned queue |
| **Map** | Current location, service area, active route |
| **Messages** | Customer, dispatcher, organization chats |
| **Activity** | Completed jobs, provisional earnings/settlement visibility, performance |
| **Profile** | Availability, auto-accept, teams, documents, settings |

When a job is active, the app should prioritize the active job screen over ordinary tabs. The active job may appear as a persistent top or bottom job bar across tabs.

---

## 6. Global App States

### 6.1 Availability

Technician availability states:
- `offline`
- `online`
- `busy`
- `break`
- `blocked_by_documents`
- `suspended`

UI rules:
- Offline technicians do not receive normal dispatch offers.
- Busy technicians may receive backup or queued offers only if policy allows.
- Blocked technicians see the reason and the document/action required.

### 6.2 GPS

GPS states:
- `tracking_active`
- `tracking_paused`
- `permission_needed`
- `low_accuracy`
- `stale_location`
- `background_limited`

UI rules:
- Location status is always visible on Jobs and Map.
- If GPS is required to go online, show the permission prompt before allowing online status.
- If location becomes stale during an active job, show a high-priority warning.

### 6.3 Sound / Alarm

Alarm states:
- `sound_enabled`
- `sound_muted`
- `permission_needed`
- `alarm_active`

UI rules:
- Show a clear "Enable alarm sound" setup action during onboarding or first login.
- Incoming job offer uses sound, vibration, and full-screen visual alert when possible.
- If sound is muted, the incoming job alert must still be visually strong.

---

## 7. Job Lifecycle

### 7.1 Job Sources

Jobs can come from:
- **ClueXP dispatch** — for individual technicians, and affiliated technicians whose organization has released them for direct ClueXP dispatch.
- **Organization dispatch** — for affiliated technicians assigned by their company/group.

Every job card must show the source:
- `ClueXP`
- `Organization`
- Organization name when applicable.

### 7.2 Job Statuses

Recommended technician-facing statuses:
- `offer_received`
- `accepted`
- `declined`
- `expired`
- `assigned`
- `en_route`
- `arrived`
- `verifying_arrival`
- `in_service`
- `customer_approval_needed`
- `completed`
- `cancelled`

State-machine boundary:
- Customer-facing `Ticket.trust_state` (`INTAKE`, `MATCHED`, `FULFILLMENT`) is separate from technician-facing job, offer, and route statuses.
- Technician actions such as accepting an offer, going en route, or marking arrived do not directly decide what the customer may see. The backend changes `trust_state` only when the customer visibility contract is satisfied.
- For organization-managed dispatch, organization acceptance is not customer `MATCHED`; `MATCHED` requires a specific verified technician assignment.
- Offer statuses such as `offer_received`, `accepted`, `expired`, and `declined` are dispatch/technician states, not replacements for `trust_state`.

### 7.3 Offer Rules

Manual accept:
- Incoming job opens a full-screen alert.
- Technician can Accept or Decline.
- Timer shows offer expiration.
- If expired, job disappears into history as missed/expired.
- Production timers must be derived from backend `expires_at`, not a local-only countdown.
- First-accept-wins must be enforced server-side, not by the mobile UI.

Auto-accept:
- Technician explicitly enables auto-accept.
- UI must show an always-visible auto-accept indicator.
- Incoming eligible job is accepted automatically after a brief visible countdown, unless technician cancels.
- Auto-accept must be disabled automatically when technician goes offline, document status blocks dispatch, or location permission is lost.

---

## 8. Screen List

### 8.1 Launch / Session Restore

Purpose:
- Restore active technician session.
- Detect active job.
- Check location and notification permissions.

Primary states:
- Signed out.
- Signed in, no active job.
- Signed in, active job.
- Session expired.

Main actions:
- Continue.
- Sign in.
- Reconnect.

---

### 8.2 Sign In

Purpose:
- Authenticate technician.

Fields:
- Phone or email.
- Password-based login backed by the platform `users` identity record, per `adr/0002-identity-and-clients.md`.

Rules:
- Do not show customer/job data before authentication.
- OTP is for customer light verification in the intake flow, not the default technician login method.
- If technician belongs to multiple organizations later, ask which workspace to enter after login.

---

### 8.3 Onboarding Permissions

Purpose:
- Prepare technician for field operations.

Steps:
- Location permission.
- Notification permission.
- Alarm sound test.
- Microphone permission only when voice calling is enabled.

Rules:
- Explain only what is necessary.
- Do not block app exploration unless a permission is required to go online.
- Make retry actions clear.

---

### 8.4 Jobs Home

Purpose:
- Main operational dashboard.

Content:
- Availability control.
- GPS status.
- Auto-accept toggle.
- Current shift/time online.
- Active job card if any.
- Incoming/queued jobs.
- Recent completed jobs.

Primary actions:
- Go Online / Go Offline.
- Enable Auto Accept.
- Start GPS Tracking.
- Open active job.

Design notes:
- This screen should be dense but calm.
- Availability and active job are more important than metrics.
- Avoid large marketing-style cards.

---

### 8.5 Incoming Job Alert

Purpose:
- Notify technician of a new job offer.

Presentation:
- Full-screen takeover when app is active.
- Strong visual alarm state.
- Sound/vibration if enabled.
- Large countdown timer.

Content:
- Job type: car/home/business/other.
- Situation: locked out, lost key, broken key, etc.
- General location area.
- Distance and estimated travel time if available.
- Price, earning, or settlement estimate only if policy allows and the backend provides it.
- Source: ClueXP or organization.
- Safety flags if any.

Primary actions:
- Accept.
- Decline.
- Call dispatcher, if available.

Auto-accept state:
- Show countdown: "Auto-accepting in 5..."
- Provide Cancel Auto Accept for this offer.

Rules:
- Do not expose sensitive customer details until accepted/assigned.
- If job has safety risk, visually highlight and allow handoff/dispatcher call.

---

### 8.6 Active Job Overview

Purpose:
- Single control center after a job is accepted.

Content:
- Job status.
- Customer first name or safe display name.
- Service type and situation.
- Address or navigation destination.
- ETA/route summary.
- Customer notes/photos if available and permitted.
- Required arrival verification instructions.
- Payment/estimate status if relevant.

Primary actions:
- Start Route.
- Message Customer.
- Call Customer.
- Call Dispatcher.
- Mark En Route.
- Mark Arrived.

Rules:
- Address visibility follows backend policy.
- Customer contact actions should be mediated through ClueXP numbers or in-app communication when possible.

---

### 8.7 Navigation / Map

Purpose:
- Show technician current location and destination.

Content:
- Current GPS dot.
- Destination marker.
- Route line.
- ETA.
- Location accuracy.
- Last GPS update timestamp.

Primary actions:
- Open in Maps.
- Refresh location.
- Share status.
- Return to active job.

Rules:
- If no real map integration is available in demo, use a realistic map placeholder and clearly separate it from production route behavior.
- No decorative fake live movement.

---

### 8.8 Customer Chat

Purpose:
- Text communication between technician and customer.

Content:
- Conversation thread.
- Delivery/read status if available.
- Quick replies.
- Attachment/photo support later.

Recommended quick replies:
- "I am on my way."
- "I arrived."
- "Please send a landmark."
- "I need 5 more minutes."
- "Please keep your ID ready."

Rules:
- Chat should keep technician phone number private.
- Chat should also keep the customer's real phone number private. ClueXP is the
  communication layer; messages are tied to the job, not to direct personal
  contact.
- MVP masked job chat should be available only after assignment/acceptance and
  should be visible to the assigned technician and the customer tracking token
  holder.
- Store chat messages against the job with sender role, sender id where
  available, body, timestamps, and moderation/audit hooks for dispute or unsafe
  situations.
- The thread should become read-only or closed when the job reaches a terminal
  state unless a dispute/recovery workflow explicitly keeps it open.
- Unsafe or dispute messages should allow dispatcher escalation.

---

### 8.9 Voice / Call

Purpose:
- Internet voice call or masked phone call.

States:
- Call unavailable.
- Connecting.
- Connected.
- Muted.
- Speaker on.
- Failed.

Primary actions:
- Start Call.
- Mute.
- Speaker.
- End Call.
- Fall back to dispatcher.

Rules:
- For demo UI, show "voice channel" as a stateful control.
- Production should use WebRTC or a telephony provider.
- The UI must not imply emergency services or law enforcement.

---

### 8.10 Arrival Verification

Purpose:
- Confirm the correct technician and customer have met.

Possible flows:
- Customer shows PIN; technician enters it.
- Technician shows QR; customer scans it.
- Technician confirms ID checked where required.

Content:
- Customer verification prompt.
- Technician identity confirmation.
- PIN/QR entry.
- Safety escalation action.

Primary actions:
- Verify Arrival.
- Cannot Verify.
- Call Dispatcher.

Rules:
- Arrival verification must be mutual, not only technician-controlled.
- Failed verification should not be hidden; route to dispatcher.

---

### 8.11 In-Service

Purpose:
- Track job progress after arrival.

Content:
- Service timer.
- Job checklist by service type.
- Notes.
- Photos if needed.
- Estimate/final price state.

Primary actions:
- Add Note.
- Add Photo.
- Request Customer Approval, if price changes.
- Complete Job.

---

### 8.12 Customer Approval Needed

Purpose:
- Handle final price or scope changes.

Content:
- Original estimate.
- Updated final amount or reason for change.
- Customer approval status.

Technician actions:
- Send Approval Request.
- Wait for Customer.
- Call Dispatcher.

Rules:
- Technician cannot complete charge flow if customer approval is required and not granted.
- Keep wording factual, not sales-like.

---

### 8.13 Complete Job

Purpose:
- Finish service.

Content:
- Final status.
- Final amount if applicable.
- Job notes.
- Customer signature/approval state if used.
- Photo/document capture if required.

Primary actions:
- Complete.
- Save Draft.
- Call Dispatcher.

Rules:
- Completion must sync to backend.
- Offline completion and conflict resolution are deferred policy/product decisions; do not imply offline completion is supported until designed.

---

### 8.14 Job History

Purpose:
- View past jobs.

Content:
- Completed jobs.
- Cancelled jobs.
- Missed/expired offers.
- Earnings or settlement reference per job only if the payout model provides it.
- Filters by date/status/source.

Primary actions:
- Open job detail.
- Report issue.

---

### 8.15 Activity / Earnings

Purpose:
- Technician activity, performance, and payout/settlement visibility where supported.

Content:
- Today completed jobs.
- Week completed jobs.
- Provisional earnings where the technician is paid directly.
- Organization settlement visibility where the organization is paid first.
- Completed job count.
- Adjustments/disputes if any.

Rules:
- The payout/commission model is undecided, especially for organization-managed jobs.
- If payout system is not live, show activity metrics only or hide financial totals until available.

---

### 8.16 Profile

Purpose:
- Technician identity and settings.

Content:
- Name/photo.
- Global technician profile details.
- Provider/company affiliations if any, including active, pending, suspended,
  ended, or historical membership.
- Team membership if any.
- Skills/service types.
- Service area.
- Rating/performance.
- App settings.

Primary actions:
- Edit profile.
- Update skills.
- Manage service area.
- Sign out.

---

### 8.17 Documents / Compliance

Purpose:
- Keep technician eligible for dispatch.

Content:
- Document list.
- Status: missing, pending review, approved, rejected, expired.
- Expiration date.
- Required vs optional.

Example technician documents:
- Locksmith license.
- Work authorization.
- Driver license.
- Vehicle registration.
- Insurance.
- Certifications.

Primary actions:
- Upload Document.
- Replace Document.
- View Rejection Reason.

Rules:
- Expired required documents can block going online or receiving dispatch.
- Organization documents are managed by organization admins, not ordinary technicians unless permission allows.

---

### 8.18 Team / Organization View

Purpose:
- Show affiliated technician’s organization context.

Content:
- Organization name.
- Teams assigned.
- Team descriptions.
- Organization dispatcher contact.
- Dispatch source rules.

Rules:
- Teams are virtual business groups, not legal entities.
- A technician can belong to multiple teams.
- Recursive team structure may be shown as grouped labels or a simple hierarchy.

---

### 8.19 Settings

Purpose:
- Operational preferences.

Settings:
- Auto-accept on/off.
- Auto-accept conditions later: distance, service type, minimum payout, source.
- Alarm sound.
- Vibration.
- Push notifications.
- Location tracking.
- Map app preference.
- Language later.

Rules:
- Auto-accept must never be hidden.
- Risky settings should require confirmation.

---

## 9. Critical Flows

### 9.1 Go Online

1. Technician opens Jobs Home.
2. App checks authentication.
3. App checks required documents.
4. App checks GPS permission.
5. App checks notification/alarm setup.
6. Technician taps Go Online.
7. Status changes to Online.
8. Technician begins receiving eligible job offers.

Failure states:
- Missing document.
- Expired document.
- GPS blocked.
- Account suspended.
- No service area.

---

### 9.2 Manual Job Accept

1. Incoming offer arrives.
2. Full-screen alert opens.
3. Alarm sound/vibration starts if enabled.
4. Technician reviews summary.
5. Technician taps Accept.
6. Backend confirms assignment.
7. Alarm stops.
8. App opens Active Job Overview.

Failure states:
- Offer expired.
- Another technician accepted first.
- Technician went offline.
- Location stale.

---

### 9.3 Auto-Accept Job

1. Technician enables Auto Accept.
2. Eligible offer arrives.
3. App shows countdown.
4. Technician may cancel this auto-accept.
5. If not cancelled, app accepts job.
6. App opens Active Job Overview.

Rules:
- Auto-accept eligibility must be backend-driven later.
- Show source and reason if an offer was auto-accepted.
- Auto-accept should not accept unsafe or exceptional jobs without policy approval.

---

### 9.4 En Route to Arrival

1. Technician taps Start Route or Mark En Route.
2. GPS location updates begin/continue.
3. Customer tracking can show technician only after backend permits fulfillment state.
4. Technician arrives.
5. Technician taps Mark Arrived.
6. App opens Arrival Verification.

Failure states:
- GPS lost.
- Customer cancels.
- Technician needs dispatcher help.

---

### 9.5 Chat / Call

1. Technician opens customer communication.
2. Technician sends chat or starts call.
3. Messages/call are logged against job.
4. Unsafe/disputed conversation can escalate to dispatcher.

Rules:
- Prefer masked or in-app communication.
- Preserve audit events for important actions.

---

### 9.6 Complete Job

1. Technician starts service.
2. Technician adds notes/photos if needed.
3. Technician requests customer approval if scope/final price changed.
4. Technician taps Complete.
5. Backend confirms job completion.
6. App returns to Jobs Home.

Failure states:
- Customer approval pending.
- Network offline.
- Required completion field missing.
- Dispatcher review required.

---

## 10. Notifications and Alerts

Alert types:
- Incoming job offer.
- Auto-accepted job.
- Offer expiring soon.
- Customer message.
- Dispatcher message.
- GPS stale.
- Required document expiring.
- Job cancelled.
- Customer approval received.

Priority:
- Critical: incoming offer, active job cancellation, GPS lost during active job.
- High: customer/dispatcher message, approval needed.
- Medium: document expiry, payout update.

Visual pattern:
- Critical alerts can take over the screen.
- High alerts appear as banners or active-job notices.
- Medium alerts appear in inbox/profile.

---

## 11. Data Needed by UI

Identity:
- user_id from the platform `users` table, used for login/session identity per ADR-0002.
- role/status from the authenticated actor context.

Technician:
- id
- user_id
- display_name
- photo_url
- photo_status: none, pending, approved, rejected
- phone/email
- status
- skills/service_types
- service_area
- rating
- current_lat/current_lng
- last_location_at

Affiliation:
- id
- technician_id
- organization_id
- organization_name
- status: pending_invite, active, suspended, ended, declined
- affiliation_type: w2_employee, contractor, individual_marketplace
- exclusivity: exclusive, non_exclusive
- dispatch_allowed
- starts_at / ended_at where applicable
- invited_at / accepted_at / declined_at where applicable

Organization:
- id
- name
- description/note
- dispatch_mode later

Team:
- id
- name
- description
- parent_team_id

Job:
- id
- source: cluexp or organization
- organization_id if applicable
- access_type
- situation
- status
- customer_display_name
- masked_customer_contact
- address/destination
- lat/lng
- distance
- eta
- price, earnings, or settlement estimate if available
- safety_flags
- notes
- photos
- timestamps

Offer:
- id
- job_id
- expires_at
- offered_at
- auto_accept_eligible
- source
- status

Message:
- id
- job_id
- sender_type
- body
- attachments
- created_at
- delivery_status

Document:
- id
- owner_type: technician or organization
- type
- status
- expiration_date
- rejection_reason
- uploaded_at

---

## 12. API Surface for Future Implementation

Suggested mobile endpoints for the post-extraction `cluexp-api` shape. These are aspirational interface targets for the Technician App and should not be treated as today's ticket-centric intake API.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Technician login |
| `GET` | `/me` | Current technician profile |
| `PATCH` | `/me/availability` | Online/offline/break |
| `POST` | `/me/location` | Location ping |
| `GET` | `/me/offers` | Current offers |
| `POST` | `/offers/{id}/accept` | Accept offer |
| `POST` | `/offers/{id}/decline` | Decline offer |
| `PATCH` | `/me/auto-accept` | Toggle auto-accept |
| `GET` | `/jobs/active` | Active assigned job |
| `PATCH` | `/jobs/{id}/status` | en route/arrived/in service/completed |
| `GET` | `/jobs/{id}/messages` | Message thread |
| `POST` | `/jobs/{id}/messages` | Send message |
| `POST` | `/jobs/{id}/arrival-verification` | Verify arrival |
| `POST` | `/jobs/{id}/completion` | Complete job |
| `GET` | `/documents` | Technician documents |
| `POST` | `/documents/upload-intent` | Signed upload |
| `POST` | `/documents/{id}/replace` | Replace document |

---

## 13. UI Style Direction

> **Design system:** inherit `docs/DESIGN-SYSTEM.md` — the shared ClueXP visual language
> (dark `#0e0e0e`, amber primary `#ffbf00`, blue secondary `#2563eb`, condensed heavy type
> (Archivo Narrow), 4px corners, faint amber grid, semantic status chips text+color). Use
> the **technician/mobile variant** per design-system §7 (field-readable, larger hit areas,
> bottom nav; full-screen offer alert is the one place strong alarm color is allowed). Same
> tokens as customer intake and the dispatch consoles.

Tone:
- Industrial, direct, reliable.
- Alerting without panic.
- Built for repeated field use.

Visual qualities:
- High contrast.
- Large action buttons.
- Compact status panels.
- Strong alarm treatment only for incoming jobs and urgent warnings.
- Minimal decoration.
- No marketing hero sections.

Recommended mobile layout:
- Sticky status header with availability, GPS, and active job state.
- Bottom navigation.
- Full-screen incoming offer alert.
- Persistent active-job bar once assigned.

Color guidance:
- Neutral dark or high-contrast light mode can work.
- Use amber/red only for real alert states.
- Use green for online/ready.
- Use blue for route/navigation.
- Avoid a single-hue dashboard.

Accessibility:
- Minimum 44px touch targets.
- Support large text without clipping.
- Alarm states must not rely on color alone.
- Provide reduced-motion behavior.
- Provide silent/vibration alternatives.

---

## 14. Demo Dataset

Use these sample cases for UI prototyping:

### Job A — Car Lockout

- Source: ClueXP
- Access type: Car
- Situation: Locked out
- Area: Downtown garage
- Distance: 2.4 mi
- ETA: 9 min
- Safety: none
- Customer note: "Silver sedan, level 3 near elevator."

### Job B — Home Lockout

- Source: Organization
- Organization: Metro Key Partners
- Team: Home Team
- Situation: Locked out
- Area: North Hills
- Distance: 5.8 mi
- ETA: 18 min
- Safety: customer alone at night
- Customer note: "Back porch light is on."

### Job C — Key Broken

- Source: ClueXP
- Access type: Business
- Situation: Broken key
- Area: Strip mall
- Distance: 3.1 mi
- ETA: 12 min
- Safety: none
- Customer note: "Front door cylinder."

---

## 15. Out of Scope for First UI Prototype

- Real dispatch algorithm.
- Real native background GPS.
- Real WebRTC/voice provider.
- Real payment/payout engine.
- Full organization dispatcher console.
- Full document review admin workflow.
- Multi-language support.

The UI should still contain believable placeholders/states for these where they affect technician flow.

---

## 16. Definition of Done for UI Prototype

- All core screens in §8 are represented, at least as navigable prototypes.
- Manual accept flow works end-to-end with demo data.
- Auto-accept flow is visible and testable.
- Incoming job alert includes visual + sound-ready states.
- GPS states are represented.
- Active job flow reaches arrival verification and completion.
- Chat UI exists with quick replies.
- Voice/call UI exists as a stateful placeholder.
- Individual vs affiliated technician context is visible.
- Organization/team context is visible for affiliated technician.
- Documents/compliance blocking state is visible.
- No customer trust-state violation: do not expose sensitive job/customer data before acceptance or assignment.

---

## 17. Builder Notes

If another model builds the UI:
- Build mobile-first.
- Start with Jobs Home, Incoming Job Alert, Active Job Overview, Chat, Map, Profile/Documents.
- Use explicit placeholders only for not-yet-live slices. Do not replace live
  BFF-backed screens with local mock data.
- Keep all technician app screens separate from the customer intake flow.
- Do not implement production API calls until the backend contract is scheduled.
- Treat this document as the UI flow contract.

---

## 18. AI Design Prompt

Use this prompt when sending the spec to Google Stitch or another UI design model:

```text
Design a mobile-first field-work app for ClueXP technicians using the specification below.

Create high-fidelity mobile UI screens and flows, not marketing pages.

Prioritize these screens:
1. Jobs Home (availability, GPS status, auto-accept, active job card)
2. Incoming Job Alert (full-screen takeover, countdown, accept/decline)
3. Active Job Overview (status, customer, route, actions)
4. Navigation / Map
5. Customer Chat (with quick replies)
6. Arrival Verification (mutual PIN/QR)
7. In-Service + Complete Job
8. Profile / Documents (compliance, blocking states)
9. Team / Organization view (affiliated technician)

Two technician types:
- Individual: dispatched by ClueXP.
- Affiliated: organization-managed by default; direct ClueXP dispatch only when the
  organization releases that technician (SPEC.md §2.10).

Style: use the ClueXP design system in docs/DESIGN-SYSTEM.md — dark near-black #0e0e0e,
amber primary #ffbf00, blue secondary #2563eb, condensed heavy type (Archivo Narrow),
4px corners, faint amber grid, semantic status chips (text+color, never color alone).
Use the technician/mobile variant: field-readable, large hit areas, bottom nav, persistent
active-job bar. Strong alarm color (amber→red) ONLY on the incoming-offer alert and urgent
warnings. Industrial operations tool, not a marketing app. Same visual language as the
customer intake app and the dispatch consoles.

Critical rules:
- Do not show customer/job data before acceptance or assignment.
- Technician statuses are separate from customer trust_state; accepting an offer does not
  by itself make the customer MATCHED.
- Offer timers must use backend expires_at; first-accept-wins is backend-enforced.
- No fake ETA, route, movement, or acceptance.

Use the full spec below as the source of truth.
[paste TECHNICIAN-MOBILE-SPEC.md here]
```
