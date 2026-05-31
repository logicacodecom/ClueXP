# packages/db — ClueXP database migrations

Alembic with raw-SQL migrations. The relational core for dispatch lives here
(`customers`, `technicians`, `jobs`, `dispatch_offers`, `media`, `events`); the
flexible intake payload stays as JSONB in `jobs.detail`.

## Running migrations

Use the Supabase **direct** connection (port **5432**) — not the transaction
pooler — so DDL runs with full privileges. Percent-encode `@` in the password as
`%40`.

```powershell
$env:MIGRATION_DATABASE_URL = "postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres"
uv run --with alembic --with "sqlalchemy>=2" alembic -c packages/db/alembic.ini upgrade head
```

- `upgrade head` — apply all migrations
- `downgrade -1` — roll back one
- `current` / `history` — inspect state

## Conventions

- One concern per migration; idempotent DDL (`IF NOT EXISTS`) where it must
  coexist with app-created tables.
- The app reads/writes via `apps/api` using the **pooler** (6543); migrations use
  the **direct** connection (5432).
