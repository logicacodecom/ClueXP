"""job scoped messages

Durable job-scoped messaging foundation for the Communication Hub. This first
schema supports customer and operations channels, idempotent client sends, and
delivery/read receipts; the initial API slice enables operations messaging only.

Revision ID: 0047_job_messages
Revises: 0046_technician_notifications
Create Date: 2026-08-02
"""
from __future__ import annotations

from alembic import op

revision = "0047_job_messages"
down_revision = "0046_technician_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS job_message_threads (
            id          uuid primary key default gen_random_uuid(),
            job_id      uuid not null references jobs(id) on delete cascade,
            channel     text not null check (channel in ('customer','operations')),
            created_at  timestamptz not null default now(),
            closed_at   timestamptz,
            unique (job_id, channel)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS job_messages (
            id                     uuid primary key default gen_random_uuid(),
            thread_id              uuid not null references job_message_threads(id) on delete cascade,
            job_id                 uuid not null references jobs(id) on delete cascade,
            channel                text not null check (channel in ('customer','operations')),
            sender_type            text not null check (sender_type in ('technician','customer','dispatcher','provider_admin','system')),
            sender_user_id         uuid,
            sender_technician_id   uuid,
            sender_organization_id uuid,
            body                   text,
            template_code          text,
            template_params        jsonb not null default '{}',
            client_message_id      text,
            request_hash           text,
            metadata               jsonb not null default '{}',
            created_at             timestamptz not null default now(),
            edited_at              timestamptz,
            deleted_at             timestamptz
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_job_messages_client
        ON job_messages (job_id, sender_type, coalesce(sender_user_id, '00000000-0000-0000-0000-000000000000'::uuid), client_message_id)
        WHERE client_message_id IS NOT NULL
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_job_messages_job_channel_created"
        " ON job_messages (job_id, channel, created_at, id)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS job_message_receipts (
            id                        uuid primary key default gen_random_uuid(),
            message_id                uuid not null references job_messages(id) on delete cascade,
            recipient_type            text not null check (recipient_type in ('technician','customer','dispatcher','provider_admin')),
            recipient_user_id         uuid,
            recipient_technician_id   uuid,
            recipient_organization_id uuid,
            delivered_at              timestamptz,
            read_at                   timestamptz,
            push_sent_at              timestamptz,
            push_error                text
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_job_message_receipts_recipient
        ON job_message_receipts (
            message_id,
            recipient_type,
            coalesce(recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
            coalesce(recipient_technician_id, '00000000-0000-0000-0000-000000000000'::uuid),
            coalesce(recipient_organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS job_message_receipts")
    op.execute("DROP TABLE IF EXISTS job_messages")
    op.execute("DROP TABLE IF EXISTS job_message_threads")
