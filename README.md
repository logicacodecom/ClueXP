# ClueXP Emergency Access Intake

Mobile-web-first emergency access intake for ClueXP. This build follows `SPEC.md`: a Next.js + TypeScript frontend backed by a minimal FastAPI service that imports the canonical Pydantic contract from `assets/schema.py`.

## Project Shape

- `SPEC.md` - product and architecture source of truth.
- `assets/schema.py` - canonical Pydantic ticket schema. Do not duplicate it by hand.
- `assets/ui/` - visual references and design tokens from the Stitch output.
- `api/main.py` - FastAPI stub backend; tickets persist in Supabase Postgres (`DATABASE_URL`) with an in-memory fallback for local dev. Routes are served under `/api`. Trust-state guards travel on every response.
- `src/app/page.tsx` - mobile-first intake and fulfillment flow.
- `src/types/schema.generated.ts` - generated TypeScript contract derived from `assets/schema.py`.
- `scripts/generate_types.py` - local schema-to-TypeScript generator.

## Requirements

- Node.js 24+
- npm
- uv

## Install

```powershell
npm install
uv sync
```

## Generate Types

Run this whenever `assets/schema.py` changes:

```powershell
npm run generate:types
```

## Run Locally

Start the API:

```powershell
uv run uvicorn api.main:app --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```powershell
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

## Current Sprint Deployment

The intake sprint deploys on:

- **Vercel** for the Next.js frontend and FastAPI Python runtime.
- **Supabase Postgres** for live ticket persistence.

For this sprint, **OTP verification and payment-method capture are deferred** (§7.10, §7.12). The flow runs intake → price acceptance → `commit` → technician **dispatch**, transitioning `trust_state` INTAKE → MATCHED and showing the assigned technician (name, role, rating, ETA) on the MATCHED screen. Live tracking, arrival verification, and payment/review remain reachable for demo. Because payment-on-file is skipped, `commit` and `is_dispatchable()` temporarily drop the payment precondition — price acceptance is the commercial-consent gate. Technician data is still shown **only** at MATCHED or later, gated by the trust-state guards.

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
5. Confirm Python functions are detected from `api/main.py`.
6. Deploy from `main`.
7. Smoke test on mobile: create ticket, submit intake, confirm the record persists.

## Fix Later Backlog

Before public launch, handle these hardening items:

1. Lock down `POST /tickets` and `PATCH /tickets/{id}` so public clients can update only user-editable intake fields. Server-owned fields such as `trust_state`, `technician_assignment`, `final_charge`, and payment fields must not be accepted from the browser.
2. Persist and rehydrate the active `ticket_id` in the frontend so refresh/back-navigation does not create duplicate tickets.
3. Make the handoff "Call now" action a real phone action or dispatcher callback request.
4. Either wire photo upload to storage or hide the upload control from the live sprint.
5. Make CORS environment-driven and restrict production origins.
6. Add a demo/production flag so fulfillment and payment-review screens cannot be confused with real operations before those subsystems are live.

## Verification

```powershell
npx tsc --noEmit
npm run build
uv run python -m compileall api scripts assets
```

## Trust-State Rule

The UI must not invent technician data, ETAs, tracking, prices, fees, or final charges. Those values come from the backend. The backend returns guard booleans derived from the `Ticket` methods:

- `may_show_technician`
- `may_show_eta`
- `may_show_live_tracking`

Frontend rendering should use those guards instead of deciding visibility locally.

## Notes

This is a stub build. Payment, OTP, dispatch, tracking, arrival verification, and final charging are intentionally simulated behind the API surface described in `SPEC.md`.
