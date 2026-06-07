"""login attempts for brute-force protection

Revision ID: 0008_login_attempts
Revises: 0007_dispatch_attempts
Create Date: 2026-06-06
"""
from __future__ import annotations

from alembic import op

revision = "0008_login_attempts"
down_revision = "0007_dispatch_attempts"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
create table if not exists login_attempts (
    id          uuid primary key default gen_random_uuid(),
    identifier  text not null,
    ip          text,
    success     boolean not null default false,
    created_at  timestamptz not null default now()
);
create index if not exists idx_login_attempts_identifier_time
    on login_attempts (lower(identifier), created_at);
"""

DOWNGRADE_SQL = """
drop index if exists idx_login_attempts_identifier_time;
drop table if exists login_attempts;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
