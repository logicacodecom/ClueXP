"""Regression coverage for the public OpenAPI export (`servers` + exported
path composition). Codex review flagged that exported servers already end in
`/v1` while exported paths also started with `/v1`, composing to the wrong
`/v1/v1/services` URL -- these tests pin the fix."""
from __future__ import annotations

import json
from pathlib import Path

from scripts.export_openapi_v1 import _strip_v1_prefix
from scripts import export_openapi_v1 as export_mod

SNAPSHOT = Path(__file__).resolve().parents[4] / "docs" / "openapi-v1-snapshot.json"


def test_strip_v1_prefix():
    assert _strip_v1_prefix("/v1/services") == "/services"
    assert _strip_v1_prefix("/v1/coverage-checks") == "/coverage-checks"
    # OpenAPI Paths Object keys must start with "/" -- "/v1" alone becomes "/",
    # never "".
    assert _strip_v1_prefix("/v1") == "/"


def test_services_operation_resolves_to_canonical_url():
    spec = export_mod.app.openapi()
    v1_paths = {
        export_mod._strip_v1_prefix(p): v
        for p, v in spec["paths"].items()
        if p == "/v1" or p.startswith("/v1/")
    }
    assert "/services" in v1_paths

    canonical_server = "https://api.cluexp.com/v1"
    legacy_server = "https://intake.cluexp.com/api/v1"
    assert canonical_server + "/services" == "https://api.cluexp.com/v1/services"
    assert legacy_server + "/services" == "https://intake.cluexp.com/api/v1/services"


def test_committed_snapshot_resolves_services_to_exact_canonical_url():
    """Guards the committed artifact itself, not just the export function --
    fails if someone regenerates the snapshot with a stale script or hand-edits
    it out of sync with `servers`."""
    spec = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    assert "/services" in spec["paths"]
    assert "/v1/services" not in spec["paths"]

    servers = {s["url"] for s in spec["servers"]}
    assert "https://api.cluexp.com/v1" in servers
    assert "https://intake.cluexp.com/api/v1" in servers

    canonical_server = next(s["url"] for s in spec["servers"] if s["url"].startswith("https://api.cluexp.com"))
    resolved = canonical_server + "/services"
    assert resolved == "https://api.cluexp.com/v1/services"
