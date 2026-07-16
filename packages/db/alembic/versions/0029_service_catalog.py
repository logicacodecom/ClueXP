"""managed service catalog

Adds platform-admin managed service categories and leaf skills. The seed keeps
Locksmith active and prepares HVAC/Towing as draft future verticals.

Revision ID: 0029_service_catalog
Revises: 0028_governance_events_user_type
Create Date: 2026-07-16
"""
from __future__ import annotations

from alembic import op

revision = "0029_service_catalog"
down_revision = "0028_governance_events_user_type"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
create table if not exists service_categories (
    code        text primary key,
    label       text not null,
    status      text not null default 'draft'
        check (status in ('draft', 'active', 'deprecated')),
    sort_order  integer not null default 100,
    updated_at  timestamptz not null default now(),
    updated_by  uuid
);

create table if not exists service_skills (
    code                  text primary key,
    category_code         text not null references service_categories(code),
    label                 text not null,
    status                text not null default 'draft'
        check (status in ('draft', 'active', 'deprecated')),
    requires_verification boolean not null default false,
    sort_order            integer not null default 100,
    updated_at            timestamptz not null default now(),
    updated_by            uuid
);

create index if not exists idx_service_skills_category
    on service_skills (category_code, sort_order, code);

insert into service_categories (code, label, status, sort_order) values
    ('locksmith', 'Locksmith', 'active', 10),
    ('hvac', 'HVAC', 'draft', 20),
    ('towing', 'Towing & Roadside', 'draft', 30)
on conflict (code) do nothing;

insert into service_skills
    (code, category_code, label, status, requires_verification, sort_order)
values
    ('locksmith.vehicle_lockout', 'locksmith', 'Vehicle lockout', 'active', false, 10),
    ('locksmith.residential_lockout', 'locksmith', 'Residential lockout', 'active', false, 20),
    ('locksmith.commercial_lockout', 'locksmith', 'Commercial lockout', 'active', false, 30),
    ('locksmith.broken_key', 'locksmith', 'Broken key extraction', 'active', true, 40),
    ('locksmith.rekey', 'locksmith', 'Rekey', 'active', false, 50),
    ('locksmith.smart_lock', 'locksmith', 'Smart lock', 'active', true, 60),
    ('locksmith.vehicle_key_programming', 'locksmith', 'Vehicle key programming', 'active', true, 70)
on conflict (code) do nothing;
"""


DOWNGRADE_SQL = """
drop index if exists idx_service_skills_category;
drop table if exists service_skills;
drop table if exists service_categories;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
