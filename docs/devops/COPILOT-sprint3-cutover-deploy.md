# Copilot CLI prompt — apply + deploy Sprint 3 fulfillment-cutover backend

> Authored by Claude (infra) for a DevOps hand-off. The backend is built, tested, and
> committed locally but this environment has no push creds / no prod `DATABASE_URL` / no
> Vercel CLI. Run the prompt below from a shell that **does** have: `gh` authenticated with
> the `workflow` scope, push access to `origin` (logicacodecom/ClueXP), the Supabase
> **DIRECT** connection string, and Vercel access to the `cluexp-intake` project.

---

## PROMPT (paste into Copilot CLI)

You are doing a production deploy of an already-built, already-committed backend slice for
the ClueXP intake monorepo. **Do not write or modify application code.** Your job is purely:
push → PR → apply DB migration → deploy → smoke-verify → report. Work carefully and stop +
report if any step deviates from the expected output below.

### Context (read before acting)
- Repo: monorepo, `origin` = `https://github.com/logicacodecom/ClueXP.git`.
- Branch to ship: `feat/sprint3-fulfillment-cutover-backend` (2 commits ahead of `main`:
  `f51d03c` backend, `bba3b02` docs). It is **local-only / unpushed**.
- What it contains: Alembic migration `0010_fulfillment_cutover` (under
  `packages/db/alembic/versions/`) + FastAPI endpoints in `apps/intake-web/api/`.
- **Safety profile — this is a low-risk deploy:**
  - Migration `0010` is **additive only** (`add column if not exists`, new indexes). No
    drops, no backfills, no type changes. It has a working `downgrade()`.
  - Every cutover behavior is behind flags that **default OFF**
    (`intake_channels.dispatch_cutover_enabled = false`, env
    `DISPATCH_CUTOVER_GLOBAL_OFF` unset). Deploying changes **zero** live behavior until a
    channel is explicitly flipped later.
  - **Do NOT flip any channel, do NOT seed data, do NOT set any cutover env var.** Leaving
    defaults is the intended end state.
- The `.github/workflows/ci.yml` is modified in this branch → pushing it requires the `gh`
  token to carry the **`workflow`** OAuth scope. If the push is rejected for that reason,
  report it (do not strip the workflow change).

### Step 1 — Push the branch and open the PR
```bash
git fetch origin
git checkout feat/sprint3-fulfillment-cutover-backend
git log --oneline origin/main..HEAD          # expect exactly: bba3b02, f51d03c
git push -u origin feat/sprint3-fulfillment-cutover-backend
gh pr create --base main --head feat/sprint3-fulfillment-cutover-backend \
  --title "feat(sprint3): fulfillment cutover backend — migration 0010 + endpoints (flags OFF)" \
  --body "Additive migration 0010 + token-tracking/lifecycle endpoints. All cutover flags default OFF — no live behavior change. Migration applied to prod separately before merge. See docs/EXECUTION-PLAN.md §3.1 and docs/HANDOFF.md."
```
Report the PR URL.

### Step 2 — Apply migration `0010` to PRODUCTION
Use the Supabase **DIRECT** connection (host `db.<ref>.supabase.co`, **port 5432**) — NOT
the transaction pooler (6543). The migration runner reads `MIGRATION_DATABASE_URL` (falls
back to `DATABASE_URL`).
```bash
cd packages/db
python -m pip install -r requirements.txt        # alembic + psycopg
export MIGRATION_DATABASE_URL="postgresql://postgres:<PWD>@db.<ref>.supabase.co:5432/postgres"
alembic current                                  # expect head = 0009_org_fulfillment_policy
alembic upgrade head                             # applies 0010
alembic current                                  # expect head = 0010_fulfillment_cutover
```
Expected: `alembic current` reports `0010_fulfillment_cutover (head)` and the run is clean.
If `alembic current` already shows `0010`, it is a no-op (the migration is idempotent) —
report that and continue.

### Step 3 — Deploy to production (Vercel project `cluexp-intake`)
Production deploys from `main`. Apply the migration (Step 2) **first**, then promote code:
```bash
gh pr merge <PR#> --squash --admin        # merging main triggers the Vercel prod build
```
If you have the Vercel CLI linked instead, you may `vercel deploy --prod` from the
`apps/intake-web` project after merge. Wait until the production deployment is **Ready**.

### Step 4 — Smoke-verify production
Prod base URL: `https://cluexp-intake.vercel.app` (custom domain `https://intake.cluexp.com`).
```bash
BASE=https://cluexp-intake.vercel.app

# (a) New code is live: the token route exists in the live OpenAPI schema.
curl -s "$BASE/api/openapi.json" | grep -o '/t/{token}' | head -1     # expect: /t/{token}

# (b) Unknown token gives no oracle → 404 (not 200/500).
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/t/definitely-not-a-real-token"  # expect: 404

# (c) DB reachable + additive columns harmless: legacy intake create still returns the
#     envelope, now with the two new optional keys NULL for a non-cutover channel.
#     (Use the existing intake smoke payload your team uses for POST /api/tickets; confirm
#     the JSON contains "tracking_token": null and "tracking_path": null and HTTP 200.)
```
Expected: (a) prints `/t/{token}`, (b) prints `404`, (c) returns 200 with both new keys
null. If any differ, **stop and report the actual output** — do not attempt fixes.

### Step 5 — Report back
Reply with: PR URL + merge commit SHA, `alembic current` before/after, Vercel production
deployment URL + Ready status, and the three smoke results (a/b/c). On success, end with a
one-line "backend LIVE + smoke-passed" so the channel knows qwen can integrate against the
live endpoints.

### Rollback (only if a smoke check fails hard)
- Code: `vercel rollback` to the previous production deployment (or revert the merge commit).
- DB: the migration is additive and safe to leave; only if required,
  `cd packages/db && alembic downgrade 0009_org_fulfillment_policy`.
- No data migration to undo.
