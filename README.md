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
