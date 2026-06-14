"""internal job notes

Append-only internal notes on a job for the owning company's dispatchers — author
+ timestamp, never shown to customers or technicians. Tenant scoping is enforced in
the API (the job must belong to the dispatcher's organization).

Revision ID: 0014_job_notes
Revises: 0013_arrival_verification
Create Date: 2026-06-14
"""
from __future__ import annotations

from alembic import op

revision = "0014_job_notes"
down_revision = "0013_arrival_verification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS job_notes (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            author_id    uuid NOT NULL,
            author_name  text,
            body         text NOT NULL,
            created_at   timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_job_notes_job ON job_notes (job_id, created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS job_notes")
