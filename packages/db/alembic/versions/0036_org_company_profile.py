"""organization company profile — contact person, address, branding, service coverage

Provider-editable company profile fields collected on the provider settings page.
All scalar fields are nullable (a fresh org has none of them yet); service
coverage is an organization-level list of postal codes stored as a text[] with an
empty-array default.

Storage choice — service coverage is a text[] column, not a normalized table:
these postal codes are profile/configuration data. Job→company/technician
dispatch is geographic (haversine on lat/lng + radius) + skill based and does not
route by postal code, so a normalized organization_service_areas table (join +
FK, no per-row metadata) would be premature. If indexed postal routing is added
later, migrate then (a GIN index on this array is an interim step).

`logo_url`, `google_profile_url`, `google_review_url`, and `customer_care_phone`
are collected now for future customer-facing features; nothing in this change
exposes them publicly.

Revision ID: 0036_org_company_profile
Revises: 0035_settlement_payments
Create Date: 2026-07-19
"""
from __future__ import annotations

from alembic import op

revision = "0036_org_company_profile"
down_revision = "0035_settlement_payments"
branch_labels = None
depends_on = None


_SCALAR_COLUMNS = (
    "contact_name",
    "contact_title",
    "contact_email",
    "contact_phone",
    "address_line1",
    "address_line2",
    "city",
    "region",
    "postal_code",
    "country_code",
    "website",
    "customer_care_phone",
    "google_profile_url",
    "google_review_url",
    "logo_url",
)


def upgrade() -> None:
    for column in _SCALAR_COLUMNS:
        op.execute(f"ALTER TABLE organizations ADD COLUMN IF NOT EXISTS {column} text")
    op.execute(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS"
        " service_postal_codes text[] NOT NULL DEFAULT '{}'"
    )
    # Public CDN bucket for organization logos (image-only, 2 MB cap), mirroring
    # the public-tech-media bucket from 0002. Server-side upload via service role.
    op.execute(
        """
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('public-org-media', 'public-org-media', true, 2097152,
            ARRAY['image/png','image/jpeg','image/webp'])
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    # Bucket is intentionally NOT dropped (may hold uploaded logos):
    #   DELETE FROM storage.buckets WHERE id = 'public-org-media';
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS service_postal_codes")
    for column in _SCALAR_COLUMNS:
        op.execute(f"ALTER TABLE organizations DROP COLUMN IF EXISTS {column}")
