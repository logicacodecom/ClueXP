"""technician compliance documents — upload, review, and status tracking

This adds a `technician_documents` table to track technician compliance documents:
- Document upload with storage path
- Status: pending_review | approved | rejected (with rejection reason)
- Document type and metadata
- Expiration date for documents that expire

Revision ID: 0020_technician_documents
Revises: 0019_organization_status_enum
Create Date: 2026-06-17
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0020_technician_documents"
down_revision = "0019_organization_status_enum"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "technician_documents",
        # Defaults match 0020_technician_documents.sql so the insert (which omits
        # id/uploaded_at/status) succeeds. Prod, applied before this fix, is repaired
        # by 0021_technician_documents_defaults.
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("technician_id", sa.UUID(), nullable=False),
        sa.Column("document_type", sa.Text(), nullable=False),
        sa.Column("document_number", sa.Text(), nullable=True),
        sa.Column("storage_bucket", sa.Text(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="pending_review", nullable=False),
        sa.Column("rejected_reason", sa.Text(), nullable=True),
        sa.Column("expiration_date", sa.Date(), nullable=True),
        sa.Column("uploaded_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("reviewed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["technician_id"], ["technicians.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_technician_documents_technician_id", "technician_documents", ["technician_id"]
    )
    op.create_index(
        "idx_technician_documents_status", "technician_documents", ["status"]
    )
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE technician_documents ADD CONSTRAINT ck_tech_doc_status
                CHECK (status IN ('pending_review','approved','rejected'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS technician_documents")
