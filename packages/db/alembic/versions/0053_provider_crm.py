"""Organization-scoped customer relationship profiles.

Revision ID: 0053_provider_crm
Revises: 0052_technician_reservations
Create Date: 2026-08-14
"""

from alembic import op


revision = "0053_provider_crm"
down_revision = "0052_technician_reservations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists provider_customer_profiles (
            organization_id uuid not null references organizations(id) on delete cascade,
            customer_id uuid not null references customers(id) on delete cascade,
            email text,
            newsletter_status text not null default 'unknown'
                check (newsletter_status in ('unknown','subscribed','unsubscribed')),
            warranty_days integer not null default 30 check (warranty_days between 0 and 3650),
            callback_at timestamptz,
            follow_up_at timestamptz,
            last_contacted_at timestamptz,
            notes text,
            updated_by uuid,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            primary key (organization_id, customer_id)
        );
        """
    )
    op.execute(
        "create index if not exists idx_provider_customer_profiles_tasks "
        "on provider_customer_profiles (organization_id, callback_at, follow_up_at)"
    )


def downgrade() -> None:
    op.execute("drop index if exists idx_provider_customer_profiles_tasks")
    op.execute("drop table if exists provider_customer_profiles")
