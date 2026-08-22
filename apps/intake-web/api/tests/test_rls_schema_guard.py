"""Static guard: every application table must have an explicit RLS decision."""
from __future__ import annotations

import ast
import re
from pathlib import Path

from api.store import RUNTIME_DDL_RLS_TABLES


ROOT = Path(__file__).resolve().parents[4]
VERSIONS = ROOT / "packages" / "db" / "alembic" / "versions"
RLS_MIGRATION = VERSIONS / "0055_default_deny_rls.py"


def _tuple_assignment(path: Path, name: str) -> tuple[str, ...]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == name for target in node.targets
        ):
            return tuple(ast.literal_eval(node.value))
    raise AssertionError(f"{name} not found in {path}")


def _created_tables(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    sql_tables = set(
        re.findall(
            r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(",
            text,
            flags=re.IGNORECASE,
        )
    )
    alembic_tables = set(
        re.findall(r"op\.create_table\(\s*[\"']([a-z_][a-z0-9_]*)[\"']", text)
    )
    return {table.lower() for table in sql_tables | alembic_tables}


def test_every_alembic_table_has_an_explicit_default_deny_rls_decision():
    created: set[str] = set()
    for migration in VERSIONS.glob("*.py"):
        created.update(_created_tables(migration))
    protected = set(_tuple_assignment(RLS_MIGRATION, "RLS_TABLES"))

    assert created <= protected, f"Tables missing an RLS decision: {sorted(created - protected)}"


def test_runtime_ddl_cannot_create_a_table_outside_the_rls_registry():
    store_path = ROOT / "apps" / "intake-web" / "api" / "store.py"
    runtime_created = _created_tables(store_path)
    protected = set(_tuple_assignment(RLS_MIGRATION, "RLS_TABLES"))

    assert runtime_created == set(RUNTIME_DDL_RLS_TABLES)
    assert runtime_created <= protected


def test_default_deny_migration_does_not_force_rls_on_backend_owner():
    text = RLS_MIGRATION.read_text(encoding="utf-8").lower()
    assert "force row level security" not in text
    assert "create policy" not in text
