"""neutral-network tenancy & intake (adr/0004)

Aligns the dispatch schema with the neutral multi-tenant dispatch-network model
in `docs/adr/0004-tenancy-and-intake.md`:

- Three independent axes on `jobs`: **origin** (who brought the demand),
  **customer owner** (who owns the relationship; defaults to origin), and
  **fulfillment** (`fulfillment_org_id` nullable + `fulfillment_technician_id`).
  The pre-adr/0004 `technician_id` / `provider_organization_id` columns are
  renamed to the fulfillment names.
- Control vs overflow as separate fields: `organizations.dispatch_mode`
  (`organization_managed` | `cluexp_managed_routing`) and `jobs.fulfillment_policy`
  (`private` | `network_overflow` | `network_open`).
- `responsible_organization_id` (merchant-of-record/accountable; legal specifics
  deferred), `network_released_at`, and a reserved `marketplace_state` (no logic).
- Publishable `intake_channels` (resolved server-side to an owning org) +
  `organization_technicians.network_release_allowed` (membership network release).

⚠️ STATUS: **DRAFTED FOR REVIEW — NOT YET APPLIED.** Additive columns/tables are
safe, but the two RENAMEs touch the live writer `apps/intake-web/api/store.py`
(which inserts `jobs.technician_id` / `provider_organization_id`). Apply in
**Sprint 2B**, in lockstep with the `store.py` update, and only with explicit
prod-DDL authorization. Until then this migration is not part of the applied head
(do not `alembic upgrade` it in prod).

Deferred to the auth migration (0005): the customer-identity split — a global
person/identity (resolved by phone, not tenant-browsable) + org-scoped,
RLS-isolated customer-relationship rows (adr/0004 §3) — since its RLS authz
couples to the `users` table.

Revision ID: 0004_tenancy_and_intake
Revises: 0003_provider_organizations
Create Date: 2026-06-04
"""
from __future__ import annotations

from alembic import op

revision = "0004_tenancy_and_intake"
down_revision = "0003_provider_organizations"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
-- 1. jobs: rename the existing fulfillment columns to the adr/0004 names.
--    (Coupled with api/store.py — apply together.)
alter table jobs rename column technician_id to fulfillment_technician_id;
alter table jobs rename column provider_organization_id to fulfillment_org_id;

-- 2. jobs: origin / customer-owner / policy / provenance (all nullable or defaulted).
alter table jobs add column if not exists origin_org_id                  uuid references organizations(id);
alter table jobs add column if not exists customer_owner_org_id          uuid references organizations(id);
alter table jobs add column if not exists origin_channel                 text;
alter table jobs add column if not exists responsible_organization_id    uuid references organizations(id);
alter table jobs add column if not exists fulfillment_policy             text not null default 'private';
alter table jobs add column if not exists network_released_at            timestamptz;
alter table jobs add column if not exists marketplace_state              text;  -- reserved; no logic yet

-- 3. organizations: routing-control mode (distinct from fulfillment_policy).
alter table organizations
    add column if not exists dispatch_mode text not null default 'organization_managed';

-- 4. organization_technicians: membership flag releasing an affiliated tech for network routing.
alter table organization_technicians
    add column if not exists network_release_allowed boolean not null default false;

-- 5. intake_channels: publishable channels resolved server-side to an owning org.
create table if not exists intake_channels (
    id                 uuid primary key default gen_random_uuid(),
    organization_id    uuid references organizations(id),   -- null = ClueXP platform channel
    slug               text unique,
    channel_type       text not null default 'web',         -- web|social|gbp|qr|sms|email|ads|embed|phone|dispatcher_manual
    display_name       text,
    fulfillment_policy text not null default 'private',
    active             boolean not null default true,
    created_at         timestamptz not null default now()
);
alter table jobs add column if not exists intake_channel_id uuid references intake_channels(id);

-- 6. indexes.
alter index if exists idx_jobs_provider_organization rename to idx_jobs_fulfillment_org;
create index if not exists idx_jobs_origin_org     on jobs (origin_org_id);
create index if not exists idx_jobs_customer_owner on jobs (customer_owner_org_id);
create index if not exists idx_jobs_intake_channel on jobs (intake_channel_id);
"""

DOWNGRADE_SQL = """
drop index if exists idx_jobs_intake_channel;
drop index if exists idx_jobs_customer_owner;
drop index if exists idx_jobs_origin_org;
alter index if exists idx_jobs_fulfillment_org rename to idx_jobs_provider_organization;

alter table if exists jobs drop column if exists intake_channel_id;
drop table if exists intake_channels;

alter table if exists organization_technicians drop column if exists network_release_allowed;
alter table if exists organizations drop column if exists dispatch_mode;

alter table if exists jobs drop column if exists marketplace_state;
alter table if exists jobs drop column if exists network_released_at;
alter table if exists jobs drop column if exists fulfillment_policy;
alter table if exists jobs drop column if exists responsible_organization_id;
alter table if exists jobs drop column if exists origin_channel;
alter table if exists jobs drop column if exists customer_owner_org_id;
alter table if exists jobs drop column if exists origin_org_id;

alter table if exists jobs rename column fulfillment_org_id to provider_organization_id;
alter table if exists jobs rename column fulfillment_technician_id to technician_id;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)
    op.execute("ALTER TABLE public.intake_channels ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
