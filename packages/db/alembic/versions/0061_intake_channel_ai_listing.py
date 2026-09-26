"""Per-channel opt-in to AI-assistant provider discovery (specs/003 FR-016)

Revision ID: 0061_intake_channel_ai_listing
Revises: 0060_intake_phone_verification
Create Date: 2026-09-26
"""
from __future__ import annotations

from alembic import op

revision = "0061_intake_channel_ai_listing"
down_revision = "0060_intake_phone_verification"
branch_labels = None
depends_on = None

# Default off: shipping code lists nobody until ClueXP ops flags a channel on a
# provider's written request (HD-6). The partial unique index allows at most one
# listed channel per organization. No RLS change: existing table, existing policies.
UPGRADE_SQL = """
alter table intake_channels
    add column if not exists ai_assistant_listed boolean not null default false;

create unique index if not exists intake_channels_one_ai_listing_per_org
    on intake_channels (organization_id) where ai_assistant_listed;
"""

DOWNGRADE_SQL = """
drop index if exists intake_channels_one_ai_listing_per_org;
alter table intake_channels drop column if exists ai_assistant_listed;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
