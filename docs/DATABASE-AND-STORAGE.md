# ClueXP — Database & Storage

Reference for the data layer: schema, connection model, migrations, and file
storage. Migrations live in `packages/db`; the app reads/writes via the API
(`api/store.py`, moving to `apps/intake-web/api`).

---

## 1. Design principles

- **Relational core + JSONB detail.** Columns that dispatch must *query*
  (location, skill, availability, status, trust_state) are real columns; the
  flexible intake payload stays as JSONB in `jobs.detail`, so the Pydantic
  `Ticket` contract (`assets/schema.py` → `packages/schema`) remains the single
  source of truth.
- **Raw SQL + Alembic.** Explicit, reviewable DDL; no ORM magic.
- **One Supabase project** for both Postgres and Storage.
- **Postgres stores pointers, not bytes.** Files live in Supabase Storage; the
  `media` table holds bucket + path + visibility.

## 2. Schema (rev `0001_baseline`)

```
customers ──< jobs >── technicians
                │  \
                │   └──< dispatch_offers >── technicians
                └──< media (owner_type='job')
                └──< events (job_id)
technicians ──< media (owner_type='technician')
```

| Table | Key columns | Notes |
|---|---|---|
| **customers** | `id` uuid pk, `phone` unique, `name`, `created_at` | identity anchor = phone |
| **technicians** | `id`, `display_name`, `status`, `vetting_status`, `skills text[]`, `service_area_center_lat/lng`, `service_area_radius_km`, `rating`, `profile_photo_url`, `vehicle_info jsonb`, `current_lat/lng`, `location_updated_at`, `is_available`, `created_at` | supply side; queried by the matcher |
| **jobs** | `id`, `customer_id`→customers, `technician_id`→technicians, `trust_state`, `status`, `access_type`, `situation`, `urgency`, `lat/lng`, `address`, `detail jsonb`, `price_quote jsonb`, `final_charge jsonb`, `created_at`, `updated_at` | dispatch spine; `detail` = Ticket payload |
| **dispatch_offers** | `id`, `job_id`→jobs, `technician_id`→technicians, `status`, `rank`, `offered_at`, `responded_at`, `expires_at` | offer→accept→fallback cascade |
| **media** | `id`, `owner_type`, `owner_id`, `kind`, `bucket`, `path`, `visibility`, `uploaded_by`, `uploaded_at` | pointers to Storage objects |
| **events** | `id` bigserial, `ticket_id`, `job_id`, `event`, `trust_state`, `at` | append-only audit log |

Legacy `tickets` (the original single-blob store) still exists and backs the
live intake until Sprint 1 migrates intake onto `jobs`/`customers`.

**Indexes:** `jobs(status)`, `jobs(trust_state)`, `jobs(customer_id)`,
`technicians(is_available)`, `dispatch_offers(job_id)`, `media(owner_type, owner_id)`.

## 3. Connection model (Supabase)

| Use | Endpoint | Why |
|---|---|---|
| **App / serverless** | **Transaction pooler** — `aws-1-us-east-2.pooler.supabase.com:6543`, user `postgres.gzgrkzvhotjolvcbqiku` | pgbouncer handles many short-lived serverless connections; **IPv4** |
| **Migrations / admin** | **Direct** `db.gzgrkzvhotjolvcbqiku.supabase.co:5432` preferred when reachable; **pooler** is the verified fallback (CI / IPv6-unreachable networks) | full session features |

Gotchas we hit and handle:
- **Disable prepared statements** behind the pooler — psycopg `prepare_threshold=None`
  (app store and Alembic `env.py` both set this).
- **Direct host is IPv6-flaky** from some networks (`getaddrinfo failed`); the
  pooler is IPv4-proxied and reliable — use it if direct won't resolve.
- **Percent-encode `@`** in the password (`%40`) in any URL.
- **Windows local + async psycopg** needs `WindowsSelectorEventLoopPolicy`
  (Linux/Vercel unaffected).

## 4. Environment variables

| Var | Where | Value |
|---|---|---|
| `DATABASE_URL` | API runtime (Vercel) | pooler URL (6543). Unset → in-memory fallback (local) |
| `MIGRATION_DATABASE_URL` | migrations (local/CI) | pooler or direct; falls back to `DATABASE_URL` |

Never commit real values; `.env.example` carries placeholders.

## 5. Migrations (Alembic, raw SQL — `packages/db`)

```powershell
$env:MIGRATION_DATABASE_URL = "postgresql://postgres.<ref>:<pw>@aws-1-us-east-2.pooler.supabase.com:6543/postgres"
uv run --with alembic --with "sqlalchemy>=2" alembic -c packages/db/alembic.ini upgrade head
```

- `upgrade head` apply · `downgrade -1` roll back · `current` / `history` inspect.
- One concern per migration; idempotent DDL (`IF NOT EXISTS`) where it must
  coexist with app-created tables.
- New migration: `... revision -m "message"` then write raw SQL in
  `upgrade()`/`downgrade()` via `op.execute(...)`.

## 6. File storage (Supabase Storage)

**Buckets**

| Bucket | Visibility | Contents |
|---|---|---|
| `public-tech-media` | public (CDN) | technician profile + vehicle photos |
| `private-verification` | private (RLS) | ID documents, customer job photos (PII / home interiors) |

**Upload flow (never stream files through the function):**
1. Client asks the API for an upload intent → API returns a **signed upload URL**
   + the object path.
2. Client uploads the file **directly** to Supabase Storage.
3. Client confirms → API inserts a `media` row (`owner_type`, `owner_id`, `kind`,
   `bucket`, `path`, `visibility`).

**Download:** public bucket → CDN URL; private bucket → short-lived **signed
download URL** issued by the API.

**Kinds:** `profile_photo`, `vehicle_photo`, `job_photo`, `id_document`.
**Limits (recommended):** images ≤ 10 MB, `image/*` + `application/pdf` for IDs;
validate server-side before issuing the signed URL.

## 7. Security & retention

- ID docs and customer photos live **only** in the private bucket; access via
  signed URLs scoped to the requesting job/technician.
- **Operationalized in Sprint 0 (not deferred):** RLS **deny-by-default** on
  `private-verification` with owner-scoped read/write; public read on
  `public-tech-media`; signed-URL TTLs (~60s upload / ~300s download); server-side
  **size (≤10 MB) + MIME** validation *before* issuing any signed URL. A "private
  bucket" without these is not actually safe.
- Define **PII retention** (e.g., purge `id_document` media N days after job
  completion); record deletions in `events`.
- `events` is the tamper-evident audit trail — never delete rows; archive.

## 8. Later (not now)

- Partition/archive `events` and completed `jobs` as volume grows.
- Supabase automated backups + periodic restore drills.
- Read replica / connection-pool tuning when traffic warrants.
