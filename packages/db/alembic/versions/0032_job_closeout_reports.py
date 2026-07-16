"""job closeout reports

Adds the production closeout ledger used when a technician finishes a job:
itemized lines, tax/tip/card-fee calculations, and the settings snapshot used
at reporting time. The legacy job_payment_reports table remains as the compact
history/payment summary while this table stores the detailed receipt.

Revision ID: 0032_job_closeout_reports
Revises: 0031_financial_closeout_settings
Create Date: 2026-07-16
"""
from __future__ import annotations

from alembic import op

revision = "0032_job_closeout_reports"
down_revision = "0031_financial_closeout_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS job_closeout_reports (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            reported_by text NOT NULL CHECK (reported_by IN ('technician')),
            currency text NOT NULL DEFAULT 'USD',
            method text NOT NULL,
            subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
            taxable_subtotal_cents integer NOT NULL CHECK (taxable_subtotal_cents >= 0),
            tax_rate_basis_points integer NOT NULL CHECK (tax_rate_basis_points >= 0),
            tax_cents integer NOT NULL CHECK (tax_cents >= 0),
            tip_cents integer NOT NULL CHECK (tip_cents >= 0),
            card_fee_basis_points integer NOT NULL CHECK (card_fee_basis_points >= 0),
            card_fee_fixed_cents integer NOT NULL CHECK (card_fee_fixed_cents >= 0),
            card_fee_cents integer NOT NULL CHECK (card_fee_cents >= 0),
            total_cents integer NOT NULL CHECK (total_cents >= 0),
            no_tax_reason text,
            settings_snapshot jsonb NOT NULL DEFAULT '{}',
            reported_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (job_id, reported_by)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS job_closeout_line_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            closeout_id uuid NOT NULL REFERENCES job_closeout_reports(id) ON DELETE CASCADE,
            job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            line_number integer NOT NULL,
            item_type_code text NOT NULL REFERENCES closeout_item_types(code),
            description text NOT NULL,
            quantity numeric(10,2) NOT NULL CHECK (quantity > 0),
            unit_amount_cents integer NOT NULL CHECK (unit_amount_cents >= 0),
            line_total_cents integer NOT NULL CHECK (line_total_cents >= 0),
            taxable boolean NOT NULL DEFAULT true,
            provided_by text CHECK (provided_by IN ('company','technician','customer','third_party')),
            compensation_eligible boolean NOT NULL DEFAULT false,
            reimbursement_eligible boolean NOT NULL DEFAULT false,
            note text,
            UNIQUE (closeout_id, line_number)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_job_closeout_reports_job"
        " ON job_closeout_reports (job_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_job_closeout_line_items_job"
        " ON job_closeout_line_items (job_id, closeout_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS job_closeout_line_items")
    op.execute("DROP TABLE IF EXISTS job_closeout_reports")
