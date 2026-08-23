"""default-deny RLS closure for every application table

The FastAPI backend connects as the database owner/postgres role and intentionally
bypasses RLS. Supabase PostgREST's anon/authenticated roles do not. Enabling RLS
without allow policies therefore closes the unintended raw database surface while
preserving the existing backend path.

Revision ID: 0055_default_deny_rls
Revises: 0054_alert_escalation
Create Date: 2026-08-22
"""
from __future__ import annotations

from alembic import op

revision = "0055_default_deny_rls"
down_revision = "0054_alert_escalation"
branch_labels = None
depends_on = None

# This is also the auditable RLS decision registry. A regression test requires
# every Alembic CREATE TABLE to appear here. ``tickets`` and ``cron_config`` are
# optional legacy/live relations not created by the current migration chain.
RLS_TABLES = (
    "alerts",
    "arrival_verifications",
    "auth_refresh_tokens",
    "closeout_item_types",
    "communication_opt_outs",
    "communication_sms_deliveries",
    "customers",
    "dispatch_offers",
    "events",
    "external_api_events",
    "external_api_idempotency_keys",
    "external_api_keys",
    "external_api_rate_limits",
    "external_clients",
    "global_settings",
    "governance_events",
    "intake_channels",
    "job_call_sessions",
    "job_closeout_line_items",
    "job_closeout_reports",
    "job_message_receipts",
    "job_message_threads",
    "job_messages",
    "job_notes",
    "job_operational_id_counters",
    "job_payment_reports",
    "job_reviews",
    "jobs",
    "login_attempts",
    "media",
    "organization_capabilities",
    "organization_partnerships",
    "organization_phone_settings",
    "organization_settings",
    "organization_team_technicians",
    "organization_teams",
    "organization_technicians",
    "organizations",
    "provider_customer_profiles",
    "provider_documents",
    "rating_summaries",
    "service_categories",
    "service_request_dispatch_authorizations",
    "service_skills",
    "settlement_adjustments",
    "settlement_payments",
    "settlement_period_jobs",
    "settlement_periods",
    "technician_agreements",
    "technician_devices",
    "technician_documents",
    "technician_invites",
    "technician_mutations",
    "technician_notifications",
    "technician_reservations",
    "technicians",
    "user_organization_memberships",
    "user_roles",
    "users",
    # Optional relations present in some deployed databases.
    "cron_config",
    "tickets",
)

# Tables already protected by 0002-0005. Downgrade must not weaken them.
PREVIOUSLY_PROTECTED_TABLES = {
    "customers",
    "dispatch_offers",
    "events",
    "intake_channels",
    "jobs",
    "media",
    "organization_team_technicians",
    "organization_teams",
    "organization_technicians",
    "organizations",
    "provider_documents",
    "rating_summaries",
    "technicians",
    "user_organization_memberships",
    "user_roles",
    "users",
    "job_reviews",
    "tickets",
}


def _set_rls(table: str, *, enabled: bool) -> None:
    action = "ENABLE" if enabled else "DISABLE"
    op.execute(
        f"""
        DO $$
        BEGIN
            IF to_regclass('public.{table}') IS NOT NULL THEN
                ALTER TABLE public.{table} {action} ROW LEVEL SECURITY;
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    for table in RLS_TABLES:
        _set_rls(table, enabled=True)
    # Alembic owns this table; owner-role migration writes continue to bypass RLS.
    _set_rls("alembic_version", enabled=True)


def downgrade() -> None:
    for table in RLS_TABLES:
        if table not in PREVIOUSLY_PROTECTED_TABLES:
            _set_rls(table, enabled=False)
