"""provider affiliation leave/rejoin history — surrogate PK + open-period uniqueness

Slice B of the Provider Workforce Model (docs/SYSTEM-DESIGN.md §18.3). Lets a
technician hold MULTIPLE historical affiliation periods with the same provider
(join → leave → rejoin) without overwriting the prior period:

- adds a surrogate `id uuid` primary key to `organization_technicians` and drops the
  old composite primary key `(organization_id, technician_id)` (no FK depends on it).
- replaces that uniqueness with a partial unique index `uq_org_tech_open_period`
  on `(organization_id, technician_id) WHERE ended_at IS NULL` — at most one OPEN
  (non-ended) affiliation period per technician per provider; ended periods accumulate
  as history.

History model: ending an affiliation sets `ended_at`/`status='ended'` (closing the
period); a later rejoin inserts a NEW row (a new open period) and leaves the ended
row intact. Upserts now target the open period (`ON CONFLICT (org, tech) WHERE
ended_at IS NULL`).

Revision ID: 0017_affiliation_history
Revises: 0016_provider_affiliations
Create Date: 2026-06-16
"""
from __future__ import annotations

from alembic import op

revision = "0017_affiliation_history"
down_revision = "0016_provider_affiliations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE organization_technicians"
        " ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid()"
    )
    # Swap the composite PK for the surrogate id so multiple periods per (org, tech)
    # can coexist. The default PK name on this table is organization_technicians_pkey.
    op.execute("ALTER TABLE organization_technicians DROP CONSTRAINT IF EXISTS organization_technicians_pkey")
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE organization_technicians ADD PRIMARY KEY (id);
        EXCEPTION WHEN invalid_table_definition THEN NULL; END $$;
        """
    )
    # At most one OPEN (non-ended) affiliation period per technician per provider.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_org_tech_open_period"
        " ON organization_technicians (organization_id, technician_id)"
        " WHERE ended_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_org_tech_open_period")
    op.execute("ALTER TABLE organization_technicians DROP CONSTRAINT IF EXISTS organization_technicians_pkey")
    # Best-effort restore of the composite PK (only valid if no duplicate periods exist).
    op.execute(
        """
        DO $$ BEGIN
            ALTER TABLE organization_technicians ADD PRIMARY KEY (organization_id, technician_id);
        EXCEPTION WHEN others THEN NULL; END $$;
        """
    )
    op.execute("ALTER TABLE organization_technicians DROP COLUMN IF EXISTS id")
