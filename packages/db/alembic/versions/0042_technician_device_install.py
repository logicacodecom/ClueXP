"""technician device installation identity — correct push-token rotation

Adds a stable per-device installation_id so token rotation replaces the token
on the SAME device row instead of accumulating rows. APNs/FCM rotation mints a
NEW token and leaves the old one valid for a while; keyed only by push_token we
would keep both as active devices. Keyed by (technician_id, environment,
installation_id) we upsert the device and swap its token.

Safe for existing rows: installation_id is nullable, and the uniqueness index is
PARTIAL (only rows that have an installation_id and are not revoked), so the
legacy token-keyed rows written by 0041 are untouched.

Revision ID: 0042_technician_device_install
Revises: 0041_technician_devices
Create Date: 2026-07-30

(Revision id kept <= 32 chars to fit alembic_version.version_num.)
"""
from __future__ import annotations

from alembic import op

revision = "0042_technician_device_install"
down_revision = "0041_technician_devices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE technician_devices ADD COLUMN IF NOT EXISTS installation_id text")
    # One active device per technician + environment + installation. Partial so
    # legacy rows (installation_id IS NULL) and revoked rows never collide.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_devices_installation"
        " ON technician_devices (technician_id, environment, installation_id)"
        " WHERE installation_id IS NOT NULL AND revoked_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_technician_devices_installation")
    op.execute("ALTER TABLE technician_devices DROP COLUMN IF EXISTS installation_id")
