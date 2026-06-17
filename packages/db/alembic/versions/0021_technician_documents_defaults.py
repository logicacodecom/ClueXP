"""repair technician_documents column defaults

0020's Python migration created `technician_documents` with `id`, `uploaded_at`, and
`status` as NOT NULL but WITHOUT defaults (the .sql sidecar had them, the .py did not).
`create_technician_document` omits id/uploaded_at on insert, so against the as-applied
table every insert fails with a NOT NULL violation. This adds the missing defaults so
the existing prod table works. Idempotent (SET DEFAULT is safe to re-run).

Revision ID: 0021_tech_doc_defaults
Revises: 0020_technician_documents
Create Date: 2026-06-17

(Revision id kept <= 32 chars for alembic_version varchar(32).)
"""
from __future__ import annotations

from alembic import op

revision = "0021_tech_doc_defaults"
down_revision = "0020_technician_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE technician_documents ALTER COLUMN id SET DEFAULT gen_random_uuid()")
    op.execute("ALTER TABLE technician_documents ALTER COLUMN uploaded_at SET DEFAULT now()")
    op.execute("ALTER TABLE technician_documents ALTER COLUMN status SET DEFAULT 'pending_review'")


def downgrade() -> None:
    op.execute("ALTER TABLE technician_documents ALTER COLUMN id DROP DEFAULT")
    op.execute("ALTER TABLE technician_documents ALTER COLUMN uploaded_at DROP DEFAULT")
    op.execute("ALTER TABLE technician_documents ALTER COLUMN status DROP DEFAULT")
