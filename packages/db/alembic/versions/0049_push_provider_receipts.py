"""technician notifications — real provider ticket + receipt columns

0046 could only record 'skipped_no_provider' because no push provider was
configured. With Expo Push wired up (api/push.py) a row now carries the
provider's own answer, so we store what the provider actually said:

  provider_ticket_id     -- Expo push ticket id, the handle used to fetch the
                            device receipt later (delivery event 2).
  provider_error_code    -- Expo error code ('DeviceNotRegistered',
                            'MessageTooBig', 'MessageRateExceeded', ...).
  provider_error_message -- human-readable provider text, for operator triage.
  provider_receipt_at    -- when the receipt lookup resolved. Null = still
                            pending; the sweep only polls unresolved rows.

Additive and nullable: existing rows stay valid and a deployment WITHOUT
credentials keeps writing 'skipped_no_provider' with all four columns null.

Revision ID: 0049_push_provider_receipts
Revises: 0048_job_call_sessions
Create Date: 2026-08-03
"""
from __future__ import annotations

from alembic import op

revision = "0049_push_provider_receipts"
down_revision = "0048_job_call_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE technician_notifications
            ADD COLUMN IF NOT EXISTS provider_ticket_id     text,
            ADD COLUMN IF NOT EXISTS provider_error_code    text,
            ADD COLUMN IF NOT EXISTS provider_error_message text,
            ADD COLUMN IF NOT EXISTS provider_receipt_at    timestamptz
        """
    )
    # The receipt sweep's only query: sent-but-unresolved tickets, oldest first.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_technician_notifications_pending_receipt"
        " ON technician_notifications (created_at)"
        " WHERE provider_ticket_id IS NOT NULL AND provider_receipt_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_technician_notifications_pending_receipt")
    op.execute(
        """
        ALTER TABLE technician_notifications
            DROP COLUMN IF EXISTS provider_ticket_id,
            DROP COLUMN IF EXISTS provider_error_code,
            DROP COLUMN IF EXISTS provider_error_message,
            DROP COLUMN IF EXISTS provider_receipt_at
        """
    )
