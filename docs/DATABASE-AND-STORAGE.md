# ClueXP — Database & Storage

Reference for the data layer: schema, connection model, migrations, and file
storage. Migrations live in `packages/db`; the app reads/writes via the API
(`api/store.py`, moving to `apps/intake-web/api`).

---

## 1. Design principles

- **Relational core + JSONB detail.** Columns that dispatch must *query*
  (location, skill, availability, status, trust_state) are real columns; the
  flexible intake payload stays as JSONB in `jobs.detail`, so the Pydantic
  `Ticket` contract (`apps/intake-web/api/schema.py` now, `packages/schema`
  later) remains the single source of truth.
- **Raw SQL + Alembic.** Explicit, reviewable DDL; no ORM magic.
- **One Supabase project** for both Postgres and Storage.
- **Postgres stores pointers, not bytes.** Files live in Supabase Storage; the
  `media` table holds bucket + path + visibility.

## 2. Schema (production head `0009`)

```
customers ──< jobs >── technicians
                │          │
                │          └──< organization_technicians >── organizations
                │                                                 │
                │                                                 └──< organization_teams
                │                                                        ├──< organization_teams (parent_team_id)
                │                                                        └──< organization_team_technicians >── technicians
                ├──< dispatch_offers >── technicians / organizations
                ├──< media (owner_type='job')
                └──< events (job_id)

organizations / technicians ──< provider_documents
technicians ───────────────────< media (owner_type='technician')
```

| Table | Key columns | Notes |
|---|---|---|
| **customers** | `id` uuid pk, `phone` unique, `name`, `created_at` | identity anchor = phone |
| **organizations** | `id`, `legal_name`, `display_name`, `description`, `slug`, `organization_type`, `status`, `subscription_status`, `billing_customer_ref`, contact + service-area fields | company/group tenant for affiliated technicians; future subscription anchor |
| **technicians** | `id`, `display_name`, `provider_type`, `primary_organization_id`, `status`, `vetting_status`, `skills text[]`, `service_area_center_lat/lng`, `service_area_radius_km`, `rating`, `profile_photo_url`, `vehicle_info jsonb`, `current_lat/lng`, `location_updated_at`, `is_available`, `created_at` | supply-side person; `provider_type='individual'` or `affiliate` |
| **organization_technicians** | `organization_id`, `technician_id`, `role`, `status`, `invited_at`, `activated_at` | links a company/group tenant to its affiliated technicians |
| **organization_teams** | `id`, `organization_id`, `parent_team_id`, `name`, `description`, `team_type`, `status`, timestamps | recursive departments/groups/business units inside an organization |
| **organization_team_technicians** | `team_id`, `technician_id`, `role`, `assigned_at` | many-to-many team membership for affiliated technicians |
| **provider_documents** | `id`, `owner_type`, `owner_id`, `document_type`, `document_number`, `issuing_authority`, `jurisdiction`, `issued_at`, `expires_at`, `status`, `storage_bucket`, `storage_path`, `notes`, review timestamps | compliance/legal documents for organizations and technicians |
| **jobs** | `id`, `customer_id`→customers, `origin_org_id`, `customer_owner_org_id`, `fulfillment_technician_id`→technicians, `fulfillment_org_id`→organizations, `intake_channel_id`, `fulfillment_policy`, `trust_state`, `status`, dispatch attempts, geo, `detail jsonb`, timestamps | dispatch spine; `detail` = Ticket payload |
| **dispatch_offers** | `id`, `job_id`→jobs, `technician_id`→technicians, `organization_id`→organizations, `status`, `rank`, `offered_at`, `responded_at`, `expires_at` | offer→accept→fallback cascade; can target solo or affiliated supply |
| **media** | `id`, `owner_type`, `owner_id`, `kind`, `bucket`, `path`, `visibility`, `uploaded_by`, `uploaded_at` | pointers to Storage objects |
| **events** | `id` bigserial, `ticket_id`, `job_id`, `event`, `trust_state`, `at` | append-only audit log |

Legacy `tickets` may still exist from the original single-blob store. New
runtime writes go to `jobs.detail` plus promoted dispatch columns; the API keeps
a read-only fallback for old `tickets` rows during the transition.

**Customer data & job history.** A customer is a `customers` row (phone is the
anchor); a request is a `jobs` row linked by `customer_id`. **Job history** is
`SELECT * FROM jobs WHERE customer_id = ? ORDER BY created_at DESC`; the per-job
timeline is the `events` rows for that job. Reliable linking depends on intake
**capturing the phone** so the `customers` upsert fires (today the `Ticket` has
no phone field — see EXECUTION-PLAN Sprint 1).

**Auth direction (`adr/0002`, amended 2026-06-06): first-party
FastAPI/Postgres** — logged-in actors (technician/provider
admin/dispatcher/staff) authenticate through ClueXP-issued JWTs. The `users`
table, roles and organization memberships are authoritative. Customers stay
anonymous (no forced account; phone remains the soft identity anchor).
Authorization is enforced in the API layer, not RLS.

**Indexes:** `jobs(status)`, `jobs(trust_state)`, `jobs(customer_id)`,
`jobs(provider_organization_id)`, `technicians(is_available)`,
`technicians(provider_type)`, `dispatch_offers(job_id)`,
`dispatch_offers(organization_id)`, `organization_teams(organization_id)`,
`organization_teams(parent_team_id)`, `organization_team_technicians(technician_id)`,
`provider_documents(owner_type, owner_id)`, `provider_documents(expires_at)`,
`media(owner_type, owner_id)`.

## 2.1 Provider / tenant model

Technicians can enter the marketplace in two ways:

- **Individual technician:** `technicians.provider_type = 'individual'`; the
  technician is vetted and dispatched directly.
- **Affiliated technician:** `technicians.provider_type = 'affiliate'`; the
  technician belongs to an `organizations` row through
  `organization_technicians`. The organization is the future subscription,
  billing, admin, and business-entity boundary.
- **Organization teams:** organizations can define recursive teams through
  `organization_teams.parent_team_id`. A team can represent a department, group,
  branch, business unit, region, specialty crew, or any internal structure. Each
  team has a description, and technicians can belong to many teams through
  `organization_team_technicians`.
- **Compliance documents:** legal/compliance documents attach to organizations
  or technicians through `provider_documents`. Teams are virtual operating
  groups and do not hold legal documents. Document files live in Supabase
  Storage; Postgres stores the bucket/path, type, jurisdiction, review status,
  and expiration date. `provider_documents.verified_by` is intentionally nullable
  until a staff/admin actor table exists; add its FK in that later migration.

Dispatch still assigns a person (the **fulfillment technician**) so the customer
sees a real verified technician. The applied `0003` columns (`jobs.technician_id`,
`jobs.provider_organization_id`) are the *pre-`adr/0004`* shape; the future migration
below renames/splits them into the neutral-network model.

**Tenancy & dispatch model (implemented foundation; `adr/0004` + SPEC §2.10).**
ClueXP is a **neutral network**, not a fulfillment provider. A job tracks **three
independent axes** and the legacy single `dispatch_owner` is **retired**:
- `jobs.origin_org_id` + `jobs.origin_channel` / `jobs.intake_channel_id` — who brought
  the demand (a provider org, or the ClueXP platform entity for direct requests).
- `jobs.customer_owner_org_id` — who owns the customer relationship; **defaults to the
  origin owner** and **stays the owner on overflow** (`adr/0004` §4/§9).
- `jobs.fulfillment_org_id` **(nullable)** + `jobs.fulfillment_technician_id` — who
  serves it. An **independent technician fulfills with `fulfillment_org_id` null**
  (renames the old `provider_organization_id`/`technician_id` pair).
- `jobs.responsible_organization_id` **(nullable)** — accountable / merchant-of-record
  party (provider org for its own jobs; ClueXP platform as facilitator for
  independent-tech jobs). Legal specifics deferred (`adr/0004` §9).
- `organizations.dispatch_mode` (`organization_managed` | `cluexp_managed_routing`) —
  who *controls* routing. `cluexp_managed_routing` = routing, **not** ClueXP fulfillment.
- `jobs.fulfillment_policy` / `intake_channels.fulfillment_policy`
  (`private` | `network_overflow` | `network_open`) — the overflow ladder; **default
  `private`**, cross-tenant exposure is explicit/opt-in.
- `organization_technicians.network_release_allowed boolean default false` — membership
  flag releasing an affiliated tech for **network routing** (not "direct ClueXP dispatch").
- **Customer identity:** a global person/identity (resolved by phone, **not** tenant-
  browsable) + **org-scoped, RLS-isolated** customer-relationship rows — global
  resolution, never global visibility (`adr/0004` §3).
- **Reserved, not built:** `jobs.marketplace_state`, bidding tables, settlement/fees.
- For org/team-targeted offers, a later migration generalizes `dispatch_offers` to
  `target_type` (`technician` | `organization` | `team`); until then offers stay
  technician-centric (`dispatch_offers.organization_id` records attribution).

Common document types include `business_registration`, `business_license`,
`insurance`, `locksmith_license`, `driver_license`, `work_authorization`,
`certification`, `vehicle_registration`, and `other`.

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
