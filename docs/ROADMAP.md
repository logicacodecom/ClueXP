# ClueXP — Product Roadmap

> Living plan for building the full ClueXP emergency-access platform gradually.
> The long-term product contract is `SPEC.md`; this file is the delivery plan.

## Locked architecture decisions (see `docs/adr/0001-foundation-architecture.md`)

- **Monorepo**, one git repo (`logicacodecom/ClueXP`), `apps/` + `packages/`. Each
  subsystem is a folder, not a separate repo. Separate Vercel projects per app,
  all from this one repo.
- **One shared FastAPI backend** (one logical service), not one API per frontend.
  Co-located inside the intake app for now; standalone `cluexp-api` extraction
  scheduled for **E2** (the technician app is the triggering client; `adr/0002`).
- **Maps:** Google Maps Platform (Geocoding + Routes + Maps JS).
- **DB access:** raw SQL + Alembic migrations (lean, explicit), in `packages/db`.
- **Storage:** Supabase Storage — public bucket for technician media, private
  (RLS) bucket for ID docs / customer job photos.

## Target repo structure

```
ClueXP/
├─ apps/
│  ├─ intake-web/      # customer PWA + co-located API (until E2) → Vercel: cluexp-intake
│  │  └─ api/          #   FastAPI (Python functions)
│  ├─ api/             # standalone cluexp-api (extracted at E2)  → Vercel: cluexp-api
│  ├─ technician/      # technician app: PWA → React Native/Expo  → cluexp-tech
│  ├─ provider-web/    # company/provider portal (org admin)      → cluexp-provider
│  └─ ops-web/         # dispatcher + admin/back-office console   → cluexp-ops
├─ packages/
│  └─ db/              # Alembic migrations (raw SQL)
├─ docs/               # SPEC.md, ROADMAP.md, ADRs
└─ supabase/           # storage buckets + RLS, seed scripts

# API extraction (apps/api) + packages/schema land at E2 — the first non-intake
# client. Until then the schema is co-located at apps/intake-web/api/schema.py.
# See adr/0002-identity-and-clients.md.
```

## UI surfaces (front-end systems)

| Surface | User | Channel | Lands |
|---|---|---|---|
| **Intake** | Customer (anonymous, phone-anchored) | Mobile-web PWA | ✅ live |
| **Technician** | Technician (solo + affiliated) | PWA → **React Native** | E2 |
| **Provider portal** | Org admin/owner | Web | E2 |
| **Ops console** | ClueXP dispatcher + admin/back-office | Web | E7 (may start as views, split later) |

All non-intake surfaces share one login (self-owned JWT + `users`; `adr/0002`).

## Phase 1 data model (relational core + JSONB detail)

| Table | Purpose |
|---|---|
| `users` | logged-in actors (technician/staff/admin); flat `role`, self-owned JWT auth (added at E2; `adr/0002`) |
| `customers` | the requester; `phone` is the identity anchor (anonymous, no login) |
| `organizations` | company/group tenants that can register affiliated technicians; future subscription anchor |
| `technicians` | supply-side people — individual or affiliated; skills, service area, availability, rating, location |
| `organization_technicians` | company/group membership for affiliated technicians |
| `organization_teams` | recursive departments/groups/business units inside a provider organization |
| `organization_team_technicians` | technician membership in one or many organization teams |
| `provider_documents` | legal/compliance documents, status, storage pointer, and expiration for organizations or technicians |
| `jobs` | the dispatch spine (evolves from `tickets`); queryable columns + `detail` JSONB holding the `Ticket` payload |
| `dispatch_offers` | offer → accept → fallback cascade (replaces the stubbed single technician) |
| `media` | pointers to files in Supabase Storage |
| `events` | append-only audit log (extended with `job_id`) |

Baseline migration: `packages/db/alembic/versions/0001_baseline.py`; provider
tenant extension: `packages/db/alembic/versions/0003_provider_organizations.py`.

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
- **E2 Technician & Access** — self-owned auth foundation (`users` + JWT, flat role; `adr/0002`); **extract `cluexp-api`** (first non-intake client); individual + company/group registry, recursive organization teams, legal/compliance document capture, affiliated technician onboarding, profile + vetting, availability, location ping; technician app (PWA → React Native) + provider portal.
- **E3 Dispatch engine** — deterministic matcher (geo + skill + availability + rating); offer cascade; backend-enforced first-accept-wins concurrency; production technician offer delivery (polling acceptable for v1, push/websocket/native notifications required before relying on real-time mobile alerts). *(v1 = ClueXP-managed only. Later: organization-managed dispatch — affiliated supply routed to the org, with a per-tech direct-dispatch release; SPEC §2.10. Not scheduled.)*
- **E4 Fulfillment** — real map, traffic ETA, live tracking, mutual arrival handshake.
- **E5 Payments** — Stripe auth-hold at commit, capture at finalize; restore the deferred payment gate.
- **E6 Identity/OTP** — restore OTP; ID verification into the private bucket.
- **E7 Dispatcher console** — handoff queue, overrides, safety escalation.
- **E8 Trust, Safety & Hardening** — the README "Fix Later Backlog" (lock down server-owned fields on POST/PATCH, ticket-id rehydration, real handoff action, CORS restriction, demo/prod flag), plus RLS, PII retention, audit, licensing checks.

## Sprint plan (2-week)

| Sprint | Goal | Headline deliverable |
|---|---|---|
| **0 — Foundation** | Hardening + restructure + DB | live-app hardening, `apps/`+`packages/` layout (API co-located), CI, baseline dispatch schema on Supabase, intake still green |
| **1 — Intake on real model** | Persist properly | Intake writes `customers`+`jobs`; real geocoding; photo upload to Storage |
| **2 — Technician + matching v1** | Kill the stub tech | Auth foundation (`users`+JWT) + `cluexp-api` extraction; provider/team/technician registry + onboarding; deterministic dispatch + offers |
| **3 — Fulfillment maps** | Real ETAs/tracking | Live map, traffic ETA, mutual arrival handshake |
| **4 — Payments + OTP** | Restore deferred | Stripe auth-hold/capture; OTP back in flow |
| **5 — Dispatcher console** | Human ops | Handoff queue, overrides, safety escalation |

## Sprint 0 — task order (production-safe)

1. **`packages/db`** — Alembic + raw-SQL baseline on Supabase. ✅ done
2. **Live hardening** — the app is already public: payload lockdown on POST/PATCH, restricted CORS, ticket-id rehydration, demo/prod flag, real handoff action.
3. **CI** — `.github/workflows/ci.yml` (typecheck, build, py compile, types drift, Alembic offline render).
4. **Monorepo move** — `apps/intake-web` (API + schema co-located at `apps/intake-web/api`); update imports, `vercel.json`, and the Vercel Root Directory. *(only step that touches the live deploy — verify + redeploy)*
5. **Storage buckets** — both buckets **with RLS policies + size/MIME limits** + signed-URL upload endpoint.
6. **Google Maps keys** — provision two restricted keys (server + browser); server-side geocoding.

Full detail + acceptance criteria: `EXECUTION-PLAN.md`.
