"""provider technician affiliations — source-of-truth fields + exclusivity guard

Slice A of the Provider Workforce Model (docs/PROVIDER-WORKFORCE-MODEL.md). Makes
`organization_technicians` the authoritative affiliation ledger for dispatch
eligibility instead of `technicians.primary_organization_id`:

- adds affiliation fields (affiliation_type, exclusivity, dispatch_allowed,
  starts_at, ended_at, ended_reason, suspension_reason, created_at, updated_at);
  `status` already exists on the table (default 'pending_invite').
- constrains status to the canonical enum
  (pending_invite | active | suspended | ended | rejected) and exclusivity to
  (exclusive | non_exclusive | unknown).
- backfills an `active`, dispatch-allowed affiliation row for every technician
  that has a `primary_organization_id` but no affiliation row yet.
- enforces AT MOST ONE ACTIVE EXCLUSIVE affiliation per technician (across orgs)
  via a partial unique index.

Source-of-truth decision: `technicians.primary_organization_id` is RETAINED as a
denormalized cache only (kept in sync on create). Dispatch eligibility now derives
from active affiliation rows (status='active', dispatch_allowed, ended_at is null).

Revision ID: 0016_provider_affiliations
Revises: 0015_job_payments
Create Date: 2026-06-16
"""
from __future__ import annotations

from alembic import op

revision = "0016_provider_affiliations"
down_revision = "0015_job_payments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE organization_technicians
            ADD COLUMN IF NOT EXISTS affiliation_type   text not null default 'unknown',
            ADD COLUMN IF NOT EXISTS exclusivity        text not null default 'unknown',
            ADD COLUMN IF NOT EXISTS dispatch_allowed   boolean not null default true,
            ADD COLUMN IF NOT EXISTS starts_at          timestamptz not null default now(),
            ADD COLUMN IF NOT EXISTS ended_at           timestamptz,
            ADD COLUMN IF NOT EXISTS ended_reason       text,
            ADD COLUMN IF NOT EXISTS suspension_reason  text,
            ADD COLUMN IF NOT EXISTS created_at         timestamptz not null default now(),
            ADD COLUMN IF NOT EXISTS updated_at         timestamptz not null default now()
        """
    )
    # Defensive: normalize legacy invitation states before the CHECK. Unknown
    # values become pending invites, not active, so migration never grants
    # dispatch eligibility silently.
    op.execute(
        "UPDATE organization_technicians SET status = 'pending_invite'"
        " WHERE status IN ('invited', 'pending')"
    )
    op.execute(
        "UPDATE organization_technicians SET status = 'pending_invite'"
        " WHERE status NOT IN ('pending_invite','active','suspended','ended','rejected')"
    )
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE organization_technicians
                ADD CONSTRAINT ck_org_tech_status
                CHECK (status IN ('pending_invite','active','suspended','ended','rejected'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE organization_technicians
                ADD CONSTRAINT ck_org_tech_exclusivity
                CHECK (exclusivity IN ('exclusive','non_exclusive','unknown'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )
    # Backfill: every technician with a primary_organization_id but no affiliation
    # row yet gets an active, dispatch-allowed affiliation. Existing rows are left as-is.
    op.execute(
        """
        INSERT INTO organization_technicians
            (organization_id, technician_id, role, status, dispatch_allowed,
             exclusivity, affiliation_type, starts_at, activated_at)
        SELECT t.primary_organization_id, t.id, 'affiliate_technician', 'active', true,
               'unknown', 'unknown', now(), now()
        FROM technicians t
        WHERE t.primary_organization_id IS NOT NULL
        ON CONFLICT (organization_id, technician_id) DO NOTHING
        """
    )
    # At most one ACTIVE EXCLUSIVE affiliation per technician (across all orgs).
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_org_tech_active_exclusive"
        " ON organization_technicians (technician_id)"
        " WHERE status = 'active' AND exclusivity = 'exclusive' AND ended_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_org_tech_active_exclusive")
    op.execute("ALTER TABLE organization_technicians DROP CONSTRAINT IF EXISTS ck_org_tech_exclusivity")
    op.execute("ALTER TABLE organization_technicians DROP CONSTRAINT IF EXISTS ck_org_tech_status")
    op.execute(
        """
        ALTER TABLE organization_technicians
            DROP COLUMN IF EXISTS affiliation_type,
            DROP COLUMN IF EXISTS exclusivity,
            DROP COLUMN IF EXISTS dispatch_allowed,
            DROP COLUMN IF EXISTS starts_at,
            DROP COLUMN IF EXISTS ended_at,
            DROP COLUMN IF EXISTS ended_reason,
            DROP COLUMN IF EXISTS suspension_reason,
            DROP COLUMN IF EXISTS created_at,
            DROP COLUMN IF EXISTS updated_at
        """
    )
