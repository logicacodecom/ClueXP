# Technician App Progress And Next Development

Status: current reconciliation note for the live `apps/technician-web` PWA.

This document reconciles:

- `docs/TECHNICIAN-MOBILE-SPEC.md` — durable product/UI flow specification.
- `docs/TECHNICIAN-APP-BUILD-PLAN.md` — historical mock-first build plan.
- Current `apps/technician-web` implementation.

Use this file for near-term technician app progress and next development. The
technician app is no longer a pure mock prototype; it has real app-server BFF
routes that forward the signed-in technician session to the intake API.

## 2026-06-17 — T7 Settings/Profile Consolidation — COMPLETE ✅

**Status:** Slice T7 complete. Availability toggle moved to `/profile`, `/settings` simplified.

**Changes:**
- `/profile` (Account tab) now shows availability control directly ("Dispatch status" section)
- `/settings` now only contains Language and Location update (no availability toggle)
- No duplicate availability state between Profile and Settings

**Verification:**
- Build: `npm.cmd run build:tech` ✅ passed
- TypeScript: 0 errors ✅

**Reviewed by Codex:**
- Verified availability toggle works correctly in Profile screen
- Confirmed GPS copy updated: "GPS updates live in App settings"
- `af6452a` - T7 copy fix commit

**Next:**
- Masked job chat (T4) remains the next high-priority slice
- Documents/compliance (T6) is code-complete; remaining work is the prod code
  deploy + `private-technician-docs` bucket (see Slice T6)

## Current Reality

Implemented or present:

- Technician sign-in/sign-up routes.
- Session-backed shell with availability control.
- Live offers feed via `/api/offers`.
- Multiple active offers rendered at once, sorted and privacy-gated.
- Accept/decline offer actions via BFF routes.
- Active job restoration via `/api/active-job`.
- Active job workflow screens for arrival, service, approval, completion, chat,
  call, and navigation.
- Active job issue reporting for cannot complete, customer unavailable, and
  unsafe situations via `/jobs/[id]/report-issue`.
- Location push route via `/api/location`.
- Technician collection reporting route.
- Technician finished-job history route.
- Activity page showing finished jobs, technician-collected money, and customer
  reviews.
- Technician global profile, photo upload/review state, and provider affiliation
  views using the workforce model.
- Bottom navigation exposes Home, Map, Messages, Activity, and Account.

Still intentionally incomplete:

- Masked job chat is not live yet.
- Voice/call remains placeholder until the communication provider is selected.
- Native background GPS, push notifications, and alarm behavior remain future
  native/PWA-platform work.

## Reconciled Information Architecture

Canonical bottom tabs:

| Tab | Current route | Purpose | Status |
|---|---|---|---|
| Jobs/Home | `/jobs` | Offers, active job, active assignment restore | Live |
| Map | `/map` | Field location/map context | Live; redirects to Jobs where map context is embedded |
| Messages | `/messages` | Customer/dispatcher communication placeholder | Placeholder pending masked job chat |
| Activity | `/activity` | Completed jobs, collected money, customer reviews | Live history read |
| Account | `/profile` | Identity, availability, photo, affiliations, profile tools | Live |

Secondary routes that exist but are not bottom tabs:

- `/settings` — reached from Account/Profile; controls language and explicit GPS
  update actions.
- `/team` — provider affiliation/team context.
- `/documents` — compliance/document surface; live with upload and status tracking.
- `/onboarding` — onboarding flow.
- `/offer/[id]` — focused offer detail/decision route.

Profile and settings are now intentionally distinct:

- `/profile` is the Account tab. It centers identity/professional profile,
  provider affiliations, photo upload/review state, trust-profile stats,
  sign-out, and the online/offline availability toggle.
- `/settings` is not a tab. It is focused on language, explicit GPS update, and
  device/app controls.

## Current Gaps Against The Mobile Spec

High priority:

- Add masked job chat after assignment so the customer and assigned technician
  can message through ClueXP without exposing phone numbers.
- Confirm all active-job lifecycle transitions remain live backend mutations and
  do not invent a separate technician-only lifecycle.

Medium priority:

- Add customer/dispatcher message unread states after masked chat exists.
- Clarify production push/sound/alarm delivery strategy.
- Keep auto-accept as a product/contract decision until backend policy exists.
- Add pagination/date range to Activity when history volume grows.

Lower priority:

- Native background GPS and push notifications.
- Voice/masked call after masked job chat is stable.
- Offline completion and conflict resolution.

## Next Development Slices

### Slice T1 — Activity Hardening

Status: ✅ completed as current UI increment.

Completed:

- ✅ <s style="color:#1a7f37">Expose Activity in bottom navigation.</s>
- ✅ <s style="color:#1a7f37">Show finished jobs with technician-collected money
  and customer reviews.</s> — `/activity` reads `/api/jobs/history`.
- ✅ <s style="color:#1a7f37">Add status/date filters.</s>
- ✅ <s style="color:#1a7f37">Add job detail drill-in.</s>
- ✅ <s style="color:#1a7f37">Add empty-state copy for no reviews vs no
  completed jobs.</s>

Future polish:

- Add pagination/date range once volume grows.
- Keep collected money separate from payout/settlement language until the payout
  model is final.

### Slice T2 — Offers Queue Clarity

Status: ✅ completed.

Completed:

- ✅ <s style="color:#1a7f37">Render more than one active offer at once.</s>
- ✅ <s style="color:#1a7f37">Sort by urgency, expiry, distance, and rank.</s>
- ✅ <s style="color:#1a7f37">Show multiple-offers header.</s>
- ✅ <s style="color:#1a7f37">Clean up expired/superseded/terminal offers.</s>
- ✅ <s style="color:#1a7f37">Preserve address/customer-detail privacy before
  accept.</s>

Important boundary:

- Multiple visible offers does not mean multiple active assignments. Accept is
  backend-enforced first-accept-wins, and the active-job lock is
  technician-scoped.

### Slice T3 — Profile, Photo, And Affiliation Readiness

Status: ✅ completed for current workforce model scope.

Completed:

- ✅ <s style="color:#1a7f37">Technician global profile remains separate from
  provider/company affiliations.</s>
- ✅ <s style="color:#1a7f37">`/team` shows provider affiliations with
  pending/active/history states.</s>
- ✅ <s style="color:#1a7f37">`/profile` shows photo upload and review
  status.</s>
- ✅ <s style="color:#1a7f37">Technician BFF routes forward affiliation
  accept/decline and photo upload to the backend.</s>
- ✅ <s style="color:#1a7f37">Backend exposes technician affiliations, photo
  status, and session profile data.</s>
- ✅ <s style="color:#1a7f37">Ops photo review is wired through the Ops
  compliance review screen.</s>

Production note:

- Workforce migrations are applied through `0018`, and the workforce code is
  deployed. Keep future UI work aligned to the global technician identity plus
  affiliation-record model in `docs/TECHNICIAN-MOBILE-SPEC.md` and
  `docs/PROVIDER-WORKFORCE-MODEL.md`.

### Slice T4 — Masked Job Chat

Status: `[ ]` next recommended communication slice.

Recommended owner: backend-capable model for message storage/API, then frontend
model for technician/customer thread UI.

Tasks:

- [ ] Add backend job-message storage tied to `job_id`, sender role, sender id
  where available, body, timestamps, and moderation/audit hooks.
- [ ] Add assigned-job message APIs for technician web and customer tracking
  token users.
- [ ] Show the same masked job thread on the assigned technician job screen and
  the customer tracking page after assignment/acceptance only.
- [ ] Keep technician/customer phone numbers private.
- [ ] Make the thread read-only or closed after terminal job states unless a
  dispute/recovery workflow keeps it open.
- [ ] Start with short polling; upgrade to realtime/WebSocket later if needed.

Boundaries:

- Do not expose raw customer or technician phone numbers.
- Do not show chat before assignment/acceptance.
- Do not implement real voice/call in this slice.
- Current web/PWA is enough for chat MVP; native app is not required.

Minimum verification:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
npm.cmd run build:tech
npm.cmd run build --workspace @cluexp/intake-web
npm.cmd run typecheck
```

### Slice T5 — Map Honesty And Live Location

Status: ✅ reviewed; uses live data.

Findings:

- `/map` redirects to `/jobs`; map context is embedded in active job workflow.
- `GoogleMapView` uses real job coordinates when available.
- No mock/demo coordinates were found in the live map path.
- Technician location is pushed via `/api/location`.
- Active job location updates run during `en_route`, `arrived`, and
  `in_progress`.
- The route line, when shown, is a straight-line placeholder and not turn-by-turn
  routing.

Future polish:

- Add clearer copy when Maps key, GPS permission, or job coordinates are missing.
- Replace straight-line route with a directions provider only after product signs
  off on that dependency.

### Slice T6 — Documents And Compliance

Status: ✅ **CODE COMPLETE** — backend, BFF, and frontend integrated; prod schema
applied; **prod code deploy pending**.

**Completed:**
- ✅ <s style="color:#1a7f37">Database migration for `technician_documents` table.</s>
- ✅ <s style="color:#1a7f37">Backend endpoints: `GET /api/technicians/me/documents`, `POST /api/technicians/me/documents`.</s>
- ✅ <s style="color:#1a7f37">InMemoryStore and PostgresStore implementations.</s>
- ✅ <s style="color:#1a7f37">Frontend `/documents` page uses real API with upload flow.</s>
- ✅ <s style="color:#1a7f37">File validation: 10MB limit, types: PNG, JPEG, WebP, PDF.</s>
- ✅ <s style="color:#1a7f37">Document status tracking: pending_review, approved, rejected.</s>
- ✅ <s style="color:#1a7f37">Document-type selection on upload (driver license, insurance,
  business license, locksmith certification, background check).</s>
- ✅ <s style="color:#1a7f37">View/download of own documents via signed URL
  (`GET /api/technicians/me/documents/{id}/download`).</s>
- ✅ <s style="color:#1a7f37">Ops review surface: "Pending technician documents" card
  on Ops → Documents with approve/reject + file open, backed by
  `GET/PATCH /admin/technician-documents` and
  `GET /admin/technician-documents/{id}/download`.</s>

**Database Schema (migration 0020; `0021_tech_doc_defaults` repaired missing
`id`/`uploaded_at`/`status` defaults):**
```sql
CREATE TABLE technician_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_number TEXT,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  rejected_reason TEXT,
  expiration_date DATE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CHECK (status IN ('pending_review', 'approved', 'rejected'))
);

CREATE INDEX idx_technician_documents_technician_id ON technician_documents (technician_id);
CREATE INDEX idx_technician_documents_status ON technician_documents (status);
```

**API Response Format:**
```json
[
  {
    "id": "uuid",
    "document_type": "driver_license",
    "document_number": "D1234567",
    "storage_bucket": "private-technician-docs",
    "storage_path": "technicians/{id}/documents/{uuid}.pdf",
    "status": "pending_review",
    "rejected_reason": null,
    "expiration_date": "2027-01-15",
    "uploaded_at": "2026-06-17T10:30:00Z",
    "reviewed_at": null
  }
]
```

**Verification (2026-06-17, post-`0020` repair):**
- ✅ `npm.cmd run build:tech` — Build successful
- ✅ `npm.cmd run typecheck` — No type errors
- ✅ `uv run pytest apps/intake-web/api/tests/test_dispatch.py` — 136 passed, 1 skipped

**Production status:**
- ✅ Schema live — migration head `0021_tech_doc_defaults` applied to prod
  2026-06-17 (`0020` created the table; `0021` repaired the missing column
  defaults). Canonical: `EXECUTION-PLAN.md` §1.
- ⏳ Code deploy pending — the technician-documents endpoints + BFF route are
  committed locally but the prod image has not shipped, so `/documents` stays
  non-functional in prod until the deploy lands. The deployed image must include
  `python-multipart`.
- ⏳ Ops action — ensure the Supabase Storage bucket `private-technician-docs`
  exists (backend uses `storage.py:TECHNICIAN_DOCS_BUCKET`).

### Slice T7 — Settings/Profile Consolidation

Status: ✅ completed.

Completed:

- ✅ <s style="color:#1a7f37">Move online/offline availability control to
  `/profile` / Account.</s>
- ✅ <s style="color:#1a7f37">Keep `/settings` focused on language and explicit
  GPS update.</s>
- ✅ <s style="color:#1a7f37">Remove duplicate or contradictory availability
  states.</s>
- ✅ <s style="color:#1a7f37">Preserve the distinction between global technician
  profile fields and provider affiliation settings.</s>

Verification:

- `npm.cmd run build:tech` passed during Codex review.

### Slice T8 — Voice / Masked Call

Status: `[ ]` later; blocked on provider decision and should follow masked job
chat.

Tasks:

- [ ] Choose masked phone call provider or WebRTC strategy.
- [ ] Keep customer and technician direct phone numbers private.
- [ ] Add call-state UI only after the provider contract exists.
- [ ] Log call attempts/status against the job for dispute and safety context.
- [ ] Keep native app work optional; web/PWA can start with masked phone calling.

Preferred order:

1. Ship masked job chat.
2. Add masked phone call through a telephony provider.
3. Consider WebRTC/native app only if product needs justify the complexity.

## Verification Commands

For technician app UI/doc slices:

```powershell
npm.cmd run build:tech
npm.cmd run typecheck
```

For backend-affecting technician behavior:

```powershell
uv run pytest apps/intake-web/api/tests/test_dispatch.py -q
npm.cmd run build:tech
npm.cmd run typecheck
```

These commands are written for Windows/PowerShell local work. On Linux CI or a
POSIX shell, use the equivalent `npm run ...` form.

## Notes For Future Models

- Treat `TECHNICIAN-MOBILE-SPEC.md` as the durable product/UX contract.
- Treat `TECHNICIAN-APP-BUILD-PLAN.md` as historical context; it says mock-only,
  but the current app now has live BFF routes.
- Keep the workforce model as global technician identity plus provider
  affiliation records with history.
- Do not show sensitive customer detail before accept/assignment.
- Technician statuses are not customer `trust_state`.
- Activity money is collected/reported money, not final payout/settlement unless
  a payout ledger contract says so.
- Use explicit placeholders only for not-yet-live slices; do not replace live
  BFF-backed screens with local mock data.
