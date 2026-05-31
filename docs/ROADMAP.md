# ClueXP — Product Roadmap

> Living plan for building the full ClueXP emergency-access platform gradually.
> The long-term product contract is `SPEC.md`; this file is the delivery plan.

## Locked architecture decisions (see `docs/adr/0001-foundation-architecture.md`)

- **Monorepo**, one git repo (`logicacodecom/ClueXP`), `apps/` + `packages/`. Each
  subsystem is a folder, not a separate repo. Separate Vercel projects per app,
  all from this one repo.
- **One shared FastAPI backend** (one logical service), not one API per frontend.
  Co-located inside the intake app for now; standalone extraction deferred until
  a second frontend exists.
- **Maps:** Google Maps Platform (Geocoding + Routes + Maps JS).
- **DB access:** raw SQL + Alembic migrations (lean, explicit), in `packages/db`.
- **Storage:** Supabase Storage — public bucket for technician media, private
  (RLS) bucket for ID docs / customer job photos.

## Target repo structure

```
ClueXP/
├─ apps/
│  ├─ intake-web/      # customer PWA + co-located API     → Vercel: cluexp-intake
│  │  └─ api/          #   FastAPI (Python functions)
│  ├─ technician-web/  # technician PWA (later)            → Vercel: cluexp-tech
│  └─ dispatcher-web/  # human ops console (later)         → Vercel: cluexp-ops
├─ packages/
│  └─ db/              # Alembic migrations (raw SQL)
├─ docs/               # SPEC.md, ROADMAP.md, ADRs
└─ supabase/           # storage buckets + RLS, seed scripts

# Deferred: packages/schema and apps/api as standalone shared packages/deployables
# once a 2nd frontend lands. For now the schema is co-located at
# apps/intake-web/api/schema.py.
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

- **E0 Foundation** — live-app hardening, monorepo restructure (API co-located), `packages/db` + the Phase-1 schema, Storage buckets, CI, Google Maps keys.
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
| **0 — Foundation** | Hardening + restructure + DB | live-app hardening, `apps/`+`packages/` layout (API co-located), CI, `packages/db` 6 tables on Supabase, intake still green |
| **1 — Intake on real model** | Persist properly | Intake writes `customers`+`jobs`; real geocoding; photo upload to Storage |
| **2 — Technician + matching v1** | Kill the stub tech | Technician table+seed+admin; deterministic dispatch + offers |
| **3 — Fulfillment maps** | Real ETAs/tracking | Live map, traffic ETA, mutual arrival handshake |
| **4 — Payments + OTP** | Restore deferred | Stripe auth-hold/capture; OTP back in flow |
| **5 — Dispatcher console** | Human ops | Handoff queue, overrides, safety escalation |

## Sprint 0 — task order (production-safe)

1. **`packages/db`** — Alembic + raw-SQL baseline; the 6 tables on Supabase. ✅ done
2. **Live hardening** — the app is already public: payload lockdown on POST/PATCH, restricted CORS, ticket-id rehydration, demo/prod flag, real handoff action.
3. **CI** — `.github/workflows/ci.yml` (typecheck, build, py compile, types drift, Alembic offline render).
4. **Monorepo move** — `apps/intake-web` (API + schema co-located at `apps/intake-web/api`); update imports, `vercel.json`, and the Vercel Root Directory. *(only step that touches the live deploy — verify + redeploy)*
5. **Storage buckets** — both buckets **with RLS policies + size/MIME limits** + signed-URL upload endpoint.
6. **Google Maps keys** — provision two restricted keys (server + browser); server-side geocoding.

Full detail + acceptance criteria: `EXECUTION-PLAN.md`.
