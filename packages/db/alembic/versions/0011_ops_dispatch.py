"""ops-controlled dispatch: race-safe single-offer index

Enforces the single-targeted-offer model at the DB level: at most one
dispatch_offers row with status='offered' may exist per job at any time.
The partial unique index makes a duplicate INSERT fail with a unique-violation
so concurrent dispatcher sessions can't race to send two offers for the same job.

No data migration needed — any existing 'offered' rows are unaffected unless
there happen to be duplicates (none expected; auto-dispatch is halted before
this migration runs).

Revision ID: 0011_ops_dispatch
Revises: 0010_fulfillment_cutover
Create Date: 2026-06-13
"""
from __future__ import annotations

from alembic import op

revision = "0011_ops_dispatch"
down_revision = "0010_fulfillment_cutover"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_offers_job_active
        ON dispatch_offers (job_id)
        WHERE status = 'offered'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_dispatch_offers_job_active")
