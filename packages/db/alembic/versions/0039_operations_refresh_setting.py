"""Add provider Operations refresh interval setting.

Revision ID: 0039_operations_refresh_setting
Revises: 0038_job_operational_id
Create Date: 2026-07-22
"""
from __future__ import annotations

from alembic import op

revision = "0039_operations_refresh_setting"
down_revision = "0038_job_operational_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO global_settings
            (key, value, value_type, description, is_secret, is_runtime_editable)
        VALUES (
            'dispatch_operations_refresh_seconds',
            '30'::jsonb,
            'integer',
            'Seconds between automatic refreshes on the provider Operations workspace. Provider-overridable.',
            false,
            true
        )
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM global_settings WHERE key = 'dispatch_operations_refresh_seconds'"
    )
