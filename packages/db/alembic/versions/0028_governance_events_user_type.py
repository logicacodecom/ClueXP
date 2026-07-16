"""allow 'user' as a governance_events entity_type

Company-staff and platform-admin account actions (edit/suspend/reactivate/
delete/archive) now record governance events too, alongside the existing
organization/technician actions.

Revision ID: 0028_governance_events_user_type
Revises: 0027_governance_events
Create Date: 2026-07-16
"""
from __future__ import annotations

from alembic import op

revision = "0028_governance_events_user_type"
down_revision = "0027_governance_events"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
alter table governance_events drop constraint if exists governance_events_entity_type_check;
alter table governance_events add constraint governance_events_entity_type_check
    check (entity_type in ('organization', 'technician', 'user'));
"""

DOWNGRADE_SQL = """
alter table governance_events drop constraint if exists governance_events_entity_type_check;
alter table governance_events add constraint governance_events_entity_type_check
    check (entity_type in ('organization', 'technician'));
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
