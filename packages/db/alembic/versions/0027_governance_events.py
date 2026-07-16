"""governance events for admin lifecycle actions

Records platform-admin lifecycle decisions for companies and technicians:
approve, reject, suspend, reactivate, delete, and archive. This keeps the
operator reason and actor separate from job-scoped dispatch events.

Revision ID: 0027_governance_events
Revises: 0026_org_limits
Create Date: 2026-07-15
"""
from __future__ import annotations

from alembic import op

revision = "0027_governance_events"
down_revision = "0026_org_limits"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
create table if not exists governance_events (
    id           uuid primary key default gen_random_uuid(),
    entity_type  text not null check (entity_type in ('organization', 'technician')),
    entity_id    uuid not null,
    action       text not null,
    reason       text,
    actor_id     uuid,
    metadata     jsonb not null default '{}',
    created_at   timestamptz not null default now()
);

create index if not exists idx_governance_events_entity
    on governance_events (entity_type, entity_id, created_at desc);
create index if not exists idx_governance_events_actor
    on governance_events (actor_id, created_at desc);
"""

DOWNGRADE_SQL = """
drop index if exists idx_governance_events_actor;
drop index if exists idx_governance_events_entity;
drop table if exists governance_events;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
