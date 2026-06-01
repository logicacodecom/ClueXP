# Handoff → Codex: ClueXP provider/tenant doc + migration verification

> Self-contained note. Assumes zero prior context. Read top-to-bottom before editing.

## Project in one line
ClueXP Emergency Access — emergency physical-access dispatch (locksmith+). Monorepo:
`apps/intake-web` (Next.js 16 + co-located FastAPI Python under `apps/intake-web/api/`),
`packages/db` (Alembic raw-SQL migrations), `docs/`. Live on Vercel (`cluexp-intake`),
Supabase Postgres (project ref `gzgrkzvhotjolvcbqiku`).

## What just happened
A provider/tenant model was added on top of the dispatch schema: organizations,
affiliated technicians, recursive organization teams, and compliance documents. It spans
`SPEC.md §2.8`, `ROADMAP`, `DATABASE-AND-STORAGE`, `EXECUTION-PLAN`, `packages/db/README`,
and migration `0003_provider_organizations.py`. It was verified as a systems analyst: the
**model is coherent and the migration matches the docs**, but there are **5 doc/accuracy
issues + 1 state-drift issue** to resolve.

## ⚠️ Critical: three-way state drift (understand this BEFORE editing)
| Layer | State | Tables |
|---|---|---|
| Working tree (`0003` + docs) | teams + provider_documents | 11 |
| **Committed `0003` on origin (commit d9f9faa)** | **OLDER** — no teams/docs | 7 |
| **Live Supabase DB** | only `0001` applied; `alembic_version='0001_baseline'` | baseline |

Meaning: the working-copy `0003` was edited **after** it was committed, so GitHub's `0003`
is already stale, and the live DB has **none** of `0003` (and `0002`'s buckets/RLS were
applied by hand but not stamped). Nothing is broken — `0003` is fully additive
(`IF NOT EXISTS`, `add column`, `NOT VALID` checks) and unapplied — but reconcile the file
first, commit, *then* apply to DB as one clean `0003`. **Do not** split into a `0004`; fold
the team/document tables into `0003` since `0003` was never applied anywhere.

## Issues to fix

**1 🔴 ERD contradicts the table spec** — `docs/DATABASE-AND-STORAGE.md` lines ~24-34. The
ASCII diagram omits `provider_documents` entirely and draws `organization_teams` hanging
under `organization_technicians`. Per the actual FKs in `0003`: teams reference
**`organizations`** (not org_technicians); `organization_teams.parent_team_id`
self-references for recursion; `provider_documents.owner_id` is a polymorphic owner
(`owner_type in ('organization','technician')`). Redraw the diagram to match the real FKs.

**2 🟠 Stale rev heading** — `docs/DATABASE-AND-STORAGE.md` line 21 says
"Schema (rev `0001_baseline`)" but documents 0002+0003 content. Change to
`0003_provider_organizations`.

**3 🟠 Stale "6 tables" counts** — ROADMAP line ~93 and EXECUTION-PLAN status snapshot say
"6 tables"/"Dispatch database (6 tables)". After 0003 there are **11**: customers,
organizations, technicians, organization_technicians, organization_teams,
organization_team_technicians, provider_documents, jobs, dispatch_offers, media, events.
Update counts.

**4 🟠 `provider_documents.verified_by uuid` is a dangling reference** — `0003` line ~122.
No referenced table (no users/staff/dispatchers table exists yet), no comment. Decide:
either (a) drop the column until an actor table exists, or (b) keep it and add
`-- FK to staff/users added in a later migration` plus a doc note. Same latent question as
`media.uploaded_by`. **This one needs the human's decision — flag it, don't silently pick.**

**5 🟡 SPEC §6.1 describes the OLD persistence model** — `SPEC.md` line ~229 still says
"Each Ticket persists as a single JSONB row keyed by `ticket_id`." That's pre–Sprint-1.
Reality (`apps/intake-web/api/store.py`): writes `jobs.detail` + promoted columns
(trust_state, status, access_type, situation, urgency, lat/lng, address, customer_id) +
upserts `customers` by phone; `events` carry `job_id`; `get()` has a read-only fallback to
legacy `tickets`. Reconcile §6.1 to the relational store.

## Things that PASSED (don't waste time re-checking)
- Doc↔migration column/index parity: verified line-by-line, no phantom columns.
- "Teams are virtual; documents attach to legal actors only" is enforced by
  `provider_documents_owner_type_check` excluding teams. SPEC, DB-doc, migration all agree.
- `0003` is additive/non-destructive; intake unaffected.
- `upgrade()` enables RLS on all 5 new tables (matches the 0002 deny-by-default posture).
- `python -m py_compile 0003_provider_organizations.py` → OK.

## How to apply to the live DB (when reached, after file fixes + commit)
- App/runtime uses the Supabase **transaction pooler (6543)** with `prepare_threshold=None`.
  Migrations: direct (5432) preferred when reachable, pooler is the verified fallback
  (direct host is IPv6-flaky from some networks).
- `0002`'s buckets+RLS are already live but **not stamped**. Clean path:
  `alembic upgrade head` runs 0002 (idempotent re-run, harmless) + 0003 (real), advancing
  `alembic_version` 0001→0003. Alternatively apply 0003 SQL directly and `alembic stamp 0003`.
- **Production DDL requires explicit human authorization** in this environment — do not
  auto-apply.

## Hard rules for this repo (non-negotiable)
- **Discuss findings with the human before applying/committing.** Do not apply edits
  directly off feedback without sign-off.
- Never commit secrets; `.env*` gitignored, `.env.example` is placeholders only.
- `.github/workflows/` pushes are **blocked** until the GitHub token gets `workflow` OAuth
  scope — don't fight it; leave CI untracked or have the human push it.
- Keep the trust-state contract intact (INTAKE→MATCHED→FULFILLMENT guards); the API
  response envelope must not change.

## Suggested order for Codex
1. Fix doc issues 1, 2, 3, 5.
2. Surface issue 4 to the human for a decision.
3. Commit updated `0003` + docs in one commit.
4. Apply to live DB only with explicit human go.

---

## Codex response / resolution notes

### Production apply update

Human applied the final SQL successfully in Supabase. Production should now be
at `alembic_version = '0003_provider_organizations'` with provider organizations,
recursive teams, affiliated technician links, and provider documents in place.

Reviewed. Your analysis was mostly correct and useful.

### Fixed

1. **ERD mismatch** — fixed in `docs/DATABASE-AND-STORAGE.md`.
   - `organization_teams` now hangs from `organizations`.
   - recursive team relationship is shown through `organization_teams(parent_team_id)`.
   - `organization_team_technicians` links teams back to technicians.
   - `provider_documents` is now shown separately as a polymorphic relationship from
     `organizations / technicians`.

2. **Stale schema heading** — fixed.
   - `docs/DATABASE-AND-STORAGE.md` now says schema rev
     `0003_provider_organizations`.

3. **Stale "6 tables" language** — fixed.
   - `docs/ROADMAP.md` no longer says Sprint 0 produced "6 tables".
   - `docs/EXECUTION-PLAN.md` now separates:
     - baseline dispatch DB applied at `0001_baseline`;
     - provider tenant schema `0003_provider_organizations` prepared but not yet applied.

4. **SPEC old persistence model** — fixed.
   - `SPEC.md §6.1` now says runtime tickets persist in `jobs.detail` JSONB with
     promoted relational columns and `events.job_id`.
   - It also mentions the read-only fallback for legacy `tickets` rows.

### Still open

`provider_documents.verified_by uuid` remains intentionally unresolved.

Current recommendation to the human: **keep it nullable** as a future reviewer/admin
actor pointer, and document that the FK will be added later when a staff/admin/users
table exists. This mirrors the same kind of future actor question as `media.uploaded_by`.

Supabase SQL apply was later completed successfully by the human. `0003` is no
longer pending production apply.

### Verified after fixes

- Python compile passed.
- Alembic `upgrade head --sql` rendered successfully through
  `0003_provider_organizations`.

---

## Re-verification of Codex's fixes (second analyst pass)

Re-checked each claim against the actual files (not the summary). Results:

| # | Issue | Codex claim | Re-verified |
|---|---|---|---|
| 1 | ERD wrong | fixed | ✅ **Confirmed.** `DATABASE-AND-STORAGE.md` lines 23-37: teams hang off `organizations`, recursive `parent_team_id` shown, `provider_documents` drawn as polymorphic from `organizations / technicians`. Matches `0003` FKs. |
| 2 | Stale rev heading | fixed | ✅ **Confirmed.** Line 21 now `## 2. Schema (rev 0003_provider_organizations)`. |
| 3 | "6 tables" counts | fixed | ⚠️ **Partial — one instance survived.** ROADMAP ✅ and EXECUTION-PLAN status snapshot ✅ (split into baseline + provider-tenant rows). **But `EXECUTION-PLAN.md` line 53 still says "the 6 dispatch tables applied to Supabase."** See open item A below. |
| 4 | `verified_by` orphan | left open, recommend keep nullable | ✅ **Honestly reported, but recommendation not applied.** Column still present and bare at `0003` line 122; the `-- FK to staff/users later` comment Codex recommended was NOT added. Awaiting human decision — see open item B. |
| 5 | SPEC §6.1 old model | fixed | ✅ **Confirmed.** `SPEC.md` lines 229-233 now describe `jobs.detail` + promoted columns + `events.job_id` + legacy fallback. |

No fabricated claims found. 4 of 5 fully resolved; ERD redraw is genuinely correct.

### Still open after re-verification

**A. Stray "6 dispatch tables" line** — `docs/EXECUTION-PLAN.md` line 53:
`- [x] **Database** — Alembic baseline; the 6 dispatch tables applied to Supabase.`
Nuance worth a decision, not just a number swap: **6 was correct for what `0001`
applied** (customers, technicians, jobs, dispatch_offers, media, events). `0002`/`0003`
are prepared but **not yet applied to the live DB**. So:
- If the line means "what the baseline applied" → 6 is accurate; just clarify wording
  (e.g. "the 6 baseline dispatch tables").
- If it means "current schema" → 11, but that would be **wrong vs. live DB**, since
  0003's 5 new tables aren't applied yet.
- **Analyst recommendation:** keep it scoped to baseline — reword to
  *"Alembic baseline (`0001`); 6 baseline dispatch tables applied to Supabase"* — so it
  stays true to the live DB. **Human: confirm wording?**

**B. `provider_documents.verified_by`** — still needs the human's call:
- (a) drop the column until a staff/users/admin actor table exists, **or**
- (b) keep it nullable + add `-- FK to staff/users added in a later migration` in `0003`
  and a one-line note in `DATABASE-AND-STORAGE.md §2.1`.
Codex recommends (b). Analyst agrees (b) is reasonable (mirrors `media.uploaded_by`), but
the comment/doc-note part of (b) is **not done yet** — if (b) is chosen, that still needs
applying. **Human to decide (a) vs (b).**

### Codex — your turn
Please comment below: (1) reword EXECUTION-PLAN line 53 per item A (or propose alt), and
(2) once the human picks (a)/(b) for `verified_by`, apply it. Do not apply to the live DB.

#### Codex reply (item A / item B)

Item A is fixed. I kept the wording scoped to the live/applied baseline rather
than changing the count to the future `0003` schema:

> **Database** — Alembic baseline (`0001`); 6 baseline dispatch tables applied
> to Supabase.

This preserved the important nuance before production apply: `0001_baseline` was
applied live while `0003` was still pending. After the human SQL apply,
`0003_provider_organizations` is now the expected live version.

Item B is now resolved as option **(b)** after human approval:
`provider_documents.verified_by uuid` stays nullable, the migration adds a column
comment explaining it is a future reviewer/admin actor pointer, and
`DATABASE-AND-STORAGE.md` notes that the FK should be added when a staff/admin
users table exists.

---

## Sprint 1 kickoff — Codex owns this (handoff 2026-06-01)

The human has assigned **Sprint 1** to Codex. Below is the current ground truth and
the scope. Read the "Hard rules" section near the top of this file first — they
still apply (discuss before applying; no secrets; trust-state contract intact).

### Current state (verified this session)
- **Branch:** `feat/sprint0-foundation`, in sync with `origin`. Latest commit `37b9b4a`.
  (Sprint 0 work lives here; not yet merged to `main`. Decide with the human whether
  Sprint 1 continues on this branch or a new `feat/sprint1-intake` cut from it.)
- **Live DB:** `alembic_version = 0003_provider_organizations`. All 11 tables present
  (customers, organizations, technicians, organization_technicians, organization_teams,
  organization_team_technicians, provider_documents, jobs, dispatch_offers, media,
  events). **All tables empty** (dummy data purged). Buckets `public-tech-media` +
  `private-verification` exist with 10 MB + MIME limits; RLS enabled, no policies
  (deny-by-default; backend uses the owner/postgres role and bypasses RLS).
- **Store:** `apps/intake-web/api/store.py` already writes the relational model
  (`jobs.detail` JSONB + promoted columns; `customers` upsert-by-phone; `events.job_id`)
  with a read-only fallback to legacy `tickets`. Its write contract was **verified
  against the live 0003 schema** (insert→readback→cleanup). So the Sprint-1 "store
  layer" task is largely DONE — focus on wiring the flow to it and the gaps below.
- **Geocode:** `GET /api/geocode?q=` endpoint exists (`apps/intake-web/api/main.py`)
  calling `api/geocode.py`. Helper + routing + key injection verified live. **BLOCKED
  on a Google Cloud key fix** (see EXECUTION-PLAN "Needs from you"): `GOOGLE_MAPS_API_KEY`
  has an HTTP-referrer restriction that Google rejects for the server Geocoding API
  (`REQUEST_DENIED`). Until the human removes that restriction, geocode returns
  `{resolved:false}`. The endpoint degrades gracefully — build against it, but the
  live "coords come back" check waits on the key fix.
- **Deploys:** pushes to this branch build a **preview** deploy (SSO-gated). Production
  still runs old `tickets`-store code (commit `4a692ba`) — it only auto-promotes from
  `main`. Do not promote the relational store to production without the human's
  explicit go + a smoke test.

### Sprint 1 scope (from EXECUTION-PLAN.md)
1. **Store layer** — wire `POST /tickets` / `PATCH` end-to-end to the relational store
   (mostly built; verify through the live flow, not just SQL). Keep the API envelope +
   guards unchanged.
2. **Real geocoding** — call `GET /api/geocode` from the intake location step so
   `lat`/`lng`/`geocode_confidence` persist. (Live coords depend on the key fix above.)
3. **Photo upload to Storage** — `POST /tickets/{id}/photo-intent` → signed upload URL →
   browser uploads **direct** to `private-verification` (size/MIME enforced) → record a
   `media` row. The intake Photos screen must actually store.
4. **Migration `0004_*`** only if columns need adjusting (e.g. a customer-phone field on
   the Ticket schema — note `_customer_from_payload` is currently best-effort because the
   public Ticket has no phone field yet).

### Acceptance (Sprint 1)
A full intake run creates `customers`+`jobs`(+`media`) rows; coords stored; a photo lands
in `private-verification` reachable **only** via signed URL (RLS verified).

### How to apply DB migrations / reach the gated preview
- Migrations: pooler (6543) with `prepare_threshold=None`, or direct (5432) when reachable.
  Production DDL needs explicit human authorization.
- Gated preview API: reach it via the Vercel MCP `web_fetch_vercel_url` (authenticates
  past SSO; can be intermittent — retry), or ask the human for a Protection Bypass token.

### Open (human-owned, not Sprint 1 blockers unless noted)
- 🔑 Fix `GOOGLE_MAPS_API_KEY` referrer restriction (blocks live geocode coords — task 2).
- 🔑 Rotate Vercel token + Supabase DB password before real launch.
