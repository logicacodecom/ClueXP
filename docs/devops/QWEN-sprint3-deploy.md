# QWEN DEPLOY RUNBOOK — Sprint 3 backend fulfillment cutover

> **Handed to qwen by Claude (infra), human-authorized.** This is normally Claude's lane;
> you're running it only because the prod credentials live in your environment. Follow it
> **exactly** — this is a mechanical runbook, **not** a build task. Do not write or edit any
> code. Do not "improve" anything.

## HARD RULES — violating any = STOP and report
- **NEVER `git add -A` / `git add .`** Stage explicit paths only. (Tooling got swept into a
  branch this way earlier today — do not repeat it.)
- **Do NOT flip any cutover flag.** Leave `intake_channels.dispatch_cutover_enabled = false`
  and do not set `DISPATCH_CUTOVER_GLOBAL_OFF`. The deploy must change **zero** live behavior.
- **Merge PR #16 ONLY.** Do NOT merge the frontend PR
  (`qwen/sprint3-fulfillment-cutover-frontend`) — it is stacked on backend and not ready.
- **Do not edit `api/`, `store.py`, or any migration.** Apply only the existing `0010`.
- If any expected output differs, **STOP and report the actual output** — do not attempt fixes.

## Step 0 — Preflight (verify BEFORE touching prod; report back before continuing)
```bash
gh auth status                                   # must be logged in, no "invalid"
git fetch origin
git fetch origin pull/16/head && git log --oneline origin/main..FETCH_HEAD
# EXPECT exactly two commits:
#   bba3b02 docs(sprint3): post cutover backend contracts ...
#   f51d03c feat(sprint3): fulfillment cutover backend ...
# If you see a third commit (e.g. bb4f1ff frontend), STOP — PR #16 is polluted, report it.
```
If `gh auth status` fails or the prod DB URL is not available in your env, STOP here and report
— do not proceed without both.

## Step 1 — Apply migration 0010 to PROD
Project ref `gzgrkzvhotjolvcbqiku`. **The DIRECT host (`db.<ref>.supabase.co:5432`) is IPv6-only
and is unreachable from an IPv4 network — verified failing.** Use the **Session Pooler** string
(Supabase → Connect → Session pooler), which is IPv4-compatible:
```
postgresql://postgres.gzgrkzvhotjolvcbqiku:<PWD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```
This migration runs fine through the pooler — `alembic/env.py` sets `prepare_threshold=None`, so
DDL works through Supabase pgbouncer. (Session pooler :5432 preferred; transaction pooler :6543
also works as a last resort. Direct :5432 only if your runner has working IPv6.)
```bash
cd packages/db
python -m pip install -r requirements.txt
export MIGRATION_DATABASE_URL="postgresql://postgres.gzgrkzvhotjolvcbqiku:<PWD>@aws-0-<region>.pooler.supabase.com:5432/postgres"
alembic current        # EXPECT head = 0009_org_fulfillment_policy
alembic upgrade head   # applies 0010
alembic current        # EXPECT head = 0010_fulfillment_cutover
```
Migration is additive + idempotent (`add column if not exists`). If `alembic current` already
shows `0010`, it's a no-op — report and continue.

## Step 2 — Merge PR #16 → main (triggers Vercel prod build)
```bash
gh pr merge 16 --merge   # preserves the 2 commits. Do NOT delete the frontend branch.
```
`cluexp-intake` auto-deploys from the GitHub integration on merge to `main`. Wait until the
production deployment is **Ready** (Vercel dashboard or `gh run watch`).

## Step 3 — Smoke-verify production
```bash
BASE=https://cluexp-intake.vercel.app
curl -s "$BASE/api/openapi.json" | grep -o '/t/{token}' | head -1        # EXPECT: /t/{token}
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/t/not-a-real-token"   # EXPECT: 404
# Optional: a legacy POST /api/tickets (existing smoke payload) still returns 200 with
#           "tracking_token": null and "tracking_path": null (non-cutover channel).
```
All three as expected → backend is live with zero behavior change.

## Step 4 — Report + log, then STOP
Reply with: `alembic current` before/after, the merge commit SHA, the Vercel prod deployment
URL + Ready status, and the three smoke results. Then append a short thread to `docs/HANDOFF.md`
(stage it explicitly: `git add docs/HANDOFF.md` — never `-A`) saying
**"Sprint 3 backend LIVE + smoke-passed @ <deploy-url>"**, commit, push. If pushing to `main` is
blocked by branch protection, skip the commit and post the status back to the human instead.
**Then STOP** — do not flip flags, do not merge the frontend PR.

## Rollback (only if a smoke check fails hard)
- Code: `vercel rollback` to the previous prod deployment, or revert the merge commit.
- DB: `0010` is additive — safe to leave. Only if required:
  `cd packages/db && alembic downgrade 0009_org_fulfillment_policy`.
