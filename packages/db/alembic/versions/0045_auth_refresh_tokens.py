"""auth refresh tokens — rotating, revocable refresh tokens for native sessions

The native technician app has no BFF/cookie (it calls FastAPI directly with a
bearer token). The existing 24h access token alone would force a daily
re-login; this adds a long-lived, single-use, rotating refresh token per
docs/TECHNICIAN-NATIVE-IMPLEMENTATION-SPEC.md SS3. Purely additive: existing
cookie/access-token-only clients (the PWA/BFF flows) are unaffected.

Tokens are stored as a hash only (sha256 of the opaque token), never in the
clear. Rotation-with-reuse-detection: presenting an already-rotated-away
token revokes the whole chain for that user (possible theft signal).

Revision ID: 0045_auth_refresh_tokens
Revises: 0044_job_lifecycle_version
Create Date: 2026-07-30
"""
from __future__ import annotations

from alembic import op

revision = "0045_auth_refresh_tokens"
down_revision = "0044_job_lifecycle_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
            id           uuid primary key default gen_random_uuid(),
            user_id      uuid not null,
            token_hash   text not null unique,
            created_at   timestamptz not null default now(),
            expires_at   timestamptz not null,
            revoked_at   timestamptz,
            replaced_by  uuid references auth_refresh_tokens(id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user"
        " ON auth_refresh_tokens (user_id) WHERE revoked_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS auth_refresh_tokens")
