"""provider organizations + affiliated technicians

Adds the supply-side tenant model:

- individual technicians can continue operating directly;
- companies/groups register as organizations;
- affiliated technicians are linked to an organization;
- jobs/offers can record the provider organization that owns the fulfillment.

This keeps subscriptions and company admin possible without forcing every
technician into a tenant on day one.

Revision ID: 0003_provider_organizations
Revises: 0002_storage_and_rls
Create Date: 2026-05-31
"""
from __future__ import annotations

from alembic import op

revision = "0003_provider_organizations"
down_revision = "0002_storage_and_rls"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
create table if not exists organizations (
    id                   uuid primary key default gen_random_uuid(),
    legal_name           text,
    display_name         text not null,
    slug                 text unique,
    organization_type    text not null default 'company',
    status               text not null default 'pending_vetting',
    subscription_status  text not null default 'none',
    billing_customer_ref text,
    phone                text,
    email                text,
    service_area_center_lat double precision,
    service_area_center_lng double precision,
    service_area_radius_km  double precision,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

alter table technicians
    add column if not exists provider_type text not null default 'individual';

alter table technicians
    add column if not exists primary_organization_id uuid references organizations(id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'technicians_provider_type_check'
    ) THEN
        ALTER TABLE technicians
            ADD CONSTRAINT technicians_provider_type_check
            CHECK (provider_type in ('individual', 'affiliate')) NOT VALID;
    END IF;
END $$;

alter table jobs
    add column if not exists provider_organization_id uuid references organizations(id);

alter table dispatch_offers
    add column if not exists organization_id uuid references organizations(id);

create table if not exists organization_technicians (
    organization_id uuid not null references organizations(id) on delete cascade,
    technician_id   uuid not null references technicians(id) on delete cascade,
    role            text not null default 'affiliate_technician',
    status          text not null default 'pending_invite',
    invited_at      timestamptz not null default now(),
    activated_at    timestamptz,
    primary key (organization_id, technician_id)
);

create index if not exists idx_organizations_status
    on organizations (status);
create index if not exists idx_organizations_subscription_status
    on organizations (subscription_status);
create index if not exists idx_technicians_provider_type
    on technicians (provider_type);
create index if not exists idx_technicians_primary_organization
    on technicians (primary_organization_id);
create index if not exists idx_jobs_provider_organization
    on jobs (provider_organization_id);
create index if not exists idx_dispatch_offers_organization
    on dispatch_offers (organization_id);
create index if not exists idx_org_tech_technician
    on organization_technicians (technician_id);
"""


DOWNGRADE_SQL = """
drop index if exists idx_org_tech_technician;
drop index if exists idx_dispatch_offers_organization;
drop index if exists idx_jobs_provider_organization;
drop index if exists idx_technicians_primary_organization;
drop index if exists idx_technicians_provider_type;
drop index if exists idx_organizations_subscription_status;
drop index if exists idx_organizations_status;

drop table if exists organization_technicians;

alter table if exists dispatch_offers drop column if exists organization_id;
alter table if exists jobs drop column if exists provider_organization_id;
alter table if exists technicians drop constraint if exists technicians_provider_type_check;
alter table if exists technicians drop column if exists primary_organization_id;
alter table if exists technicians drop column if exists provider_type;

drop table if exists organizations;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)
    for table in ("organizations", "organization_technicians"):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    for table in ("organization_technicians", "organizations"):
        op.execute(
            f"""
DO $$
BEGIN
    IF to_regclass('public.{table}') IS NOT NULL THEN
        ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY;
    END IF;
END $$;
"""
        )
    op.execute(DOWNGRADE_SQL)
