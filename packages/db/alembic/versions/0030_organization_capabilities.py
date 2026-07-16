"""organization service capabilities

Providers select which active service-catalog skills their company offers. The
initial backfill enables existing organizations for the active catalog so demo
dispatch keeps working until providers refine their selections.

Revision ID: 0030_organization_capabilities
Revises: 0029_service_catalog
Create Date: 2026-07-16
"""
from __future__ import annotations

from alembic import op

revision = "0030_organization_capabilities"
down_revision = "0029_service_catalog"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
create table if not exists organization_capabilities (
    organization_id uuid not null,
    skill_code      text not null references service_skills(code),
    status          text not null default 'active'
        check (status in ('active', 'inactive')),
    updated_at      timestamptz not null default now(),
    updated_by      uuid,
    primary key (organization_id, skill_code)
);

create index if not exists idx_organization_capabilities_active
    on organization_capabilities (organization_id, status, skill_code);

insert into organization_capabilities (organization_id, skill_code, status)
select o.id, s.code, 'active'
from organizations o
cross join service_skills s
where s.status = 'active'
on conflict (organization_id, skill_code) do nothing;
"""


DOWNGRADE_SQL = """
drop index if exists idx_organization_capabilities_active;
drop table if exists organization_capabilities;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
