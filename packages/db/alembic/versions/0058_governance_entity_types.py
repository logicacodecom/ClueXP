"""allow 'external_client', 'external_api_key', 'service_request' as
governance_events entity types

Two already-shipped code paths write governance_events rows with entity types
the DB check constraint doesn't allow yet:
- external-client/key admin provisioning (`abb252e`) -- entity_type
  'external_client' / 'external_api_key'.
- the Tier 2 Network Router's routing-decision audit -- entity_type
  'service_request'.

Neither was caught before merge because the local test suite only exercises
InMemoryStore, which has no such constraint; CI's real-Postgres tier caught
this one (service_request) on first run. Widening the constraint here rather
than routing these actions through an existing allowed entity type, since
they are genuinely new legal actors for this table, not organization/
technician/user in disguise.

Revision ID: 0058_governance_entity_types
Revises: 0057_dispatch_authorizations
Create Date: 2026-08-23
"""
from __future__ import annotations

from alembic import op

revision = "0058_governance_entity_types"
down_revision = "0057_dispatch_authorizations"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
alter table governance_events drop constraint if exists governance_events_entity_type_check;
alter table governance_events add constraint governance_events_entity_type_check
    check (entity_type in (
        'organization', 'technician', 'user',
        'external_client', 'external_api_key', 'service_request'
    ));
"""

DOWNGRADE_SQL = """
alter table governance_events drop constraint if exists governance_events_entity_type_check;
alter table governance_events add constraint governance_events_entity_type_check
    check (entity_type in ('organization', 'technician', 'user'));
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
