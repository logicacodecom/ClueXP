# ClueXP Emergency Access Intake

Mobile-web-first emergency access intake for ClueXP: a Next.js + TypeScript frontend backed by a minimal FastAPI service that imports the canonical Pydantic contract from `apps/intake-web/api/schema.py`.

## Canonical docs

The project is documented by four canonical docs (plus a pilot runbook):

- [`docs/SYSTEM-DESIGN.md`](docs/SYSTEM-DESIGN.md) — tech stack, database + storage, infrastructure, and the four subsystem specs (intake / technician / partner / ops). **Architecture source of truth.**
- [`docs/TECHNICIAN-APP-REDESIGN.md`](docs/TECHNICIAN-APP-REDESIGN.md) — approved active-job-first technician experience, native/PWA boundaries, development workstreams, testing, and rollout gates.
- [`docs/EXECUTION-PLAN.md`](docs/EXECUTION-PLAN.md) — product backlog, releases, sprints, tasks, and **Canonical Status**.
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — the UI Guide (visual tokens, components); `docs/design-ref/` holds reference assets only.
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — the multi-agent communication channel.
- Architecture decisions (why/rejected alternatives) live in `SYSTEM-DESIGN.md` §20 · [`docs/PILOT-OPERATIONS.md`](docs/PILOT-OPERATIONS.md) — pilot gates, cutover, matrix, rollback.

## Project Shape

- `apps/intake-web/api/schema.py` - canonical Pydantic ticket schema. Do not duplicate it by hand.
- `apps/intake-web/api/main.py` - FastAPI backend; tickets persist in Supabase Postgres (`DATABASE_URL`) with an in-memory fallback for local dev. Routes are served under `/api`. Trust-state guards travel on every response.
- `apps/intake-web/src/app/page.tsx` - mobile-first intake and fulfillment flow.
- `apps/intake-web/src/types/schema.generated.ts` - generated TypeScript contract derived from `api/schema.py`.
- `apps/intake-web/scripts/generate_types.py` - local schema-to-TypeScript generator.
- `packages/db/` - Alembic migrations for the dispatch relational core.
- `apps/ops-web/`, `apps/provider-web/` - dispatch consoles (ClueXP ops + provider org) built on shared `packages/console-ui` (`SYSTEM-DESIGN.md` §18.3–§18.4, §20.3).
- `apps/technician-web/` - technician field PWA (`SYSTEM-DESIGN.md` §18.2; redesign and native-ready delivery plan in `docs/TECHNICIAN-APP-REDESIGN.md`).
- `packages/api-client/`, `packages/console-ui/` - shared types + mock data and the shared console component system (seam for the future `cluexp-api`).

> This is an npm-workspace monorepo (`apps/*` + `packages/*`). The instructions below cover the
> **intake** app; the consoles run via `npm run dev:ops` / `npm run dev:provider` from the repo root.

## Requirements

- Node.js 24+
- npm
- uv

## Install

```powershell
cd apps/intake-web
npm install
cd ..\..
uv sync
```

## Generate Types

Run this whenever `apps/intake-web/api/schema.py` changes:

```powershell
cd apps/intake-web
npm run generate:types
```

## Run Locally

Start the API:

```powershell
cd apps/intake-web
uv run uvicorn api.main:app --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```powershell
cd apps/intake-web
npm run dev
```

Open:

- Frontend: http://127.0.0.1:3000
- API docs: http://127.0.0.1:8000/docs

Without `DATABASE_URL` the API uses an in-memory store, so no database is needed
for local work. If you *do* run locally against Supabase Postgres **on Windows**,
the selector event loop must be set in the *same* process that starts uvicorn —
psycopg's async driver cannot use Windows' default `ProactorEventLoop`:

```powershell
$env:DATABASE_URL = "postgresql://postgres:PASSWORD@HOST:5432/postgres"
uv run python -c "import asyncio, sys, uvicorn; sys.platform=='win32' and asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy()); uvicorn.run('api.main:app', host='127.0.0.1', port=8000)"
```

This only affects local Windows + Postgres; Vercel's Linux runtime and the
in-memory fallback are unaffected. Percent-encode any `@` in the password as `%40`.

## Current Product State

The platform deploys on:

- **Vercel** for the Next.js frontend and FastAPI Python runtime.
- **Supabase Postgres** for live ticket persistence.

Real intake, authentication, provider onboarding, provider-managed dispatch,
technician fulfillment, arrival verification, customer confirmation/review/dispute,
dispatcher resolution and automatic closure are deployed; the authenticated production
happy path has been smoke-tested. The next priority is operational readiness described in
`docs/EXECUTION-PLAN.md`: approve dispatcher acknowledgement SLA and coverage, add durable
background alerts, and complete the pilot evidence matrix. The provider queue has configurable
SLA/stalled indicators and opt-in browser alerts for a staffed open console. Production
SMS/email/push and real payment authorization/capture/refund remain unimplemented;
technician-reported collection is advisory only. The accepted real-payment direction is
provider-owned Stripe Connect direct charges: each provider is merchant of record and ClueXP does
not hold or settle provider funds.

Vercel production traffic should call the API through the same deployment at `/api/...`. Local development rewrites `/api/...` to `LOCAL_API_BASE_URL`, which defaults to `http://127.0.0.1:8000`.

Use Supabase's transaction pooler connection string for Vercel serverless Python:

```env
DATABASE_URL=postgres://postgres.PROJECT_REF:YOUR_PASSWORD@aws-REGION.pooler.supabase.com:6543/postgres
```

Copy `.env.example` into the relevant Vercel project environment variables rather than committing real secrets.

## Live Setup Checklist

1. Create a Supabase project.
2. Copy the transaction pooler Postgres URL into Vercel as `DATABASE_URL`.
3. Import the GitHub repo into Vercel.
4. Set the Vercel framework to Next.js.
5. Confirm Python functions are detected from `apps/intake-web/api/main.py`.
6. Deploy from `main`.
7. Smoke test on mobile: create ticket, submit intake, confirm the record persists.

## Fix Later Backlog

Most of the original hardening items are now handled in Sprint 0/1 — see `docs/EXECUTION-PLAN.md`
for the authoritative current status. Snapshot:

1. ✅ Photo upload wired to Supabase Storage (signed upload/download URLs, size/MIME validation).
2. ✅ Storage buckets + RLS policies created (`public-tech-media`, `private-verification`).
3. ✅ Server-side geocoding works. Traffic-aware routing and durable live customer
   tracking remain planned.
4. ✅ Relational store: intake writes `customers` + `jobs` (legacy `tickets` kept as read-only fallback).

## Verification

```powershell
cd apps/intake-web
npx tsc --noEmit
npm run build
cd ..\..
uv run python -m compileall apps\intake-web\api apps\intake-web\scripts packages
```

## Trust-State Rule

The UI must not invent technician data, ETAs, tracking, prices, fees, or final charges. Those values come from the backend. The backend returns guard booleans derived from the `Ticket` methods:

- `may_show_technician`
- `may_show_eta`
- `may_show_live_tracking`

Frontend rendering should use those guards instead of deciding visibility locally.

## Notes

Some original demo fulfillment endpoints remain for rollback/demo use. They are
not evidence of a production completion or payment cycle; see the canonical
status in `docs/EXECUTION-PLAN.md`.
