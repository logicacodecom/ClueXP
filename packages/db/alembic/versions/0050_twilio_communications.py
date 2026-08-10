"""twilio communications settings, inbound calls, and sms delivery records

Revision ID: 0050_twilio_communications
Revises: 0049_push_provider_receipts
Create Date: 2026-08-09
"""
from __future__ import annotations

from alembic import op

revision = "0050_twilio_communications"
down_revision = "0049_push_provider_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE job_call_sessions ALTER COLUMN job_id DROP NOT NULL")
    op.execute(
        """
        ALTER TABLE job_call_sessions
            ADD COLUMN IF NOT EXISTS direction text
                check (direction in ('inbound','outbound')),
            ADD COLUMN IF NOT EXISTS answered_at timestamptz,
            ADD COLUMN IF NOT EXISTS duration_seconds integer
        """
    )
    op.execute(
        """
        ALTER TABLE job_call_sessions
        DROP CONSTRAINT IF EXISTS job_call_sessions_status_check
        """
    )
    op.execute(
        """
        ALTER TABLE job_call_sessions
        ADD CONSTRAINT job_call_sessions_status_check
        CHECK (status in (
            'requested','initiated','ringing','connected','answered',
            'completed','busy','no_answer','failed','unavailable','voicemail'
        ))
        """
    )
    op.execute(
        """
        ALTER TABLE job_call_sessions
        DROP CONSTRAINT IF EXISTS job_call_sessions_provider_status_check
        """
    )
    op.execute(
        """
        ALTER TABLE job_call_sessions
        ADD CONSTRAINT job_call_sessions_provider_status_check
        CHECK (provider_status in (
            'queued','initiated','ringing','in-progress','completed','busy',
            'failed','no-answer','canceled','sent','delivered','undelivered',
            'skipped_no_provider'
        ))
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_job_call_sessions_provider_sid
        ON job_call_sessions (provider, provider_call_sid)
        WHERE provider IS NOT NULL AND provider_call_sid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS organization_phone_settings (
            organization_id             uuid primary key references organizations(id) on delete cascade,
            twilio_number               text unique,
            primary_forwarding_number   text,
            backup_forwarding_number    text,
            ring_timeout_seconds        integer not null default 20
                                         check (ring_timeout_seconds between 5 and 60),
            business_hours_behavior     text not null default 'always_forward'
                                         check (business_hours_behavior in ('always_forward','voicemail_after_hours')),
            voicemail_enabled           boolean not null default true,
            sms_enabled                 boolean not null default false,
            masked_calling_enabled      boolean not null default false,
            a2p_registered              boolean not null default false,
            updated_at                  timestamptz not null default now(),
            updated_by                  uuid
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS communication_sms_deliveries (
            id                 uuid primary key default gen_random_uuid(),
            organization_id    uuid references organizations(id) on delete cascade,
            job_id             uuid references jobs(id) on delete set null,
            recipient_type     text not null check (recipient_type in ('customer','technician','dispatcher','provider_admin')),
            to_number          text not null,
            from_number        text,
            purpose            text not null,
            provider           text,
            provider_message_sid text,
            provider_status    text not null default 'skipped_no_provider',
            error_code         text,
            request_hash       text not null,
            metadata           jsonb not null default '{}',
            created_at         timestamptz not null default now(),
            sent_at            timestamptz,
            delivered_at       timestamptz,
            failed_at          timestamptz
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_delivery_request
        ON communication_sms_deliveries (organization_id, job_id, recipient_type, purpose, request_hash)
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_delivery_provider_sid
        ON communication_sms_deliveries (provider, provider_message_sid)
        WHERE provider IS NOT NULL AND provider_message_sid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS communication_opt_outs (
            phone_e164       text primary key,
            organization_id  uuid references organizations(id) on delete cascade,
            opted_out_at     timestamptz not null default now(),
            source           text not null default 'sms_stop'
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS communication_opt_outs")
    op.execute("DROP TABLE IF EXISTS communication_sms_deliveries")
    op.execute("DROP TABLE IF EXISTS organization_phone_settings")
    op.execute("DROP INDEX IF EXISTS uq_job_call_sessions_provider_sid")
    op.execute("ALTER TABLE job_call_sessions DROP COLUMN IF EXISTS duration_seconds")
    op.execute("ALTER TABLE job_call_sessions DROP COLUMN IF EXISTS answered_at")
    op.execute("ALTER TABLE job_call_sessions DROP COLUMN IF EXISTS direction")
    op.execute("ALTER TABLE job_call_sessions ALTER COLUMN job_id SET NOT NULL")
