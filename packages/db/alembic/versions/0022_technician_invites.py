"""technician invites — company-issued signup invites for not-yet-registered techs

Part 4 of the Provider Workforce Model. Lets a company admin/dispatcher invite a
technician who has NO ClueXP account yet. The invite holds a one-time token; the
company shares the signup link (email delivery is a follow-up) and on signup the
token attaches the new technician to the inviting company as a PENDING affiliation
— consent still required, never a silent activation.

Existing technicians (already registered) are attached directly as pending invites
via `organization_technicians` (Slice A) and never need a row here.

Revision ID: 0022_technician_invites
Revises: 0021_tech_doc_defaults
Create Date: 2026-06-19
"""
from __future__ import annotations

from alembic import op

revision = "0022_technician_invites"
down_revision = "0021_tech_doc_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS technician_invites (
            id                    uuid primary key default gen_random_uuid(),
            organization_id       uuid not null references organizations(id),
            email                 text,
            token                 text not null unique,
            status                text not null default 'pending'
                                  check (status in ('pending','accepted','revoked','expired')),
            invited_by            uuid,
            accepted_technician_id uuid,
            created_at            timestamptz not null default now(),
            expires_at            timestamptz not null,
            accepted_at           timestamptz
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_technician_invites_org"
        " ON technician_invites (organization_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_technician_invites_token"
        " ON technician_invites (token)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS technician_invites")
