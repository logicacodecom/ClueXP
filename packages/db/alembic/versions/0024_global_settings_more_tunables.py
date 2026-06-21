"""global settings — seed more runtime operational tunables

Adds runtime-editable, non-secret operational settings to `global_settings`
(table created in 0023). Each key has strict per-key validation in the
application (`apps/intake-web/api/settings.py`); `value` stays jsonb but is never
free-form. Secrets and deployment/infrastructure config never live here — the
`CHECK (is_secret = false)` invariant from 0023 still holds.

New keys (each migrated from an env-only constant in `api/config.py`):
  - dispatch_cutover_global_off  (boolean) — emergency kill-switch
  - token_action_max             (integer) — per-token mutation rate-limit count
  - token_action_window_seconds  (integer) — per-token rate-limit window
  - login_max_failures           (integer) — login-throttle failure count
  - login_window_seconds         (integer) — login-throttle window

Seeds use the same default as the env fallback so behavior is unchanged until an
operator tunes a value. All inserts are idempotent (ON CONFLICT DO NOTHING) so a
re-run never clobbers an operator-tuned value.

Revision ID: 0024_gs_more_tunables
Revises: 0023_global_settings
Create Date: 2026-06-21
"""
from __future__ import annotations

from alembic import op

revision = "0024_gs_more_tunables"
down_revision = "0023_global_settings"
branch_labels = None
depends_on = None


# (key, jsonb-literal, value_type, description)
_SEEDS = (
    (
        "dispatch_cutover_global_off",
        "false",
        "boolean",
        "Force every channel back to the legacy dispatch stub, regardless of its "
        "per-channel dispatch_cutover_enabled flag.",
    ),
    (
        "token_action_max",
        "30",
        "integer",
        "Max customer capability-link mutations per token per window.",
    ),
    (
        "token_action_window_seconds",
        "60",
        "integer",
        "Sliding-window length (seconds) for the per-token mutation limit.",
    ),
    (
        "login_max_failures",
        "8",
        "integer",
        "Failed logins allowed per window before throttling.",
    ),
    (
        "login_window_seconds",
        "900",
        "integer",
        "Sliding-window length (seconds) for the login-failure throttle.",
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
    op.execute(f"DELETE FROM global_settings WHERE key IN ({keys})")
