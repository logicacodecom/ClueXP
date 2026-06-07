"""organization default fulfillment policy

Adds `organizations.fulfillment_policy` — the org's default dispatch policy
surfaced/edited in the provider console workspace (private_owner_only /
owner_first_then_network / network_open). Jobs/intake_channels keep their own
`fulfillment_policy`; this is the org-level default. Without it the provider
workspace read 500s (the query selected a non-existent column).

Revision ID: 0009_org_fulfillment_policy
Revises: 0008_login_attempts
Create Date: 2026-06-06
"""
from __future__ import annotations

from alembic import op

revision = "0009_org_fulfillment_policy"
down_revision = "0008_login_attempts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("alter table organizations add column if not exists fulfillment_policy text")


def downgrade() -> None:
    op.execute("alter table organizations drop column if exists fulfillment_policy")
