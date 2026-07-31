"""Push-send scaffolding tests (InMemory store via TestClient + direct store/push
module calls).

Covers: NullPushSender never claims success; notify_technician fans out to every
registered device and records one row per device (or one un-targeted row with no
devices); list/ack endpoints are self-scoped and idempotent; and offer creation
(POST /provider/queue/{id}/assign) triggers a real notification record end-to-end.

Run from apps/intake-web:  pytest api/tests/test_notifications.py
"""
from __future__ import annotations

import asyncio
from uuid import uuid4

from starlette.testclient import TestClient

from api import push as push_service
from api.auth import create_access_token
from api.dispatch import STATUS_PENDING_DISPATCH
from api.main import app, store as app_store


def _register_tech() -> tuple[str, dict[str, str]]:
    tid = str(uuid4())
    app_store.users[tid] = {
        "id": tid, "email": f"notify-{tid}@example.com", "phone": None,
        "display_name": "Notify Tech", "password_hash": "x",
        "roles": ["technician"], "active_organization_id": None,
        "organization_name": None,
    }
    techs = app_store._technicians = getattr(app_store, "_technicians", [])
    techs.append({
        "id": tid, "display_name": "Notify Tech", "status": "active",
        "vetting_status": "verified", "is_available": True,
    })
    token = create_access_token({"sub": tid, "roles": ["technician"]})
    return tid, {"authorization": f"Bearer {token}"}


# --- push module (unit) ----------------------------------------------------
def test_null_sender_never_claims_success():
    sender = push_service.NullPushSender()
    status = asyncio.run(sender.send(device={"id": "x"}, envelope={}))
    assert status == "skipped_no_provider"


def test_get_push_sender_defaults_to_null():
    assert isinstance(push_service.get_push_sender(), push_service.NullPushSender)


def test_notify_technician_fans_out_one_row_per_device():
    client = TestClient(app)
    tid, headers = _register_tech()
    for i in range(2):
        client.post("/technicians/me/devices", headers=headers, json={
            "platform": "ios", "push_token": f"notify-fanout-{tid}-{i}",
            "installation_id": f"install-{i}",
        })
    records = asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="offer", envelope={"title": "t", "body": "b"}))
    assert len(records) == 2
    assert all(r["provider_status"] == "skipped_no_provider" for r in records)
    assert {r["device_id"] for r in records} == {
        d["id"] for d in asyncio.run(app_store.list_technician_devices(tid))
    }


def test_notify_technician_with_no_devices_records_one_untargeted_row():
    tid, _ = _register_tech()
    records = asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="safety", envelope={"title": "t", "body": "b"}))
    assert len(records) == 1
    assert records[0]["device_id"] is None
    assert records[0]["provider_status"] == "skipped_no_provider"


# --- endpoints ---------------------------------------------------------------
def test_list_and_ack_notification():
    client = TestClient(app)
    tid, headers = _register_tech()
    asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="system", envelope={"title": "t", "body": "b"}))
    listed = client.get("/technicians/me/notifications", headers=headers).json()["notifications"]
    assert len(listed) == 1
    nid = listed[0]["id"]
    assert listed[0]["acknowledged_at"] is None

    ack = client.post(f"/technicians/me/notifications/{nid}/ack", headers=headers)
    assert ack.status_code == 200, ack.text
    assert ack.json()["acknowledged_at"] is not None

    # idempotent: acking again doesn't error or clear the timestamp
    again = client.post(f"/technicians/me/notifications/{nid}/ack", headers=headers)
    assert again.status_code == 200
    assert again.json()["acknowledged_at"] == ack.json()["acknowledged_at"]

    unacked = client.get(
        "/technicians/me/notifications?unacknowledged_only=true", headers=headers
    ).json()["notifications"]
    assert unacked == []


def test_notifications_are_self_scoped():
    client = TestClient(app)
    tid_a, headers_a = _register_tech()
    _, headers_b = _register_tech()
    asyncio.run(push_service.notify_technician(
        app_store, tid_a, alert_class="system", envelope={"title": "t", "body": "b"}))
    assert client.get("/technicians/me/notifications", headers=headers_b).json()["notifications"] == []
    nid = client.get("/technicians/me/notifications", headers=headers_a).json()["notifications"][0]["id"]
    assert client.post(f"/technicians/me/notifications/{nid}/ack", headers=headers_b).status_code == 404


def test_notifications_require_technician_auth():
    client = TestClient(app)
    assert client.get("/technicians/me/notifications").status_code == 401


# --- integration: offer creation triggers a real notification --------------
def _seed_dispatcher(app_store, uid, org_id):
    app_store.users[uid] = {
        "id": uid, "email": f"disp_{uid[:8]}@cluexp.test", "phone": None,
        "display_name": "Dispatcher", "password_hash": "",
        "roles": ["dispatcher"], "active_organization_id": org_id, "organization_name": "Acme",
    }


def test_offer_creation_records_a_notification():
    client = TestClient(app)
    org = str(uuid4())
    uid = str(uuid4())
    jid = str(uuid4())
    tid, tech_headers = _register_tech()
    _seed_dispatcher(app_store, uid, org)
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_PENDING_DISPATCH
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org
    # in-org, online tech (avoids the offline-override path)
    from datetime import datetime, timezone
    app_store._technicians = getattr(app_store, "_technicians", [])
    for t in app_store._technicians:
        if t["id"] == tid:
            t["primary_organization_id"] = org
            t["location_updated_at"] = datetime.now(timezone.utc).isoformat()

    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    resp = client.post(
        f"/provider/queue/{jid}/assign", json={"technician_id": tid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text

    notifications = client.get(
        "/technicians/me/notifications", headers=tech_headers
    ).json()["notifications"]
    assert len(notifications) == 1
    assert notifications[0]["alert_class"] == "offer"
    assert notifications[0]["job_id"] == jid
    assert notifications[0]["provider_status"] == "skipped_no_provider"
