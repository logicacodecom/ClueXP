"""Technician readiness snapshot tests (InMemory store via TestClient).

Covers: blocked-when-not-ready (fresh account has no location), ready when
approved+available+location-fresh+idle, push-device count reflected, and
auth/role gating.

Run from apps/intake-web:  pytest api/tests/test_readiness.py
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from starlette.testclient import TestClient

from api.auth import create_access_token
from api.main import app, store as app_store


def _register_tech(*, approved: bool = True, fresh_location: bool = False) -> tuple[str, dict[str, str]]:
    tid = str(uuid4())
    app_store.users[tid] = {
        "id": tid, "email": f"tech-{tid}@example.com", "phone": None,
        "display_name": "Dev Tech", "password_hash": "x",
        "roles": ["technician"], "active_organization_id": None,
        "organization_name": None,
    }
    techs = app_store._technicians = getattr(app_store, "_technicians", [])
    techs.append({
        "id": tid, "display_name": "Dev Tech",
        "status": "active" if approved else "pending_vetting",
        "vetting_status": "verified" if approved else "unverified",
        "is_available": True,
        "location_updated_at": datetime.now(timezone.utc).isoformat() if fresh_location else None,
    })
    token = create_access_token({"sub": tid, "roles": ["technician"]})
    return tid, {"authorization": f"Bearer {token}"}


def test_not_ready_when_location_stale():
    client = TestClient(app)
    _, headers = _register_tech(approved=True, fresh_location=False)
    body = client.get("/technicians/me/readiness", headers=headers).json()
    assert body["can_receive_offers"] is False
    assert "location_stale" in body["blocking_reasons"]
    assert body["account"]["approved"] is True
    assert body["push"]["push_ready"] is False


def test_ready_when_approved_available_fresh_and_idle():
    client = TestClient(app)
    _, headers = _register_tech(approved=True, fresh_location=True)
    body = client.get("/technicians/me/readiness", headers=headers).json()
    assert body["can_receive_offers"] is True
    assert body["blocking_reasons"] == []
    assert body["active_job"]["busy"] is False


def test_not_approved_blocks():
    client = TestClient(app)
    _, headers = _register_tech(approved=False, fresh_location=True)
    body = client.get("/technicians/me/readiness", headers=headers).json()
    assert body["can_receive_offers"] is False
    assert "not_approved" in body["blocking_reasons"]


def test_push_ready_reflects_registered_device():
    client = TestClient(app)
    _, headers = _register_tech(approved=True, fresh_location=True)
    client.post("/technicians/me/devices", headers=headers, json={
        "platform": "ios", "push_token": f"apns-{uuid4()}",
    })
    body = client.get("/technicians/me/readiness", headers=headers).json()
    assert body["push"]["registered_devices"] == 1
    assert body["push"]["push_ready"] is True


def test_readiness_requires_technician_auth():
    client = TestClient(app)
    assert client.get("/technicians/me/readiness").status_code == 401
    prov = {"authorization": f"Bearer {create_access_token({'sub': 'usr_provider_demo'})}"}
    assert client.get("/technicians/me/readiness", headers=prov).status_code in (403, 409)
