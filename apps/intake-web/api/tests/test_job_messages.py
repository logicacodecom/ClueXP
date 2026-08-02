"""Job-scoped operations messaging contract.

This is the first Communication Hub implementation slice: technician <-> owning
provider operations. Customer messaging and masked calling remain deliberately
gated to later slices.
"""
from __future__ import annotations

from uuid import uuid4

from starlette.testclient import TestClient

from api.auth import create_access_token
from api.dispatch import STATUS_ASSIGNED, STATUS_CANCELLED
from api.main import app, store as app_store


def _headers(user_id: str, roles: list[str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': user_id, 'id': user_id, 'roles': roles})}"}


def _register_tech() -> tuple[str, dict[str, str]]:
    tid = str(uuid4())
    app_store.users[tid] = {
        "id": tid, "email": f"msg-tech-{tid}@example.com", "phone": None,
        "display_name": "Message Tech", "password_hash": "x",
        "roles": ["technician"], "active_organization_id": None,
        "organization_name": None,
    }
    techs = app_store._technicians = getattr(app_store, "_technicians", [])
    techs.append({
        "id": tid, "display_name": "Message Tech", "status": "active",
        "vetting_status": "verified", "is_available": True,
    })
    return tid, _headers(tid, ["technician"])


def _register_dispatcher(org_id: str, role: str = "dispatcher") -> tuple[str, dict[str, str]]:
    uid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": f"msg-dispatch-{uid}@example.com", "phone": None,
        "display_name": "Nadia Dispatch", "password_hash": "x",
        "roles": [role], "active_organization_id": org_id,
        "organization_name": "Metro Key",
    }
    return uid, _headers(uid, [role])


def _seed_job(tid: str, org_id: str, status: str = STATUS_ASSIGNED) -> str:
    jid = str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_fulfillment_org = getattr(app_store, "_job_fulfillment_org", {})
    app_store._job_status[jid] = status
    app_store._job_tech[jid] = tid
    app_store._job_org[jid] = org_id
    app_store._job_fulfillment_org[jid] = org_id
    return jid


def test_technician_operations_message_is_visible_to_provider_and_reply_returns_to_tech():
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()
    _, provider_h = _register_dispatcher(org)
    jid = _seed_job(tid, org)

    sent = client.post(
        f"/jobs/{jid}/messages",
        headers=tech_h,
        json={"channel": "operations", "body": "Customer is not answering."},
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["message"]["sender_type"] == "technician"

    provider_view = client.get(f"/provider/jobs/{jid}/messages", headers=provider_h)
    assert provider_view.status_code == 200, provider_view.text
    assert [m["body"] for m in provider_view.json()["messages"]] == ["Customer is not answering."]

    reply = client.post(
        f"/provider/jobs/{jid}/messages",
        headers=provider_h,
        json={"channel": "operations", "body": "Try once more, then mark customer unavailable."},
    )
    assert reply.status_code == 200, reply.text
    assert reply.json()["message"]["sender_type"] == "dispatcher"

    tech_view = client.get(f"/jobs/{jid}/messages", headers=tech_h)
    assert tech_view.status_code == 200, tech_view.text
    assert [m["sender_type"] for m in tech_view.json()["messages"]] == ["technician", "dispatcher"]


def test_message_client_message_id_is_idempotent_and_conflicts_on_reuse():
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()
    jid = _seed_job(tid, org)
    key = "msg_" + uuid4().hex

    body = {"channel": "operations", "body": "Need approval for extra part.", "client_message_id": key}
    first = client.post(f"/jobs/{jid}/messages", headers=tech_h, json=body)
    retry = client.post(f"/jobs/{jid}/messages", headers=tech_h, json=body)
    assert first.status_code == 200, first.text
    assert retry.status_code == 200, retry.text
    assert retry.json()["message"]["id"] == first.json()["message"]["id"]

    listed = client.get(f"/jobs/{jid}/messages", headers=tech_h)
    assert len(listed.json()["messages"]) == 1

    conflict = client.post(
        f"/jobs/{jid}/messages",
        headers=tech_h,
        json={"channel": "operations", "body": "Different text", "client_message_id": key},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency_key_reuse"


def test_messages_are_self_and_tenant_scoped():
    client = TestClient(app)
    org_a, org_b = str(uuid4()), str(uuid4())
    tid, tech_h = _register_tech()
    _, other_tech_h = _register_tech()
    _, provider_a_h = _register_dispatcher(org_a)
    _, provider_b_h = _register_dispatcher(org_b)
    jid = _seed_job(tid, org_a)

    assert client.get(f"/jobs/{jid}/messages", headers=tech_h).status_code == 200
    assert client.get(f"/jobs/{jid}/messages", headers=other_tech_h).status_code == 404
    assert client.get(f"/provider/jobs/{jid}/messages", headers=provider_a_h).status_code == 200
    assert client.get(f"/provider/jobs/{jid}/messages", headers=provider_b_h).status_code == 404


def test_customer_channel_and_closed_job_writes_are_gated():
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()
    jid = _seed_job(tid, org)
    customer = client.post(
        f"/jobs/{jid}/messages",
        headers=tech_h,
        json={"channel": "customer", "body": "I am on my way."},
    )
    assert customer.status_code == 501
    assert customer.json()["detail"]["code"] == "channel_not_enabled"

    closed = _seed_job(tid, org, status=STATUS_CANCELLED)
    blocked = client.post(
        f"/jobs/{closed}/messages",
        headers=tech_h,
        json={"channel": "operations", "body": "Can you see this?"},
    )
    assert blocked.status_code == 409
