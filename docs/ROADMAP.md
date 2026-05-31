# ClueXP — Product Roadmap

> Living plan for building the full ClueXP emergency-access platform gradually.
> The long-term product contract is `SPEC.md`; this file is the delivery plan.

## Locked architecture decisions (see `docs/adr/0001-foundation-architecture.md`)

- **Monorepo**, one git repo (`logicacodecom/ClueXP`), `apps/` + `packages/`. Each
  subsystem is a folder, not a separate repo. Separate Vercel projects per app,
  all from this one repo.
- **One shared FastAPI backend** (extracted out of the intake app), not one API
  per frontend.
- **Maps:** Google Maps Platform (Geocoding + Routes + Maps JS).
- **DB access:** raw SQL + Alembic migrations (lean, explicit), in `packages/db`.
- **Storage:** Supabase Storage — public bucket for technician media, private
  (RLS) bucket for ID docs / customer job photos.

## Target repo structure

```
ClueXP/
├─ apps/
│  ├─ intake-web/      # customer PWA (today's Next app)   → Vercel: cluexp-intake
│  ├─ technician-web/  # technician PWA (later)            → Vercel: cluexp-tech
│  ├─ dispatcher-web/  # human ops console (later)         → Vercel: cluexp-ops
│  └─ api/             # shared FastAPI backend            → Vercel: cluexp-api
├─ packages/
│  ├─ schema/          # Pydantic contract + generated TS types
│  └─ db/              # Alembic migrations (raw SQL)
├─ docs/               # SPEC.md, ROADMAP.md, ADRs
└─ supabase/           # storage buckets + RLS, seed scripts
```

## Phase 1 data model (relational core + JSONB detail)

| Table | Purpose |
|---|---|
| `customers` | the requester; `phone` is the identity anchor |
| `technicians` | supply side — skills, service area, availability, rating, location |
| `jobs` | the dispatch spine (evolves from `tickets`); queryable columns + `detail` JSONB holding the `Ticket` payload |
| `dispatch_offers` | offer → accept → fallback cascade (replaces the stubbed single technician) |
| `media` | pointers to files in Supabase Storage |
| `events` | append-only audit log (extended with `job_id`) |

Baseline migration: `packages/db/alembic/versions/0001_baseline.py`.

## File storage (Supabase Storage)

- `public-tech-media` (public): technician profile + vehicle photos (CDN).
- `private-verification` (private, RLS): ID docs, customer job photos (PII).
- Flow: API issues a **signed upload URL** → browser uploads **direct to
  Storage** → API records the path in `media`. Private files served via
  short-lived signed download URLs.

## Maps (Google Maps Platform)

| Need | Side | API |
|---|---|---|
| Address → lat/lng (intake) | backend | Geocoding |
| Map render | frontend | Maps JS (domain-restricted public token) |
| Tech→customer ETA | backend | Routes (traffic-aware) |
| Live tracking | frontend | map + polled position |

Geocoding/routing run **server-side** with the secret key; the browser uses a
separate **domain-restricted** token for rendering only.

## Epics

- **E0 Foundation** — monorepo restructure, extract API, `packages/db` + the Phase-1 schema, Storage buckets, Google Maps keys.
- **E1 Intake** — *(Sprint 1 live)* wire intake to `customers`/`jobs`; real geocoding; photo upload to Storage.
- **E2 Technician** — registry/admin, profile + vetting, availability, location ping; technician PWA.
- **E3 Dispatch engine** — deterministic matcher (geo + skill + availability + rating); offer cascade.
- **E4 Fulfillment** — real map, traffic ETA, live tracking, mutual arrival handshake.
- **E5 Payments** — Stripe auth-hold at commit, capture at finalize; restore the deferred payment gate.
- **E6 Identity/OTP** — restore OTP; ID verification into the private bucket.
- **E7 Dispatcher console** — handoff queue, overrides, safety escalation.
- **E8 Trust, Safety & Hardening** — the README "Fix Later Backlog" (lock down server-owned fields on POST/PATCH, ticket-id rehydration, real handoff action, CORS restriction, demo/prod flag), plus RLS, PII retention, audit, licensing checks.

## Sprint plan (2-week)

| Sprint | Goal | Headline deliverable |
|---|---|---|
| **0 — Foundation** | Restructure + DB | `apps/`+`packages/` layout, API extracted, `packages/db` with the 6 tables applied to Supabase, intake still green |
| **1 — Intake on real model** | Persist properly | Intake writes `customers`+`jobs`; real geocoding; photo upload to Storage |
| **2 — Technician + matching v1** | Kill the stub tech | Technician table+seed+admin; deterministic dispatch + offers |
| **3 — Fulfillment maps** | Real ETAs/tracking | Live map, traffic ETA, mutual arrival handshake |
| **4 — Payments + OTP** | Restore deferred | Stripe auth-hold/capture; OTP back in flow |
| **5 — Dispatcher console** | Human ops | Handoff queue, overrides, safety escalation |

## Sprint 0 — task order (production-safe)

1. **`packages/db`** — Alembic + raw-SQL baseline; apply the 6 tables to Supabase (additive, does not touch the live intake). ✅ first
2. **Monorepo move** — `apps/intake-web`, extract `apps/api`, `packages/schema`; update imports, `vercel.json`, and the Vercel Root Directory. *(only step that touches the live deploy — verify + redeploy)*
3. **Storage buckets** — create the two buckets + a signed-URL upload endpoint.
4. **Google Maps key** — provision + restrict; server-side geocoding of the intake address.
