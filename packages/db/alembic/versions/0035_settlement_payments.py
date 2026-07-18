"""settlement payments ledger

Company<->technician payment ledger. Settlement periods stay the approval/
snapshot batches; this table records the money that actually moved. Provider-
logged payments are confirmed immediately; technician-submitted payments are
pending until a provider admin confirms or rejects. Wrong confirmed entries
are voided with a reason, never edited or deleted.

Revision ID: 0035_settlement_payments
Revises: 0034_settlement_periods
Create Date: 2026-07-18
"""
from __future__ import annotations

from alembic import op

revision = "0035_settlement_payments"
down_revision = "0034_settlement_periods"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS settlement_payments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            technician_id uuid NOT NULL REFERENCES technicians(id),
            settlement_period_id uuid REFERENCES settlement_periods(id),
            source_period_start date,
            source_period_end date,
            direction text NOT NULL
                CHECK (direction IN ('company_to_technician','technician_to_company')),
            amount_cents integer NOT NULL CHECK (amount_cents > 0),
            payment_method text NOT NULL,
            reference_number text,
            paid_on date NOT NULL,
            note text,
            status text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','rejected','voided')),
            submitted_by_role text NOT NULL
                CHECK (submitted_by_role IN ('provider','technician')),
            submitted_by uuid REFERENCES users(id),
            confirmed_by uuid REFERENCES users(id),
            confirmed_at timestamptz,
            rejected_by uuid REFERENCES users(id),
            rejected_at timestamptz,
            rejected_reason text,
            voided_by uuid REFERENCES users(id),
            voided_at timestamptz,
            void_reason text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_settlement_payments_org_tech"
        " ON settlement_payments (organization_id, technician_id, paid_on DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS settlement_payments")
