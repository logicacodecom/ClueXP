"""technician mutations — client idempotency-key store for offline replay

First piece of the offline-sync contract (docs/TECHNICIAN-APP-REDESIGN.md §13.3
/13.5, docs/TECHNICIAN-NATIVE-IMPLEMENTATION-SPEC.md §5). A native/offline client
sends a client_mutation_id (idempotency key) with selected technician commands;
we record the key + a hash of the request and the produced response so an exact
retry replays the same result and a same-key/different-payload reuse is a
structured conflict.

response_json is stored as text (json-encoded) — no jsonb adapter needed.
Scoped per technician: uniqueness is (technician_id, client_mutation_id), so two
technicians can reuse the same key string without colliding.

Revision ID: 0043_technician_mutations
Revises: 0042_technician_device_install
Create Date: 2026-07-30
"""
from __future__ import annotations

from alembic import op

revision = "0043_technician_mutations"
down_revision = "0042_technician_device_install"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS technician_mutations (
            id                 uuid primary key default gen_random_uuid(),
            technician_id      uuid not null references technicians(id) on delete cascade,
            client_mutation_id text not null,
            request_hash       text not null,
            status_code        integer,
            response_json      text,
            created_at         timestamptz not null default now(),
            completed_at       timestamptz,
            unique (technician_id, client_mutation_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS technician_mutations")
