# packages/db — ClueXP database migrations

Alembic with raw-SQL migrations. The relational core for dispatch lives here
(`customers`, `organizations`, `technicians`, `organization_technicians`,
`jobs`, `dispatch_offers`, `media`, `events`); the flexible intake payload stays
as JSONB in `jobs.detail`.

## Running migrations

**Connection policy:** prefer the Supabase **direct** connection (port **5432**)
for local/admin migrations when reachable. Use the **transaction pooler** (6543)
as the verified fallback for CI or when the direct host is unavailable — it can
be IPv6-unreachable from some networks (we currently run via the pooler for that
reason). `env.py` disables prepared statements so DDL is pooler-safe either way.
Percent-encode `@` in the password as `%40`.

```powershell
# Direct (preferred when reachable):
$env:MIGRATION_DATABASE_URL = "postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres"
# Fallback (pooler — IPv4, always reachable):
# $env:MIGRATION_DATABASE_URL = "postgresql://postgres.PROJECT_REF:PASSWORD@aws-REGION.pooler.supabase.com:6543/postgres"
uv run --with alembic --with "sqlalchemy>=2" alembic -c packages/db/alembic.ini upgrade head
```

- `upgrade head` — apply all migrations
- `downgrade -1` — roll back one
- `current` / `history` — inspect state

## Conventions

- One concern per migration; idempotent DDL (`IF NOT EXISTS`) where it must
  coexist with app-created tables.
- The app runtime always uses the **pooler** (6543); migrations prefer the
  **direct** connection (5432) when reachable, else the pooler (see policy above).
