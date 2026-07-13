"""organization_settings — per-provider overrides of runtime dispatch tunables

Adds a per-organization key/value override table mirroring `global_settings`
(created in 0023): a provider can override a runtime setting for its own
dispatch queue; an absent row means "inherit the platform default"
(`global_settings` -> env -> hardcoded, via `api/settings.py::resolve`).
Same non-secret discipline: no `is_secret` column exists here at all, and
overridable keys are restricted to the application-side `SETTINGS` allowlist
(`org_overridable=True`) -- this table is not a generic settings bucket.

First overridable keys (each newly seeded into `global_settings` as the
platform-wide default, matching the values the provider console UI already
used as build-time constants):
  - dispatch_ack_sla_minutes  (integer) -- dispatcher acknowledgement SLA
  - dispatch_stalled_minutes  (integer) -- unassigned-job stalled threshold

Revision ID: 0025_org_dispatch_settings
Revises: 0024_gs_more_tunables
Create Date: 2026-07-13
"""
from __future__ import annotations

from alembic import op

revision = "0025_org_dispatch_settings"
down_revision = "0024_gs_more_tunables"
branch_labels = None
depends_on = None


_SEEDS = (
    (
        "dispatch_ack_sla_minutes",
        "5",
        "integer",
        "Minutes before an unacknowledged (no offer sent) job breaches the "
        "dispatcher acknowledgement SLA. Provider-overridable.",
    ),
    (
        "dispatch_stalled_minutes",
        "15",
        "integer",
        "Minutes before an unassigned job is flagged stalled in the dispatch "
        "queue. Provider-overridable.",
    ),
)


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS organization_settings (
            organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            key              text        NOT NULL,
            value            jsonb       NOT NULL,
            value_type       text        NOT NULL
                             CHECK (value_type IN ('integer','boolean','string','object','array')),
            updated_at       timestamptz NOT NULL DEFAULT now(),
            updated_by       uuid        REFERENCES users(id),
            PRIMARY KEY (organization_id, key)
        )
        """
    )
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
    op.execute("DROP TABLE IF EXISTS organization_settings")
    keys = ",".join(f"'{k}'" for k, *_ in _SEEDS)
    op.execute(f"DELETE FROM global_settings WHERE key IN ({keys})")
