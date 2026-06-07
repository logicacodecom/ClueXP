# ClueXP Emergency Access — Build Specification

> **Status:** Source of truth for the initial build.
> **Audience:** Claude Code / Codex (or a senior developer).
> **Companion files:**
> - `schema.py` — canonical data contract (Pydantic). **Do not duplicate or paraphrase; import and use it.**
> - Stitch HTML files + PNG screens — **visual reference only.** See [§ Stitch files: how to use them](#stitch-files-how-to-use-them).

---

## 1. What we're building

ClueXP Emergency Access is a mobile-web-first dispatch service for emergency physical access (locksmith and beyond). It takes a panicked user from "I'm locked out" to "a verified technician arrived and the job is done" via a structured, trust-preserving flow.

**This build:** a Next.js + TypeScript front end + a minimal FastAPI + Pydantic back end with **stub** dispatch / pricing / payment / OTP services. Real vendors get wired in later; the goal of this build is a working end-to-end system whose contract between layers is honest and stable.

### Current sprint scope: live intake → matched technician

The current sprint deploys the intake system online using **Vercel** for the Next.js frontend plus FastAPI Python runtime, and **Supabase Postgres** for ticket persistence.

**In scope:** the full INTAKE collection flow, backend-supplied price estimate + commercial price acceptance, `commit`, technician **dispatch**, and the MATCHED screen (technician name, role, rating, ETA). The FULFILLMENT screens (live tracking, arrival verification, payment/review) remain wired and reachable for demo, sourced only from backend values via the trust-state guards.

**Deferred this sprint:** OTP verification (§7.12) and payment-method capture (§7.10). Because payment-on-file is skipped, `commit` and `Ticket.is_dispatchable()` temporarily **drop the payment-method precondition** — price acceptance remains the commercial consent gate. ⚠️ This means a technician is matched without a payment method on file; restore the payment precondition before any real launch.

**Persistence:** tickets and state-transition events persist in **Supabase Postgres** (see §6.1), not in-process memory. A `DATABASE_URL` enables the Postgres store; with it unset the API falls back to an in-memory store for local development.

The trust-state contract is unchanged: technician name, role, rating, and ETA appear **only** at `trust_state = MATCHED` or later, gated by `may_show_technician()` / `may_show_eta()`. Live tracking appears only at FULFILLMENT. Nothing operational is shown during INTAKE.

This addendum narrows the implementation scope for the sprint (OTP + payment deferred); it does not remove the full build requirements below.

---

## 2. Non-negotiable architectural principles

These are the principles the entire system enforces. Every implementation decision should be checked against them.

### 2.1 Trust-state system

The UI operates in one of three states, defined on the Ticket (`trust_state` field):

| State | Meaning | What the UI may render |
|---|---|---|
| `INTAKE` | Gathering info + commercial consent. No technician committed. | Form fields, the user's own inputs, backend-supplied price estimates. **No technician data, no ETAs, no live tracking.** |
| `MATCHED` | Backend has assigned a verified technician. | All of the above, plus technician name/photo, rating, real ETA. **No live tracking yet.** |
| `FULFILLMENT` | Real operational data flows live. | All of the above, plus live map, arrival verification, final price. |

The Ticket model exposes guard methods (`may_show_technician()`, `may_show_eta()`, `may_show_live_tracking()`) — **the UI must call these instead of deciding for itself.**

### 2.2 The UI never makes promises the backend hasn't committed to

No fabricated ETAs. No invented technician names. No fake "matching..." animations. No fake map movement. If a value isn't yet returned by the backend, the UI does not display it — period.

This is the single most important rule. In a scam-heavy category, fake certainty destroys trust. Accuracy and restraint are the brand.

### 2.3 Backend-driven dynamic values

These are **always** sourced from the backend, never hardcoded in the UI:
ETAs, technician names/photos, ratings, maps, addresses, prices, fees, vehicle info, live tracking states, cancellation fee amounts.

### 2.4 Animation discipline

Animate only what represents a real operation in progress. Genuine parsing indicator while parsing is happening — yes. Live tracking marker once tracking is real — yes. Ambient pulses, decorative shimmer, fake "locating..." loops — **no**. They drain battery, add visual noise, and imply activity that isn't happening.

### 2.5 Mobile-web first, no forced install

Primary channel is mobile web / PWA. **Never** force an app install — no interstitials, no "open in app" banners, no "download for full experience." An optional "Add to Home Screen" hint is allowed **only** on the post-service screen. Do not depend on push notifications for anything critical; reinforce "keep this page open" where live updates matter.

### 2.6 The human-fallback escape hatch

A full-width "Call a person instead" button is present in the footer of **every** screen — same label, same position, same size. The human-handoff screen is framed as an **upgrade** ("connecting you to a person who can help faster"), never as an error or failure.

### 2.7 The agent does not match technicians

The intake graph collects information and produces a structured Ticket. Technician matching, equipment selection, and pricing live in **deterministic engines outside** the intake graph. This separation is what keeps the bulletproof part bulletproof.

### 2.8 Technicians can be individual or affiliated

The supply side supports two provider paths:

- **Individual technician** — a solo operator vetted and dispatched directly by
  ClueXP.
- **Affiliated technician** — a technician attached to a company/group provider
  organization. The customer still sees the assigned verified person, while the
  backend records the provider organization for business reporting, permissions,
  subscription, billing, and future tenant controls.

Provider organizations can register themselves and manage affiliated technicians
without changing the customer intake flow. Each provider organization may also
define recursive teams — departments, groups, business units, branches, regions,
or specialty crews — and each team has its own description. An affiliated
technician can belong to one or many teams.

Teams are virtual operating groups only. Legal/compliance documents attach to
the organization or the technician, not to the team. Organization documents may
include business registration, business license, insurance, or similar company
credentials. Technician documents may include license ID, work authorization,
driver license, certifications, or vehicle registration. Each document carries a
status and optional expiration date so dispatch can later require valid,
non-expired credentials before matching.

Dispatch always assigns a technician; when that technician is affiliated, the
job also carries the organization that owns the fulfillment. Team membership is
available to dispatch and reporting, but the customer-facing trust-state
contract stays centered on the assigned verified person.

### 2.9 Actors, identity, and customer data

**Actors.** The customer is **anonymous** — no account, no forced install (§2.5);
they are recognized by **phone number** as a soft identity anchor. Everyone else
(technician, provider-org admin, ClueXP staff/admin) is a **logged-in user**.
Production identity uses ClueXP's FastAPI/Postgres authentication for logged-in
actors (sessions, users, organization memberships, and roles; see the
2026-06-06 amendment to `adr/0002-identity-and-clients.md`). FastAPI-issued JWTs
are bridged by the web apps through same-site httpOnly cookies. Technicians,
provider memberships, compliance, dispatch permissions, jobs, and reviews remain
ClueXP-owned data.

**Where customer data and job history live.** All of it is in the platform
Postgres (schema detail in `docs/DATABASE-AND-STORAGE.md`):
- a **customer** is a `customers` row keyed by phone;
- each request is a **`jobs`** row (full intake payload in `jobs.detail`, key
  fields promoted to columns) linked by `customer_id`;
- **job history** = a customer's `jobs` ordered by `created_at`; the per-job
  timeline is the append-only `events` rows for that job;
- uploaded photos/IDs are files in private Storage, referenced by `media` rows.

**Enabler:** linking a job to a returning customer requires intake to **capture
the phone** so the `customers` upsert fires (today the `Ticket` has no phone
field, so jobs can land unlinked). Phone arrives naturally with OTP (§7.12), but
history needs it sooner — see the execution plan.

### 2.10 Dispatch authority & tenancy (see `adr/0004`)

> ClueXP is a **neutral dispatch network**, not a fulfillment provider — it routes
> demand to verified providers/technicians and never competes as a service company.
> The full tenancy/intake model is **`adr/0004-tenancy-and-intake.md`**; this is the
> dispatch-authority summary. Sprint 2 builds the foundation, not the marketplace.

Every job tracks **three independent axes** — **origin** (who brought the demand),
**customer owner** (who owns the relationship; defaults to the origin owner), and
**fulfillment** (`fulfillment_org_id` *nullable* + `fulfillment_technician_id`). The
legacy single `dispatch_owner` field is **retired**.

Who *controls* routing is `dispatch_mode`:
- **`organization_managed`** — the provider org assigns from its own technicians, or
  overflows the job to the network. When an org overflows, **the org stays the owner**;
  the fulfilling technician only serves.
- **`cluexp_managed_routing`** — ClueXP **routes** the request to the best eligible
  provider org or **independent technician**. This is routing, **not** ClueXP
  fulfillment; an independent technician fulfills with `fulfillment_org_id` null.

Overflow is governed by `fulfillment_policy` (`private` | `network_overflow` |
`network_open`), set per org/channel; default **private**, cross-tenant exposure is
explicit/opt-in. A previously org-managed technician released for network routing is a
**membership flag** on `organization_technicians`, not a global technician property.

**Trust-state rule (non-negotiable):** an organization (or ClueXP) *accepting/routing*
a job does **not** flip `trust_state` to `matched`. The customer is only ever shown a
**named, verified person** (§2.2, §2.8), so `matched` fires only when a specific
`fulfillment_technician_id` is set; accept/route is an internal `events` milestone.

---

## 3. The data contract

**See `schema.py`.** It defines:

- `Ticket` — the single mutable state object. Every API endpoint reads and/or writes this.
- `TrustState`, `TicketStatus`, `Channel`, `AccessType`, `Situation`, `Urgency`, `KeyType`, `LockClass`, `SafetyType`, `AuthorityRole` — closed enums the graph routes on.
- Sub-objects: `SafetyFlag`, `Location`, `Automotive`, `Property`, `Identity`, `Photo`, `PaymentMethod`, `CancellationPolicy`, `PriceQuote`, `TechnicianAssignment`, `FinalCharge`.
- Guard helpers: `may_show_technician()`, `may_show_eta()`, `may_show_live_tracking()`, `is_dispatchable()`.

**For the front end:** generate TypeScript types from the Pydantic models (e.g. with `datamodel-code-generator` or `pydantic-to-typescript`). The TS types must derive from `schema.py`, not be hand-maintained. This guarantees frontend and backend share one contract.

**Do not** reinvent or paraphrase the schema in the front-end codebase. Import the generated types.

---

## 4. The flow (16 + 1 screens)

The flow is sequential through INTAKE, transitions to MATCHED when the backend returns an assignment, then proceeds through FULFILLMENT. The human-handoff screen is reachable from any screen.

Detailed per-screen specifications are in [§ 7. Screen-by-screen behavior](#7-screen-by-screen-behavior). At a glance:

**INTAKE (`trust_state = INTAKE`):**
1. Opener — Car / Home / Business / Something else
2. Situation — single-select chips (auto-advance)
3. Location + Safety — GPS share + safety question
4. Branch details — Car (make/model/year + key type) / Home / Business
5. NL parse state (optional) — if user typed free-form
6. Additional details (optional, skippable)
7. Photo upload (optional, skippable)
8. Identity confirm (light)
9. Price-range confirmation + cancellation policy (commercial consent)
10. Payment method on file (not charged)
11. Request confirmed / committing
12. OTP verification (parallel with matching, non-blocking)

**MATCHED (`trust_state = MATCHED`):**
13. Technician assigned

**FULFILLMENT (`trust_state = FULFILLMENT`):**
14. Live tracking
15. Arrival verification (mutual PIN / QR)
16. Payment / review (with side-by-side estimate vs. final)

**Always reachable:** Human-handoff screen.

### Non-negotiable ordering rules

- Price acceptance (consent) **before** any "confirmed" language.
- Cancellation policy lives **on** the price-confirmation screen (it is the cost commitment).
- Payment method is captured but **not charged** during intake.
- OTP runs **after** commitment, in parallel with matching — never a gate.
- Technician data (name, photo, ETA, live map) appears **only** at MATCHED or later.
- Final price exceeding the estimate range requires an **explicit customer approval tap** before any charge.

---

## 5. Frontend

### 5.1 Stack

- **Next.js 14+** with App Router, TypeScript. (Live app styles with CSS custom
  properties, not Tailwind — see `docs/DESIGN-SYSTEM.md`.)
- Use the ClueXP design language captured in **`docs/DESIGN-SYSTEM.md`** (extracted from
  the live intake app): dark/industrial-minimal, amber primary, condensed heavy type,
  4px corners. This is the shared visual system for all surfaces.
- State management: React context or Zustand for the active Ticket; persist to backend per step, not just at submit.
- TS types: auto-generated from `schema.py` (see § 3).

### 5.2 Component patterns (build these as reusable React components, not page-by-page HTML)

- `<ChipSelect>` — single- or multi-select chips with **auto-advance** on single-select tap.
- `<AgentMessage>` — the calm, large-type framing block at the top of intake screens.
- `<StepPipes>` — consistent intake progress indicator (fixed total across all intake screens; **not shown** during fulfillment).
- `<CallAPersonButton>` — the always-present fallback. Same label, position, size on every screen.
- `<TrustStateGate>` — wrapper that hides children when the Ticket's trust-state forbids them. Use this around any element that would otherwise show technician/ETA/tracking. **The Ticket guard methods are the gate's authority.**
- `<EstimateRangeAccept>` — the explicit price-acceptance UI (no auto-advance, no pre-check).
- `<EstimateVsFinal>` — the side-by-side comparison on the payment/review screen. Renders calmly when final ≤ max; renders an explicit-approval flow when final > max.

### 5.3 What to keep from Stitch vs. rebuild

| Keep | Rebuild |
|---|---|
| Color tokens, typography, spacing scale, icon set | All component logic |
| Visual rhythm: large agent message → controls → footer | Routing, state, persistence |
| Dark theme, amber primary, blue secondary | Animations (apply animation discipline § 2.4) |
| The chip-based intake aesthetic | Form validation (use the Pydantic schema via API errors) |
| The footer CTA pattern | The progress indicator (make it consistent across intake) |

### 5.4 Stitch output: known issues — DO NOT carry these into the build

The Stitch HTML/PNG files attached to this spec are the second-pass output. They are **stronger** than the first pass, but the following issues were identified in review and **must be corrected during implementation**. Do not import the HTML — rebuild with these fixes baked in from the start.

**Trust / tone issues:**

- **Tech-assigned screen leans theatrical.** The Stitch screen uses phrases like *"Rapid response protocols initiated,"* *"Cleared for high-security environments and sensitive technical recovery operations,"* *"Specialized in Complex Recovery."* This contradicts § 2 ("operationally honest, NOT alarmist, NOT artificially urgent"). Replace with neutral, factual copy: name, role ("Specialist"), rating, ETA, "en route to your address." Calmer rhythm than intake.
- **Handoff screen still has badge-styled identifier** ("Dispatcher #DX-9921") and a stock authority-figure photo. Use a plain name (e.g. "Sam Reyes"), role ("Dispatcher" or "Specialist"), and a neutral avatar. No badge number, no quasi-official styling.

**Consistency issues:**

- **Progress-bar step count varies across intake screens** (5 pipes vs. 6 pipes between screens). Fix: pick one count for all INTAKE screens and honor it everywhere. **Do not** show the progress bar on FULFILLMENT screens (calmer rhythm rule, § 2).
- **Header subtitle is inconsistent.** Opener has "EMERGENCY ACCESS" top-right; other screens have it as a subtitle under "ClueXP." Standardize: subtitle under wordmark on all screens.
- **Live-tracking screen has three different time/distance values on screen at once** ("ETA 14:22," "8 mins away," "Tracking Active"). Pick a single source of truth (the backend's `eta_minutes_min/max`) and render it in one place.

**Interaction issues:**

- **Situation screen (#2) uses chevrons next to each option,** which reads as "navigate to a sub-page," not "single-select chip that auto-advances." Rebuild as `<ChipSelect>` from § 5.2 — no chevrons, tap auto-advances.
- **OTP input uses filled dot characters** which can read as "already filled" to a stressed user. Use empty boxes that fill as the user types.
- **Price/policy screen has two separate consent gestures** — a "Legal Authority Confirmation" checkbox AND an "Accept & Request Tech" button. Fold the legal acknowledgement into the same accept tap (single deliberate consent), or move it earlier.
- **Photo screen primary button says "Continue to Dispatch,"** but this is not the last gate before dispatch (price, payment, commit are still ahead). Use "Continue" — don't promise dispatch from a mid-flow screen.

**Visual / data-honesty issues:**

- **Live-tracking map is a decorative dot grid,** not a map. Use a real map (Mapbox / Google Maps) for the FULFILLMENT screen; for the stub build, a static placeholder map image is fine **but** must look like a map, not an aesthetic background.

**The trust-state contract still wins.** Even where Stitch's screen is acceptable, if at any point an implementation choice would render technician data, ETA, or tracking during INTAKE, **do not implement it**. The `<TrustStateGate>` and Ticket guard methods (§ 5.2, § 3) are the authority — not the visual reference.

---

## 6. Backend

### 6.1 Stack

- **FastAPI** + Pydantic v2.
- The schema is `schema.py` — import and use directly (it is already Pydantic).
- Storage: **Supabase Postgres** for the live sprint. Each `Ticket` persists in
  `jobs.detail` as JSONB, with dispatch-critical values promoted onto relational
  columns (`trust_state`, `status`, `access_type`, `situation`, `urgency`,
  `lat`, `lng`, `address`, and provider/customer links). State transitions
  append to `events` with `job_id`. The API selects the store from
  `DATABASE_URL` (Postgres when set, in-memory fallback when unset for local
  dev). A read-only fallback can still fetch legacy `tickets` rows created
  before the Sprint 1 store migration.
- Use Pydantic models as both request/response schemas and storage objects — FastAPI handles serialization automatically.

### 6.2 Endpoints (stub services for now)

All endpoints operate on the `Ticket`. The exact request/response shapes are derived from the schema (FastAPI generates OpenAPI from the Pydantic models — the spec does not duplicate them here).

| Method | Path | Purpose | Trust-state effect |
|---|---|---|---|
| `POST` | `/tickets` | Create a draft ticket. Returns `ticket_id`. | INTAKE |
| `GET` | `/tickets/{id}` | Fetch current ticket. | (unchanged) |
| `PATCH` | `/tickets/{id}` | Partial update of any Ticket field captured by the UI step-by-step. Server validates against schema. | INTAKE |
| `POST` | `/tickets/{id}/price-quote` | **Stub** pricing engine returns an estimate range based on access_type + situation + location. | INTAKE |
| `POST` | `/tickets/{id}/payment-method` | Receive an opaque processor token. **Stub** payment service: validate format, do not charge. | INTAKE |
| `POST` | `/tickets/{id}/commit` | User completed consent + payment-on-file. Returns "committed." This is when "Request confirmed" becomes truthful. | INTAKE |
| `POST` | `/tickets/{id}/otp/send` | **Stub** SMS: log the OTP server-side; for dev, return it in the response. | INTAKE |
| `POST` | `/tickets/{id}/otp/verify` | User enters their own code. **Stub**: accept the code returned by `/send` for the same ticket. | INTAKE |
| `POST` | `/tickets/{id}/dispatch` | **Stub** dispatch engine: synchronously (for now) returns a fake `TechnicianAssignment`. Flips `trust_state` to `MATCHED`. | MATCHED |
| `GET` | `/tickets/{id}/tracking` | **Stub** live tracking: returns a moving lat/lng over time (interpolated). Polling for now (no WebSocket required). Flips `trust_state` to `FULFILLMENT` once tracking starts. | FULFILLMENT |
| `POST` | `/tickets/{id}/arrival-handshake` | Generate / verify mutual PIN or QR for arrival verification. | FULFILLMENT |
| `POST` | `/tickets/{id}/finalize` | **Stub**: backend supplies a final price. If it exceeds the estimate range, flag `customer_approval_required`. | FULFILLMENT |
| `POST` | `/tickets/{id}/approve-final` | Customer's explicit approval tap for an over-estimate final price. Only after this is `charge` allowed. | FULFILLMENT |
| `POST` | `/tickets/{id}/charge` | **Stub** payment capture. Refuses if approval was required and not given. | FULFILLMENT |
| `POST` | `/tickets/{id}/handoff` | Route to human dispatcher. Reasons: timeout, safety event, explicit user request, unresolvable input. Sets `status = FALLBACK_TO_HUMAN`. | (state preserved) |

### 6.3 Stub behavior rules

For every stub:
- Return realistic-looking data so the UI renders normally.
- **Never** return data the trust-state of the ticket does not yet permit. (The backend enforces the trust-state contract; it does not just trust the frontend not to ask.)
- Include latency simulation (200–800 ms) so the UI's loading states are exercised.
- Log every state transition for debugging.

### 6.4 What is NOT in this build

- Real Stripe / Adyen / payment processor integration.
- Real Twilio / SMS provider.
- Real Google Maps live tracking.
- Real LLM for the NL parse step (the screen exists; the parsing endpoint can return a hand-crafted extraction or a no-op).
- Authentication beyond phone-number OTP. (No accounts created on the user's behalf.)
- Multi-language support.
- Voice channel.

These are deferred. The system must be **architected so they slot in cleanly** behind the existing endpoints when they're added.

---

## 7. Screen-by-screen behavior

For each screen, the spec gives: trust-state, what data the screen reads/writes, which endpoints it calls, and any screen-specific rules.

### 7.1 Opener
- **Trust-state:** INTAKE.
- **Data:** writes `access_type`.
- **Endpoints:** `POST /tickets` (create draft on first interaction).
- **Behavior:** Four large cards (Car / Home / Business / Something else). Tap auto-advances. "Something else" routes to the human-handoff screen.

### 7.2 Situation
- **Trust-state:** INTAKE.
- **Data:** writes `situation`.
- **Endpoints:** `PATCH /tickets/{id}`.
- **Behavior:** Single-select chips auto-advance on tap. **No Continue button.** No ETA card, no priority card.

### 7.3 Location + Safety
- **Trust-state:** INTAKE.
- **Data:** writes `location`, `safety_flag`.
- **Endpoints:** `PATCH /tickets/{id}`.
- **Behavior:** "Share GPS" primary; address field secondary. Safety question with the safe option equal-or-greater visual weight. If safety event: also route to human-handoff in parallel.

### 7.4 Branch details
- **Trust-state:** INTAKE.
- **Data:** writes `automotive` or `property` depending on `access_type`.
- **Behavior:** Car screen has make/model/year + key-type chips including a guilt-free "Not sure" highlighted distinctly. Multi-field forms may use a Confirm button.

### 7.5 NL parse state (optional)
- Only shown if the user typed a free-form sentence.
- Parsing indicator allowed here (real operation).
- Pre-fills any extracted fields; asks only for remaining gaps.

### 7.6 Additional details (optional)
- **Behavior:** Free-text "Anything else we should know?" with ghost-text examples. **Skip** has equal prominence to Continue. Never blocks dispatch.

### 7.7 Photo upload (optional)
- **Behavior:** Native camera/photo picker. Multiple photos, easy delete. Skip equal prominence. **Photos never gate dispatch.**

### 7.8 Identity confirm (light)
- Soft "Can you confirm this is yours? (technician verifies ID on arrival)" — may be folded into the next screen.

### 7.9 Price-range confirmation + cancellation policy
- **Trust-state:** INTAKE.
- **Endpoints:** `POST /tickets/{id}/price-quote` to fetch estimate; `PATCH` to record acceptance.
- **Behavior:** Backend-supplied estimate range. Cancellation policy folded in as a visible sub-section. Acceptance is an **explicit, deliberate tap** — no auto-advance, no pre-checked box, no countdown. Fee amounts from backend.

### 7.10 Payment method on file
- **Trust-state:** INTAKE.
- **Endpoints:** `POST /tickets/{id}/payment-method`.
- **Behavior:** Apple Pay / Google Pay / saved method first; manual card entry secondary. **Represent card collection as a handoff to a secure payment step** — do NOT hardcode card-field UI; do NOT store credentials. Copy must make clear: "not charged until service is completed or a cancellation/no-show fee applies." No prepayment framing.

### 7.11 Request confirmed / committing
- **Trust-state:** INTAKE.
- **Endpoints:** `POST /tickets/{id}/commit`.
- **Behavior:** Appears only after price acceptance AND payment-method capture. Still no technician/ETA unless backend has them.

### 7.12 OTP verification
- **Trust-state:** INTAKE.
- **Endpoints:** `POST /tickets/{id}/otp/send`, `POST /tickets/{id}/otp/verify`.
- **Behavior:** Runs in parallel with backend matching. **User enters their own SMS code** — no auto-fill, no auto-submit. Include "resend code" and verify-by-call fallback. **Never blocks help.**

### 7.13 Technician assigned (MATCHED)
- **Trust-state:** MATCHED.
- **Endpoints:** `GET /tickets/{id}` (polled until `technician_assignment` populated) or trigger via `POST /tickets/{id}/dispatch`.
- **Behavior:** First screen allowed to show real technician data. Role is "Dispatcher" or "Specialist" — **never "Officer"** or law-enforcement framing. Verified/vetted indicators. Calmer rhythm than intake.

### 7.14 Live tracking (FULFILLMENT)
- **Trust-state:** FULFILLMENT.
- **Endpoints:** `GET /tickets/{id}/tracking` (poll).
- **Behavior:** Real-time map (stub returns interpolated motion). Live ETA. Call/message tech action. Reinforce "keep this page open." Calm.

### 7.15 Arrival verification (FULFILLMENT)
- **Endpoints:** `POST /tickets/{id}/arrival-handshake`.
- **Behavior:** **Mutual** PIN/QR. Customer's screen shows a code the tech must present, or customer scans the tech's QR. The tech proves identity to the customer, not just the other way around.

### 7.16 Payment / review (FULFILLMENT)
- **Endpoints:** `POST /tickets/{id}/finalize`, `POST /tickets/{id}/approve-final` (conditional), `POST /tickets/{id}/charge`.
- **Behavior:** Side-by-side "Estimated Range" vs. "Final Price." Inside the range: calm. Exceeds the range: **explicit approval tap required before any charge.** After charge, show one job-service review prompt. The customer rates the completed service, not dispatch/intake. That review applies to the `fulfillment_technician_id` and, when present, the `fulfillment_org_id`; it does **not** change customer ownership and does not rate the origin organization unless the origin also fulfilled the job. **One** appropriate place for an optional "Add to Home Screen" PWA hint.

### 7.17 Human-handoff screen (always reachable)
- **Endpoints:** `POST /tickets/{id}/handoff`.
- **Behavior:** Framed as an **upgrade**, not an error. One clear way to reach a person. Show transparently *why* (timeout / safety / explicit / unresolvable) without red error styling. **No "Officer" framing.** Neutral avatar.

---

## 8. Stitch files: how to use them

The Stitch HTML files and PNG screenshots accompanying this spec are **visual reference**, not the codebase.

**Do:**
- Lift the Tailwind config (colors, fonts, spacing).
- Match the visual language: dark theme, amber primary, blue secondary, large agent message → controls → footer rhythm, chip-based interactions, footer CTA pattern.
- Use the screens as a sanity check on layout and proportion when building React components.

**Don't:**
- Import Stitch's HTML files into the codebase.
- Carry forward the bugs listed in [§ 5.4](#54-bugs-in-the-stitch-output-do-not-carry-these-forward).
- Treat Stitch's vanilla JS micro-interactions as authoritative — rebuild them as React with the animation discipline rule.

**When Stitch and this spec disagree, the spec wins.** Stitch is a sketch; this document is the contract.

---

## 9. Build order (suggested)

1. **Scaffold** Next.js + TypeScript + Tailwind frontend; FastAPI + Pydantic backend in a `/api` directory.
2. **Wire schema.py** into the backend; generate TS types from it for the frontend.
3. **Build the design system primitives** (`ChipSelect`, `AgentMessage`, `StepPipes`, `CallAPersonButton`, `TrustStateGate`) before any screens.
4. **Implement INTAKE screens 1–4** end-to-end against the backend (`POST /tickets`, `PATCH /tickets/{id}`). Verify the Ticket persists step-by-step.
5. **Add the price → payment → commit chain** (screens 9–11) with the stub pricing endpoint.
6. **Add OTP + matching** (screens 12–13). Verify the trust-state transition INTAKE → MATCHED visually changes the UI.
7. **Add FULFILLMENT screens** (14–16). Verify the polling + state transitions.
8. **Add the human-handoff screen** and wire timeout / safety / explicit-request routing.
9. **Add Additional Details, Photos, NL parse stub** screens.
10. **Polish:** animation discipline pass, sunlight-contrast pass, "Call a person instead" consistency audit across every screen.

---

## 10. Definition of done (for this build)

- All 17 screens render correctly on a mobile viewport (375–414 px wide).
- The Ticket persists across all screen transitions via the backend.
- Trust-state transitions visually change what is rendered (verified by inspecting that technician data is invisible during INTAKE).
- All stub endpoints respond with realistic data.
- "Call a person instead" is identical and present on every screen.
- No hardcoded technician name, ETA, or fee anywhere in the frontend codebase. (Grep should find none.)
- The price-vs-final flow handles both within-range and exceeds-range cases.
- The human-handoff screen does not use "Officer" or red error styling.

---

## 11. Out of scope for this build

(See § 6.4 for the full list of deferred integrations: real payment, SMS, maps, LLM, accounts, languages, voice.)

The system must be **architected so these slot in cleanly** behind the existing API surface when added later. Do not bake stub-specific assumptions into the frontend or schema.

---

**End of spec.** Questions / ambiguities → default to the principles in § 2.
