"""organization status — canonical company lifecycle enum

Slice G of the Provider Workforce Model (docs/SYSTEM-DESIGN.md §18.3). The
`organizations.status` column was free text with divergent values (`pending_vetting`
on insert, `active` on approve, legacy `verified`/`expired`). This reconciles it to
the canonical company lifecycle and enforces it:

  pending_review | active | suspended | rejected | closed

Legacy mapping: pending_vetting/pending → pending_review, verified → active,
expired → suspended; any other value → pending_review (never silently active).
Column default becomes 'pending_review'. Company lifecycle is distinct from the
technician lifecycle even where labels overlap.

Revision ID: 0019_organization_status_enum
Revises: 0018_technician_photo_status
Create Date: 2026-06-17
"""
from __future__ import annotations

from alembic import op

revision = "0019_organization_status_enum"
down_revision = "0018_technician_photo_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE organizations SET status='pending_review' WHERE status IN ('pending_vetting','pending')")
    op.execute("UPDATE organizations SET status='active' WHERE status='verified'")
    op.execute("UPDATE organizations SET status='suspended' WHERE status='expired'")
    op.execute(
        "UPDATE organizations SET status='pending_review'"
        " WHERE status NOT IN ('pending_review','active','suspended','rejected','closed')"
    )
    op.execute("ALTER TABLE organizations ALTER COLUMN status SET DEFAULT 'pending_review'")
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE organizations ADD CONSTRAINT ck_org_status
                CHECK (status IN ('pending_review','active','suspended','rejected','closed'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE organizations DROP CONSTRAINT IF EXISTS ck_org_status")
    op.execute("ALTER TABLE organizations ALTER COLUMN status SET DEFAULT 'pending_vetting'")
