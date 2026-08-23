# Supabase RLS Audit — Revalidated at Repository HEAD

**Revalidated:** 2026-08-22

**Repository head before closure:** `0054_alert_escalation`

**Closure migration:** `0055_default_deny_rls`

**Deployment status:** applied to production on 2026-08-22 after explicit human authorization.
Structural database verification and an external Supabase PostgREST denial probe with the live
anon key both passed.

The July audit below identified 18 exposed live tables at that point in time. A complete replay of
the Alembic chain through `0054` now creates **53 application tables**. Earlier migrations enable
RLS on **17** of them; **36** were still missing RLS at repository HEAD. The missing set includes
the original financial/settings findings plus arrival verification, notes/payments, operational-ID
counters, devices, mutation/idempotency records, refresh tokens, notifications, job messaging,
call/SMS records, partnerships, reservations, CRM profiles, and alerts.

Migration `0055_default_deny_rls` is the explicit table registry and enables RLS with **zero allow
policies** on all 53 Alembic-managed application tables. It also conditionally protects the legacy
`tickets` and live-only `cron_config` relations when present, and keeps `alembic_version` protected.
It intentionally does not use `FORCE ROW LEVEL SECURITY`: the database owner/Postgres backend and
Supabase `service_role` retain their intended bypass, while `anon` and ordinary `authenticated`
roles receive zero rows and cannot insert when PostgREST grants are present.

| State | Protected | Unprotected |
|---|---:|---:|
| Through migration `0054` | 17 / 53 | 36 / 53 |
| Fresh database at `0055` | 53 / 53 | 0 / 53 |

The configured deployed database was checked read-only before the migration on 2026-08-22. It was
stamped `0054_alert_escalation` and had 56 public relations including `alembic_version`,
legacy/live-only relations, and the 53 current application tables: **22 had RLS enabled and 34 had
it disabled**. Both `anon` and `authenticated` had privileges on all 34 unprotected tables (238
privilege rows per role). The deployed `postgres` and `service_role` roles had `BYPASSRLS`; `anon`
and `authenticated` did not. There were zero public-schema policies.

After the authorized production apply on 2026-08-22, the deployed database is stamped
`0055_default_deny_rls`; all 55 existing relations covered by the migration registry have
`relrowsecurity = true`; public-schema policy count remains `0`; the owner/backend `postgres`
session still reads `public.jobs`; and `SET ROLE anon` / `SET ROLE authenticated` probes see zero
`public.jobs` rows. A live HTTP PostgREST probe using the production anon key against
`/rest/v1/jobs?select=id&limit=1` returned `200` with zero rows and no leaked data.

CI now migrates a clean PostgreSQL 16 database and checks every public table's `relrowsecurity`,
owner/service-role access, anon/authenticated read and mutation denial, representative
`PostgresStore` SQL, token lookup, and organization-scoped queues. A static regression guard fails
when Alembic or the legacy runtime DDL creates a table absent from the explicit RLS registry.

Tracking doc for a security hardening item found incidentally while working on
the job operational ID change (2026-07-21). Deliberately kept out of that
commit/PR — this is unrelated and needs its own review.

## Severity: this is live, not theoretical

Confirmed via `information_schema.role_table_grants`: all 18 tables below grant
**full `SELECT, INSERT, UPDATE, DELETE, TRUNCATE`** to both the `anon` and
`authenticated` Postgres roles, with RLS disabled. Those are exactly the roles
Supabase's auto-generated PostgREST API (`https://<project>.supabase.co/rest/v1/<table>`)
authenticates as using the project's anon/publishable key — a key that is not
secret (it's meant to ship in public client bundles).

**Net effect: anyone who obtains this Supabase project's anon key can read,
insert, update, or delete every row in every one of these 18 tables directly,
with no session, no role check, and no FastAPI backend involved at all.**
That includes `settlement_payments`, `technician_agreements`,
`job_closeout_reports`, and `global_settings`.

This is not blocked by the app's own auth — PostgREST is a separate,
parallel path directly into Postgres that sits in front of (not behind) the
custom backend.

## Why fixing this is lower-risk than it sounds

Two things make a stopgap fix safe to apply immediately, before the fuller
policy-design work:

1. **No code in this repo uses a client-side Supabase client.** Grepped the
   whole monorepo for `@supabase/supabase-js`, `createClient(`, and
   `NEXT_PUBLIC_SUPABASE*` — zero matches. Every app talks to the FastAPI
   backend (`apps/intake-web/api`), which talks to Postgres directly via
   `psycopg` using the `DATABASE_URL` connection string
   (`apps/intake-web/api/store.py:55`, `PostgresStore._connect`). Nothing in
   this codebase legitimately depends on the anon/authenticated PostgREST
   path for these tables.
2. **The backend's own DB role bypasses RLS anyway.** Checked `pg_roles`:
   `postgres` and `service_role` both have `rolbypassrls = true`; `anon` and
   `authenticated` do not. Supabase pooler connection strings (what
   `DATABASE_URL`/`MIGRATION_DATABASE_URL` are) connect as `postgres`. So
   turning RLS on with **zero policies** blocks `anon`/`authenticated`
   (PostgREST) completely while having **no effect whatsoever** on the
   FastAPI backend's own reads/writes.

In other words: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with no policies
yet is not "block everyone and then add policies to let the app back in" —
the app was never going through the path that gets blocked.

## Historical July snapshot: the 18 tables then observed live

| Table | Rows | Sensitivity | Why |
|---|---|---|---|
| `settlement_payments` | 3 | **Critical** | Actual money-movement records to technicians. Writable = an attacker can fabricate or erase payment records. |
| `settlement_periods` | 5 | **Critical** | Settlement batch definitions feeding payouts. |
| `settlement_period_jobs` | 76 | **Critical** | Per-job settlement line items (amounts). |
| `settlement_adjustments` | 1 | **Critical** | Manual adjustments to settlements — a quiet way to move money if writable. |
| `global_settings` | 14 | **Critical** | Platform-wide runtime flags/kill-switches (e.g. `dispatch_cutover_global_off`, `login_max_failures`). Writable = an attacker can disable dispatch or lockouts platform-wide. |
| `technician_documents` | 0 | **Critical** | Technician verification/identity documents. Empty today, but the exposure is structural, not row-count-dependent. |
| `job_closeout_reports` | 78 | **High** | Per-job financial closeout (amounts, methods). |
| `job_closeout_line_items` | 187 | **High** | Line-item detail behind the above. |
| `technician_agreements` | 7 | **High** | Compensation/contract terms between orgs and technicians. |
| `technician_invites` | 2 | **High** | Onboarding invite tokens — writable/readable lets an attacker forge or hijack an invite. |
| `login_attempts` | 3 | **High** | Auth security log. Readable leaks attempted identifiers; writable/deletable lets an attacker erase evidence or forge failures to lock out a legitimate user. |
| `governance_events` | 9 | **High** | Admin action audit trail (suspensions, etc.). Tampering destroys accountability. |
| `organization_settings` | 6 | **Medium** | Same class as `global_settings`, scoped to one org. |
| `organization_capabilities` | 21 | **Medium** | Which orgs offer which skills — write access could misroute dispatch. |
| `cron_config` | 1 | **Medium** | Scheduler config (pg_cron). Write access could disable/hijack scheduled jobs. |
| `closeout_item_types` | 17 | **Low** | Catalog/lookup data (parts & fee types). |
| `service_categories` | 3 | **Low** | Service taxonomy, catalog data. |
| `service_skills` | 7 | **Low** | Service taxonomy, catalog data. |

All 18 currently have **identical exposure** (same grants, RLS off) — the
table above differentiates by blast radius, not by how exposed they are.

## Original proposed plan

1. ~~List all 18 tables~~ — done above.
2. ~~Classify by sensitivity~~ — done above.
3. ~~Identify what's actually exposed through anon/service roles~~ — done above: all 18, fully, via `anon`+`authenticated`; the backend's own path (`postgres` role) is unaffected either way.
4. **Stopgap implemented in migration `0055`: enable RLS with zero policies on every application table.** Per the analysis above this has no effect on the owner-role backend path and closes the anon/authenticated hole.
5. Design and add real RLS policies per table (deny-by-default; only add allow policies if/when a legitimate PostgREST or client-side consumer is introduced — there isn't one today).
6. ~~Verify the FastAPI backend's read/write paths still work post-change~~ — production
   `GET https://intake.cluexp.com/api/healthz` returned `200 {"status":"ok"}` after the
   migration; broader pilot smoke remains recommended.
7. Add a regression check: a test (mirroring the existing `test_postgres_sql_has_no_unescaped_percent` style guard-test pattern in `test_dispatch.py`) or a CI/Supabase-advisor check that fails if a new table ships with RLS disabled and anon/authenticated grants present, so this doesn't silently recur.

## Status

Repository implementation is complete through the Sprint 0 closure migration and regression tests.
Production migration `0055_default_deny_rls` is applied, structurally verified, and externally
probed through Supabase PostgREST with the live anon key. The backend was redeployed after
production secret provisioning and smoke-tested on public/protected routes. Real per-table allow
policies remain intentionally deferred until an approved direct PostgREST consumer exists; there is
none today.

### 2026-08-23 — live PostgREST probe of the Tier 2 tables (`0057`/`0058`)

Extended the same live-probe pattern to `service_request_dispatch_authorizations` (new in `0057`)
and re-confirmed `governance_events` (touched by `0058`'s widened entity-type constraint) — this
time with a full read/write cycle against a **known-existing row**, not just an empty-table read,
which is the gap the original 2026-08-22 anon probe left open (an empty `SELECT` result is
ambiguous between "RLS blocked it" and "the table is genuinely empty").

**Method:** live HTTP calls to `https://gzgrkzvhotjolvcbqiku.supabase.co/rest/v1/...` using the
project's real anon key (legacy JWT, `role: anon`), not a mocked client.

| Table | Grants (anon & authenticated) | Live anon SELECT | Live anon INSERT | Live anon UPDATE | Live anon DELETE |
|---|---|---|---|---|---|
| `service_request_dispatch_authorizations` | full SELECT/INSERT/UPDATE/DELETE/etc. (Supabase default) | `200 []` (table empty in prod — not independently conclusive alone) | `401`, `{"code":"42501", "message":"new row violates row-level security policy for table \"service_request_dispatch_authorizations\""}` — conclusive | not independently tested (see below) | not independently tested (see below) |
| `governance_events` | full SELECT/INSERT/UPDATE/DELETE/etc. (Supabase default) | `200 []` against a **known real row id** — conclusive | `401`, same `42501` RLS-violation shape — conclusive | `200 []` (zero rows returned/affected) against the known real row id — conclusive | `200 []` against the known real row id — conclusive |

**How the known-row test worked:** inserted one synthetic probe row directly into
`governance_events` via the trusted service connection (`entity_type='service_request'`,
`action='rls_live_probe'`, id `16f72e5c-3cc7-49fb-83d2-dd2f4c6a6d05`), then hit that exact row by id
through the anon PostgREST key for `SELECT`/`PATCH`/`DELETE`. All three returned an empty result
(`200 []`, using `Prefer: return=representation` so an affected-but-invisible row would still show a
count) even though the row demonstrably existed — re-queried via the service connection immediately
after and confirmed unchanged (`action` still `rls_live_probe`, not the attempted `tampered`), then
deleted via the trusted connection and confirmed removed (`count = 0`). **Nothing anon-originated was
persisted; the only write to production was the probe row itself, inserted and removed via the
trusted connection, not through PostgREST.**

**Why the same known-row test wasn't repeated against `service_request_dispatch_authorizations`:**
that table has `NOT NULL` foreign keys to `jobs` and `external_clients` — inserting a real row to
test against would mean fabricating a job or an external client in production, which was explicitly
out of scope for this pass ("do not create real external clients"). The `INSERT` result alone is
still conclusive proof (RLS rejects a fabricated row outright, independent of what's already in the
table), and `governance_events` — sharing the exact same default-deny-with-zero-policies mechanism
and identical anon/authenticated grants — serves as the representative full-cycle proof for the
enforcement pattern both tables use.

**`authenticated` role:** not live-probed with a genuine role-scoped token. This project's backend
uses first-party FastAPI/Postgres auth (`SYSTEM-DESIGN.md` §"Authentication") — confirmed
`select count(*) from auth.users` returns `0` in production, i.e. Supabase Auth (GoTrue) issues no
real sessions here, so no genuine `authenticated`-role JWT exists to test with, and minting one would
require the project's JWT signing secret, which was not accessed. This is not a gap specific to this
pass — the original `0055` anon probe (2026-08-22, referenced above) was likewise anon-only.
Reasoned rather than assumed: `information_schema.role_table_grants` shows `anon` and `authenticated`
hold **identical** raw grant sets on both tables (full SELECT/INSERT/UPDATE/DELETE), and RLS with
zero policies applies uniformly to any non-owner/non-bypass role — there is no per-role carve-out
anywhere in `0055`–`0058`. The anon result is representative of `authenticated` by construction, not
by assumption alone, but a literal authenticated-role probe remains a real, documented gap if this
project ever starts issuing real Supabase Auth sessions.

**Discrepancy between Postgres catalog checks and live PostgREST behavior:** none found. The prior
session's catalog-only verification (`relrowsecurity=true`, zero `pg_policies` rows) predicted
exactly the behavior observed live: reads return nothing, writes are rejected. The one thing the
catalog check alone could not distinguish — RLS-blocked vs. genuinely-empty on a `SELECT` — is why
the known-row test above was added this pass.
