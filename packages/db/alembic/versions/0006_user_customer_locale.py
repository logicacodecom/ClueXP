"""user + customer locale preference

Adds a nullable `locale` column to users and customers for localization
persistence (EN/ES to start; null => English fallback). Supports the own-auth +
localization direction: an authenticated user's language is stored on `users`,
and a customer's chosen language on `customers` (used later for SMS/email).

Revision ID: 0006_user_customer_locale
Revises: 0005_auth_and_job_reviews
Create Date: 2026-06-06
"""
from __future__ import annotations

from alembic import op

revision = "0006_user_customer_locale"
down_revision = "0005_auth_and_job_reviews"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
alter table users add column if not exists locale text;
alter table customers add column if not exists locale text;
"""

DOWNGRADE_SQL = """
alter table users drop column if exists locale;
alter table customers drop column if exists locale;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
