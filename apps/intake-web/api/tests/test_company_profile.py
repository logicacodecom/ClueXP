"""Provider company-profile feature tests (InMemory store via TestClient).

Covers: provider-admin reads/updates, unauthorized role, clearing nullable
fields, validation failures, postal-code normalization/dedupe, valid/invalid
logo uploads, and that operational fields (dispatch_mode / fulfillment_policy)
cannot be written through the profile request.

Run from apps/intake-web:  pytest api/tests/test_company_profile.py
"""
from __future__ import annotations

import struct
from uuid import uuid4

import pytest
from starlette.testclient import TestClient

from api.auth import create_access_token
from api.main import app, store as app_store
from api import storage


def _provider_headers(org_id: str) -> dict[str, str]:
    # Give the demo provider_admin a real-UUID org (the seeded 'org-metro' is not a
    # UUID and would 500 in _provider_organization_id), then mint a session token.
    app_store.users["usr_provider_demo"]["active_organization_id"] = org_id
    token = create_access_token({"sub": "usr_provider_demo"})
    return {"authorization": f"Bearer {token}"}


def _tech_headers() -> dict[str, str]:
    token = create_access_token({"sub": "usr_tech_demo"})
    return {"authorization": f"Bearer {token}"}


def _png(width: int, height: int) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    length = struct.pack(">I", 13)
    ihdr = b"IHDR" + struct.pack(">II", width, height)
    return sig + length + ihdr + b"\x08\x02\x00\x00\x00" + b"\x00" * 8


def _fresh_org() -> str:
    return str(uuid4())


# --- reads & updates -------------------------------------------------------
def test_profile_update_and_read_roundtrip():
    client = TestClient(app)
    org = _fresh_org()
    headers = _provider_headers(org)
    resp = client.patch("/provider/organization", headers=headers, json={
        "display_name": "Metro Key",
        "contact_name": "Nadia Reyes",
        "contact_email": "Nadia@Metrokey.Example",
        "website": "https://metrokey.example",
        "city": "Tampa",
        "country_code": "us",
    })
    assert resp.status_code == 200, resp.text
    body = client.get("/provider/workspace", headers=headers).json()["organization"]
    assert body["contact_name"] == "Nadia Reyes"
    assert body["contact_email"] == "nadia@metrokey.example"  # normalized lowercase
    assert body["website"] == "https://metrokey.example"
    assert body["country_code"] == "US"  # normalized uppercase


# --- unauthorized role -----------------------------------------------------
def test_profile_update_forbidden_for_technician():
    client = TestClient(app)
    resp = client.patch("/provider/organization", headers=_tech_headers(), json={"display_name": "X"})
    assert resp.status_code == 403


def test_logo_upload_forbidden_for_technician():
    client = TestClient(app)
    resp = client.post(
        "/provider/organization/logo", headers=_tech_headers(),
        files={"file": ("logo.png", _png(128, 128), "image/png")},
    )
    assert resp.status_code == 403


# --- clearing nullable fields ----------------------------------------------
def test_clear_field_with_null():
    client = TestClient(app)
    org = _fresh_org()
    headers = _provider_headers(org)
    client.patch("/provider/organization", headers=headers, json={"contact_email": "a@b.com"})
    assert client.get("/provider/workspace", headers=headers).json()["organization"]["contact_email"] == "a@b.com"
    client.patch("/provider/organization", headers=headers, json={"contact_email": None})
    assert client.get("/provider/workspace", headers=headers).json()["organization"]["contact_email"] is None


def test_clear_field_with_blank_string():
    client = TestClient(app)
    org = _fresh_org()
    headers = _provider_headers(org)
    client.patch("/provider/organization", headers=headers, json={"city": "Tampa"})
    client.patch("/provider/organization", headers=headers, json={"city": "   "})
    assert client.get("/provider/workspace", headers=headers).json()["organization"]["city"] is None


# --- validation failures ---------------------------------------------------
@pytest.mark.parametrize("payload", [
    {"contact_email": "not-an-email"},
    {"website": "http://insecure.example"},
    {"contact_phone": "abc"},
    {"country_code": "USA"},
    {"postal_code": "!!bad!!"},
])
def test_validation_failures(payload):
    client = TestClient(app)
    headers = _provider_headers(_fresh_org())
    resp = client.patch("/provider/organization", headers=headers, json=payload)
    assert resp.status_code == 422, resp.text


# --- postal-code normalization & dedupe ------------------------------------
def test_postal_codes_normalized_and_deduped():
    client = TestClient(app)
    org = _fresh_org()
    headers = _provider_headers(org)
    resp = client.patch("/provider/organization", headers=headers, json={
        "service_postal_codes": ["33601", "33601", " 33602 ", "k1a 0b1", "K1A 0B1"]
    })
    assert resp.status_code == 200, resp.text
    codes = client.get("/provider/workspace", headers=headers).json()["organization"]["service_postal_codes"]
    assert codes == ["33601", "33602", "K1A 0B1"]


def test_postal_codes_reject_invalid():
    client = TestClient(app)
    headers = _provider_headers(_fresh_org())
    resp = client.patch("/provider/organization", headers=headers, json={"service_postal_codes": ["ok1", "bad!code"]})
    assert resp.status_code == 422


# --- operational fields cannot be written through the profile request -------
def test_profile_request_cannot_change_dispatch_mode():
    client = TestClient(app)
    org = _fresh_org()
    headers = _provider_headers(org)
    # Seed an operational value directly — providers have no endpoint to set it.
    app_store._org_record(org)["dispatch_mode"] = "platform_managed"
    # Attempt to change it via the profile request (plus a real profile edit).
    resp = client.patch("/provider/organization", headers=headers, json={
        "display_name": "Metro Key", "dispatch_mode": "organization_managed",
    })
    assert resp.status_code == 200
    org_body = client.get("/provider/workspace", headers=headers).json()["organization"]
    assert org_body["dispatch_mode"] == "platform_managed"  # unchanged by profile PATCH
    assert org_body["display_name"] == "Metro Key"


# --- logo upload: valid & invalid ------------------------------------------
def test_logo_upload_valid(monkeypatch):
    client = TestClient(app)
    org = _fresh_org()
    headers = _provider_headers(org)

    async def _fake_upload(bucket, path, content, content_type):
        return f"https://cdn.example/{bucket}/{path}"

    monkeypatch.setattr(storage, "storage_configured", lambda: True)
    monkeypatch.setattr(storage, "upload_object", _fake_upload)

    resp = client.post(
        "/provider/organization/logo", headers=headers,
        files={"file": ("logo.png", _png(256, 256), "image/png")},
    )
    assert resp.status_code == 200, resp.text
    logo_url = resp.json()["logo_url"]
    assert logo_url.endswith(".png")
    assert client.get("/provider/workspace", headers=headers).json()["organization"]["logo_url"] == logo_url


def test_logo_upload_rejects_non_image():
    client = TestClient(app)
    headers = _provider_headers(_fresh_org())
    resp = client.post(
        "/provider/organization/logo", headers=headers,
        files={"file": ("evil.png", b"this is not really an image", "image/png")},
    )
    assert resp.status_code == 422


def test_logo_upload_rejects_too_small():
    client = TestClient(app)
    headers = _provider_headers(_fresh_org())
    resp = client.post(
        "/provider/organization/logo", headers=headers,
        files={"file": ("tiny.png", _png(16, 16), "image/png")},
    )
    assert resp.status_code == 422


# --- storage image helpers (pure) ------------------------------------------
def test_image_helpers_png():
    content = _png(100, 80)
    assert storage.sniff_image_mime(content) == "image/png"
    assert storage.image_dimensions(content) == (100, 80)
    assert storage.validate_logo_upload(content, "image/png") == "image/png"


def test_validate_logo_content_type_mismatch():
    with pytest.raises(ValueError):
        storage.validate_logo_upload(_png(100, 100), "image/jpeg")
