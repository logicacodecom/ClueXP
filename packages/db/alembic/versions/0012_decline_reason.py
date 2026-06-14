"""dispatch: persist technician decline reason

Adds dispatch_offers.decline_reason so Ops can see why a technician declined an
offer when deciding whom to reassign. Nullable text — existing declined rows
keep a NULL reason; no data migration needed.

Revision ID: 0012_decline_reason
Revises: 0011_ops_dispatch
Create Date: 2026-06-13
"""
from __future__ import annotations

from alembic import op

revision = "0012_decline_reason"
down_revision = "0011_ops_dispatch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE dispatch_offers ADD COLUMN IF NOT EXISTS decline_reason text")


def downgrade() -> None:
    op.execute("ALTER TABLE dispatch_offers DROP COLUMN IF EXISTS decline_reason")
