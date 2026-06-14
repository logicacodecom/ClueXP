"""arrival verification: secure customer PIN

Replaces the in-memory arrival-handshake stub with a persisted, hashed,
expiring, single-use, attempt-limited PIN bound to the job and its assigned
technician. Only the HMAC hash is stored — never the PIN.

One row per job (upserted when the customer issues/refreshes a PIN). The
technician proves physical presence by entering the customer-held PIN to move
the job en_route -> arrived.

Revision ID: 0013_arrival_verification
Revises: 0012_decline_reason
Create Date: 2026-06-13
"""
from __future__ import annotations

from alembic import op

revision = "0013_arrival_verification"
down_revision = "0012_decline_reason"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS arrival_verifications (
            job_id        uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
            technician_id uuid NOT NULL,
            pin_hash      text NOT NULL,
            expires_at    timestamptz NOT NULL,
            attempts      integer NOT NULL DEFAULT 0,
            max_attempts  integer NOT NULL DEFAULT 5,
            verified_at   timestamptz,
            created_at    timestamptz NOT NULL DEFAULT now(),
            updated_at    timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS arrival_verifications")
