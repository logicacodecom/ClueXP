"""auth memberships + job reviews

Adds the first durable auth tables and post-job review storage:

- users, roles, and organization memberships for tenant-scoped console access;
- job reviews keyed to the completed job;
- rating summaries for technicians and fulfillment organizations.

Revision ID: 0005_auth_and_job_reviews
Revises: 0004_tenancy_and_intake
Create Date: 2026-06-04
"""
from __future__ import annotations

from alembic import op

revision = "0005_auth_and_job_reviews"
down_revision = "0004_tenancy_and_intake"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
create table if not exists users (
    id            uuid primary key default gen_random_uuid(),
    email         text unique,
    phone         text unique,
    password_hash text not null,
    display_name  text not null,
    status        text not null default 'active',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create table if not exists user_roles (
    user_id    uuid not null references users(id) on delete cascade,
    role       text not null,
    created_at timestamptz not null default now(),
    primary key (user_id, role)
);

create table if not exists user_organization_memberships (
    user_id         uuid not null references users(id) on delete cascade,
    organization_id uuid not null references organizations(id) on delete cascade,
    role            text not null default 'member',
    status          text not null default 'active',
    created_at      timestamptz not null default now(),
    primary key (user_id, organization_id)
);

create table if not exists job_reviews (
    id                         uuid primary key default gen_random_uuid(),
    job_id                     uuid not null references jobs(id) on delete cascade,
    rating                     integer not null check (rating between 1 and 5),
    tags                       text[] not null default '{}',
    comment                    text,
    fulfillment_technician_ref text,
    fulfillment_org_id         uuid references organizations(id),
    created_at                 timestamptz not null default now()
);

create table if not exists rating_summaries (
    target_type    text not null,
    target_id      text not null,
    average_rating numeric(3,2) not null default 0,
    review_count   integer not null default 0,
    updated_at     timestamptz not null default now(),
    primary key (target_type, target_id)
);

create index if not exists idx_user_roles_user
    on user_roles (user_id);
create index if not exists idx_user_memberships_org
    on user_organization_memberships (organization_id);
create index if not exists idx_job_reviews_job
    on job_reviews (job_id);
create index if not exists idx_job_reviews_technician
    on job_reviews (fulfillment_technician_ref);
create index if not exists idx_job_reviews_org
    on job_reviews (fulfillment_org_id);
"""


DOWNGRADE_SQL = """
drop index if exists idx_job_reviews_org;
drop index if exists idx_job_reviews_technician;
drop index if exists idx_job_reviews_job;
drop index if exists idx_user_memberships_org;
drop index if exists idx_user_roles_user;

drop table if exists rating_summaries;
drop table if exists job_reviews;
drop table if exists user_organization_memberships;
drop table if exists user_roles;
drop table if exists users;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)
    for table in (
        "users",
        "user_roles",
        "user_organization_memberships",
        "job_reviews",
        "rating_summaries",
    ):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    for table in (
        "rating_summaries",
        "job_reviews",
        "user_organization_memberships",
        "user_roles",
        "users",
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
