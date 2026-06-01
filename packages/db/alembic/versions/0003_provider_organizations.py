"""provider organizations + affiliated technicians

Adds the supply-side tenant model:

- individual technicians can continue operating directly;
- companies/groups register as organizations;
- organizations can have recursive teams/departments/business units;
- affiliated technicians are linked to an organization and optionally to one or
  many organization teams;
- compliance documents attach to legal actors (organizations or technicians),
  not virtual teams;
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
    description          text,
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

create table if not exists organization_teams (
    id              uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    parent_team_id  uuid references organization_teams(id) on delete set null,
    name            text not null,
    description     text,
    team_type       text not null default 'team',
    status          text not null default 'active',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists organization_team_technicians (
    team_id       uuid not null references organization_teams(id) on delete cascade,
    technician_id uuid not null references technicians(id) on delete cascade,
    role          text not null default 'member',
    assigned_at   timestamptz not null default now(),
    primary key (team_id, technician_id)
);

create table if not exists provider_documents (
    id                 uuid primary key default gen_random_uuid(),
    owner_type         text not null,
    owner_id           uuid not null,
    document_type      text not null,
    document_number    text,
    issuing_authority  text,
    jurisdiction       text,
    issued_at          date,
    expires_at         date,
    status             text not null default 'pending_review',
    storage_bucket     text not null default 'private-verification',
    storage_path       text,
    notes              text,
    submitted_at       timestamptz not null default now(),
    verified_at        timestamptz,
    verified_by        uuid,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'provider_documents_owner_type_check'
    ) THEN
        ALTER TABLE provider_documents
            ADD CONSTRAINT provider_documents_owner_type_check
            CHECK (owner_type in ('organization', 'technician')) NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'provider_documents_status_check'
    ) THEN
        ALTER TABLE provider_documents
            ADD CONSTRAINT provider_documents_status_check
            CHECK (status in ('pending_review', 'verified', 'rejected', 'expired')) NOT VALID;
    END IF;
END $$;

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
create index if not exists idx_org_teams_organization
    on organization_teams (organization_id);
create index if not exists idx_org_teams_parent
    on organization_teams (parent_team_id);
create unique index if not exists idx_org_teams_root_name
    on organization_teams (organization_id, name)
    where parent_team_id is null;
create unique index if not exists idx_org_teams_child_name
    on organization_teams (organization_id, parent_team_id, name)
    where parent_team_id is not null;
create index if not exists idx_org_team_tech_technician
    on organization_team_technicians (technician_id);
create index if not exists idx_provider_documents_owner
    on provider_documents (owner_type, owner_id);
create index if not exists idx_provider_documents_type_status
    on provider_documents (document_type, status);
create index if not exists idx_provider_documents_expires_at
    on provider_documents (expires_at);

comment on column provider_documents.verified_by is
    'Nullable future reviewer/admin actor pointer; add FK when staff/admin users table exists.';
"""


DOWNGRADE_SQL = """
drop index if exists idx_org_tech_technician;
drop index if exists idx_org_team_tech_technician;
drop index if exists idx_provider_documents_expires_at;
drop index if exists idx_provider_documents_type_status;
drop index if exists idx_provider_documents_owner;
drop index if exists idx_org_teams_child_name;
drop index if exists idx_org_teams_root_name;
drop index if exists idx_org_teams_parent;
drop index if exists idx_org_teams_organization;
drop index if exists idx_dispatch_offers_organization;
drop index if exists idx_jobs_provider_organization;
drop index if exists idx_technicians_primary_organization;
drop index if exists idx_technicians_provider_type;
drop index if exists idx_organizations_subscription_status;
drop index if exists idx_organizations_status;

drop table if exists organization_team_technicians;
drop table if exists organization_teams;
drop table if exists organization_technicians;
drop table if exists provider_documents;

alter table if exists dispatch_offers drop column if exists organization_id;
alter table if exists jobs drop column if exists provider_organization_id;
alter table if exists technicians drop constraint if exists technicians_provider_type_check;
alter table if exists technicians drop column if exists primary_organization_id;
alter table if exists technicians drop column if exists provider_type;

drop table if exists organizations;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)
    for table in (
        "organizations",
        "organization_technicians",
        "organization_teams",
        "organization_team_technicians",
        "provider_documents",
    ):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    for table in (
        "organization_team_technicians",
        "organization_teams",
        "organization_technicians",
        "provider_documents",
        "organizations",
    ):
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
