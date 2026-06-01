"""storage buckets + enable RLS on public tables

Records two live changes applied in Sprint 0:

1. Storage buckets for uploaded media:
   - public-tech-media   — public CDN, image-only, 10 MB cap (technician photos)
   - private-verification — private, image + pdf, 10 MB cap (ID docs / customer
     verification). Reached only via backend-issued signed URLs (service-role).

2. Enable Row Level Security on every public table. The app's FastAPI backend
   connects as the owner/postgres role and BYPASSES RLS, so this is unaffected by
   the change; it closes the Supabase auto-REST exposure where the public anon
   key could read/write these tables. No policies are added (default-deny) — the
   anon/authenticated roles have no business touching these tables.

Idempotent: ON CONFLICT for buckets; ENABLE ROW LEVEL SECURITY is a no-op when
already enabled.

Revision ID: 0002_storage_and_rls
Revises: 0001_baseline
Create Date: 2026-05-31
"""
from __future__ import annotations

from alembic import op

revision = "0002_storage_and_rls"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

_PUBLIC_TABLES = (
    "tickets",
    "events",
    "customers",
    "technicians",
    "jobs",
    "dispatch_offers",
    "media",
    "alembic_version",
)

UPGRADE_SQL = """
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('public-tech-media',    'public-tech-media',    true,  10485760,
        ARRAY['image/png','image/jpeg','image/webp']),
    ('private-verification', 'private-verification', false, 10485760,
        ARRAY['image/png','image/jpeg','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;
"""

DOWNGRADE_SQL = """
-- Buckets are intentionally NOT dropped on downgrade: they may hold uploaded
-- files. Remove them manually if truly required:
--   DELETE FROM storage.buckets WHERE id IN ('public-tech-media','private-verification');
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)
    for table in _PUBLIC_TABLES:
        op.execute(
            f"""
DO $$
BEGIN
    IF to_regclass('public.{table}') IS NOT NULL THEN
        ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;
"""
        )


def downgrade() -> None:
    for table in _PUBLIC_TABLES:
        op.execute(
            f"""
DO $$
BEGIN
    IF to_regclass('public.{table}') IS NOT NULL THEN
        ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY;
    END IF;
END $$;
"""
        )
    op.execute(DOWNGRADE_SQL)
