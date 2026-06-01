# ClueXP — Recommended DevOps

How code goes from a branch to production safely. Reflects the current setup
(Vercel + Supabase + GitHub) and the practices to adopt as the team grows.

---

## 1. Environments

| Env | Frontend/API | Database | Trigger |
|---|---|---|---|
| **Local** | `npm run dev` + `uvicorn` (or in-memory) | in-memory, or Supabase pooler | manual |
| **Preview** | Vercel preview deploy | Supabase (Preview env var) | every PR / branch push |
| **Production** | https://cluexp-intake.vercel.app | Supabase (Production env var) | merge/push to `main` |

- Vercel project: **`cluexp-intake`** (team `logicacode-projects`), **git
  integration connected** to `logicacodecom/ClueXP` → pushes auto-deploy.
- Supabase project ref: `gzgrkzvhotjolvcbqiku`.

## 2. Git workflow (trunk-based)

- `main` is always deployable + protected. Short-lived branches off it:
  `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`) — commits read as
  a changelog.
- One PR per unit of work → review → **squash-merge** → delete branch.
- Run **`/code-review`** on the diff before merging; `/code-review ultra` for
  deeper passes.
- Remotes: `origin` = `logicacodecom/ClueXP` (canonical); `ferrybarbarossa` =
  old repo (kept as backup).

**Protect `main`:** require PR + passing CI, no direct pushes, no force-push.

## 3. CI (GitHub Actions) — recommended

`.github/workflows/ci.yml` gates every PR on:

```yaml
name: ci
on: [pull_request]
jobs:
  web:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/intake-web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: apps/intake-web/package-lock.json
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run build
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv sync
      - run: uv run python -m compileall apps/intake-web/api apps/intake-web/scripts packages
      - name: schema→types drift check
        run: |
          cd apps/intake-web
          uv run python scripts/generate_types.py
          git diff --exit-code src/types/schema.generated.ts
      - name: alembic migrations are valid (offline)
        env:
          MIGRATION_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres
        run: uv run --with alembic --with "sqlalchemy>=2" alembic -c packages/db/alembic.ini upgrade head --sql
```

Key checks: **TS typecheck + build**, **Python compile/lint**, **schema→types
drift** (fail if `schema.py` changed but generated TS wasn't regenerated),
**Alembic offline render** (migrations parse).

The workflow uses the current `apps/intake-web` layout, compiles the co-located
API, checks generated type drift, and renders Alembic SQL offline without
touching a real database.

## 4. CD (Vercel)

- Preview URL per PR (auto). Smoke-test there before promoting.
- `main` → Production automatically via git integration.
- **Manual / from local:** `npx vercel deploy --prod` (used for the first deploy).
- **Rollback:** Vercel dashboard → Deployments → promote a previous build (or
  `vercel rollback`). Instant, no rebuild.
- Consider **Rolling Releases** (canary) once traffic is real.

## 5. Database migrations in the pipeline

- Migrations are **not** auto-run by the app at request time; only the
  `create-table-if-not-exists` startup safety net is. Run schema changes
  deliberately:
  - **Manual/CI step** `alembic upgrade head` against the target DB **before**
    deploying code that depends on the new columns.
  - Migrations must be **backward-compatible** with the currently-running code
    (expand → deploy → contract), so a deploy + migration can interleave safely.
- **Connection policy:** prefer the Supabase **direct** URL (5432) for
  local/admin migrations when reachable; use the **transaction pooler** (6543) as
  the verified fallback for CI or when the direct host is unavailable (it can be
  IPv6-unreachable from some networks). Never point CI at a destructive
  `downgrade` automatically.

## 6. Secrets management

| Secret | Lives in | Never |
|---|---|---|
| `DATABASE_URL` | Vercel env (Prod + Preview) | committed; in client bundle |
| `GOOGLE_MAPS_API_KEY` (server) | Vercel env | exposed to browser — rendering uses `NEXT_PUBLIC_MAPS_BROWSER_KEY` (Maps JS, domain-restricted) |
| `SUPABASE_URL` | Vercel env | hardcoded into backend modules |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env / CI secret | in repo or client bundle |
| Vercel token | CI secret only | in chat/repo |

- `.env*` is gitignored; `.env.example` holds placeholders only.
- **Rotate on exposure.** ⚠️ The Vercel token and Supabase DB password used
  during setup were shared in chat — rotate both, then update Vercel env + redeploy.
- Prefer **scoped, short-lived tokens**; least-privilege Supabase keys.

## 7. Observability

- **Vercel:** build logs + runtime logs per deployment (also via the Vercel MCP:
  `get_deployment_build_logs`, `get_runtime_logs`).
- **Supabase:** Postgres logs + Storage logs in the dashboard.
- Add later: error tracking (Sentry), uptime/health check on the API, and
  alerting on dispatch/payment failures.
- The `events` table is the app-level audit trail — query it for incident
  forensics.

## 8. Backups & DR

- Enable Supabase automated backups; periodically **test a restore**.
- Keep migrations in git as the schema source of truth (rebuildable).
- Document an incident runbook (who, escalation, rollback steps) as ops matures.

## 9. Release checklist (per change)

1. Branch → implement → `/code-review` → green CI.
2. If schema changed: write + apply the migration (expand-compatible).
3. Open PR → preview URL → smoke-test on mobile viewport.
4. Squash-merge → auto-deploy to prod → verify the live flow.
5. Watch logs briefly; roll back via Vercel if needed.
