"""technician agreements for settlements

Provider-owned agreement records live at the provider-technician affiliation
boundary. They define service/labor cut rules, tip/card-fee policy, service
area, and service hours without mutating the technician's global profile.

Revision ID: 0033_technician_agreements
Revises: 0032_job_closeout_reports
Create Date: 2026-07-16
"""
from __future__ import annotations

from alembic import op

revision = "0033_technician_agreements"
down_revision = "0032_job_closeout_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS technician_agreements (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','active','paused','archived')),
            effective_from date,
            effective_until date,
            default_labor_cut_basis_points integer NOT NULL DEFAULT 5000
                CHECK (default_labor_cut_basis_points BETWEEN 0 AND 10000),
            tip_policy text NOT NULL DEFAULT 'tech_keeps'
                CHECK (tip_policy IN ('tech_keeps','company_keeps','split')),
            tip_cut_basis_points integer NOT NULL DEFAULT 10000
                CHECK (tip_cut_basis_points BETWEEN 0 AND 10000),
            card_fee_policy text NOT NULL DEFAULT 'company_pays'
                CHECK (card_fee_policy IN ('company_pays','deduct_from_company','split')),
            minimum_payout_cents integer NOT NULL DEFAULT 0 CHECK (minimum_payout_cents >= 0),
            flat_job_bonus_cents integer NOT NULL DEFAULT 0 CHECK (flat_job_bonus_cents >= 0),
            service_area_counties jsonb NOT NULL DEFAULT '[]',
            service_area_zipcodes jsonb NOT NULL DEFAULT '[]',
            service_hours jsonb NOT NULL DEFAULT '{}',
            rules jsonb NOT NULL DEFAULT '{}',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            updated_by uuid REFERENCES users(id),
            UNIQUE (organization_id, technician_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_technician_agreements_org_tech"
        " ON technician_agreements (organization_id, technician_id, status)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS technician_agreements")
