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

- Monorepo · Google Maps Platform · raw SQL + Alembic · Supabase Storage.
- **Shared FastAPI backend (logical).** Physically **co-located** inside the
  intake app for now; **extraction to a standalone `apps/api` / `cluexp-api`
  project is deferred** until a second frontend (technician/dispatcher) lands.

## 🔑 Needs from you (blockers, do in parallel)

- [ ] **Google Maps — two keys** (server-side calls and browser rendering must
  use different, separately-restricted keys):
  - `GOOGLE_MAPS_API_KEY` (server): enable Geocoding + Routes; restrict by **API +
    IP/secret** usage. Never shipped to the browser.
  - `NEXT_PUBLIC_MAPS_BROWSER_KEY` (browser): **Maps JS only**, restricted by
    **HTTP referrer (domain)**.
- [ ] **Supabase Storage:** authenticate the Supabase plugin (so I can create
  buckets + policies), or create `public-tech-media` + `private-verification` in
  the dashboard.
- [ ] **Rotate** the Vercel token + Supabase DB password when we wrap (both shared in chat).

---

## Sprint 0 — Foundation

**Goal:** make the *live* app safe, then lay clean structure + the data layer.
Tasks are in execution order; live-hardening runs **before** the restructure.

- [x] **Database** — Alembic baseline; the 6 dispatch tables applied to Supabase.
- [ ] **Live hardening (do first — the app is already public)** ⚠️
  - [ ] Lock down `POST /tickets` / `PATCH /tickets/{id}` so clients set only
        user-editable intake fields; reject `trust_state`, `technician_assignment`,
        `final_charge`, and payment fields from the browser.
  - [ ] Env-driven **CORS**; restrict production origins (no `*`).
  - [ ] Frontend **`ticket_id` rehydration** (persist + restore; no duplicate
        tickets on refresh/back).
  - [ ] **Demo/production flag** so fulfillment/payment-review screens cannot be
        mistaken for real operations.
  - [ ] Real handoff **"Call now"** action (tel: / dispatcher callback), not a dead button.
- [ ] **CI** — add `.github/workflows/ci.yml` (typecheck, build, py compile,
      schema→types drift check, Alembic offline render). See `DEVOPS.md §3`.
- [ ] ⚠️ **Monorepo restructure** — *API stays co-located in the intake app*
      (single Vercel project); only folders move:
  - `src/`, `next.config.mjs`, `package.json`, `tsconfig.json`, `next-env.d.ts` → `apps/intake-web/`
  - `api/`, `requirements.txt`, `vercel.json` → **`apps/intake-web/api/`** (co-located)
  - `assets/schema.py`, `scripts/generate_types.py` → `packages/schema/`
  - generated `schema.generated.ts` → `apps/intake-web/src/types/`
  - `assets/ui/` → `docs/design-ref/` (visual reference only)
  - Update imports (`from assets.schema` → `from packages.schema...`), the
    type-gen path, and `vercel.json` function globs.
  - [ ] ⚠️ Update the Vercel project **Root Directory** to `apps/intake-web`;
        re-verify build; **redeploy**; smoke-test the live flow.
  - *(Deferred: a standalone `apps/api` + `cluexp-api` Vercel project — do this
    when `technician-web` arrives.)*
- [ ] **Supabase Storage** 🔑 — create buckets **and operationalize them**:
  - `public-tech-media` (public, CDN) · `private-verification` (private).
  - **RLS policies:** owner-scoped read/write on `private-verification`; deny by
    default; public read only on `public-tech-media`.
  - **Signed-URL rules:** upload TTL ~60s, download TTL ~300s.
  - **Limits:** max 10 MB; MIME allowlist (`image/*`; `application/pdf` for IDs);
    **validate size + MIME server-side before issuing the signed URL**.
- [ ] **Google Maps** 🔑 — store the two keys above; add a backend
      `geocode(address)` helper (server key); confirm a test address resolves.

**Acceptance:** live app has payload lockdown + restricted CORS + a demo flag;
repo is `apps/`+`packages/` with intake still green in prod; CI runs on PRs;
buckets exist **with policies + size/MIME limits**; `geocode()` returns coords.

---

## Sprint 1 — Intake on the real model

**Goal:** intake stops using the single `tickets` blob and writes the relational model.

- [ ] **Store layer** — replace the `tickets` JSONB store with `jobs` + `customers`:
  - `POST /tickets`: upsert `customers` (by phone when known) + insert `jobs`;
    `jobs.detail` holds the Ticket payload; promote `trust_state`, `status`,
    `access_type`, `situation`, `lat`, `lng`, `address`, `customer_id`.
  - `require_ticket`/`save` read/write `jobs`; `events` rows carry `job_id`.
  - Keep the API response contract (envelope + guards) unchanged.
- [ ] **Real geocoding** — GPS/address persists `lat`/`lng` + `geocode_confidence`.
- [ ] **Photo upload to Storage** — `POST /tickets/{id}/photo-intent` → signed URL;
      browser uploads direct to `private-verification` (size/MIME enforced);
      record a `media` row; the intake Photos screen actually stores.
- [ ] **Migration** `0002_*` if columns need adjusting.

**Acceptance:** a full run creates `customers`+`jobs`+`media` rows; coords stored;
photo lands in the private bucket and is **only** reachable via a signed URL (RLS verified).

---

## Sprint 2 — Technician registry + matching v1

- [ ] Seed `technicians` (varied skills/areas) + a minimal admin list view.
- [ ] **Dispatch engine v1** (deterministic, outside the intake graph per SPEC §2.7):
      score by distance (service_area), skill (`access_type`/key type), availability, rating.
- [ ] `/dispatch` creates `dispatch_offers` for top-N; first accept wins; timeout →
      next; assigns `jobs.technician_id`, flips `trust_state=matched`.
- [ ] Technician location ping (`current_lat/lng`).

**Acceptance:** dispatch picks a real seeded technician by rule; offers recorded; trust gating intact.

---

## Sprint 3 — Fulfillment maps

- [ ] Real Google map on tracking screen (browser key).
- [ ] Backend traffic-aware ETA via Routes API (replaces the `sin()` stub).
- [ ] Live position polling from `technicians.current_lat/lng`.
- [ ] Mutual arrival handshake (tech proves to customer) backed by a real code store.

**Acceptance:** customer sees a real map + backend ETA; arrival verified both ways.

---

## Sprint 4 — Payments + OTP (restore deferred)

- [ ] Stripe: auth-hold at `commit`, capture at `finalize`, release on cancel;
      over-estimate approval before capture (make `finalize` able to exceed — fixes the dead path).
- [ ] Restore the payment-method precondition in `commit` + `is_dispatchable()`.
- [ ] Restore OTP send/verify in the flow.
- [ ] Idempotency keys on `commit`/`dispatch`/`charge`.

**Acceptance:** real auth-hold → capture; over-estimate path reachable; OTP gates; retries safe.

---

## Sprint 5 — Dispatcher console

- [ ] `dispatcher-web` app: live job queue, handoff inbox, overrides, safety escalation.

**Acceptance:** a human can take over any job from a console.

---

## Cross-cutting (ongoing — not deferred-and-forgotten)

> Live-app safety items moved into **Sprint 0** above. What remains is genuinely
> later/continuous:

- [ ] PII retention policy (purge `id_document` media N days post-completion; log to `events`).
- [ ] Audit-log retention/archival for `events`.
- [ ] Licensing/insurance checks per jurisdiction before activating a technician.
- [ ] Error tracking (Sentry) + API health check + alerting (see `DEVOPS.md §7`).

---

## Open questions for you (answer inline)

1. ~~API deploy shape~~ — **resolved: co-locate now, extraction deferred** (flip if you disagree). → _your answer:_
2. Maps render in the customer app — full Maps JS now, or static map images for the stub fulfillment screen first? → _your answer:_
3. Any sprint reordering / scope changes? → _your answer:_
