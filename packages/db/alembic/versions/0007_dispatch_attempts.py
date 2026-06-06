"""dispatch attempt tracking

Adds `jobs.dispatch_attempts` so the customer tracking read can distinguish
"not yet dispatched" from "dispatched, no eligible technician" and enforce a
maximum number of re-dispatch rounds (so a customer never waits forever).

Revision ID: 0007_dispatch_attempts
Revises: 0006_user_customer_locale
Create Date: 2026-06-06
"""
from __future__ import annotations

from alembic import op

revision = "0007_dispatch_attempts"
down_revision = "0006_user_customer_locale"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
alter table jobs add column if not exists dispatch_attempts integer not null default 0;
"""

DOWNGRADE_SQL = """
alter table jobs drop column if exists dispatch_attempts;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
