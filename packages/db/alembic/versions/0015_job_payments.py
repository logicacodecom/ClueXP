"""job payment reports

Payment record for a completed job. The assigned **technician** reports how much
was collected and by what method (the single source of truth); the customer views
and acknowledges it by confirming completion — there is no separate customer-entered
amount. Amounts are advisory records for the job history (USD-only in the MVP), not
a payment-processing ledger (no real capture happens).

`reported_by` keeps a CHECK allowing 'customer' as a reserved value for forward
compatibility, but the current contract only writes 'technician'. One row per
(job_id, reported_by) — a re-report overwrites.

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
