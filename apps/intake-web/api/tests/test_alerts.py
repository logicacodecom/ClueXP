"""Dispatcher alert/escalation inbox (0054): tenant-scoped list/ack/resolve,
platform-ops read-only cross-org view, and the alert-generation hooks that
feed it (customer_help_request off need_more_details, delivery_failure off
the Twilio SMS status webhook)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from starlette.testclient import TestClient

from twilio.request_validator import RequestValidator

from api.auth import create_access_token
from api.dispatch import STATUS_ASSIGNED, STATUS_PENDING_DISPATCH, STATUS_SCHEDULED_CONFIRMED
from api.main import _evaluate_dispatch_alerts, app, store as app_store


def _headers(user_id: str, roles: list[str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': user_id, 'id': user_id, 'roles': roles})}"}


def _register_tech() -> tuple[str, dict[str, str]]:
    tid = str(uuid4())
    app_store.users[tid] = {
        "id": tid, "email": f"alerts-tech-{tid}@example.com", "phone": None,
        "display_name": "Alert Tech", "password_hash": "x",
        "roles": ["technician"], "active_organization_id": None,
        "organization_name": None,
    }
    techs = app_store._technicians = getattr(app_store, "_technicians", [])
    techs.append({
        "id": tid, "display_name": "Alert Tech", "status": "active",
        "vetting_status": "verified", "is_available": True,
    })
    return tid, _headers(tid, ["technician"])


def _register_dispatcher(org_id: str, role: str = "dispatcher") -> tuple[str, dict[str, str]]:
    uid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": f"alerts-dispatch-{uid}@example.com", "phone": None,
        "display_name": "Alert Dispatch", "password_hash": "x",
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
    app_store._tokens = getattr(app_store, "_tokens", {})
    app_store._tokens[jid] = f"track-{jid}"
    return jid


def _twilio_signature(url: str, params: dict[str, str], token: str = "test-token") -> str:
    return RequestValidator(token).compute_signature(url, params)


def _platform_admin() -> dict[str, str]:
    uid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": f"alerts-ops-{uid}@example.com", "phone": None,
        "display_name": "Ops Admin", "password_hash": "x",
        "roles": ["platform_admin"], "active_organization_id": None,
        "organization_name": None,
    }
    return _headers(uid, ["platform_admin"])


def test_owning_provider_can_list_and_ack_its_own_alert():
    client = TestClient(app)
    org = str(uuid4())
    tid, _ = _register_tech()
    _, provider_h = _register_dispatcher(org)
    jid = _seed_job(tid, org, status=STATUS_ASSIGNED)

    app_store._alerts = getattr(app_store, "_alerts", {})
    alert_id = str(uuid4())
    app_store._alerts[alert_id] = {
        "id": alert_id, "organization_id": org, "job_id": jid, "alert_type": "safety_flag",
        "severity": "critical", "status": "open", "payload": {}, "created_at": "2026-08-20T00:00:00+00:00",
        "acknowledged_by": None, "acknowledged_at": None, "resolved_at": None, "escalated_at": None,
    }

    listed = client.get("/provider/alerts", headers=provider_h)
    assert listed.status_code == 200, listed.text
    assert [a["id"] for a in listed.json()["alerts"]] == [alert_id]

    acked = client.post(f"/provider/alerts/{alert_id}/ack", headers=provider_h)
    assert acked.status_code == 200, acked.text
    assert acked.json()["alert"]["status"] == "acknowledged"

    resolved = client.post(f"/provider/alerts/{alert_id}/resolve", headers=provider_h)
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["alert"]["status"] == "resolved"


def test_foreign_provider_gets_404_on_ack_and_resolve():
    client = TestClient(app)
    org = str(uuid4())
    other_org = str(uuid4())
    tid, _ = _register_tech()
    _, other_provider_h = _register_dispatcher(other_org)
    jid = _seed_job(tid, org, status=STATUS_ASSIGNED)

    app_store._alerts = getattr(app_store, "_alerts", {})
    alert_id = str(uuid4())
    app_store._alerts[alert_id] = {
        "id": alert_id, "organization_id": org, "job_id": jid, "alert_type": "stalled_job",
        "severity": "warning", "status": "open", "payload": {}, "created_at": "2026-08-20T00:00:00+00:00",
        "acknowledged_by": None, "acknowledged_at": None, "resolved_at": None, "escalated_at": None,
    }

    assert client.post(f"/provider/alerts/{alert_id}/ack", headers=other_provider_h).status_code == 404
    assert client.post(f"/provider/alerts/{alert_id}/resolve", headers=other_provider_h).status_code == 404
    # list is scoped to the caller's own org, so it never even surfaces the row
    assert client.get("/provider/alerts", headers=other_provider_h).json()["alerts"] == []


def test_platform_ops_lists_all_orgs_read_only_and_cannot_ack_or_resolve():
    client = TestClient(app)
    org = str(uuid4())
    tid, _ = _register_tech()
    jid = _seed_job(tid, org, status=STATUS_ASSIGNED)
    ops_h = _platform_admin()

    app_store._alerts = getattr(app_store, "_alerts", {})
    alert_id = str(uuid4())
    app_store._alerts[alert_id] = {
        "id": alert_id, "organization_id": org, "job_id": jid, "alert_type": "new_job",
        "severity": "info", "status": "open", "payload": {}, "created_at": "2026-08-20T00:00:00+00:00",
        "acknowledged_by": None, "acknowledged_at": None, "resolved_at": None, "escalated_at": None,
    }

    listed = client.get("/admin/alerts", headers=ops_h)
    assert listed.status_code == 200, listed.text
    assert alert_id in [a["id"] for a in listed.json()["alerts"]]

    # ops has no /admin ack/resolve route at all -- there is nothing to hit;
    # confirm the provider-scoped ack/resolve routes reject an ops session
    # (no active_organization_id -> _require_dispatch_org 409, same as any
    # non-provider caller hitting a provider-scoped mutation).
    assert client.post(f"/provider/alerts/{alert_id}/ack", headers=ops_h).status_code in {403, 409}


def test_technician_and_customer_token_actors_cannot_reach_alert_routes():
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()
    jid = _seed_job(tid, org, status=STATUS_ASSIGNED)
    token = app_store._tokens[jid]

    assert client.get("/provider/alerts", headers=tech_h).status_code in {403, 409}
    # no customer-token alert route exists at all
    assert client.get(f"/t/{token}/alerts").status_code == 404


def test_customer_help_request_alert_created_for_need_more_details_only():
    client = TestClient(app)
    org = str(uuid4())
    tid, _ = _register_tech()
    jid = _seed_job(tid, org, status=STATUS_ASSIGNED)
    token = app_store._tokens[jid]
    app_store._job_fulfillment_org[jid] = org

    other = client.post(f"/t/{token}/messages", json={"channel": "customer", "template_code": "on_my_way"})
    assert other.status_code == 200, other.text
    alerts_after_other = [
        a for a in getattr(app_store, "_alerts", {}).values()
        if a["job_id"] == jid and a["alert_type"] == "customer_help_request"
    ]
    assert alerts_after_other == []

    help_request = client.post(f"/t/{token}/messages", json={"channel": "customer", "template_code": "need_more_details"})
    assert help_request.status_code == 200, help_request.text
    alerts_after_help = [
        a for a in getattr(app_store, "_alerts", {}).values()
        if a["job_id"] == jid and a["alert_type"] == "customer_help_request"
    ]
    assert len(alerts_after_help) == 1
    assert alerts_after_help[0]["organization_id"] == org
    assert alerts_after_help[0]["severity"] == "warning"


def test_provider_manual_immediate_request_creates_new_job_alert(monkeypatch):
    async def unresolved(_address):
        return None

    monkeypatch.setattr("api.main.geocode", unresolved)
    client = TestClient(app)
    org = str(uuid4())
    _, provider_h = _register_dispatcher(org)
    app_store._alerts = {}

    created = client.post(
        "/provider/requests",
        headers=provider_h,
        json={
            "customer_name": "Alert Customer",
            "customer_phone": "(555) 014-0999",
            "address": "77 Alert Ave",
            "access_type": "home",
            "situation": "locked_out",
            "urgency": "urgent",
            "source_channel": "phone",
        },
    )
    assert created.status_code == 200, created.text
    job_id = created.json()["ticket"]["ticket_id"]

    matching = [
        a for a in getattr(app_store, "_alerts", {}).values()
        if a["job_id"] == job_id and a["alert_type"] == "new_job" and a["status"] == "open"
    ]
    assert len(matching) == 1
    assert matching[0]["organization_id"] == org
    assert matching[0]["payload"]["source"] == "phone"


def test_dispatch_alert_sweep_ignores_future_scheduled_queue_rows():
    org = str(uuid4())
    tid, _ = _register_tech()
    scheduled_jid = _seed_job(tid, org, status=STATUS_SCHEDULED_CONFIRMED)
    pending_jid = _seed_job(tid, org, status=STATUS_PENDING_DISPATCH)
    old = (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
    app_store._job_created_at = getattr(app_store, "_job_created_at", {})
    app_store._job_created_at[scheduled_jid] = old
    app_store._job_created_at[pending_jid] = old
    app_store._organization_settings = getattr(app_store, "_organization_settings", {})
    app_store._organization_settings[(org, "dispatch_stalled_minutes")] = {"value": 30}
    app_store._alerts = {}

    counts = asyncio.run(_evaluate_dispatch_alerts())
    assert counts["stalled_job"] == 1
    assert all(a["job_id"] != scheduled_jid for a in getattr(app_store, "_alerts", {}).values())
    assert any(a["job_id"] == pending_jid and a["alert_type"] == "stalled_job" for a in app_store._alerts.values())


def test_delivery_failure_alert_created_on_terminal_twilio_sms_status(monkeypatch):
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test-token")
    client = TestClient(app)
    org = str(uuid4())
    tid, _ = _register_tech()
    jid = _seed_job(tid, org, status=STATUS_ASSIGNED)

    app_store._sms_deliveries = getattr(app_store, "_sms_deliveries", [])
    sid = "SMfail" + uuid4().hex[:8]
    app_store._sms_deliveries.append({
        "id": str(uuid4()), "organization_id": org, "job_id": jid, "recipient_type": "customer",
        "to_number": "+15551239999", "from_number": "+15551230000", "purpose": "technician_en_route",
        "provider": "twilio", "provider_message_sid": sid, "provider_status": "sent",
        "error_code": None, "request_hash": "x", "metadata": {}, "created_at": "2026-08-20T00:00:00+00:00",
        "sent_at": "2026-08-20T00:00:00+00:00", "delivered_at": None, "failed_at": None,
    })

    params = {"MessageSid": sid, "MessageStatus": "failed", "ErrorCode": "30003"}
    url = "http://testserver/api/twilio/sms/status"
    response = client.post(
        "/api/twilio/sms/status", data=params, headers={"X-Twilio-Signature": _twilio_signature(url, params)},
    )
    assert response.status_code == 200, response.text

    failure_alerts = [
        a for a in getattr(app_store, "_alerts", {}).values()
        if a["job_id"] == jid and a["alert_type"] == "delivery_failure"
    ]
    assert len(failure_alerts) == 1
    assert failure_alerts[0]["organization_id"] == org


def test_duplicate_open_alert_is_not_created_twice():
    client = TestClient(app)
    org = str(uuid4())
    tid, _ = _register_tech()
    jid = _seed_job(tid, org, status=STATUS_ASSIGNED)
    token = app_store._tokens[jid]

    for _ in range(2):
        response = client.post(f"/t/{token}/messages", json={"channel": "customer", "template_code": "need_more_details"})
        assert response.status_code == 200, response.text

    matching = [
        a for a in getattr(app_store, "_alerts", {}).values()
        if a["job_id"] == jid and a["alert_type"] == "customer_help_request" and a["status"] == "open"
    ]
    assert len(matching) == 1
