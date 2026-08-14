"""Technician soft reservations for scheduled appointments.

Revision ID: 0052_technician_reservations
Revises: 0051_organization_partnerships
Create Date: 2026-08-13
"""

from alembic import op


revision = "0052_technician_reservations"
down_revision = "0051_organization_partnerships"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists technician_reservations (
            id uuid primary key default gen_random_uuid(),
            job_id uuid not null references jobs(id) on delete cascade,
            technician_id uuid not null references technicians(id) on delete cascade,
            organization_id uuid references organizations(id) on delete set null,
            status text not null default 'held'
                check (status in ('held','released','converted','cancelled')),
            reserved_start timestamptz not null,
            reserved_end timestamptz not null,
            note text,
            created_by uuid,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            check (reserved_end > reserved_start)
        );
        """
    )
    op.execute(
        """
        create unique index if not exists idx_technician_reservations_one_active_job
        on technician_reservations (job_id)
        where status = 'held';
        """
    )
    op.execute(
        """
        create index if not exists idx_technician_reservations_active_overlap
        on technician_reservations (technician_id, reserved_start, reserved_end)
        where status = 'held';
        """
    )


def downgrade() -> None:
    op.execute("drop index if exists idx_technician_reservations_active_overlap")
    op.execute("drop index if exists idx_technician_reservations_one_active_job")
    op.execute("drop table if exists technician_reservations")
