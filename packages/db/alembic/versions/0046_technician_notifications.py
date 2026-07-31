"""technician notifications — push delivery/acknowledgement tracking

Push-send scaffolding up to the credentials wall (ADR-0001 SS6, redesign SS13.2:
"record last app acknowledgement"). Records the four-event delivery model from
ADR-0001 SS6 as far as this backend can honestly go without a real APNs/FCM
provider configured:

  1. provider_status='queued'|'sent'|'failed'|'skipped_no_provider' -- provider
     receipt. 'skipped_no_provider' is the only status this deployment can
     produce today (see api/push.py NullPushSender).
  2/3. device receipt / user display -- NOT tracked here; no provider exists
     to report them. Left null rather than faked.
  4. acknowledged_at -- explicit acknowledgement, the one first-class client
     signal alongside provider receipt.

Revision ID: 0046_technician_notifications
Revises: 0045_auth_refresh_tokens
Create Date: 2026-07-31
"""
from __future__ import annotations

from alembic import op

revision = "0046_technician_notifications"
down_revision = "0045_auth_refresh_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS technician_notifications (
            id               uuid primary key default gen_random_uuid(),
            technician_id    uuid not null references technicians(id) on delete cascade,
            device_id        uuid references technician_devices(id) on delete set null,
            alert_class      text not null
                             check (alert_class in ('offer','active_job_change','message','safety','system')),
            job_id           uuid,
            offer_id         uuid,
            thread_id        uuid,
            payload          jsonb not null default '{}',
            provider_status  text not null default 'queued'
                             check (provider_status in ('queued','sent','failed','skipped_no_provider')),
            created_at       timestamptz not null default now(),
            provider_sent_at timestamptz,
            acknowledged_at  timestamptz
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_technician_notifications_tech"
        " ON technician_notifications (technician_id, created_at desc)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_technician_notifications_unacked"
        " ON technician_notifications (technician_id) WHERE acknowledged_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS technician_notifications")
