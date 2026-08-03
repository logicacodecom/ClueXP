"""job scoped masked call sessions

Durable audit table for mediated/masked call attempts. This does not configure
a voice provider; current API responses honestly return skipped_no_provider.

Revision ID: 0048_job_call_sessions
Revises: 0047_job_messages
Create Date: 2026-08-02
"""
from __future__ import annotations

from alembic import op

revision = "0048_job_call_sessions"
down_revision = "0047_job_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS job_call_sessions (
            id                     uuid primary key default gen_random_uuid(),
            job_id                 uuid not null references jobs(id) on delete cascade,
            caller_type            text not null check (caller_type in ('technician','customer','dispatcher','provider_admin')),
            caller_user_id         uuid,
            caller_technician_id   uuid,
            caller_organization_id uuid,
            callee_type            text not null check (callee_type in ('technician','customer','operations')),
            callee_user_id         uuid,
            callee_technician_id   uuid,
            callee_organization_id uuid,
            provider               text,
            provider_call_sid      text,
            masked_number          text,
            status                 text not null default 'unavailable'
                                   check (status in ('requested','ringing','connected','completed','failed','unavailable')),
            provider_status        text not null default 'skipped_no_provider'
                                   check (provider_status in ('queued','sent','failed','skipped_no_provider')),
            metadata               jsonb not null default '{}',
            created_at             timestamptz not null default now(),
            connected_at           timestamptz,
            ended_at               timestamptz
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_job_call_sessions_job_created"
        " ON job_call_sessions (job_id, created_at desc)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS job_call_sessions")
