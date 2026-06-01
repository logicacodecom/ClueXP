# Handoff — Claude ↔ Codex communication log

> **Purpose:** the back-and-forth channel between the two agents (and the human) —
> questions, findings, review notes, decisions needed, replies.
>
> **It is NOT the plan.** Sprint scope, tasks, acceptance, and live state live in:
> - `docs/EXECUTION-PLAN.md` — sprint tasks + acceptance + **Status snapshot** (current truth)
> - `docs/ROADMAP.md` — epics + sprint table
> - `docs/DATABASE-AND-STORAGE.md`, `SPEC.md`, `adr/0001` — design contracts
>
> Don't restate scope or state here; link to those docs. Keep it lean — delete
> threads once resolved.

## Conventions
- New thread: `### YYYY-MM-DD — <topic>` under **Open threads**.
- Sign entries `— Claude` / `— Codex` / `— Human`.
- Delete a thread when settled (the durable outcome belongs in the plan/design docs).
- **Hard rules (both agents):** discuss before applying/committing off feedback; never
  commit secrets; keep the trust-state contract (INTAKE→MATCHED→FULFILLMENT) and the API
  envelope intact; production DDL / prod promotion needs explicit human authorization;
  `.github/workflows/` pushes need the GitHub `workflow` OAuth scope (or add via web UI).

---

## Open threads

### 2026-06-01 — Sprint 1 geocode + photo upload handoff

Commit pushed:

```text
6816be2 Build intake geocode and photo upload flow
```

Branch:

```text
feat/sprint0-foundation
```

What changed:
- Added `apps/intake-web/api/storage.py` for backend-only Supabase Storage signed
  upload/download helpers.
- Added `POST /tickets/{ticket_id}/photo-intent` and
  `POST /tickets/{ticket_id}/photo-complete`.
- Added `store.record_media(...)` for in-memory and Postgres stores.
- Updated the intake location step to use real browser GPS and typed-address
  server geocoding via `GET /api/geocode`.
- Updated the photo screen to upload selected PNG/JPEG/WebP files to signed
  Storage URLs, then confirm and record `media`.
- Added `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `.env.example`.
- Updated `docs/DEVOPS.md` and `docs/EXECUTION-PLAN.md`.

Verification:
- Python compile passed.
- `npx tsc --noEmit` passed.
- `npm run build` passed.
- FastAPI smoke test passed with in-memory store:
  create ticket, geocode gracefully unresolved without key, photo intent returns
  expected 503 without Storage env.

Known remaining live setup:
- Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Vercel env.
- Fix `GOOGLE_MAPS_API_KEY` restriction in Google Cloud:
  Application restriction = None; API restriction = Geocoding API now, Routes later.
- Then smoke-test preview/prod:
  address persists `lat/lng/address`, photo lands in `private-verification`,
  `media` row is created, ticket `photos[]` updates.

Notes:
- Working tree was clean after push.
- Codex did not promote to production.
- Current sprint truth remains in `docs/EXECUTION-PLAN.md`.

— Codex
