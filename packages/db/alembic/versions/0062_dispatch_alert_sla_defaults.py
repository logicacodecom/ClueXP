"""dispatcher alert SLA default and unresolved-alert uniqueness

Revision ID: 0062_dispatch_alert_sla_defaults
Revises: 0061_intake_channel_ai_listing
Create Date: 2026-09-27
"""
from __future__ import annotations

from alembic import op

revision = "0062_dispatch_alert_sla_defaults"
down_revision = "0061_intake_channel_ai_listing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE global_settings
           SET value = '30'::jsonb,
               updated_at = now()
         WHERE key = 'dispatch_stalled_minutes'
           AND value = '15'::jsonb
           AND updated_by IS NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_unresolved_org_job_type
            ON alerts (organization_id, job_id, alert_type)
         WHERE status <> 'resolved' AND job_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_unresolved_org_type_no_job
            ON alerts (organization_id, alert_type)
         WHERE status <> 'resolved' AND job_id IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_alerts_unresolved_org_type_no_job")
    op.execute("DROP INDEX IF EXISTS uq_alerts_unresolved_org_job_type")
    # Do not rewrite the setting on downgrade: a value of 30 may have been
    # explicitly confirmed or changed by an operator after upgrade.
