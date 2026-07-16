"""settlement periods

Adds provider-owned settlement periods that snapshot calculated settlement rows.
Draft periods can receive adjustments; locked/paid periods preserve immutable row
snapshots so later agreement or closeout edits do not rewrite payout history.

Revision ID: 0034_settlement_periods
Revises: 0033_technician_agreements
Create Date: 2026-07-16
"""
from __future__ import annotations

from alembic import op

revision = "0034_settlement_periods"
down_revision = "0033_technician_agreements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS settlement_periods (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','locked','paid','void')),
            label text NOT NULL,
            period_start date,
            period_end date,
            technician_id uuid REFERENCES technicians(id),
            job_count integer NOT NULL DEFAULT 0,
            customer_total_cents integer NOT NULL DEFAULT 0,
            tax_cents integer NOT NULL DEFAULT 0,
            card_fee_cents integer NOT NULL DEFAULT 0,
            tech_payout_cents integer NOT NULL DEFAULT 0,
            company_retained_cents integer NOT NULL DEFAULT 0,
            adjustment_cents integer NOT NULL DEFAULT 0,
            final_tech_payout_cents integer NOT NULL DEFAULT 0,
            note text,
            created_by uuid REFERENCES users(id),
            locked_by uuid REFERENCES users(id),
            paid_by uuid REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            locked_at timestamptz,
            paid_at timestamptz
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS settlement_period_jobs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            settlement_period_id uuid NOT NULL REFERENCES settlement_periods(id) ON DELETE CASCADE,
            job_id uuid NOT NULL,
            technician_id uuid,
            row_snapshot jsonb NOT NULL,
            tech_payout_cents integer NOT NULL DEFAULT 0,
            company_retained_cents integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (settlement_period_id, job_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS settlement_adjustments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            settlement_period_id uuid NOT NULL REFERENCES settlement_periods(id) ON DELETE CASCADE,
            amount_cents integer NOT NULL,
            reason text NOT NULL,
            created_by uuid REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_settlement_periods_org_status"
        " ON settlement_periods (organization_id, status, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS settlement_adjustments")
    op.execute("DROP TABLE IF EXISTS settlement_period_jobs")
    op.execute("DROP TABLE IF EXISTS settlement_periods")
