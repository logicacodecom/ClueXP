"""organization partnerships for private partner dispatch

Revision ID: 0051_organization_partnerships
Revises: 0050_twilio_communications
Create Date: 2026-08-13
"""
from __future__ import annotations

from alembic import op

revision = "0051_organization_partnerships"
down_revision = "0050_twilio_communications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS organization_partnerships (
            id                    uuid primary key default gen_random_uuid(),
            requester_org_id      uuid not null references organizations(id) on delete cascade,
            partner_org_id        uuid not null references organizations(id) on delete cascade,
            status                text not null default 'requested'
                                  check (status in ('requested','active','suspended','rejected','ended')),
            note                  text,
            requested_by          uuid,
            approved_by           uuid,
            requested_at          timestamptz not null default now(),
            approved_at           timestamptz,
            updated_at            timestamptz not null default now(),
            check (requester_org_id <> partner_org_id)
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_partnership_pair
        ON organization_partnerships (
            least(requester_org_id, partner_org_id),
            greatest(requester_org_id, partner_org_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_organization_partnerships_lookup
        ON organization_partnerships (status, requester_org_id, partner_org_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_organization_partnerships_lookup")
    op.execute("DROP INDEX IF EXISTS uq_organization_partnership_pair")
    op.execute("DROP TABLE IF EXISTS organization_partnerships")
