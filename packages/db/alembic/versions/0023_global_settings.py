"""global settings — DB-backed runtime operational settings (NOT a secret store)

A small key/value table for runtime-tunable operational/product settings, resolved
at request time with an env fallback. The first (and currently only) setting is
`dispatch_offer_ttl_seconds`. Secrets and deployment/infrastructure config never
live here — a `CHECK (is_secret = false)` makes that a database invariant.

`value` is jsonb for flexibility, but every supported key has strict per-key
validation in the application (`api/settings.py`); it is never free-form.

Revision ID: 0023_global_settings
Revises: 0022_technician_invites
Create Date: 2026-06-19
"""
from __future__ import annotations

from alembic import op

revision = "0023_global_settings"
down_revision = "0022_technician_invites"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS global_settings (
            key                  text PRIMARY KEY,
            value                jsonb       NOT NULL,
            value_type           text        NOT NULL
                                 CHECK (value_type IN ('integer','boolean','string','object','array')),
            description          text,
            is_secret            boolean     NOT NULL DEFAULT false,
            is_runtime_editable  boolean     NOT NULL DEFAULT true,
            updated_at           timestamptz NOT NULL DEFAULT now(),
            updated_by           uuid        REFERENCES users(id),
            CHECK (is_secret = false)
        )
        """
    )
    # Seed the first runtime setting. Idempotent so re-running never clobbers an
    # operator-tuned value.
    op.execute(
        """
        INSERT INTO global_settings (key, value, value_type, description, is_secret, is_runtime_editable)
        VALUES (
            'dispatch_offer_ttl_seconds', '300'::jsonb, 'integer',
            'Seconds before a provider-created dispatch offer expires.', false, true
        )
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS global_settings")
