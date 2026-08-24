"""Export the public `/v1` OpenAPI contract to docs/openapi-v1-snapshot.json.

Scoped to `/v1/*` paths only and pruned to the schemas they actually
reference, so internal routes never leak into the published public contract.
Run after adding/changing a `/v1` route and commit the resulting diff.
"""
from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

warnings.filterwarnings("ignore")  # pre-existing duplicate-operation-id warning, unrelated to /v1

from api.main import app  # noqa: E402

OUT = ROOT.parents[1] / "docs" / "openapi-v1-snapshot.json"


def _referenced_schemas(paths: dict, all_schemas: dict) -> dict:
    seen: set[str] = set()

    def walk(obj: object) -> None:
        if isinstance(obj, dict):
            ref = obj.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
                name = ref.split("/")[-1]
                if name not in seen:
                    seen.add(name)
                    if name in all_schemas:
                        walk(all_schemas[name])
            for value in obj.values():
                walk(value)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(paths)
    return {k: v for k, v in all_schemas.items() if k in seen}


def _strip_v1_prefix(path: str) -> str:
    """Servers already end in `/v1` (or the legacy `/api/v1`), so exported path
    keys must NOT also start with `/v1` -- otherwise clients resolve
    `.../v1` + `/v1/services` = `.../v1/v1/services`. `/v1` alone becomes `/`
    (never `""`) -- the OpenAPI Paths Object requires every key to start with
    `/`, and `.../v1` + `/` still resolves to the correct `.../v1` root."""
    if path == "/v1":
        return "/"
    return path[len("/v1"):]


def main() -> None:
    check = "--check" in sys.argv
    spec = app.openapi()
    v1_paths = {
        _strip_v1_prefix(p): v
        for p, v in spec["paths"].items()
        if p == "/v1" or p.startswith("/v1/")
    }
    all_schemas = spec.get("components", {}).get("schemas", {})
    out = {
        "openapi": spec["openapi"],
        "info": {"title": "ClueXP Public API", "version": "v1"},
        "servers": [
            {"url": "https://api.cluexp.com/v1", "description": "Canonical public machine API"},
            {
                "url": "https://intake.cluexp.com/api/v1",
                "description": "Legacy origin, available during migration",
            },
        ],
        "paths": v1_paths,
        "components": {"schemas": _referenced_schemas(v1_paths, all_schemas)},
    }
    rendered = json.dumps(out, indent=2, sort_keys=True) + "\n"
    if check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != rendered:
            print(
                f"{OUT} is stale — run `python scripts/export_openapi_v1.py` and commit the diff.",
                file=sys.stderr,
            )
            sys.exit(1)
        return
    OUT.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
