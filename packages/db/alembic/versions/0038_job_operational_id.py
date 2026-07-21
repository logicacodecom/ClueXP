"""job operational id — friendly public reference, separate from the UUID

Adds a system-generated, human-readable job reference (`YYMMDDSSSSS`: two-digit
UTC year/month/day + a zero-padded global daily sequence) so user-facing
surfaces (technician/provider UI, support, exports) never have to show the raw
`jobs.id` UUID. `jobs.id` remains the internal primary key; `operational_id`
is assigned once at creation and never changes.

See docs/JOB-OPERATIONAL-ID-SCOPE.md for the full design (why no org/company
code component, why a single global daily counter, timezone rationale).

Revision ID: 0038_job_operational_id
Revises: 0037_canonical_technician_skills
Create Date: 2026-07-21
"""
from __future__ import annotations

from alembic import op

revision = "0038_job_operational_id"
down_revision = "0037_canonical_technician_skills"
branch_labels = None
depends_on = None


UPGRADE_SQL = """
alter table jobs add column if not exists operational_id        text;
alter table jobs add column if not exists operational_year      integer;
alter table jobs add column if not exists operational_month     integer;
alter table jobs add column if not exists operational_day       integer;
alter table jobs add column if not exists operational_sequence  integer;

create table if not exists job_operational_id_counters (
    year          integer not null,
    month         integer not null,
    day           integer not null,
    next_sequence integer not null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (year, month, day)
);

-- Backfill: assign every existing job a sequence within its UTC creation day,
-- ordered by created_at then id (tie-breaker), matching the same format new
-- jobs get at creation time.
with ranked as (
    select
        id,
        (created_at at time zone 'utc')::date as op_date,
        row_number() over (
            partition by (created_at at time zone 'utc')::date
            order by created_at, id
        ) as seq
    from jobs
)
update jobs
set operational_year     = extract(year from ranked.op_date)::int,
    operational_month    = extract(month from ranked.op_date)::int,
    operational_day      = extract(day from ranked.op_date)::int,
    operational_sequence = ranked.seq,
    operational_id       =
        lpad((extract(year from ranked.op_date)::int % 100)::text, 2, '0') ||
        lpad(extract(month from ranked.op_date)::int::text, 2, '0') ||
        lpad(extract(day from ranked.op_date)::int::text, 2, '0') ||
        lpad(ranked.seq::text, 5, '0')
from ranked
where jobs.id = ranked.id;

-- Seed counters so the next job created on a day that already has backfilled
-- jobs continues the sequence instead of restarting at 1.
insert into job_operational_id_counters (year, month, day, next_sequence, created_at, updated_at)
select operational_year, operational_month, operational_day, max(operational_sequence), now(), now()
from jobs
where operational_id is not null
group by operational_year, operational_month, operational_day
on conflict (year, month, day) do update
set next_sequence = greatest(job_operational_id_counters.next_sequence, excluded.next_sequence),
    updated_at = now();

alter table jobs alter column operational_id       set not null;
alter table jobs alter column operational_year     set not null;
alter table jobs alter column operational_month    set not null;
alter table jobs alter column operational_day      set not null;
alter table jobs alter column operational_sequence set not null;

create unique index if not exists idx_jobs_operational_id on jobs (operational_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'jobs_operational_sequence_unique'
    ) THEN
        ALTER TABLE jobs
            ADD CONSTRAINT jobs_operational_sequence_unique
            UNIQUE (operational_year, operational_month, operational_day, operational_sequence);
    END IF;
END $$;
"""

DOWNGRADE_SQL = """
alter table if exists jobs drop constraint if exists jobs_operational_sequence_unique;
drop index if exists idx_jobs_operational_id;
alter table if exists jobs drop column if exists operational_sequence;
alter table if exists jobs drop column if exists operational_day;
alter table if exists jobs drop column if exists operational_month;
alter table if exists jobs drop column if exists operational_year;
alter table if exists jobs drop column if exists operational_id;
drop table if exists job_operational_id_counters;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
