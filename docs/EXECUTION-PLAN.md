# ClueXP — Execution Plan (revise before build)

> **How to use this doc:** edit it freely — tick `[x]`, strike tasks, change order,
> add notes. I will execute exactly what this file says, sprint by sprint, and
> pause for your review at each sprint boundary. Nothing here is built until you
> say go. High-level rationale lives in `ROADMAP.md` / `adr/0001`.

**Legend:** `[x]` done · `[~]` in progress · `[ ]` planned · ⚠️ touches the live deploy · 🔑 needs something from you

---

## Status snapshot

| | |
|---|---|
| Intake app (Sprint 1) | ✅ live — https://cluexp-intake.vercel.app |
| Dispatch database (6 tables) | ✅ applied to Supabase (`packages/db`, rev `0001_baseline`) |
| Roadmap / ADR / this plan | ✅ in `docs/` |
| Everything below | ⬜ awaiting your review |

## Locked decisions (from ADR 0001)

- Monorepo · one shared FastAPI backend · Google Maps Platform · raw SQL + Alembic · Supabase Storage.

## 🔑 Needs from you (blockers, do in parallel)

- [ ] **Google Maps:** GCP project + billing on + enable Geocoding / Routes / Maps JS + create a **restricted** API key → paste it.
- [ ] **Supabase Storage:** authenticate the Supabase plugin (so I can create buckets), or make `public-tech-media` + `private-verification` in the dashboard.
- [ ] **Decide the API-deploy shape** (see Sprint 0, task 2 sub-decision).
- [ ] **Rotate** the Vercel token + Supabase DB password when we wrap (both were shared in chat).

---

## Sprint 0 — Foundation

**Goal:** clean structure + the data layer, without breaking the live intake.

- [x] `packages/db` — Alembic baseline; `customers`, `technicians`, `jobs`, `dispatch_offers`, `media`, `events` applied to Supabase.
- [ ] ⚠️ **Monorepo restructure** — move files:
  - `src/`, `next.config.mjs`, `package.json`, `tsconfig.json`, `next-env.d.ts`, `globals.css` → `apps/intake-web/`
  - `api/` → `apps/api/` · `requirements.txt`, `vercel.json` → alongside the API
  - `assets/schema.py`, `scripts/generate_types.py` → `packages/schema/`
  - generated `schema.generated.ts` → `apps/intake-web/src/types/`
  - `assets/ui/` → `docs/design-ref/` (visual reference only)
  - Update imports (`from assets.schema` → `from packages.schema...`), the type-gen path, and `vercel.json` function globs.
  - **Sub-decision — how the API deploys:**
    - **(rec) 0a. Co-locate now:** keep the Python function inside `apps/intake-web` (folder layout achieved, deploy unchanged). Split out a separate `cluexp-api` Vercel project only when `technician-web` arrives.
    - **0b. Extract now:** separate `cluexp-api` Vercel project; frontends call it via `API_BASE_URL`. More moving parts today.
  - [ ] ⚠️ Update the Vercel project **Root Directory** to `apps/intake-web`; re-verify build; **redeploy**; smoke-test the live flow.
- [ ] **Supabase Storage buckets** 🔑 — create `public-tech-media` (public) + `private-verification` (private, RLS).
- [ ] **Google Maps** 🔑 — store key as `GOOGLE_MAPS_API_KEY` (server) + a restricted render token; add a backend `geocode(address)` helper.

**Acceptance:** repo is `apps/`+`packages/`; intake still green in prod; buckets exist; geocode helper returns lat/lng for a test address.

---

## Sprint 1 — Intake on the real model

**Goal:** intake stops using the single `tickets` blob and writes the relational model.

- [ ] **Store layer** — replace `tickets` JSONB store with `jobs` + `customers`:
  - On `POST /tickets`: upsert a `customers` row (by phone, when known) + insert a `jobs` row; `jobs.detail` holds the Ticket payload; promote `trust_state`, `status`, `access_type`, `situation`, `lat`, `lng`, `address`, `customer_id`.
  - `require_ticket`/`save` read/write `jobs`; `events` rows carry `job_id`.
  - Keep the API response contract (envelope + guards) unchanged so the frontend doesn't move.
- [ ] **Real geocoding** — `PATCH location` / GPS share calls backend geocode; persist `lat`/`lng` + `geocode_confidence`.
- [ ] **Photo upload to Storage** — signed-upload endpoint (`POST /tickets/{id}/photo-intent` → signed URL); browser uploads direct to `private-verification`; record a `media` row; the intake Photos screen actually stores.
- [ ] **Migration** `0002_*` if columns need adjusting.

**Acceptance:** a full intake run creates `customers`+`jobs`+`media` rows; geocoded coords stored; photo lands in the private bucket.

---

## Sprint 2 — Technician registry + matching v1

**Goal:** kill the hardcoded "Sam Reyes" stub.

- [ ] Seed `technicians` (a handful, varied skills/areas) + a minimal admin list view (`dispatcher-web` shell or a protected route).
- [ ] **Dispatch engine v1** (deterministic, outside the intake graph per SPEC §2.7): score by distance (service_area), skill match (`access_type`/key type), availability, rating.
- [ ] `/dispatch` creates `dispatch_offers` for the top-N; first accept wins; timeout → next; assigns `jobs.technician_id`, flips `trust_state=matched`.
- [ ] Technician location ping endpoint (`current_lat/lng`).

**Acceptance:** dispatch picks a real seeded technician by rule; offers recorded; trust gating intact.

---

## Sprint 3 — Fulfillment maps

- [ ] Real Google map on tracking screen (render token).
- [ ] Backend traffic-aware ETA via Routes API (replaces the `sin()` stub).
- [ ] Live position polling from `technicians.current_lat/lng`.
- [ ] Mutual arrival handshake (tech proves to customer) backed by a real code store.

**Acceptance:** customer sees a real map + backend ETA; arrival verified both ways.

---

## Sprint 4 — Payments + OTP (restore deferred)

- [ ] Stripe: auth-hold at `commit`, capture at `finalize`, release on cancel; over-estimate approval before capture (make the `finalize` stub able to exceed — fixes the current dead path).
- [ ] Restore the payment-method precondition in `commit` + `is_dispatchable()`.
- [ ] Restore OTP send/verify in the flow.
- [ ] Idempotency keys on `commit`/`dispatch`/`charge`.

**Acceptance:** real auth-hold → capture; over-estimate path reachable; OTP gates correctly; retries are safe.

---

## Sprint 5 — Dispatcher console

- [ ] `dispatcher-web` app: live job queue, handoff inbox, overrides, safety-event escalation.
- [ ] Wire the "Call a person" handoff to a real dispatcher action.

**Acceptance:** a human can take over any job from a console.

---

## Cross-cutting / hardening (from README "Fix Later Backlog")

- [ ] Lock down `POST /tickets` / `PATCH` so clients can set only user-editable fields (reject `trust_state`, `technician_assignment`, `final_charge`, payment from the browser).
- [ ] Persist + rehydrate active `ticket_id` in the frontend (no duplicate tickets on refresh).
- [ ] Real handoff "Call now" action.
- [ ] Env-driven CORS; restrict production origins.
- [ ] Demo/production flag so fulfillment/payment screens can't be mistaken for real ops.
- [ ] RLS on Storage + PII retention policy; audit log retention; licensing checks per jurisdiction.

---

## Open questions for you (answer inline)

1. API deploy shape — **0a co-locate (rec)** or **0b extract now**?  → _your answer:_
2. Maps render in the customer app — full Maps JS, or static map images for the stub fulfillment screen first?  → _your answer:_
3. Any sprint reordering / scope you want to change?  → _your answer:_
