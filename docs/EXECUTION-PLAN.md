# ClueXP — Execution Plan (revise before build)

> **How to use this doc:** edit it freely — tick `[x]`, strike tasks, change order,
> add notes. I will execute exactly what this file says, sprint by sprint, and
> pause for your review at each sprint boundary. Completed items are marked
> below; unchecked items are not built until you say go. High-level rationale
> lives in `ROADMAP.md` / `adr/0001`.

**Legend:** `[x]` done · `[~]` in progress · `[ ]` planned · ⚠️ touches the live deploy · 🔑 needs something from you

---

## Status snapshot (verified 2026-06-04)

> **2026-06-06 — scope + execution decision (human):** **Localization (i18n) and auth (Clerk / 2B
> auth foundation) are DEFERRED** to a later sprint. Both agents have **full autonomous permission**
> to finish their Sprint 2 work without per-step approval (ownership split unchanged). Tonight Claude
> is executing the **Sprint 2A apply bundle** (apply `0004` to prod → deploy `store.py` → trusted
> `/o/[slug]` resolution → seed → smoke); Codex finishes the 2A **mock UI concepts**. Technician
> mobile polish shipped to prod (`tech.cluexp.com`) earlier today. Per-app `vercel.json` +
> ignore-build step merged (`main` no longer rebuilds all four on every push).

| | |
|---|---|
| Intake app (production) | ✅ live — `www.cluexp.com` + `intake.cluexp.com` (project `cluexp-intake`). **Sprint 1 shipped to prod** (relational store + `/geocode` + photo upload) at commit `eeb3f7c` via `main`; both domains serving 200. `www` to be repurposed for a future public marketing site. |
| Git / branches | ✅ **`main` consolidated** — `feat/sprint0-foundation` fast-forwarded into `main` (`eeb3f7c`); `main` is now the trunk and intake prod auto-deploys from it. New work should branch off `main`. |
| Dispatch database baseline | ✅ applied to Supabase (`packages/db`, rev `0001_baseline`) |
| Provider tenant schema | ✅ applied to Supabase, rev `0003_provider_organizations`; live `alembic_version = 0003` |
| Live DB data | ✅ tables present; **prod intake write path verified 2026-06-04** (test ticket created → persisted to `jobs` with queryable lat/lng/address → read-back → cleaned up). `customers` empty (customer capture not wired — see backlog). |
| Supabase Storage | ✅ `public-tech-media` + `private-verification` (10 MB + MIME limits); RLS on, deny-by-default (backend bypasses as owner role) |
| Relational store (`api/store.py`) | ✅ built + **write contract verified in PRODUCTION** (writes `jobs.detail` + promoted cols, `customers` upsert-by-phone, `events.job_id`; read-only fallback to legacy `tickets`). |
| `GET /api/geocode` | ✅ **working in prod** — server-key restriction fixed (Application restrictions = None); returns real coords (`high`/`low` confidence). |
| CI | ✅ `.github/workflows/ci.yml` on origin; runs on PRs |
| Sprint 0 | ✅ complete |
| Sprint 1 | ✅ **complete + verified in production** (relational store, geocoding, photo upload). |
| Dispatch consoles | ✅ **live** — `ops.cluexp.com` (ClueXP) + `partners.cluexp.com` (provider), 200; shadcn/ui + Tailwind v4 migration **committed (`71d32b5`) + redeployed**. Mock-data UI ahead of backend wiring. ⚠️ copy uses pre-`adr/0004` "ClueXP MODE/ClueXP-routed" language — slated for the Sprint 2A language correction. |
| Technician app | ✅ **live** — `tech.cluexp.com` (`apps/technician-web` PWA, 19 screens) + **real Google Map render** (geocode + Maps JS both live), committed. |
| Tenancy / intake model | ✅ **`adr/0004` accepted** (neutral dispatch network, no ClueXP Direct, three axes, no bidding). Correction pass = **Sprint 2A** (below). |
| Everything unchecked below | ⬜ planned |

## Locked decisions (from ADR 0001)

- Monorepo · Google Maps Platform · raw SQL + Alembic · Supabase Storage.
- **Shared FastAPI backend (logical).** Physically **co-located** inside the
  intake app for now; **extraction to a standalone `apps/api` / `cluexp-api`
  project is deferred** until a second frontend (technician/dispatcher) lands.

## 🔑 Needs from you (blockers, do in parallel)

- [x] **Google Maps — two keys** (both keys were provided in chat; restrict them
  in Google Cloud and do not commit them. Add them to Vercel env vars only.
  Server-side calls and browser rendering must use different,
  separately-restricted keys):
  - `GOOGLE_MAPS_API_KEY` (server credential; second key provided): enable Geocoding + Routes; restrict by **API +
    IP/secret** usage. Never shipped to the browser.
  - `NEXT_PUBLIC_MAPS_BROWSER_KEY` (browser map render; first key provided): **Maps JS only**, restricted by
    **HTTP referrer (domain)**.
- [ ] ⚠️ **FIX `GOOGLE_MAPS_API_KEY` restriction (do later, remind me).**
  Live verification of `GET /api/geocode` (2026-06-01) returned
  `REQUEST_DENIED — "API keys with referer restrictions cannot be used with this
  API."` The server key currently carries an **HTTP-referrer restriction**, which
  Google rejects for the server-side Geocoding API. The endpoint, helper, and key
  injection all work — only the key restriction is wrong. Fix in **Google Cloud
  Console → APIs & Services → Credentials → (the GOOGLE_MAPS_API_KEY key):**
  - **Application restrictions → None** (Vercel egress IPs are dynamic, so no IP
    restriction; the referrer restriction belongs only on the *browser* key).
  - **API restrictions → restrict to Geocoding API** (add Routes API later).
  - Leave `NEXT_PUBLIC_MAPS_BROWSER_KEY` as-is (HTTP-referrer + Maps JS only).
  - No redeploy needed; Google applies it in ~1–2 min. Then re-hit
    `GET /api/geocode?q=<address>` to confirm coordinates come back.
- [x] **Supabase Storage:** buckets created in Supabase dashboard:
  `public-tech-media` + `private-verification`.
- [ ] **Rotate** the Vercel token + Supabase DB password when we wrap (both shared in chat).

---

## Sprint 0 — Foundation

**Goal:** make the *live* app safe, then lay clean structure + the data layer.
Tasks are in execution order; live-hardening runs **before** the restructure.

- [x] **Database** — Alembic baseline (`0001`); 6 baseline dispatch tables applied to Supabase.
- [x] **Live hardening (do first — the app is already public)** ⚠️
  - [x] Lock down `POST /tickets` / `PATCH /tickets/{id}` so clients set only
        user-editable intake fields; reject `trust_state`, `technician_assignment`,
        `final_charge`, and payment fields from the browser.
  - [x] Env-driven **CORS**; restrict production origins (no `*`).
  - [x] Frontend **`ticket_id` rehydration** (persist + restore; no duplicate
        tickets on refresh/back).
  - [x] **Demo/production flag** so fulfillment/payment-review screens cannot be
        mistaken for real operations.
  - [x] Real handoff **"Call now"** action (tel: / dispatcher callback), not a dead button.
- [x] **CI** — add `.github/workflows/ci.yml` (typecheck, build, py compile,
      schema→types drift check, Alembic offline render). See `DEVOPS.md §3`.
- [x] ⚠️ **Monorepo restructure** — *API stays co-located in the intake app*
      (single Vercel project); only folders move:
  - `src/`, `next.config.mjs`, `package.json`, `package-lock.json`, `tsconfig.json`, `next-env.d.ts`, `vercel.json` → `apps/intake-web/`
  - `api/`, `requirements.txt` → **`apps/intake-web/api/`** (co-located)
  - `assets/schema.py` → `apps/intake-web/api/schema.py`
  - `scripts/generate_types.py` → `apps/intake-web/scripts/generate_types.py`
  - generated `schema.generated.ts` → `apps/intake-web/src/types/`
  - `assets/ui/` → `docs/design-ref/` (visual reference only)
  - Update imports (`from assets.schema` → `from api.schema`), the
    type-gen path, and `vercel.json` function globs.
  - [x] ⚠️ Update the Vercel project **Root Directory** to `apps/intake-web`;
        re-verify build; **redeploy**; smoke-test the live flow.
  - *(Deferred to **E2/Sprint 2**: standalone `packages/schema` and `apps/api` /
    `cluexp-api` — the technician app is the triggering client; `adr/0002`.)*
- [~] **Supabase Storage** — buckets exist; operationalize them:
  - [x] `public-tech-media` (public, CDN) · `private-verification` (private).
  - **RLS policies:** owner-scoped read/write on `private-verification`; deny by
    default; public read only on `public-tech-media`.
  - **Signed-URL rules:** upload TTL ~60s, download TTL ~300s.
  - **Limits:** max 10 MB; MIME allowlist (`image/*`; `application/pdf` for IDs);
    **validate size + MIME server-side before issuing the signed URL**.
- [~] **Google Maps** — keys are stored; add a backend `geocode(address)`
      helper (server key); confirm a test address resolves.

**Acceptance:** live app has payload lockdown + restricted CORS + a demo flag;
repo is `apps/`+`packages/` with intake still green in prod; CI runs on PRs;
buckets exist **with policies + size/MIME limits**; `geocode()` returns coords.

---

## Sprint 1 — Intake on the real model

**Goal:** intake stops using the single `tickets` blob and writes the relational model.
**Owner:** Codex.

- [x] **Store layer** — `tickets` JSONB store replaced with `jobs` + `customers`:
  - `POST /tickets`: upsert `customers` (by phone when known) + insert `jobs`;
    `jobs.detail` holds the Ticket payload; promote `trust_state`, `status`,
    `access_type`, `situation`, `lat`, `lng`, `address`, `customer_id`.
  - `require_ticket`/`save` read/write `jobs`; `events` rows carry `job_id`.
  - Keep the API response contract (envelope + guards) unchanged.
  - *Built in `api/store.py`; write contract verified against the live 0003 schema.
    Remaining: drive it through the live flow (not just SQL) and confirm rows land.*
  - ⚠️ `customers` upsert-by-phone is **best-effort** — the public `Ticket` schema has
    no phone field yet, so `_customer_from_payload` rarely finds one. Add a phone field
    (and the `0004` migration if needed) to make customer rows reliably populate.
- [~] **Real geocoding** — location step calls `GET /api/geocode`; persist `lat`/`lng`
      + `geocode_confidence`. *(Endpoint built; live coords blocked on the
      `GOOGLE_MAPS_API_KEY` referrer-restriction fix — see "Needs from you".
      Frontend wiring is built.)*
- [~] **Photo upload to Storage** — `POST /tickets/{id}/photo-intent` → signed URL;
      browser uploads direct to `private-verification` (size/MIME enforced);
      `POST /tickets/{id}/photo-complete` records a `media` row; the intake
      Photos screen uploads selected PNG/JPEG/WebP images. Needs live
      `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` verification in Vercel.
- [ ] **Migration** `0004_*` if columns need adjusting (e.g. customer phone on Ticket).

**Acceptance:** a full run creates `customers`+`jobs`+`media` rows; coords stored;
photo lands in the private bucket and is **only** reachable via a signed URL (RLS verified).

**Deploy note:** branch pushes build an SSO-gated **preview**; production runs the old
store until a merge to `main`. Do not promote the relational store to prod without the
human's explicit go + smoke test.

---

## Sprint 2 — Neutral-network correction, then technician + matching v1

> Decisions: **`adr/0004-tenancy-and-intake.md`** (tenancy/intake — neutral network,
> no ClueXP Direct, three axes, no bidding) + `adr/0002-identity-and-clients.md`
> (future Clerk-backed auth, `cluexp-api` extraction).
>
> **Sequencing (human, 2026-06-04):** do the **correction pass + document updates
> FIRST (2A)**, then the auth/extraction/dispatch build (2B).

### 2A — Tenancy correction pass (do first, per `adr/0004`)
- [x] **ADR 0004** authored (neutral network; origin/customer-owner/fulfillment;
      `dispatch_mode` vs `fulfillment_policy`; no bidding; trusted-channel resolution).
- [x] **Docs realigned** — SPEC §2.10 reworded; ROADMAP/this plan reframed to the
      neutral-network model; console spec + `DATABASE-AND-STORAGE` updated.
- [x] **Infra (Claude):** migration `0004_tenancy_and_intake` **APPLIED to prod** (verified
      `alembic_version = 0005`; `0004` is its parent in the linear graph, so necessarily applied).
      The coupled `api/store.py` tenancy writes are **on `main` and live** (intake auto-deploys).
      The old `chore/sprint2b-0004-apply` branch is now **behind `main`** (superseded).
- [x] **Code language correction** (Codex, merged) — `dispatch_owner` retired;
      `provider_organization_id` → `fulfillment_org_id`; mock fixtures re-expressed as
      Origin=ClueXP / Fulfillment=partner-or-tech; console/technician copy on the neutral
      lexicon ("ClueXP Direct / our techs / ClueXP MODE / direct-release" removed). Builds green.
- [ ] **Mock UI concepts** (no live marketplace mechanics): org dispatch-policy
      settings, anonymous-capacity map/list (masked PII), network-release action,
      ranked-match mock. *(Codex — in progress 2026-06-06.)*

### 2A+ — Multi-tenant intake & dispatch update (pulled into current scope, human 2026-06-04)
> Priority: make the **existing** intake + dispatch systems multi-tenant now. Plain
> mobile-web (no PWA). Ships as one bundle with the `0004` apply.
- [x] **Per-org intake link (REAL):** `/o/[slug]` page (Codex) + **trusted server-side
      slug→org resolution** stamping `origin_org_id` / `customer_owner_org_id` /
      `intake_channel_id` (Claude, `store.py`). **Verified live in prod 2026-06-06** — smoke:
      `POST /api/tickets` with `intake_channel:"metro-key"` → job carried `origin_org_id` =
      metro-key org (browser org id never trusted). Test artifact cleaned up.
- [x] **Dispatch consoles (display update):** **Origin / Customer-Owner / Fulfillment** +
      `dispatch_mode` / `fulfillment_policy` in board/table/drawer; neutral lexicon. (Codex; mock
      data — real `cluexp-api` wiring stays 2B.)
- [x] **Infra ship (Claude):** `0004` applied to prod; one provider org (`metro-key`,
      Metro Key Partners) + active intake channel seeded; `store.py` + intake API live; **prod
      smoke passed** 2026-06-06.

### 2B — Auth + extraction + dispatch v1 (after 2A)
- [ ] **Auth foundation** — migrate production auth direction to **Clerk**
      (`adr/0002`): add Clerk to ops/provider/technician apps; verify Clerk-issued
      tokens in FastAPI; map Clerk user/org context to local `users` /
      `organizations` records via external refs; keep ClueXP tables authoritative
      for technicians, compliance, dispatch permissions, jobs, and reviews; retire
      the custom demo `/auth/login` flow once Clerk sign-in is verified.
- [ ] **API extraction** — move the shared FastAPI to standalone `apps/api`
      (`cluexp-api`) + `packages/schema`; intake-web consumes it over HTTP.
- [x] **Provider tenant schema** — support individual technicians and
      company/group organizations with affiliated technicians
      (`organizations`, recursive `organization_teams`,
      `organization_technicians`, `organization_team_technicians`, technician
      `provider_type`, `provider_documents`).
- [ ] Organization onboarding: company/group can register itself, set service
      area/contact details, add description/notes, create
      departments/groups/business units, and invite or bulk-create affiliated
      technicians.
- [ ] Team management: teams can be nested, described, activated/deactivated,
      and assigned one or many affiliated technicians.
- [ ] Compliance documents: upload/review/expire documents for organizations
      and technicians only; teams are virtual and have no legal docs.
- [ ] Individual technician onboarding remains supported for solo operators.
- [ ] Seed `organizations` + teams + `technicians` (individual + affiliated;
      varied skills/areas) + a minimal admin list view.
- [ ] **Dispatch engine v1** (deterministic, outside the intake graph per SPEC §2.7):
      score by distance (service_area), skill (`access_type`/key type), availability, rating.
- [ ] `/dispatch` creates `dispatch_offers` for top-N; first accept wins via
      backend transaction/constraint (not UI timing); timeout → next; sets
      `jobs.fulfillment_technician_id` (and `fulfillment_org_id` when an org fulfills,
      else null for an independent tech — `adr/0004` §2/§9); preserves the job's
      `origin_org_id`/`customer_owner_org_id`; flips `trust_state=matched`.
- [ ] Technician offer delivery v1 may poll `dispatch_offers`; production-grade
      real-time delivery (push/websocket/native notifications), expiry countdown
      correctness, and mobile alert reliability are tracked under Roadmap E3
      before relying on live server→device alerts.
- [ ] Technician location ping (`current_lat/lng`).

**Acceptance:** dispatch picks a real seeded technician by rule, whether solo or
affiliated; offers record the technician and provider organization where
applicable; trust gating intact.

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

> The UI shell is already built ahead of schedule as `ops-web` + `provider-web` on the shared
> `console-ui` core (mock-data; see status snapshot). This sprint wires it to the real API and
> adds human-ops behavior.

- [ ] `ops-web` (ClueXP) / `provider-web` (org): live job queue, handoff inbox, overrides, safety
      escalation — backed by `cluexp-api` instead of mock data.

**Acceptance:** a human can take over any job from a console, against real data.

---

## Cross-cutting (ongoing — not deferred-and-forgotten)

> Live-app safety items moved into **Sprint 0** above. What remains is genuinely
> later/continuous:

- [ ] PII retention policy (purge `id_document` media N days post-completion; log to `events`).
- [ ] Audit-log retention/archival for `events`.
- [ ] Licensing/insurance checks per jurisdiction before activating an individual
      technician or a provider organization.
- [ ] Expiration monitoring for provider documents; prevent dispatch when
      required organization/technician documents are missing, rejected, or expired.
- [ ] Subscription/billing model for provider organizations.
- [ ] Error tracking (Sentry) + API health check + alerting (see `DEVOPS.md §7`).

---

## Open questions for you (answer inline)

1. ~~API deploy shape~~ — **resolved: co-locate now, extraction deferred** (flip if you disagree).
2. ~~Maps render in the customer app~~ — **resolved:** consoles use static map cards (SPEC §8.8); customer-app real Maps JS lands Sprint 3 / E4.
3. ~~Sprint reordering~~ — **reordered 2026-06-03:** the dispatch consoles (both surfaces) and, next, the technician live screens are pulled **ahead** of their E2/E7 backend slots — built as mock UI first for an end-to-end whole-picture demo. Backend wiring (E2: auth + `cluexp-api` + dispatch engine) follows.
4. ~~Dispatch authority for affiliated technicians~~ — **resolved (direction, not
   scheduled; SPEC §2.10):** organization-managed by default; org can release a specific
   tech for direct ClueXP dispatch. Individuals = ClueXP-dispatched. Future columns
   (`organizations.dispatch_mode`, `organization_technicians.direct_dispatch_allowed`,
   polymorphic `dispatch_offers.target_type`) are planned-not-applied. Sprint 2 ships
   ClueXP-managed dispatch only.
