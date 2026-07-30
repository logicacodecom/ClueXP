"""technician devices — push-notification token registry for the native app

First backend prerequisite for the native technician client (see
docs/TECHNICIAN-NATIVE-IMPLEMENTATION-SPEC.md §4/§10.1 and ADR-0001 §6).
Holds one row per device push token (APNs/FCM) a technician has registered.
Registration is an upsert on the token; re-seeing a token refreshes
last_seen_at, moving it to whoever presented it and clearing any revoke.

This table only *stores* tokens. Actually sending push (provider selection,
APNs/FCM fan-out, delivery/ack tracking) is a later slice — the push provider
is still an open ADR-0001 §7 decision.

Revision ID: 0041_technician_devices
Revises: 0040_technician_last_seen
Create Date: 2026-07-30
"""
from __future__ import annotations

from alembic import op

revision = "0041_technician_devices"
down_revision = "0040_technician_last_seen"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS technician_devices (
            id            uuid primary key default gen_random_uuid(),
            technician_id uuid not null references technicians(id) on delete cascade,
            platform      text not null check (platform in ('ios','android')),
            push_token    text not null unique,
            environment   text not null default 'production'
                          check (environment in ('development','production')),
            app_version   text,
            created_at    timestamptz not null default now(),
            last_seen_at  timestamptz not null default now(),
            revoked_at    timestamptz
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_technician_devices_active"
        " ON technician_devices (technician_id) WHERE revoked_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS technician_devices")
