"""org limits — platform-wide default caps on users / affiliated technicians per org

Seeds two new org-overridable runtime settings into `global_settings` (0023).
Per-organization overrides reuse the existing `organization_settings` table
(0025); an absent row means "inherit the platform default" via
`api/settings.py::resolve_org`. No new tables.

  - max_users_per_org        (integer) -- cap on org member accounts
  - max_technicians_per_org  (integer) -- cap on affiliated technicians (active + pending)

Revision ID: 0026_org_limits
Revises: 0025_org_dispatch_settings
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op

revision = "0026_org_limits"
down_revision = "0025_org_dispatch_settings"
branch_labels = None
depends_on = None


_SEEDS = (
    (
        "max_users_per_org",
        "5",
        "integer",
        "Max member accounts (admins + dispatchers) per organization. "
        "Console-overridable per organization.",
    ),
    (
        "max_technicians_per_org",
        "5",
        "integer",
        "Max affiliated technicians (active + pending invites) per organization. "
        "Console-overridable per organization.",
    ),
)


def upgrade() -> None:
    for key, value, value_type, description in _SEEDS:
        op.execute(
            f"""
            INSERT INTO global_settings
                (key, value, value_type, description, is_secret, is_runtime_editable)
            VALUES (
                '{key}', '{value}'::jsonb, '{value_type}',
                '{description.replace("'", "''")}', false, true
            )
            ON CONFLICT (key) DO NOTHING
            """
        )


def downgrade() -> None:
    keys = ",".join(f"'{k}'" for k, *_ in _SEEDS)
    op.execute(f"DELETE FROM organization_settings WHERE key IN ({keys})")
    op.execute(f"DELETE FROM global_settings WHERE key IN ({keys})")
