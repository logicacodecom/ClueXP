"""canonicalize technician skill codes

Technician skills predate the service catalog and some rows still contain short
aliases such as ``home``, ``business``, and ``vehicle``. Convert every known
legacy alias to the canonical service-catalog leaf code and remove duplicates.

Revision ID: 0037_canonical_technician_skills
Revises: 0036_org_company_profile
Create Date: 2026-07-19
"""
from __future__ import annotations

from alembic import op

revision = "0037_canonical_technician_skills"
down_revision = "0036_org_company_profile"
branch_labels = None
depends_on = None


_CANONICAL_SKILL_SQL = """
CASE lower(btrim(entry.skill))
    WHEN 'vehicle' THEN 'locksmith.vehicle_lockout'
    WHEN 'car' THEN 'locksmith.vehicle_lockout'
    WHEN 'auto' THEN 'locksmith.vehicle_lockout'
    WHEN 'home' THEN 'locksmith.residential_lockout'
    WHEN 'residential' THEN 'locksmith.residential_lockout'
    WHEN 'business' THEN 'locksmith.commercial_lockout'
    WHEN 'commercial' THEN 'locksmith.commercial_lockout'
    WHEN 'broken_key' THEN 'locksmith.broken_key'
    WHEN 'rekey' THEN 'locksmith.rekey'
    WHEN 'smart_lock' THEN 'locksmith.smart_lock'
    WHEN 'key_programming' THEN 'locksmith.vehicle_key_programming'
    ELSE btrim(entry.skill)
END
"""


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE technicians AS technician
        SET skills = (
            SELECT coalesce(
                array_agg(mapped.skill ORDER BY mapped.first_position),
                ARRAY[]::text[]
            ) AS skills
            FROM (
                SELECT {_CANONICAL_SKILL_SQL} AS skill,
                       min(entry.ordinality) AS first_position
                FROM unnest(technician.skills) WITH ORDINALITY AS entry(skill, ordinality)
                WHERE btrim(entry.skill) <> ''
                GROUP BY {_CANONICAL_SKILL_SQL}
            ) AS mapped
        )
        WHERE EXISTS (
            SELECT 1
            FROM unnest(technician.skills) AS existing(skill)
            WHERE lower(btrim(existing.skill)) IN (
                'vehicle', 'car', 'auto', 'home', 'residential', 'business',
                'commercial', 'broken_key', 'rekey', 'smart_lock', 'key_programming'
            )
        )
        """
    )


def downgrade() -> None:
    # Canonical codes cannot be losslessly converted back to the particular alias
    # each row originally used.
    pass
