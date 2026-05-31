# ClueXP Emergency Access Intake

Mobile-web-first emergency access intake for ClueXP. This build follows `SPEC.md`: a Next.js + TypeScript frontend backed by a minimal FastAPI service that imports the canonical Pydantic contract from `assets/schema.py`.

## Project Shape

- `SPEC.md` - product and architecture source of truth.
- `assets/schema.py` - canonical Pydantic ticket schema. Do not duplicate it by hand.
- `assets/ui/` - visual references and design tokens from the Stitch output.
- `api/main.py` - FastAPI stub backend with in-memory tickets and trust-state guards.
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
