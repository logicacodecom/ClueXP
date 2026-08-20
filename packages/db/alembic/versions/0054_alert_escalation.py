"""dispatcher alert/escalation table + staffed fallback phone

Revision ID: 0054_alert_escalation
Revises: 0053_provider_crm
Create Date: 2026-08-20
"""
from __future__ import annotations

from alembic import op

revision = "0054_alert_escalation"
down_revision = "0053_provider_crm"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id                uuid primary key default gen_random_uuid(),
            organization_id   uuid not null references organizations(id) on delete cascade,
            job_id            uuid references jobs(id) on delete set null,
            alert_type        text not null check (alert_type in (
                                   'new_job','stalled_job','safety_flag',
                                   'stuck_offer','delivery_failure','customer_help_request'
                               )),
            severity          text not null check (severity in ('info','warning','critical')),
            status            text not null default 'open'
                                   check (status in ('open','acknowledged','resolved')),
            payload           jsonb not null default '{}',
            created_at        timestamptz not null default now(),
            acknowledged_by   uuid,
            acknowledged_at   timestamptz,
            resolved_at       timestamptz,
            escalated_at      timestamptz
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_alerts_org_status ON alerts (organization_id, status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_alerts_job_id ON alerts (job_id)"
    )
    # Duplicate-prevention for sweep-driven alerts: at most one OPEN alert per
    # (org, job, type). Job-less alert types (e.g. a delivery_failure with no
    # job_id) are not covered by this partial unique index; the store layer
    # falls back to a check-then-skip for those. See store.create_alert().
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_open_org_job_type
        ON alerts (organization_id, job_id, alert_type)
        WHERE status = 'open' AND job_id IS NOT NULL
        """
    )
    # Reuse the existing forwarding-number pair for on-call routing (it is
    # already semantically "who rings first / who rings on backup"); add one
    # new column for the always-answers safety line, distinct from those two
    # because it exists specifically to guarantee an answer for critical
    # alerts, not to take normal call overflow.
    op.execute(
        """
        ALTER TABLE organization_phone_settings
            ADD COLUMN IF NOT EXISTS staffed_fallback_phone text
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE organization_phone_settings DROP COLUMN IF EXISTS staffed_fallback_phone")
    op.execute("DROP INDEX IF EXISTS uq_alerts_open_org_job_type")
    op.execute("DROP INDEX IF EXISTS ix_alerts_job_id")
    op.execute("DROP INDEX IF EXISTS ix_alerts_org_status")
    op.execute("DROP TABLE IF EXISTS alerts")
