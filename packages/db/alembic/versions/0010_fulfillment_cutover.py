"""fulfillment cutover: token tracking, operational lifecycle, per-channel flip

Additive only — deploying this changes no live behavior. It lays the schema for
the Sprint 3 production fulfillment cutover (offer -> accept -> track -> fulfill
-> customer confirm/review/dispute -> close):

- `jobs.tracking_token` — secure, unique, URL-safe capability token generated at
  job creation. The customer link is the token, never the raw ticket id.
- `jobs` operational lifecycle timestamps (nullable) — one per status transition,
  for an audited fulfillment timeline. The operational lifecycle lives in
  `jobs.status` (app-enforced domain, NOT a DB check, so legacy intake-status
  values keep working); `trust_state` stays the orthogonal privacy gate.
- `intake_channels.dispatch_cutover_enabled` (default false) — the per-channel
  flip. A channel uses the real offer->accept loop only when this is true; every
  channel ships OFF, so nothing cuts over on deploy.
- `job_reviews` extra columns for the ticket-scoped, customer-safe review shape
  (assigned technician, customer-owner org, confirm timestamp, issue flag).

Revision ID: 0010_fulfillment_cutover
Revises: 0009_org_fulfillment_policy
Create Date: 2026-06-09
"""
from __future__ import annotations

from alembic import op

revision = "0010_fulfillment_cutover"
down_revision = "0009_org_fulfillment_policy"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
-- 1. customer capability token (the tracking/confirm/review/dispute link).
alter table jobs add column if not exists tracking_token text;
create unique index if not exists idx_jobs_tracking_token on jobs (tracking_token);

-- 2. operational lifecycle timestamps (nullable; set once on transition).
alter table jobs add column if not exists assigned_at            timestamptz;
alter table jobs add column if not exists en_route_at            timestamptz;
alter table jobs add column if not exists arrived_at             timestamptz;
alter table jobs add column if not exists in_progress_at         timestamptz;
alter table jobs add column if not exists completed_pending_at   timestamptz;
alter table jobs add column if not exists confirmed_at           timestamptz;
alter table jobs add column if not exists closed_at              timestamptz;
alter table jobs add column if not exists disputed_at            timestamptz;
alter table jobs add column if not exists cancelled_at           timestamptz;

-- 3. per-channel cutover flip (the pilot lever). Ships OFF for every channel.
alter table intake_channels
    add column if not exists dispatch_cutover_enabled boolean not null default false;

-- 4. ticket-scoped, customer-safe review fields (extend rev-0005 job_reviews).
alter table job_reviews add column if not exists assigned_technician_id text;
alter table job_reviews add column if not exists customer_owner_org_id  uuid;
alter table job_reviews add column if not exists confirmed_at           timestamptz;
alter table job_reviews add column if not exists issue_reported         boolean not null default false;

-- 5. lookup support for auto-close sweep over completion-pending jobs.
create index if not exists idx_jobs_completed_pending_at on jobs (completed_pending_at);
"""


DOWNGRADE_SQL = """
drop index if exists idx_jobs_completed_pending_at;

alter table if exists job_reviews drop column if exists issue_reported;
alter table if exists job_reviews drop column if exists confirmed_at;
alter table if exists job_reviews drop column if exists customer_owner_org_id;
alter table if exists job_reviews drop column if exists assigned_technician_id;

alter table if exists intake_channels drop column if exists dispatch_cutover_enabled;

alter table if exists jobs drop column if exists cancelled_at;
alter table if exists jobs drop column if exists disputed_at;
alter table if exists jobs drop column if exists closed_at;
alter table if exists jobs drop column if exists confirmed_at;
alter table if exists jobs drop column if exists completed_pending_at;
alter table if exists jobs drop column if exists in_progress_at;
alter table if exists jobs drop column if exists arrived_at;
alter table if exists jobs drop column if exists en_route_at;
alter table if exists jobs drop column if exists assigned_at;

drop index if exists idx_jobs_tracking_token;
alter table if exists jobs drop column if exists tracking_token;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
