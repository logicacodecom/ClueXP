"""Every error response must be JSON carrying a string `detail`.

The BFF routes in all four frontends do `await response.json().catch(() => ({}))`
and render `body.detail`, so a plain-text 500 or a list-shaped 422 reaches the
browser as a blank generic message with no cause.

Run from apps/intake-web:  pytest api/tests/test_error_detail.py
"""
from __future__ import annotations

from starlette.testclient import TestClient

from api.main import app


def _detail(response) -> str:
    body = response.json()
    assert isinstance(body["detail"], str) and body["detail"], body
    return body["detail"]


def test_validation_error_detail_is_a_string():
    # Default FastAPI would answer with detail=[{...}, {...}].
    resp = TestClient(app).post("/auth/register/organization", json={"organization_name": "X"})
    assert resp.status_code == 422
    assert "admin_email" in _detail(resp)


def test_unhandled_error_detail_is_opaque_and_traceable():
    # The InMemory store raises NotImplementedError here; default Starlette would
    # answer with the plain text "Internal Server Error".
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/auth/register/organization", json={
        "organization_name": "X", "admin_display_name": "A",
        "admin_email": "a@example.com", "password": "password123",
    })
    assert resp.status_code == 500
    assert _detail(resp) == "An unexpected error occurred."
    assert len(resp.json()["error_id"]) == 16
    assert "NotImplementedError" not in resp.text
