# Technician App Progress And Next Development

Status: current reconciliation note for the live `apps/technician-web` PWA.

---

### 2026-06-16 - Qwen: Slice T5/T6 review - Map live, Documents mock

**Findings:**
- **T5 (Map)**: Uses live data. `/map` redirects to `/jobs`. `GoogleMapView` uses real `job.lat`/`job.lng` coordinates. No mock/demo data. Technician location pushes via `/api/location` every 25s during active job. **Status: LIVE**.
- **T6 (Documents)**: Fully mock. `/documents` has hardcoded array, no upload API, no document retrieval. Requires backend: `GET /api/technicians/me/documents`, `POST /api/technicians/me/documents`. **Status: NEEDS BACKEND**.

**Actions:**
- T5 marked complete — ready for production.
- T6 requires backend endpoints before frontend can be made live. Next priority after T4 (masked chat).

---

This document reconciles:

- `docs/TECHNICIAN-MOBILE-SPEC.md` — product/UI flow specification.
- `docs/TECHNICIAN-APP-BUILD-PLAN.md` — historical mock-first build plan.
- Current `apps/technician-web` implementation.

Use this file for near-term technician app progress and next development. Keep
the mobile spec as the product contract, and keep the build plan as historical
context.

## Current Reality

The technician app is no longer only a mock prototype. It has a real Next.js PWA
surface with app-server BFF routes that forward the signed-in technician session
to the intake API.

Implemented or present:

- Technician sign-in/sign-up routes.
- Session-backed shell with availability toggle.
- Live offers feed via `/api/offers`.
- Multiple offered jobs can render at once in `LiveOffersFeed`.
- Accept/decline offer actions via BFF routes.
- Active job restoration via `/api/active-job`.
- Active job workflow screens for arrival, service, approval, completion, chat,
  call, and navigation.
- Active job issue reporting for cannot complete, customer unavailable, and
  unsafe situations via `/jobs/[id]/report-issue`.
- Location push route.
- Technician collection reporting route.
- Technician finished-job history route.
- Activity page that shows finished jobs, technician-collected money, and
  customer reviews.
- Bottom navigation now exposes Jobs, Map, Messages, Activity, and Account.

## Reconciled Information Architecture

Canonical bottom tabs:

| Tab | Current route | Purpose | Status |
|---|---|---|---|
| Jobs | `/jobs` | Offers, active job, active assignment restore | Live |
| Map | `/map` | Field location/map context | Present, live — uses real coordinates |
| Messages | `/messages` | Customer/dispatcher communication placeholder | Present, needs live-depth review |
| Activity | `/activity` | Completed jobs, collected money, customer reviews | Live history read |
| Account | `/profile` | Profile, availability/account settings | Present |

The original spec called the first tab `Jobs`; the implementation label is
`Home` for the same route. That is acceptable as long as the route remains the
technician's operational home.

Secondary routes that exist but are not bottom tabs:

- `/settings` — reached from Account/Profile; controls language, availability,
  and GPS update actions.
- `/team` — provider/team context, to be wired to technician affiliations.
- `/documents` — compliance/document surface.
- `/onboarding` — onboarding flow.
- `/offer/[id]` — focused offer detail/decision route.

Profile and settings are distinct screens. `/profile` is the Account tab and
centers identity/professional profile: display name, organization context,
avatar, read-only online pill, editable name/phone/service-area radius/skills,
trust-profile stats, sign-out, and a link to `/settings`; mutations flow through
`/api/profile`. `/settings` is not a tab and currently holds language, the
actual online/offline toggle via `/api/availability`, and GPS update via
`/api/location`. Mild future consolidation question: `/profile` displays
availability while `/settings` controls it, and a technician may expect the
availability toggle directly on the Account screen.

## Activity / Finished Jobs

Requirement: a technician must be able to find completed jobs, collected money,
and customer reviews.

Current implementation:

- UI route: `apps/technician-web/src/app/activity/page.tsx`
- BFF route: `apps/technician-web/src/app/api/jobs/history/route.ts`
- Backend source: `GET /api/technician/jobs/history`

The Activity page shows:

- completed/cancelled/no-show history rows returned by the backend;
- technician-reported payment amount/method;
- customer review rating/comment when present;
- total collected amount across returned jobs;
- refresh and loading/error/empty states.

Next improvements:

- Add date/status filters.
- Separate collected money from payout/settlement language until the payout
  policy is final.
- Add job detail drill-in for notes, timestamps, and dispute/no-show context.
- Add pagination or date range once volume grows.

## Multiple Requested Jobs At Once

The app should support more than one requested job/offer being visible at once.

Current implementation:

- `LiveOffersFeed` normalizes an array response from `/api/offers`.
- It renders all active `offered`/`seen` offers.
- Each offer has independent accept/decline state and a backend-driven
  `expires_at` countdown.

Important rule:

- Multiple visible offers does not mean multiple active assignments.
- Accept remains backend-enforced first-accept-wins.
- The active-job lock remains global to the technician; a technician must not be
  double-dispatched across providers or offers. (Backend: `get_technician_active_job`
  is technician-scoped — now covered by `test_active_job_lock_is_technician_scoped`
  added in Slice A.)

Next improvements:

- Add clearer "multiple offers available" grouping/copy.
- Sort offers by expiry/urgency/distance.
- Add stale/expired visual cleanup without waiting for the next poll.
- Keep exact customer address hidden until acceptance/assignment.

## Gaps Against The Mobile Spec

High priority:

- Confirm all technician lifecycle transitions use live backend mutations and do
  not invent a separate technician-only lifecycle.
- Add masked job chat after assignment so the customer and assigned technician
  can message through ClueXP without exposing phone numbers.
- Expand Activity with filters and job detail drill-in.
- Add technician profile photo upload/review states once the workforce/profile
  model lands.
- Add customer-visible assigned technician identity contract only after approved
  photo fields exist.
- Review Map and Messages for real-data honesty and placeholder labeling.

Medium priority:

- Sound/alarm enablement remains mostly UI/permission concept; production push
  and sound behavior still need a delivery strategy.
- Auto-accept remains a product/contract decision; do not imply it is production
  active without backend policy.
- Documents/compliance blocking should be checked against current backend
  document status and availability policy.
- Team/organization view (`/team`) should be wired to the provider affiliation
  model now that the backend ledger exists (Slice A, migration `0016`); needs the
  technician-facing affiliation read endpoint (Slice B/C).

Lower priority:

- Native background GPS and push notifications remain future native-app work.
- Voice/call remains placeholder until a telephony/WebRTC provider is selected;
  masked job chat should ship first.
- Offline completion remains out of scope until conflict rules exist.

## Next Development Slices

### Slice T1 — Activity Hardening

Status: ✅ completed as current UI increment — Activity tab is visible, history is
live, filters are available, and each row has a detail drill-in.

Tasks:

- ✅ <s style="color:#1a7f37">Expose Activity in bottom navigation.</s> —
  Activity is now a visible technician tab.
- ✅ <s style="color:#1a7f37">Show finished jobs with technician-collected money
  and customer reviews.</s> — `/activity` reads `/api/jobs/history`.
- ✅ <s style="color:#1a7f37">Add status/date filters.</s> — filters by
  returned history status and all time / 30 days / 90 days / 1 year.
- ✅ <s style="color:#1a7f37">Add job detail drill-in.</s> — expandable rows
  show job id, urgency, created timestamp, review detail, technician-reported
  collection, and customer-reported payment.
- ✅ <s style="color:#1a7f37">Add empty-state copy for no reviews vs no completed
  jobs.</s> — no history, no filter matches, and no customer review are distinct
  states.

### Slice T2 — Offers Queue Clarity

Status: ✅ completed — multiple offers render with sorting, header, and cleanup.

Tasks:

- ✅ <s style="color:#1a7f37">Render more than one active offer at once.</s> —
  `LiveOffersFeed` maps all active offers.
- ✅ <s style="color:#1a7f37">Sort by urgency, expiry, and distance.</s> —
  Priority: urgency (critical>high>medium>low), expiry (soonest first),
  distance (closest first), rank (lower first).
- ✅ <s style="color:#1a7f37">Show "multiple offers available" header.</s> —
  Header displays when `activeOffers.length > 1`.
- ✅ <s style="color:#1a7f37">Add explicit expired/superseded cleanup.</s> —
  Offers with terminal status (expired, superseded, accepted, declined, failed_delivery)
  are removed from state on each render cycle.
- ✅ <s style="color:#1a7f37">Preserve address/customer-detail privacy before accept.</s> —
  Exact address shown only after acceptance; shows "Nearby service area" or
  "Approximate service area" before accept.

### Slice T3 — Profile, Photo, And Affiliation Readiness

Status: ✅ completed — Slice D frontend implementation complete. UI shell for
affiliations and photo upload ready, and Claude's Slice D-backend now provides
the real technician-facing endpoints.

**Frontend-prep completed (this slice):**
- ✅ `/team` — now shows technician's provider affiliations with pending/active/history states
- ✅ `/profile` — photo upload wrapper with API integration
- ✅ `/documents` — compliance document upload placeholder with review status
- ✅ `api/affiliations` — BFF route to fetch technician affiliations and organizations
- ✅ `api/affiliations/[id]/accept|decline` — technician-web BFF routes with loading states
- ✅ `api/photo` — technician-web BFF route validates image type/size
- ✅ `PhotoUpload` component — drag-and-drop UI with status badges
- ✅ Global profile and provider affiliations kept distinct in UI

**Backend follow-ups after Slice B (Claude) — ✅ DONE (Slice D-backend):**
- ✅ <s style="color:#1a7f37">`GET /api/technicians/me/affiliations` — returns the tech's affiliations.</s>
- ✅ <s style="color:#1a7f37">`GET /api/technicians/me/organizations` — orgs for name lookup.</s>
- ✅ <s style="color:#1a7f37">Photo/affiliation read — the `GET /api/session` technician object now carries
  `photo_url`, `photo_status`, and `affiliations[]` (the `/profile` screen reads these
  directly; no separate `/me/profile` endpoint needed).</s>
- ✅ <s style="color:#1a7f37">`POST /api/technicians/me/photo` — upload sets `profile_photo_status='pending'`;
  Ops approves via `PATCH /admin/technicians/{id}/photo`; only an approved photo is
  customer-visible (Slice E).</s>
- ✅ <s style="color:#1a7f37">`POST /api/technicians/me/affiliations/{id}/accept|decline` — consent flow,
  exclusivity enforced at activation.</s>

Technician-facing backend contract is complete; the invite/photo screens run on real
data. Ops photo review is also wired through the Ops compliance review screen:
`GET /admin/technicians/photos` lists pending headshots and
`PATCH /admin/technicians/{id}/photo` approves/rejects them.

### Slice T4 — Masked Job Chat

Status: `[ ]` next communication slice — implement masked job chat before real
voice/call.

Recommended owner: backend-capable model for message storage/API, then frontend
model for technician/customer thread UI.

Tasks:

- [ ] Add backend job-message storage tied to `job_id`, sender role, sender id
  where available, body, and timestamps.
- [ ] Add assigned-job message APIs for technician web and customer tracking
  token users.
- [ ] Show the same masked job thread on the assigned technician job screen and
  the customer tracking page after assignment/acceptance only.
- [ ] Keep technician/customer phone numbers private; display controlled labels
  such as "Customer" and "Technician".
- [ ] Make the thread read-only or closed after the job reaches a terminal state.
- [ ] Start with short polling; upgrade to realtime/WebSocket later if needed.
- [ ] Ensure no customer phone or sensitive identity leaks outside policy.

Boundaries:

- Do not expose raw customer or technician phone numbers.
- Do not show chat before assignment/acceptance.
- Do not implement real voice/call in this slice.
- Start with current web/PWA; native app is not required for the chat MVP.

Minimum verification:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
npm.cmd run build:tech
npm.cmd run build --workspace @cluexp/intake-web
npm.cmd run typecheck
```

### Slice T5 — Map Honesty And Live Location

Status: `[✓]` reviewed — uses live data.

**Findings:**
- `/map` route redirects to `/jobs` (intentional design — map context is embedded in active job workflow)
- `GoogleMapView` component uses real coordinates from job data (`job.lat`, `job.lng`)
- No mock/demo coordinates found in map implementation
- Technician location is pushed via `/api/location` PATCH route during active job
- Location updates every 25 seconds during `en_route`, `arrived`, `in_progress` statuses
- Falls back gracefully when Maps API key unavailable or location permission denied
- Route line (if `connect=true`) is straight-line placeholder, NOT turn-by-turn routing

**Implementation details:**
- `active-job-workflow.tsx` builds `points` array with tech location (if shared) and job location
- `GoogleMapView` renders markers for tech (yellow) and job (blue) with dark map theme
- Maps script loaded once per page via singleton `mapsPromise`
- Location sharing explicit, permission-aware, with timeout/error handling

**Backend verification:**
- `PATCH /api/location` — exists, updates technician location
- `GET /api/jobs/[id]` — returns job coordinates when available

**Status:** T5 is LIVE — no placeholder data. Ready for production.

Minimum verification:

```powershell
npm.cmd run build:tech
npm.cmd run typecheck
```

### Slice T6 — Documents And Compliance

Status: `[ ]` **needs backend endpoints** — currently mock implementation.

**Current state:**
- `/documents` route (`apps/technician-web/src/app/documents/page.tsx`) is fully mock
- Hardcoded `documents` array with 2 example documents
- Status badges (`approved`, `pending`, `rejected`) are hardcoded, not API-driven
- No file upload integration
- No document retrieval from backend
- Upload UI has no `onChange` handler, no file validation, no API call

**Required backend endpoints:**
- `GET /api/technicians/me/documents` — list technician documents with status
- `POST /api/technicians/me/documents` — upload new document (multipart/form-data)
- Document response should include: `id`, `name`, `type`, `status`, `uploaded_at`, `reviewed_at`, `rejection_reason` (optional)

**Required frontend changes:**
- Replace hardcoded `documents` array with API fetch
- Implement file upload with progress indicator
- Add status refresh after upload
- Show required document types from backend (don't hardcode requirements)
- Connect compliance status to dispatch/availability blocking when backend policy exists

**Backend verification needed:**
- Check if document endpoints exist in intake API (`apps/intake-web/api/endpoints/technicians/`)
- If not, create document CRUD endpoints mirroring profile photo flow
- Ensure document status workflow: `pending` → `approved`/`rejected` with admin review

**Status:** T6 requires backend implementation before frontend can be made live.

Minimum verification:

```powershell
npm.cmd run build:tech
npm.cmd run typecheck
```

### Slice T7 — Settings/Profile Consolidation

Status: `[ ]` small UX cleanup.

Recommended owner: frontend model.

Tasks:

- [ ] Decide whether online/offline should be controllable directly from
  `/profile`/Account, not only displayed there.
- [ ] Keep `/settings` focused on language, GPS update, and device/app controls.
- [ ] Avoid duplicate or contradictory availability states between Profile and
  Settings.
- [ ] Preserve the clear distinction between global technician profile fields
  and provider affiliation settings.

Minimum verification:

```powershell
npm.cmd run build:tech
npm.cmd run typecheck
```

### Slice T8 — Voice / Masked Call

Status: `[ ]` later; blocked on provider decision.

Recommended owner: backend/integration model after masked job chat is stable.

Tasks:

- [ ] Choose masked phone call provider or WebRTC strategy.
- [ ] Keep customer and technician direct phone numbers private.
- [ ] Add call-state UI only after the provider contract exists.
- [ ] Log call attempts/status against the job for dispute and safety context.
- [ ] Keep native app work optional; web/PWA can start with masked phone calling.

Preferred order:

1. Ship masked job chat first.
2. Add masked phone call through a telephony provider.
3. Consider WebRTC/native app only if product needs justify the complexity.

## Verification Commands

For technician app UI/doc slices:

```powershell
npm.cmd run build:tech
npm.cmd run typecheck
```

These commands are written for Windows/PowerShell local work. On Linux CI or a
POSIX shell, use the equivalent `npm run ...` form.

For backend-affecting technician behavior:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
npm.cmd run build:tech
npm.cmd run typecheck
```

## Notes For Future Models

- Treat `TECHNICIAN-MOBILE-SPEC.md` as the durable product/UX contract.
- Treat `TECHNICIAN-APP-BUILD-PLAN.md` as historical context; it says mock-only,
  but the current app now has live BFF routes.
- Do not show sensitive customer detail before accept/assignment.
- Technician statuses are not customer `trust_state`.
- Activity money is collected/reported money, not final payout/settlement unless
  a payout ledger contract says so.

---

### 2026-06-16 — Qwen: Slice D technician consent & onboarding - COMPLETE

Status: `[✓]` frontend BFF routes and UI complete for technician consent flow and photo onboarding.

**Frontend implementation complete:**
- `/team` - pending invites shown with accept/decline buttons and loading states
- `/profile` - photo upload wrapper with API integration
- `/documents` - compliance document upload placeholder with status display

**BFF endpoints created:**
- `api/affiliations` - GET affiliations + organizations
- `api/affiliations/[id]/accept` - POST accept pending invite
- `api/affiliations/[id]/decline` - POST decline pending invite
- `api/photo` - POST upload profile photo

**Components created:**
- `PhotoUpload` - drag-and-drop upload component with status badges
- `PhotoUploadWrapper` - profile page wrapper that calls `/api/photo`

**Features:**
- Accept/decline buttons show loading state during API calls
- Confirmation dialog for decline actions
- Exclusivity conflict errors handled when backend is ready
- Photo upload validates file type (image) and size (max 5MB)
- Pending invite actions refresh affiliations after completion

**Verification:**
- `npm.cmd run build` - **passed** (25 pages, 8 API routes)
- `npx tsc --noEmit` - **passed** (0 errors)

**Backend contract assumptions (Slice B responsibility):**
- `GET /api/technicians/me/affiliations` - returns affiliations with status
- `POST /api/technicians/me/affiliations/{id}/accept` - accepts pending invite
- `POST /api/technicians/me/affiliations/{id}/decline` - declines pending invite
- `POST /api/technicians/me/photo` - uploads profile photo
- `GET /api/technicians/me/profile` - returns photo_url, photo_status, affiliations

**UI shows:**
- Pending invites with visual distinctness and accept/decline buttons
- Active affiliations with status/type/exclusivity/dispatch badges
- History section for ended/suspended/rejected affiliations
- Global profile distinct from provider affiliation settings

**Tasks completed:**
- [x] Show provider affiliation invites to the technician
- [x] Let technician accept or decline pending_invite affiliations
- [x] Add profile photo/headshot upload UX
- [x] Show photo review status: pending, approved, rejected/replacement needed
- [x] Keep global technician profile separate from provider affiliation settings

---

### 2026-06-16 — qwen → Codex: Review requested — Slice D frontend + T2 offers queue

Status: `[✓]` frontend complete, backend complete (commit 39299b2). Ready for your review.

**Frontend changes:**
- `apps/technician-web/src/app/api/affiliations*` — 4 BFF routes for affiliations/photo
- `apps/technician-web/src/components/photo-upload*` — upload component + wrapper
- `apps/technician-web/src/app/team/page.tsx` — accept/decline with loading states
- `apps/technician-web/src/app/profile/page.tsx` — photo upload integration
- `apps/technician-web/src/components/live-offers.tsx` — T2: sorting, multiple offers, cleanup

**Verification:**
- `npm.cmd run build:tech` — ✓ 25 pages, 8 API routes
- `npm.cmd run typecheck` — ✓ 0 errors
- `uv run pytest apps/intake-web/api/tests/test_dispatch.py -q` — ✓ 132 passed, 1 skipped

**Backend contract (Claude, commit 39299b2):**
- `GET /api/technicians/me/affiliations` — returns affiliations with org names
- `POST /api/technicians/me/affiliations/{id}/accept|decline` — consent flow, exclusivity
- `POST /api/technicians/me/photo` — upload sets status='pending', Ops approves
- `GET /api/session` technician object includes `photo_url`, `photo_status`, `affiliations[]`

**Slice T2 completion (offers queue clarity):**
- ✅ Sort by urgency, expiry, distance, rank
- ✅ Multiple offers header when >1 active offer
- ✅ Expired/superseded cleanup per render cycle
- ✅ Address privacy preserved before accept

**Action needed:**
Please review the technician-web implementation (Slice D frontend + T2).
Build is green and backend contract is implemented. Ready to merge after your approval.

- [x] Do not expose provider-private data across affiliations

---

### 2026-06-16 — Codex: Review Of Slice D Frontend + T2

Verdict: ✅ approved after fixes.

Codex reviewed the Qwen technician-web Slice D frontend and T2 offers queue work
against Claude's completed backend contract.

Required fixes applied:

- `PhotoUpload` now awaits the async upload handler before showing success, so
  failed backend/storage uploads no longer produce a false "pending review" state.
- `PhotoUploadWrapper` refreshes the server profile after upload success and
  surfaces backend error messages.
- Technician-web `/api/photo` now accepts only PNG/JPEG/WebP, matching the
  backend storage contract.
- `/team` now uses `affiliation.organization_name` before falling back to the
  active-organizations lookup, so pending invites show the provider name.

Verification:

- `uv run pytest api/tests/test_dispatch.py -q` from `apps/intake-web` →
  132 passed, 1 skipped, 1 warning.
- `npm.cmd run build:tech` → passed.
- `npm.cmd run build:provider` → passed.
- `npm.cmd run build --workspace @cluexp/intake-web` → passed.
- `npm.cmd run typecheck` → passed.
- `git diff --check` → passed with line-ending warnings only.

Remaining:

- Ops photo-review screen/list is complete in ops-web.
- Production still needs migrations `0016`, `0017`, `0018` and
  `python-multipart` deployed.
