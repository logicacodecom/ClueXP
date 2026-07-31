"""job lifecycle version — durable active-job snapshot ETag input

Adds a monotonically increasing lifecycle_version counter to jobs. Native active
job snapshots use it to produce an opaque version/ETag that can change on
lifecycle-relevant writes without relying only on status text.

Revision ID: 0044_job_lifecycle_version
Revises: 0043_technician_mutations
Create Date: 2026-07-30
"""
from __future__ import annotations

from alembic import op

revision = "0044_job_lifecycle_version"
down_revision = "0043_technician_mutations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lifecycle_version integer")
    op.execute("UPDATE jobs SET lifecycle_version = 1 WHERE lifecycle_version IS NULL")
    op.execute("ALTER TABLE jobs ALTER COLUMN lifecycle_version SET DEFAULT 1")
    op.execute("ALTER TABLE jobs ALTER COLUMN lifecycle_version SET NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE jobs DROP COLUMN IF EXISTS lifecycle_version")
