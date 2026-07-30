"""Native push-device registry tests (InMemory store via TestClient).

Covers: register, self-scoped list, token rotation is idempotent (no dup),
push_token never echoed back, revoke, revoke-not-found, cross-technician
isolation, unauthenticated + non-technician rejection, and validation.

Run from apps/intake-web:  pytest api/tests/test_devices.py
"""
from __future__ import annotations

from uuid import uuid4

from starlette.testclient import TestClient

from api.auth import create_access_token
from api.main import app, store as app_store


def _register_tech() -> tuple[str, dict[str, str]]:
    """Inject a technician with a real-UUID id (registration is Postgres-only in
    the InMemory store) and mint its bearer token."""
    tid = str(uuid4())
    app_store.users[tid] = {
        "id": tid, "email": f"tech-{tid}@example.com", "phone": None,
        "display_name": "Dev Tech", "password_hash": "x",
        "roles": ["technician"], "active_organization_id": None,
        "organization_name": None,
    }
    techs = app_store._technicians = getattr(app_store, "_technicians", [])
    techs.append({
        "id": tid, "display_name": "Dev Tech", "status": "active",
        "vetting_status": "verified", "is_available": True,
    })
    token = create_access_token({"sub": tid, "roles": ["technician"]})
    return tid, {"authorization": f"Bearer {token}"}


def test_register_list_and_token_not_echoed():
    client = TestClient(app)
    _, headers = _register_tech()
    resp = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "iOS", "push_token": "apns-token-abc", "app_version": "1.0.0",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["platform"] == "ios"  # normalized
    assert body["environment"] == "production"  # default
    assert "push_token" not in body  # never echoed
    devices = client.get("/technicians/me/devices", headers=headers).json()["devices"]
    assert len(devices) == 1
    assert devices[0]["id"] == body["id"]
    assert "push_token" not in devices[0]


def test_rotation_is_idempotent():
    client = TestClient(app)
    _, headers = _register_tech()
    first = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "android", "push_token": "fcm-rotate", "app_version": "1.0.0",
    }).json()
    again = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "android", "push_token": "fcm-rotate", "app_version": "1.1.0",
    }).json()
    assert again["id"] == first["id"]  # same row, not a duplicate
    assert again["app_version"] == "1.1.0"  # refreshed
    devices = client.get("/technicians/me/devices", headers=headers).json()["devices"]
    assert len(devices) == 1


def test_installation_rotation_replaces_token():
    """APNs/FCM rotation: same installation registers a NEW token. The device row
    is updated in place — one active device, not two."""
    client = TestClient(app)
    _, headers = _register_tech()
    a = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "ios", "push_token": "apns-A",
        "installation_id": "install-1", "app_version": "1.0.0",
    }).json()
    b = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "ios", "push_token": "apns-B",
        "installation_id": "install-1", "app_version": "1.1.0",
    }).json()
    assert b["id"] == a["id"]  # same device row, token swapped
    assert b["app_version"] == "1.1.0"  # refreshed
    devices = client.get("/technicians/me/devices", headers=headers).json()["devices"]
    assert len(devices) == 1  # NOT two active devices
    assert devices[0]["id"] == a["id"]


def test_installation_rotation_onto_token_used_elsewhere_is_atomic():
    """Edge: rotate one installation onto a token already active on another device
    row. Must not error (Postgres would hit the global-unique push_token
    constraint); the stale row is removed and one correct active row remains."""
    client = TestClient(app)
    _, headers = _register_tech()
    a = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "ios", "push_token": "dup-A", "installation_id": "install-1",
    }).json()
    client.post("/technicians/me/devices", headers=headers, json={
        "platform": "ios", "push_token": "dup-B", "installation_id": "install-2",
    })
    assert len(client.get("/technicians/me/devices", headers=headers).json()["devices"]) == 2
    # install-1 rotates onto dup-B, which install-2 already holds.
    resp = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "ios", "push_token": "dup-B", "installation_id": "install-1",
    })
    assert resp.status_code == 200, resp.text  # not a 500
    assert resp.json()["id"] == a["id"]  # rotated in place on install-1
    devices = client.get("/technicians/me/devices", headers=headers).json()["devices"]
    assert len(devices) == 1  # install-2's stale dup-B row is gone
    assert devices[0]["id"] == a["id"]


def test_installation_id_is_scoped_per_technician():
    """The same installation_id string under two technicians is two distinct
    devices — the identity is (technician, environment, installation)."""
    client = TestClient(app)
    _, headers_a = _register_tech()
    _, headers_b = _register_tech()
    dev_a = client.post("/technicians/me/devices", headers=headers_a, json={
        "platform": "ios", "push_token": "apns-shared-a", "installation_id": "shared",
    }).json()
    dev_b = client.post("/technicians/me/devices", headers=headers_b, json={
        "platform": "android", "push_token": "fcm-shared-b", "installation_id": "shared",
    }).json()
    assert dev_a["id"] != dev_b["id"]
    assert len(client.get("/technicians/me/devices", headers=headers_a).json()["devices"]) == 1
    assert len(client.get("/technicians/me/devices", headers=headers_b).json()["devices"]) == 1


def test_revoke_and_not_found():
    client = TestClient(app)
    _, headers = _register_tech()
    dev = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "ios", "push_token": "apns-revoke",
    }).json()
    assert client.delete(f"/technicians/me/devices/{dev['id']}", headers=headers).status_code == 200
    assert client.get("/technicians/me/devices", headers=headers).json()["devices"] == []
    # second revoke is a 404 (already gone)
    assert client.delete(f"/technicians/me/devices/{dev['id']}", headers=headers).status_code == 404
    # unknown id is a 404
    assert client.delete(f"/technicians/me/devices/{uuid4()}", headers=headers).status_code == 404


def test_devices_are_self_scoped():
    client = TestClient(app)
    _, headers_a = _register_tech()
    _, headers_b = _register_tech()
    dev_a = client.post("/technicians/me/devices", headers=headers_a, json={
        "platform": "ios", "push_token": "apns-scoped-a",
    }).json()
    # B cannot see A's device...
    assert client.get("/technicians/me/devices", headers=headers_b).json()["devices"] == []
    # ...nor revoke it
    assert client.delete(f"/technicians/me/devices/{dev_a['id']}", headers=headers_b).status_code == 404


def test_auth_and_validation():
    client = TestClient(app)
    # unauthenticated
    assert client.get("/technicians/me/devices").status_code == 401
    # non-technician (provider) rejected by role gate
    prov = {"authorization": f"Bearer {create_access_token({'sub': 'usr_provider_demo'})}"}
    assert client.get("/technicians/me/devices", headers=prov).status_code in (403, 409)
    # bad platform
    _, headers = _register_tech()
    bad = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "windows", "push_token": "x",
    })
    assert bad.status_code == 422
