"""Technician last-seen heartbeat + stale-availability threshold.

Adds `technicians.last_seen_at` — the authenticated-session heartbeat the
technician app already produces (it re-fetches the session every ~20s while
open) but which nothing recorded.

`location_updated_at` cannot serve as this clock: the technician PWA has no
background location and only posts a fix when the operator taps "Refresh
location", so a technician can work a full shift without moving it.

Backfilled from `location_updated_at` so existing rows keep their best known
signal. Rows with neither stay NULL and read as "never connected" to the
reaper, which is exactly what they are — every authenticated request stamps
this column, so a technician cannot reach `is_available = true` without one.

Revision ID: 0040_technician_last_seen
Revises: 0039_operations_refresh_setting
Create Date: 2026-07-23
"""
from __future__ import annotations

from alembic import op

revision = "0040_technician_last_seen"
down_revision = "0039_operations_refresh_setting"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
alter table technicians add column if not exists last_seen_at timestamptz;

update technicians
   set last_seen_at = location_updated_at
 where last_seen_at is null
   and location_updated_at is not null;

-- Partial index matching the reaper predicate: only available rows are ever scanned.
create index if not exists idx_technicians_available_last_seen
    on technicians (last_seen_at) where is_available;

INSERT INTO global_settings
    (key, value, value_type, description, is_secret, is_runtime_editable)
VALUES (
    'technician_stale_hours',
    '12'::jsonb,
    'integer',
    'Hours without an authenticated technician heartbeat before the technician '
    'is signed off duty and flagged offline. Platform-wide.',
    false,
    true
)
ON CONFLICT (key) DO NOTHING;
"""

DOWNGRADE_SQL = """
DELETE FROM global_settings WHERE key = 'technician_stale_hours';
drop index if exists idx_technicians_available_last_seen;
alter table technicians drop column if exists last_seen_at;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
