"""technician profile photo approval status — customer-safe identity gate

Slice E of the Provider Workforce Model (docs/SYSTEM-DESIGN.md §18.3). The
`technicians.profile_photo_url` column already exists (0001 baseline, public CDN
bucket from 0002). This adds an approval gate so the customer tracking response can
expose the assigned technician's photo ONLY when it is approved:

- `profile_photo_status`: none | pending | approved | rejected (default 'none').

The customer-facing tracking assignment exposes `technician_photo_url` only when the
status is `approved`; otherwise the UI shows a "Photo pending verification" fallback.
Candidate technician identity is never exposed before assignment (unchanged).

Revision ID: 0018_technician_photo_status
Revises: 0017_affiliation_history
Create Date: 2026-06-16
"""
from __future__ import annotations

from alembic import op

revision = "0018_technician_photo_status"
down_revision = "0017_affiliation_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE technicians"
        " ADD COLUMN IF NOT EXISTS profile_photo_status text NOT NULL DEFAULT 'none'"
    )
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE technicians ADD CONSTRAINT ck_tech_photo_status
                CHECK (profile_photo_status IN ('none','pending','approved','rejected'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE technicians DROP CONSTRAINT IF EXISTS ck_tech_photo_status")
    op.execute("ALTER TABLE technicians DROP COLUMN IF EXISTS profile_photo_status")
