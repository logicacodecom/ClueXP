# ADR 0001 — Foundation architecture

- **Status:** Accepted (2026-05-31)
- **Context:** ClueXP grows from the single intake app into a full platform
  (technician, dispatch, fulfillment, payments, ops console), built gradually.

## Decisions

### 1. Monorepo, not multiple repos
One git repo with `apps/` (deployables) and `packages/` (shared `schema`, `db`).
Each subsystem is a folder. Rationale: a small team sharing one domain contract;
polyrepo would force duplicating/publishing the schema and split every
cross-cutting change across repos. Vercel supports multiple projects from one
repo via per-project Root Directory.

### 2. One shared FastAPI backend
The API is extracted into `apps/api` and shared by all frontends, rather than one
API per app. Keeps the SPEC §2.7 separation (agent collects; deterministic
engines dispatch/price) in a single authoritative service.

### 3. Maps: Google Maps Platform
Chosen over Mapbox for geocoding accuracy and traffic-aware Routes ETAs, because
the SPEC makes honest ETAs a trust requirement. Cost is accepted; keys are
domain/secret-restricted (render token in the browser, geocoding/routing on the
backend).

### 4. DB access: raw SQL + Alembic
Keep the lean psycopg/raw-SQL style from `api/store.py`; add Alembic for
versioned migrations. Data model is a relational core (queryable columns for
dispatch) plus a `detail` JSONB column holding the Pydantic `Ticket` payload, so
the schema-as-contract approach is preserved.

### 5. Storage: Supabase Storage
Reuse the existing Supabase project. Public bucket for technician media; private
RLS bucket for ID docs and customer job photos. Browser uploads direct via
signed URLs; Postgres stores only object paths.

## Consequences

- A one-time Sprint-0 restructure moves the current root-level Next app into
  `apps/intake-web` and extracts `apps/api`; the Vercel project's Root Directory
  must be updated and the deploy re-verified.
- Migrations run against the Supabase **direct** connection (5432); the app uses
  the **transaction pooler** (6543).
