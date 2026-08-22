"""public API external client foundation

Revision ID: 0056_public_api_foundation
Revises: 0055_default_deny_rls
Create Date: 2026-08-22
"""
from __future__ import annotations

from alembic import op

revision = "0056_public_api_foundation"
down_revision = "0055_default_deny_rls"
branch_labels = None
depends_on = None

PUBLIC_API_TABLES = (
    "external_clients",
    "external_api_keys",
    "external_api_events",
    "external_api_idempotency_keys",
    "external_api_rate_limits",
)


def _enable_rls(table: str) -> None:
    op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.external_clients (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name text NOT NULL,
            client_type text NOT NULL DEFAULT 'partner'
                CHECK (client_type IN ('first_party','partner','agent','enterprise','internal')),
            status text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','revoked')),
            organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
            allowed_scopes text[] NOT NULL DEFAULT '{}',
            allowed_origins text[] NOT NULL DEFAULT '{}',
            rate_limit_per_minute integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute > 0),
            metadata jsonb NOT NULL DEFAULT '{}',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS public.external_api_keys (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id uuid NOT NULL REFERENCES public.external_clients(id) ON DELETE CASCADE,
            key_prefix text NOT NULL UNIQUE,
            key_hash text NOT NULL UNIQUE,
            status text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','revoked')),
            scopes text[] NOT NULL DEFAULT '{}',
            expires_at timestamptz,
            last_used_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            revoked_at timestamptz,
            created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS public.external_api_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id uuid REFERENCES public.external_clients(id) ON DELETE SET NULL,
            api_key_id uuid REFERENCES public.external_api_keys(id) ON DELETE SET NULL,
            action text NOT NULL,
            path text,
            status_code integer,
            idempotency_key text,
            request_id text,
            ip text,
            metadata jsonb NOT NULL DEFAULT '{}',
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.external_api_idempotency_keys (
            client_id uuid NOT NULL REFERENCES public.external_clients(id) ON DELETE CASCADE,
            idempotency_key text NOT NULL,
            request_hash text NOT NULL,
            method text NOT NULL,
            path text NOT NULL,
            status_code integer,
            response jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (client_id, idempotency_key)
        );

        CREATE TABLE IF NOT EXISTS public.external_api_rate_limits (
            client_id uuid NOT NULL REFERENCES public.external_clients(id) ON DELETE CASCADE,
            scope text NOT NULL,
            window_start timestamptz NOT NULL,
            count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
            PRIMARY KEY (client_id, scope, window_start)
        );

        CREATE INDEX IF NOT EXISTS idx_external_clients_status
            ON public.external_clients (status, client_type);
        CREATE INDEX IF NOT EXISTS idx_external_api_keys_client
            ON public.external_api_keys (client_id, status);
        CREATE INDEX IF NOT EXISTS idx_external_api_events_client_created
            ON public.external_api_events (client_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_external_api_events_action_created
            ON public.external_api_events (action, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_external_api_rate_limits_window
            ON public.external_api_rate_limits (window_start);
        """
    )
    for table in PUBLIC_API_TABLES:
        _enable_rls(table)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.external_api_rate_limits")
    op.execute("DROP TABLE IF EXISTS public.external_api_idempotency_keys")
    op.execute("DROP TABLE IF EXISTS public.external_api_events")
    op.execute("DROP TABLE IF EXISTS public.external_api_keys")
    op.execute("DROP TABLE IF EXISTS public.external_clients")
