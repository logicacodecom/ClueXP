"""Push delivery tests (InMemory store via TestClient + direct store/push
module calls).

Covers both halves of the provider seam:
  * unconfigured (the default everywhere, including production until
    PUSH_PROVIDER=expo is set): NoopPushProvider never claims success, every
    row stays 'skipped_no_provider';
  * configured: a mocked Expo transport — send success stores the ticket id,
    a provider error stores the code, a DeviceNotRegistered receipt deactivates
    the device, and fan-out records one row per device.

Plus: the offer push contract (channel/priority/data payload), and the
list/ack endpoints being self-scoped and idempotent.

Run from apps/intake-web:  pytest api/tests/test_notifications.py
"""
from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest
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


def _register_device(client: TestClient, headers: dict[str, str], token: str) -> str:
    resp = client.post("/technicians/me/devices", headers=headers, json={
        "platform": "android", "push_token": token, "installation_id": f"install-{token}",
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


@pytest.fixture
def expo(monkeypatch):
    """Select the Expo provider and stub its HTTP transport. Returns a recorder
    whose `.replies` maps a URL to the JSON Expo would answer with (an Exception
    to simulate a transport failure, or a callable for per-call answers), and
    whose `.calls` collects (url, body) so payload shape can be asserted."""
    class Transport:
        def __init__(self):
            self.calls: list[tuple[str, dict]] = []
            self.replies: dict[str, object] = {}

        def __call__(self, url, body, access_token):
            self.calls.append((url, body))
            reply = self.replies.get(url)
            if isinstance(reply, Exception):
                raise reply
            if callable(reply):
                return reply(body)
            return reply if reply is not None else {"data": {"status": "ok", "id": "ticket-x"}}

    transport = Transport()
    monkeypatch.setenv("PUSH_PROVIDER", "expo")
    monkeypatch.delenv("EXPO_ACCESS_TOKEN", raising=False)
    monkeypatch.setattr(push_service, "_post_json", transport)
    return transport


# --- push module (unit) ----------------------------------------------------
def test_noop_provider_never_claims_success():
    provider = push_service.NoopPushProvider()
    assert provider.configured is False
    assert asyncio.run(provider.send(device={"id": "x"}, message={})) == {
        "status": "skipped_no_provider"
    }
    assert asyncio.run(provider.receipts(["t1"])) == {}


def test_get_push_provider_defaults_to_noop():
    assert isinstance(push_service.get_push_provider(), push_service.NoopPushProvider)


def test_get_push_provider_selects_expo_by_env(monkeypatch):
    monkeypatch.setenv("PUSH_PROVIDER", "Expo")  # case/whitespace tolerant
    assert isinstance(push_service.get_push_provider(), push_service.ExpoPushProvider)


# --- offer push contract ---------------------------------------------------
def test_offer_message_uses_urgent_channel_and_priority():
    message = push_service._expo_message("ExponentPushToken[abc]", {
        "alert_class": "offer", "title": "New job offer", "body": "b", "data": {"kind": "offer"},
    })
    assert message["to"] == "ExponentPushToken[abc]"
    assert message["channelId"] == "job-offers-v2"
    assert message["priority"] == "high"
    assert message["sound"] == "offer_alarm.wav"
    # time-sensitive, NOT 'critical': critical alerts need an Apple entitlement.
    assert message["interruptionLevel"] == "time-sensitive"


def test_non_offer_message_stays_on_the_quiet_channel():
    message = push_service._expo_message("t", {"alert_class": "message", "title": "x", "body": "y"})
    assert message["channelId"] == "job-alerts"
    assert message["priority"] == "default"
    assert message["sound"] == "default"
    assert "interruptionLevel" not in message


def test_offer_data_payload_shape():
    job_id, offer_id = uuid4(), uuid4()
    data = push_service._push_data(
        alert_class="offer", notification_id="n-1", job_id=job_id, offer_id=offer_id,
        thread_id=None, envelope={"expires_at": "2026-08-03T10:05:00+00:00"},
    )
    assert data == {
        "kind": "offer",
        "notification_id": "n-1",
        "url": f"cluexp-tech://offers/{offer_id}",
        "urgent": True,
        "job_id": str(job_id),
        "offer_id": str(offer_id),
        "expires_at": "2026-08-03T10:05:00+00:00",
    }


def test_message_data_payload_deep_links_to_the_job():
    job_id, thread_id = uuid4(), uuid4()
    data = push_service._push_data(
        alert_class="message", notification_id="n-2", job_id=job_id, offer_id=None,
        thread_id=thread_id, envelope={},
    )
    assert data["url"] == f"cluexp-tech://jobs/{job_id}"
    assert data["urgent"] is False
    assert data["thread_id"] == str(thread_id)
    assert "expires_at" not in data


def test_data_payload_falls_back_to_the_work_screen():
    data = push_service._push_data(
        alert_class="system", notification_id="n-3", job_id=None, offer_id=None,
        thread_id=None, envelope={},
    )
    assert data["url"] == "cluexp-tech://work"


# --- configured Expo provider ----------------------------------------------
def test_expo_send_marks_notification_sent_and_stores_ticket(expo):
    expo.replies[push_service.EXPO_SEND_URL] = {"data": [{"status": "ok", "id": "ticket-sent-1"}]}
    client = TestClient(app)
    tid, headers = _register_tech()
    _register_device(client, headers, f"tok-sent-{tid}")

    offer_id = uuid4()
    records = asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="offer", offer_id=offer_id,
        envelope={"title": "New job offer", "body": "b", "expires_at": "2026-08-03T10:05:00+00:00"},
    ))
    assert len(records) == 1
    assert records[0]["provider_status"] == "sent"
    assert records[0]["provider_ticket_id"] == "ticket-sent-1"
    assert records[0]["provider_sent_at"] is not None
    assert records[0]["provider_error_code"] is None

    url, body = expo.calls[0]
    assert url == push_service.EXPO_SEND_URL
    assert body["to"] == f"tok-sent-{tid}"
    assert body["channelId"] == "job-offers-v2"
    assert body["sound"] == "offer_alarm.wav"
    assert body["data"]["notification_id"] == records[0]["id"]
    assert body["data"]["offer_id"] == str(offer_id)
    assert body["data"]["urgent"] is True


def test_expo_provider_error_marks_notification_failed(expo):
    expo.replies[push_service.EXPO_SEND_URL] = {"data": [{
        "status": "error", "message": "Message too big",
        "details": {"error": "MessageTooBig"},
    }]}
    client = TestClient(app)
    tid, headers = _register_tech()
    _register_device(client, headers, f"tok-fail-{tid}")

    records = asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="message", envelope={"title": "t", "body": "b"}))
    assert records[0]["provider_status"] == "failed"
    assert records[0]["provider_error_code"] == "MessageTooBig"
    assert records[0]["provider_error_message"] == "Message too big"
    assert records[0]["provider_ticket_id"] is None


def test_expo_transport_failure_marks_failed_without_leaking_the_request(expo):
    expo.replies[push_service.EXPO_SEND_URL] = RuntimeError("connection reset")
    client = TestClient(app)
    tid, headers = _register_tech()
    _register_device(client, headers, f"tok-boom-{tid}")

    records = asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="offer", envelope={"title": "t", "body": "b"}))
    assert records[0]["provider_status"] == "failed"
    assert records[0]["provider_error_code"] == "TransportError"


def test_expo_send_deactivates_a_permanently_dead_device(expo):
    expo.replies[push_service.EXPO_SEND_URL] = {"data": [{
        "status": "error", "message": "not registered",
        "details": {"error": "DeviceNotRegistered"},
    }]}
    client = TestClient(app)
    tid, headers = _register_tech()
    _register_device(client, headers, f"tok-dead-{tid}")

    records = asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="offer", envelope={"title": "t", "body": "b"}))
    assert records[0]["provider_error_code"] == "DeviceNotRegistered"
    # revoked, so it stops eating a push on every future offer
    assert client.get("/technicians/me/devices", headers=headers).json()["devices"] == []


def test_expo_fanout_records_one_row_per_device(expo):
    tickets = iter(["ticket-fan-1", "ticket-fan-2"])
    expo.replies[push_service.EXPO_SEND_URL] = lambda body: {
        "data": [{"status": "ok", "id": next(tickets)}]
    }
    client = TestClient(app)
    tid, headers = _register_tech()
    for i in range(2):
        _register_device(client, headers, f"tok-fan-{tid}-{i}")

    records = asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="offer", envelope={"title": "t", "body": "b"}))
    assert len(records) == 2
    assert all(r["provider_status"] == "sent" for r in records)
    assert {r["provider_ticket_id"] for r in records} == {"ticket-fan-1", "ticket-fan-2"}
    assert len({r["device_id"] for r in records}) == 2


def test_receipt_poll_confirms_delivery(expo):
    expo.replies[push_service.EXPO_SEND_URL] = {"data": [{"status": "ok", "id": "ticket-rcpt-ok"}]}
    expo.replies[push_service.EXPO_RECEIPT_URL] = {
        "data": {"ticket-rcpt-ok": {"status": "ok"}}
    }
    client = TestClient(app)
    tid, headers = _register_tech()
    _register_device(client, headers, f"tok-rcpt-{tid}")
    record = asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="offer", envelope={"title": "t", "body": "b"}))[0]

    result = asyncio.run(push_service.poll_push_receipts(app_store))
    assert result["delivered"] >= 1
    row = asyncio.run(app_store.list_technician_notifications(tid))[0]
    assert row["id"] == record["id"]
    assert row["provider_status"] == "sent"
    assert row["provider_receipt_at"] is not None
    # resolved rows are not polled again
    assert not [p for p in asyncio.run(app_store.list_pending_push_receipts())
                if p["id"] == record["id"]]


def test_receipt_poll_deactivates_unregistered_device(expo):
    expo.replies[push_service.EXPO_SEND_URL] = {"data": [{"status": "ok", "id": "ticket-rcpt-dead"}]}
    expo.replies[push_service.EXPO_RECEIPT_URL] = {"data": {"ticket-rcpt-dead": {
        "status": "error", "message": "gone", "details": {"error": "DeviceNotRegistered"},
    }}}
    client = TestClient(app)
    tid, headers = _register_tech()
    device_id = _register_device(client, headers, f"tok-rcptdead-{tid}")
    record = asyncio.run(push_service.notify_technician(
        app_store, tid, alert_class="offer", envelope={"title": "t", "body": "b"}))[0]
    assert record["device_id"] == device_id

    result = asyncio.run(push_service.poll_push_receipts(app_store))
    assert result["devices_deactivated"] >= 1
    row = asyncio.run(app_store.list_technician_notifications(tid))[0]
    assert row["provider_status"] == "failed"
    assert row["provider_error_code"] == "DeviceNotRegistered"
    assert client.get("/technicians/me/devices", headers=headers).json()["devices"] == []


def test_receipt_poll_is_a_noop_without_a_provider():
    assert asyncio.run(push_service.poll_push_receipts(app_store)) == {
        "checked": 0, "delivered": 0, "failed": 0, "devices_deactivated": 0,
    }


def test_push_token_never_leaks_to_the_devices_endpoint():
    client = TestClient(app)
    tid, headers = _register_tech()
    _register_device(client, headers, f"tok-secret-{tid}")
    listed = client.get("/technicians/me/devices", headers=headers).json()["devices"]
    assert listed and "push_token" not in listed[0]
    # ...but api/push.py can still read it
    targets = asyncio.run(app_store.list_technician_devices(UUID(tid), with_tokens=True))
    assert targets[0]["push_token"] == f"tok-secret-{tid}"


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
