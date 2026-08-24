"""jobs.origin_client_id -- which external client created a service request

ADR-6 deferred this exact column "until a second consumer needs the extra
dimension." The public service-request read/tracking/cancel endpoints are
that consumer: a `private_partner` request can be authorized via
`customer_owner_org_id`, but a `network` request has no owner org at all, so
without this column there is no way to know which external client may read
or cancel an unauthorized draft network request.

Revision ID: 0059_job_origin_client
Revises: 0058_governance_entity_types
Create Date: 2026-08-23
"""
from __future__ import annotations

from alembic import op

revision = "0059_job_origin_client"
down_revision = "0058_governance_entity_types"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
alter table jobs add column if not exists origin_client_id uuid references external_clients(id);
create index if not exists idx_jobs_origin_client on jobs (origin_client_id);
"""

DOWNGRADE_SQL = """
drop index if exists idx_jobs_origin_client;
alter table jobs drop column if exists origin_client_id;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
