"""dispatcher alert SLA defaults

Revision ID: 0061_dispatch_alert_sla_defaults
Revises: 0060_intake_phone_verification
Create Date: 2026-09-27
"""
from __future__ import annotations

from alembic import op

revision = "0061_dispatch_alert_sla_defaults"
down_revision = "0060_intake_phone_verification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE global_settings
           SET value = '30'::jsonb,
               description = 'Minutes before an unassigned job is flagged stalled in the dispatch queue.'
         WHERE key = 'dispatch_stalled_minutes'
           AND value = '15'::jsonb
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE global_settings
           SET value = '15'::jsonb,
               description = 'Minutes before an unassigned job is flagged stalled in the dispatch queue.'
         WHERE key = 'dispatch_stalled_minutes'
           AND value = '30'::jsonb
        """
    )
