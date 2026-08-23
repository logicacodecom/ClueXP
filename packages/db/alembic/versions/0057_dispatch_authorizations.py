"""dispatch authorization evidence (Tier 2 network routing MVP)

Records that an external client obtained and presented dispatch authorization
for a service request before it becomes dispatchable. `job_id` is unique --
one authorization per job for v1 -- which doubles as the atomic idempotency
gate against duplicate authorization/duplicate offers.

Routing *decisions* (considered/excluded/selected technicians) are not stored
here; they are `governance_events` rows, reusing the existing audit
mechanism rather than adding a second one.

Revision ID: 0057_dispatch_authorizations
Revises: 0056_public_api_foundation
Create Date: 2026-08-23
"""
from __future__ import annotations

from alembic import op

revision = "0057_dispatch_authorizations"
down_revision = "0056_public_api_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.service_request_dispatch_authorizations (
            id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            job_id                   uuid NOT NULL UNIQUE REFERENCES public.jobs(id),
            dispatch_scope           text NOT NULL
                CHECK (dispatch_scope IN ('private_partner', 'network')),
            authorized_by_client_id  uuid NOT NULL REFERENCES public.external_clients(id),
            channel                  text NOT NULL,
            evidence_reference       text NOT NULL,
            terms_version            text NOT NULL,
            created_at               timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_dispatch_authorizations_client
            ON public.service_request_dispatch_authorizations (authorized_by_client_id, created_at DESC);
        """
    )
    op.execute(
        "ALTER TABLE public.service_request_dispatch_authorizations ENABLE ROW LEVEL SECURITY"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.service_request_dispatch_authorizations")
