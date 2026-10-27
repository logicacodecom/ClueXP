"""provider subscription entitlements

Revision ID: 0063_provider_billing
Revises: 0062_dispatch_alert_sla_defaults
Create Date: 2026-10-26
"""
from __future__ import annotations

from alembic import op

revision = "0063_provider_billing"
down_revision = "0062_dispatch_alert_sla_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE organizations
          ADD COLUMN IF NOT EXISTS stripe_subscription_ref text,
          ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz,
          ADD COLUMN IF NOT EXISTS subscription_grace_ends_at timestamptz,
          ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS subscription_event_created_at timestamptz,
          ADD COLUMN IF NOT EXISTS subscription_updated_at timestamptz,
          ADD COLUMN IF NOT EXISTS billing_reconciliation_generation bigint NOT NULL DEFAULT 0;

        CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_billing_customer_ref
          ON organizations (billing_customer_ref) WHERE billing_customer_ref IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_stripe_subscription_ref
          ON organizations (stripe_subscription_ref) WHERE stripe_subscription_ref IS NOT NULL;

        CREATE TABLE IF NOT EXISTS stripe_webhook_events (
          event_id text PRIMARY KEY,
          event_type text NOT NULL,
          stripe_created_at timestamptz NOT NULL,
          customer_ref text,
          organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
          outcome text NOT NULL,
          processed_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE stripe_webhook_events FORCE ROW LEVEL SECURITY;
        REVOKE ALL ON stripe_webhook_events FROM PUBLIC;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            REVOKE ALL ON stripe_webhook_events FROM anon;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            REVOKE ALL ON stripe_webhook_events FROM authenticated;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS stripe_webhook_events;
        DROP INDEX IF EXISTS uq_organizations_stripe_subscription_ref;
        DROP INDEX IF EXISTS uq_organizations_billing_customer_ref;
        ALTER TABLE organizations
          DROP COLUMN IF EXISTS billing_reconciliation_generation,
          DROP COLUMN IF EXISTS subscription_updated_at,
          DROP COLUMN IF EXISTS subscription_event_created_at,
          DROP COLUMN IF EXISTS subscription_cancel_at_period_end,
          DROP COLUMN IF EXISTS subscription_grace_ends_at,
          DROP COLUMN IF EXISTS subscription_current_period_end,
          DROP COLUMN IF EXISTS stripe_subscription_ref;
        """
    )
