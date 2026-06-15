"""job payment reports

Two-sided payment reconciliation for a completed job: the assigned technician
reports how much was collected and by what method; the customer reports how much
they paid and how. One row per (job_id, reported_by) — the latest report from each
side. Amounts are advisory records for the job history, not a payment-processing
ledger (no real capture happens in the MVP).

Revision ID: 0015_job_payments
Revises: 0014_job_notes
Create Date: 2026-06-15
"""
from __future__ import annotations

from alembic import op

revision = "0015_job_payments"
down_revision = "0014_job_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS job_payment_reports (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            reported_by  text NOT NULL CHECK (reported_by IN ('technician', 'customer')),
            amount       numeric(10, 2) NOT NULL CHECK (amount >= 0),
            currency     text NOT NULL DEFAULT 'USD',
            method       text NOT NULL,
            reported_at  timestamptz NOT NULL DEFAULT now(),
            updated_at   timestamptz NOT NULL DEFAULT now(),
            UNIQUE (job_id, reported_by)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_job_payment_reports_job"
        " ON job_payment_reports (job_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS job_payment_reports")
