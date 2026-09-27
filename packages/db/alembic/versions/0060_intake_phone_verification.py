"""ClueXP-owned intake phone verification links

Revision ID: 0060_intake_phone_verification
Revises: 0059_job_origin_client
Create Date: 2026-09-24
"""
from __future__ import annotations

from alembic import op

revision = "0060_intake_phone_verification"
down_revision = "0059_job_origin_client"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
alter table jobs add column if not exists phone_verified_at timestamptz;
alter table jobs add column if not exists phone_verified_e164 text;

create table if not exists intake_phone_verifications (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references jobs(id) on delete cascade,
    phone_e164 text not null,
    token_hash text not null unique check (length(token_hash) = 64),
    intake_channel_slug text not null,
    consent_version text not null,
    consented_at timestamptz not null default now(),
    expires_at timestamptz not null,
    send_succeeded_at timestamptz,
    consumed_at timestamptz,
    superseded_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_intake_phone_verifications_job_created
    on intake_phone_verifications (job_id, created_at desc);
create index if not exists idx_intake_phone_verifications_phone_created
    on intake_phone_verifications (phone_e164, created_at desc);

alter table intake_phone_verifications enable row level security;
"""

DOWNGRADE_SQL = """
drop table if exists intake_phone_verifications;
alter table jobs drop column if exists phone_verified_e164;
alter table jobs drop column if exists phone_verified_at;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
