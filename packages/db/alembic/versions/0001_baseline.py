"""baseline: customers, technicians, jobs, dispatch_offers, media, events

Relational core for dispatch (queryable columns) plus a `jobs.detail` JSONB column
that holds the Pydantic Ticket payload. Idempotent (IF NOT EXISTS) so it coexists
with the `tickets`/`events` tables the intake app auto-created.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-05-31
"""
from __future__ import annotations

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


UPGRADE_SQL = """
create table if not exists customers (
    id          uuid primary key default gen_random_uuid(),
    phone       text unique,
    name        text,
    created_at  timestamptz not null default now()
);

create table if not exists technicians (
    id                       uuid primary key default gen_random_uuid(),
    display_name             text not null,
    phone                    text,
    email                    text,
    status                   text not null default 'pending_vetting',
    vetting_status           text not null default 'unverified',
    skills                   text[] not null default '{}',
    service_area_center_lat  double precision,
    service_area_center_lng  double precision,
    service_area_radius_km   double precision,
    rating                   numeric(2,1),
    profile_photo_url        text,
    vehicle_info             jsonb,
    current_lat              double precision,
    current_lng              double precision,
    location_updated_at      timestamptz,
    is_available             boolean not null default false,
    created_at               timestamptz not null default now()
);

create table if not exists jobs (
    id             uuid primary key default gen_random_uuid(),
    customer_id    uuid references customers(id),
    technician_id  uuid references technicians(id),
    trust_state    text not null default 'intake',
    status         text not null default 'draft',
    access_type    text,
    situation      text,
    urgency        text,
    lat            double precision,
    lng            double precision,
    address        text,
    detail         jsonb not null default '{}',
    price_quote    jsonb,
    final_charge   jsonb,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create table if not exists dispatch_offers (
    id             uuid primary key default gen_random_uuid(),
    job_id         uuid not null references jobs(id),
    technician_id  uuid not null references technicians(id),
    status         text not null default 'offered',
    rank           integer,
    offered_at     timestamptz not null default now(),
    responded_at   timestamptz,
    expires_at     timestamptz
);

create table if not exists media (
    id           uuid primary key default gen_random_uuid(),
    owner_type   text not null,
    owner_id     uuid not null,
    kind         text not null,
    bucket       text not null,
    path         text not null,
    visibility   text not null default 'private',
    uploaded_by  uuid,
    uploaded_at  timestamptz not null default now()
);

-- events may already exist (app auto-created it); ensure it and add job link.
create table if not exists events (
    id           bigserial primary key,
    ticket_id    uuid,
    job_id       uuid,
    event        text not null,
    trust_state  text,
    at           timestamptz not null default now()
);
alter table events add column if not exists job_id uuid;

create index if not exists idx_jobs_status          on jobs (status);
create index if not exists idx_jobs_trust_state     on jobs (trust_state);
create index if not exists idx_jobs_customer        on jobs (customer_id);
create index if not exists idx_technicians_available on technicians (is_available);
create index if not exists idx_offers_job           on dispatch_offers (job_id);
create index if not exists idx_media_owner          on media (owner_type, owner_id);
"""


DOWNGRADE_SQL = """
drop index if exists idx_media_owner;
drop index if exists idx_offers_job;
drop index if exists idx_technicians_available;
drop index if exists idx_jobs_customer;
drop index if exists idx_jobs_trust_state;
drop index if exists idx_jobs_status;
drop table if exists media;
drop table if exists dispatch_offers;
drop table if exists jobs;
drop table if exists technicians;
drop table if exists customers;
alter table if exists events drop column if exists job_id;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
