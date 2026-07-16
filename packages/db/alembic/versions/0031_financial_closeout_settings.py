"""financial closeout settings and item type catalog

Seeds platform-wide defaults for the closeout breakdown workflow. Per-provider
overrides reuse the existing `organization_settings` table (0025); an absent row
means "inherit the platform default" via `api/settings.py::resolve_org`.

  - closeout_max_line_items                 (integer) -- default 20
  - closeout_default_tax_rate_basis_points  (integer) -- default 0; 725 = 7.25%
  - closeout_card_fee_basis_points          (integer) -- default 0
  - closeout_card_fee_fixed_cents           (integer) -- default 0

Also creates a platform-managed closeout item type catalog. This is not yet the
job closeout ledger; it is the taxonomy/settings foundation for the production
closeout and settlement work.

Revision ID: 0031_financial_closeout_settings
Revises: 0030_organization_capabilities
Create Date: 2026-07-16
"""
from __future__ import annotations

from alembic import op

revision = "0031_financial_closeout_settings"
down_revision = "0030_organization_capabilities"
branch_labels = None
depends_on = None


_SEEDS = (
    (
        "closeout_max_line_items",
        "20",
        "integer",
        "Max line items a technician may add to a job closeout. "
        "Provider-overridable.",
    ),
    (
        "closeout_default_tax_rate_basis_points",
        "0",
        "integer",
        "Default provider tax rate for closeout calculations, stored in basis "
        "points (725 = 7.25%). Provider-overridable.",
    ),
    (
        "closeout_card_fee_basis_points",
        "0",
        "integer",
        "Default card processing fee percentage for closeout calculations, "
        "stored in basis points. Provider-overridable.",
    ),
    (
        "closeout_card_fee_fixed_cents",
        "0",
        "integer",
        "Default fixed card processing fee in cents for closeout calculations. "
        "Provider-overridable.",
    ),
)


_ITEM_TYPES = (
    ("service_fee", "Service fee", "active", True, True, False, False, False, False, 10),
    ("labor", "Labor", "active", True, True, False, False, False, False, 20),
    ("diagnostic", "Diagnostic", "active", True, True, False, False, False, False, 30),
    ("emergency_fee", "Emergency fee", "active", True, True, False, False, False, False, 40),
    ("trip_fee", "Trip fee", "active", True, True, False, False, False, False, 50),
    ("physical_part", "Physical part", "active", True, False, True, True, False, False, 60),
    ("hardware", "Hardware", "active", True, False, True, True, False, False, 70),
    ("key_blank", "Key blank", "active", True, False, True, True, False, False, 80),
    ("remote_fob", "Remote / fob", "active", True, False, True, True, False, False, 90),
    ("key_code_purchase", "Key code purchase", "active", False, False, True, True, True, True, 100),
    ("programming_token", "Programming token", "active", False, False, True, True, True, True, 110),
    ("software_license", "Software / license", "active", False, False, True, True, True, True, 120),
    ("consumable", "Consumable", "active", True, False, True, True, False, False, 130),
    ("permit_fee", "Permit fee", "active", False, False, False, True, True, True, 140),
    ("third_party_service", "Third-party service", "active", False, False, True, True, True, True, 150),
    ("discount", "Discount", "active", False, True, False, False, True, False, 160),
    ("other", "Other", "active", True, False, False, True, True, False, 170),
)


def upgrade() -> None:
    for key, value, value_type, description in _SEEDS:
        op.execute(
            f"""
            INSERT INTO global_settings
                (key, value, value_type, description, is_secret, is_runtime_editable)
            VALUES (
                '{key}', '{value}'::jsonb, '{value_type}',
                '{description.replace("'", "''")}', false, true
            )
            ON CONFLICT (key) DO NOTHING
            """
        )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS closeout_item_types (
            code text PRIMARY KEY,
            label text NOT NULL,
            status text NOT NULL DEFAULT 'active'
                CHECK (status IN ('draft','active','deprecated')),
            default_taxable boolean NOT NULL DEFAULT true,
            default_compensation_eligible boolean NOT NULL DEFAULT false,
            default_reimbursement_eligible boolean NOT NULL DEFAULT false,
            requires_provided_by boolean NOT NULL DEFAULT false,
            requires_note boolean NOT NULL DEFAULT false,
            requires_receipt boolean NOT NULL DEFAULT false,
            sort_order integer NOT NULL DEFAULT 100,
            updated_at timestamptz NOT NULL DEFAULT now(),
            updated_by uuid REFERENCES users(id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_closeout_item_types_status"
        " ON closeout_item_types (status, sort_order, code)"
    )
    for (
        code,
        label,
        status,
        default_taxable,
        default_compensation_eligible,
        default_reimbursement_eligible,
        requires_provided_by,
        requires_note,
        requires_receipt,
        sort_order,
    ) in _ITEM_TYPES:
        op.execute(
            f"""
            INSERT INTO closeout_item_types
                (code, label, status, default_taxable,
                 default_compensation_eligible, default_reimbursement_eligible,
                 requires_provided_by, requires_note, requires_receipt, sort_order)
            VALUES (
                '{code}', '{label.replace("'", "''")}', '{status}',
                {str(default_taxable).lower()},
                {str(default_compensation_eligible).lower()},
                {str(default_reimbursement_eligible).lower()},
                {str(requires_provided_by).lower()},
                {str(requires_note).lower()},
                {str(requires_receipt).lower()},
                {sort_order}
            )
            ON CONFLICT (code) DO NOTHING
            """
        )


def downgrade() -> None:
    keys = ",".join(f"'{k}'" for k, *_ in _SEEDS)
    op.execute("DROP TABLE IF EXISTS closeout_item_types")
    op.execute(f"DELETE FROM organization_settings WHERE key IN ({keys})")
    op.execute(f"DELETE FROM global_settings WHERE key IN ({keys})")
