"""Job-scoped communication hub contract.

Operations messaging is technician <-> provider operations. Customer messaging
is a separate template-only channel exposed to the tracking-token customer.
Read receipts, push-attempt audit, and masked-call session scaffolding are part
of the same Communication Hub contract.
"""
from __future__ import annotations

from uuid import uuid4

from starlette.testclient import TestClient
from twilio.request_validator import RequestValidator

from api.auth import create_access_token
from api.dispatch import STATUS_ASSIGNED, STATUS_CANCELLED, STATUS_COMPLETED_CONFIRMED
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
    app_store._tokens = getattr(app_store, "_tokens", {})
    app_store._tokens[jid] = f"track-{jid}"
    return jid


def _twilio_signature(url: str, params: dict[str, str], token: str = "test-token") -> str:
    return RequestValidator(token).compute_signature(url, params)


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


def test_customer_channel_is_template_only_and_visible_to_customer_provider_and_tech():
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()
    _, provider_h = _register_dispatcher(org)
    jid = _seed_job(tid, org)
    token = app_store._tokens[jid]

    free_text = client.post(
        f"/jobs/{jid}/messages",
        headers=tech_h,
        json={"channel": "customer", "body": "I am on my way."},
    )
    assert free_text.status_code == 422
    assert free_text.json()["detail"]["code"] == "template_required"

    sent = client.post(
        f"/jobs/{jid}/messages",
        headers=tech_h,
        json={"channel": "customer", "template_code": "on_my_way", "client_message_id": "cust_msg_123"},
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["message"]["channel"] == "customer"
    assert sent.json()["message"]["body"] is None
    assert sent.json()["message"]["template_code"] == "on_my_way"

    customer_view = client.get(f"/t/{token}/messages")
    assert customer_view.status_code == 200, customer_view.text
    assert customer_view.json()["messages"][0]["template_code"] == "on_my_way"

    customer_reply = client.post(
        f"/t/{token}/messages",
        json={"channel": "customer", "template_code": "need_more_details", "client_message_id": "reply_123456"},
    )
    assert customer_reply.status_code == 200, customer_reply.text
    assert customer_reply.json()["message"]["sender_type"] == "customer"

    tech_view = client.get(f"/jobs/{jid}/messages?channel=customer", headers=tech_h)
    provider_view = client.get(f"/provider/jobs/{jid}/messages?channel=customer", headers=provider_h)
    assert tech_view.status_code == 200
    assert provider_view.status_code == 200
    assert [m["sender_type"] for m in tech_view.json()["messages"]] == ["technician", "customer"]
    assert [m["sender_type"] for m in provider_view.json()["messages"]] == ["technician", "customer"]


def test_customer_channel_unknown_template_and_operations_leak_are_blocked():
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()
    jid = _seed_job(tid, org)
    token = app_store._tokens[jid]

    unknown = client.post(
        f"/jobs/{jid}/messages",
        headers=tech_h,
        json={"channel": "customer", "template_code": "raw_free_text"},
    )
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["code"] == "unknown_template"

    blocked = client.post(
        f"/t/{token}/messages",
        json={"channel": "operations", "template_code": "need_more_details"},
    )
    assert blocked.status_code == 404

    client.post(f"/jobs/{jid}/messages", headers=tech_h, json={"channel": "operations", "body": "ops-only"})
    customer_view = client.get(f"/t/{token}/messages")
    assert customer_view.status_code == 200
    assert customer_view.json()["messages"] == []


def test_closed_job_writes_are_gated():
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()

    closed = _seed_job(tid, org, status=STATUS_CANCELLED)
    blocked = client.post(
        f"/jobs/{closed}/messages",
        headers=tech_h,
        json={"channel": "operations", "body": "Can you see this?"},
    )
    assert blocked.status_code == 409


def test_message_unread_counts_read_receipts_and_tech_push_attempts():
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()
    _, provider_h = _register_dispatcher(org)
    jid = _seed_job(tid, org)

    sent = client.post(
        f"/jobs/{jid}/messages",
        headers=tech_h,
        json={"channel": "operations", "body": "Need dispatch guidance."},
    )
    assert sent.status_code == 200, sent.text

    provider_view = client.get(f"/provider/jobs/{jid}/messages", headers=provider_h)
    assert provider_view.status_code == 200
    assert provider_view.json()["unread_count"] == 1

    marked = client.post(f"/provider/jobs/{jid}/messages/read", headers=provider_h)
    assert marked.status_code == 200, marked.text
    assert marked.json()["read_count"] == 1
    assert client.get(f"/provider/jobs/{jid}/messages", headers=provider_h).json()["unread_count"] == 0

    reply = client.post(
        f"/provider/jobs/{jid}/messages",
        headers=provider_h,
        json={"channel": "operations", "body": "Proceed and document it."},
    )
    assert reply.status_code == 200, reply.text

    notifications = [
        n for n in getattr(app_store, "_notifications", [])
        if n.get("job_id") == jid and n.get("alert_class") == "message"
    ]
    assert notifications
    assert notifications[-1]["provider_status"] == "skipped_no_provider"
    assert notifications[-1]["payload"]["body"] == "Open ClueXP to view the secure job thread."

    tech_view = client.get(f"/jobs/{jid}/messages", headers=tech_h)
    assert tech_view.status_code == 200
    assert tech_view.json()["unread_count"] == 1
    tech_read = client.post(f"/jobs/{jid}/messages/read", headers=tech_h)
    assert tech_read.status_code == 200
    assert tech_read.json()["read_count"] == 1
    assert client.get(f"/jobs/{jid}/messages", headers=tech_h).json()["unread_count"] == 0


def test_customer_read_receipts_are_channel_scoped():
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()
    jid = _seed_job(tid, org)
    token = app_store._tokens[jid]

    client.post(
        f"/jobs/{jid}/messages",
        headers=tech_h,
        json={"channel": "customer", "template_code": "on_my_way"},
    )
    customer_view = client.get(f"/t/{token}/messages")
    assert customer_view.status_code == 200
    assert customer_view.json()["unread_count"] == 1

    read = client.post(f"/t/{token}/messages/read")
    assert read.status_code == 200
    assert read.json()["read_count"] == 1
    assert client.get(f"/t/{token}/messages").json()["unread_count"] == 0


def test_customer_help_request_round_trips_through_dispatch():
    """Product flow: tracking customer asks dispatch for help, dispatch reads it,
    replies with an approved customer template, and the customer sees that reply."""
    client = TestClient(app)
    org = str(uuid4())
    tid, _ = _register_tech()
    _, provider_h = _register_dispatcher(org)
    jid = _seed_job(tid, org)
    token = app_store._tokens[jid]

    requested = client.post(
        f"/t/{token}/messages",
        json={
            "channel": "customer",
            "template_code": "need_more_details",
            "client_message_id": "customer_help_request_123",
        },
    )
    assert requested.status_code == 200, requested.text
    assert requested.json()["message"]["sender_type"] == "customer"

    dispatch_thread = client.get(
        f"/provider/jobs/{jid}/messages?channel=customer", headers=provider_h)
    assert dispatch_thread.status_code == 200, dispatch_thread.text
    assert dispatch_thread.json()["unread_count"] == 1
    assert dispatch_thread.json()["messages"][-1]["template_code"] == "need_more_details"

    marked = client.post(
        f"/provider/jobs/{jid}/messages/read?channel=customer", headers=provider_h)
    assert marked.status_code == 200, marked.text
    assert marked.json()["read_count"] == 1

    replied = client.post(
        f"/provider/jobs/{jid}/messages",
        headers=provider_h,
        json={
            "channel": "customer",
            "template_code": "please_confirm",
            "client_message_id": "dispatch_help_reply_123",
        },
    )
    assert replied.status_code == 200, replied.text
    assert replied.json()["message"]["sender_type"] == "dispatcher"

    customer_thread = client.get(f"/t/{token}/messages")
    assert customer_thread.status_code == 200, customer_thread.text
    assert customer_thread.json()["unread_count"] == 1
    assert customer_thread.json()["messages"][-1]["template_code"] == "please_confirm"


def test_masked_call_sessions_are_scoped_and_honest_when_provider_missing():
    client = TestClient(app)
    org_a, org_b = str(uuid4()), str(uuid4())
    tid, tech_h = _register_tech()
    _, other_tech_h = _register_tech()
    _, provider_a_h = _register_dispatcher(org_a)
    _, provider_b_h = _register_dispatcher(org_b)
    jid = _seed_job(tid, org_a)
    token = app_store._tokens[jid]

    tech_call = client.post(f"/jobs/{jid}/calls/customer", headers=tech_h)
    assert tech_call.status_code == 200, tech_call.text
    assert tech_call.json()["available"] is False
    assert tech_call.json()["call"]["callee_type"] == "customer"
    assert tech_call.json()["call"]["masked_number"] is None
    assert tech_call.json()["call"]["provider_status"] == "skipped_no_provider"

    assert client.post(f"/jobs/{jid}/calls/customer", headers=other_tech_h).status_code == 404

    provider_call = client.post(f"/provider/jobs/{jid}/calls/technician", headers=provider_a_h)
    assert provider_call.status_code == 200, provider_call.text
    assert provider_call.json()["call"]["callee_type"] == "technician"
    assert client.post(f"/provider/jobs/{jid}/calls/technician", headers=provider_b_h).status_code == 404

    customer_call = client.post(f"/t/{token}/calls/technician")
    assert customer_call.status_code == 200, customer_call.text
    assert customer_call.json()["call"]["caller_type"] == "customer"

    assert client.post(f"/jobs/{jid}/calls/raw-phone", headers=tech_h).status_code == 404


def test_provider_communications_settings_are_admin_scoped():
    client = TestClient(app)
    org = str(uuid4())
    _, admin_h = _register_dispatcher(org, "provider_admin")
    _, dispatcher_h = _register_dispatcher(org, "dispatcher")

    payload = {
        "primary_forwarding_number": "+15551234501",
        "backup_forwarding_number": "+15551234502",
        "ring_timeout_seconds": 25,
        "voicemail_enabled": True,
        "sms_enabled": True,
        "masked_calling_enabled": True,
    }
    denied = client.patch("/provider/settings/communications", headers=dispatcher_h, json=payload)
    assert denied.status_code == 403

    ops_owned = client.patch("/provider/settings/communications", headers=admin_h, json={"twilio_number": "(555) 123-4500"})
    assert ops_owned.status_code == 403

    saved = client.patch("/provider/settings/communications", headers=admin_h, json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["settings"]["twilio_number"] is None
    assert client.get("/provider/settings/communications", headers=dispatcher_h).status_code == 403
    loaded = client.get("/provider/settings/communications", headers=admin_h)
    assert loaded.status_code == 200
    assert loaded.json()["settings"]["primary_forwarding_number"] == "+15551234501"


def test_valid_twilio_inbound_call_is_verified_routed_and_matched(monkeypatch):
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test-token")
    client = TestClient(app)
    org = str(uuid4())
    tid, _ = _register_tech()
    jid = _seed_job(tid, org)
    app_store._job_detail = getattr(app_store, "_job_detail", {})
    app_store._job_detail[jid] = {"customer_phone": "(555) 123-9999", "customer_name": "Pat Caller"}
    app_store._organizations[org] = {"id": org, "display_name": "Metro Test", "phone": "+15551230001"}
    app_store._organization_phone_settings = getattr(app_store, "_organization_phone_settings", {})
    app_store._organization_phone_settings[org] = {
        "organization_id": org,
        "twilio_number": "+15551230000",
        "primary_forwarding_number": "+15551230001",
        "backup_forwarding_number": "+15551230002",
        "ring_timeout_seconds": 18,
        "voicemail_enabled": True,
        "sms_enabled": False,
        "masked_calling_enabled": False,
        "a2p_registered": False,
    }
    params = {"CallSid": "CAinbound1", "From": "+15551239999", "To": "+15551230000", "CallStatus": "ringing"}
    url = "http://testserver/api/twilio/voice/incoming"
    response = client.post(
        "/api/twilio/voice/incoming",
        data=params,
        headers={"X-Twilio-Signature": _twilio_signature(url, params)},
    )
    assert response.status_code == 200, response.text
    assert "<Dial" in response.text
    assert "+15551230001" in response.text
    assert "+15551230002" in response.text
    calls = getattr(app_store, "_job_call_sessions", [])
    assert calls[-1]["provider_call_sid"] == "CAinbound1"
    assert calls[-1]["job_id"] == jid
    assert calls[-1]["metadata"]["matched_job"] is True


def test_invalid_twilio_signature_is_rejected_before_work(monkeypatch):
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test-token")
    before = len(getattr(app_store, "_job_call_sessions", []))
    client = TestClient(app)
    response = client.post(
        "/twilio/voice/incoming",
        data={"CallSid": "CAbad", "From": "+15551239999", "To": "+15551230000"},
        headers={"X-Twilio-Signature": "bad"},
    )
    assert response.status_code == 403
    assert len(getattr(app_store, "_job_call_sessions", [])) == before


def test_masked_call_uses_injected_twilio_provider_without_exposing_private_numbers(monkeypatch):
    client = TestClient(app)
    org = str(uuid4())
    tid, tech_h = _register_tech()
    jid = _seed_job(tid, org)
    app_store._job_detail = getattr(app_store, "_job_detail", {})
    app_store._job_detail[jid] = {"customer_phone": "+15551239999", "customer_name": "Pat Caller"}
    for tech in app_store._technicians:
        if tech["id"] == tid:
            tech["phone"] = "+15551238888"
    app_store._organizations[org] = {"id": org, "display_name": "Metro Test", "phone": "+15551230001"}
    app_store._organization_phone_settings = getattr(app_store, "_organization_phone_settings", {})
    app_store._organization_phone_settings[org] = {
        "organization_id": org,
        "twilio_number": "+15551230000",
        "primary_forwarding_number": "+15551230001",
        "ring_timeout_seconds": 20,
        "voicemail_enabled": True,
        "sms_enabled": False,
        "masked_calling_enabled": True,
        "a2p_registered": False,
    }

    class FakeProvider:
        def start_masked_call(self, **kwargs):
            assert kwargs["caller_number"] == "+15551238888"
            assert kwargs["callee_number"] == "+15551239999"
            from api.communications import VoiceStartResult
            return VoiceStartResult(True, "twilio", "CAoutbound1", "queued", "requested", kwargs["from_number"], "Masked call session started.", {})

        def send_sms(self, **kwargs):  # pragma: no cover
            raise AssertionError("not used")

    monkeypatch.setattr("api.main.get_communications_provider", lambda: FakeProvider())
    response = client.post(f"/jobs/{jid}/calls/customer", headers=tech_h)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["available"] is True
    assert body["call"]["provider"] == "twilio"
    assert body["call"]["masked_number"] == "+15551230000"
    assert "+15551239999" not in response.text
    assert "+15551238888" not in response.text


def test_provider_crm_can_start_masked_call_for_completed_service(monkeypatch):
    client = TestClient(app)
    org = str(uuid4())
    tid, _ = _register_tech()
    _, provider_h = _register_dispatcher(org, "provider_admin")
    jid = _seed_job(tid, org, STATUS_COMPLETED_CONFIRMED)
    app_store._job_detail = getattr(app_store, "_job_detail", {})
    app_store._job_detail[jid] = {"customer_phone": "+15551237777", "customer_name": "CRM Call Customer"}
    app_store._organizations[org] = {"id": org, "display_name": "Metro Test", "phone": "+15551230001"}
    app_store._organization_phone_settings = getattr(app_store, "_organization_phone_settings", {})
    app_store._organization_phone_settings[org] = {
        "organization_id": org,
        "twilio_number": "+15551230000",
        "primary_forwarding_number": "+15551230001",
        "ring_timeout_seconds": 20,
        "voicemail_enabled": True,
        "sms_enabled": False,
        "masked_calling_enabled": True,
        "a2p_registered": False,
    }

    class FakeProvider:
        def start_masked_call(self, **kwargs):
            assert kwargs["caller_number"] == "+15551230001"
            assert kwargs["callee_number"] == "+15551237777"
            from api.communications import VoiceStartResult
            return VoiceStartResult(True, "twilio", "CAcrmcompleted", "queued", "requested", kwargs["from_number"], "Masked call session started.", {})

        def send_sms(self, **kwargs):  # pragma: no cover
            raise AssertionError("not used")

    monkeypatch.setattr("api.main.get_communications_provider", lambda: FakeProvider())
    response = client.post(f"/provider/jobs/{jid}/calls/customer", headers=provider_h)
    assert response.status_code == 200, response.text
    assert response.json()["available"] is True
    assert response.json()["call"]["provider"] == "twilio"
    assert "+15551237777" not in response.text
    assert "+15551230001" not in response.text
    crm = client.get("/provider/crm/customers", headers=provider_h)
    assert crm.status_code == 200, crm.text
    assert next(row for row in crm.json() if row["phone"] == "+15551237777")["last_contacted_at"] is not None


def test_transactional_sms_is_idempotent_and_stop_blocks_future_sends(monkeypatch):
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test-token")
    client = TestClient(app)
    org = str(uuid4())
    tid, _ = _register_tech()
    _, provider_h = _register_dispatcher(org, "provider_admin")
    jid = _seed_job(tid, org)
    app_store._job_detail = getattr(app_store, "_job_detail", {})
    app_store._job_detail[jid] = {"customer_phone": "+15551239998", "customer_name": "Sms Customer"}
    app_store._organizations[org] = {"id": org, "display_name": "Metro Test", "phone": "+15551230001"}
    app_store._organization_phone_settings = getattr(app_store, "_organization_phone_settings", {})
    app_store._organization_phone_settings[org] = {
        "organization_id": org,
        "twilio_number": "+15551230000",
        "primary_forwarding_number": "+15551230001",
        "ring_timeout_seconds": 20,
        "voicemail_enabled": True,
        "sms_enabled": True,
        "masked_calling_enabled": False,
        "a2p_registered": True,
    }

    class FakeProvider:
        calls = 0

        def start_masked_call(self, **kwargs):  # pragma: no cover
            raise AssertionError("not used")

        def send_sms(self, **kwargs):
            FakeProvider.calls += 1
            from api.communications import SmsSendResult
            return SmsSendResult(True, "twilio", "SMsame", "queued")

    monkeypatch.setattr("api.main.get_communications_provider", lambda: FakeProvider())
    payload = {"job_id": jid, "purpose": "tracking_link_reminder", "recipient_type": "customer"}
    first = client.post("/provider/communications/sms", headers=provider_h, json=payload)
    retry = client.post("/provider/communications/sms", headers=provider_h, json=payload)
    assert first.status_code == 200, first.text
    assert retry.status_code == 200, retry.text
    assert first.json()["delivery"]["id"] == retry.json()["delivery"]["id"]
    assert FakeProvider.calls == 1

    crm_payload = {
        "job_id": jid,
        "purpose": "crm_service_follow_up",
        "recipient_type": "customer",
        "client_message_id": "crm-test-follow-up-1",
    }
    follow_up = client.post("/provider/communications/sms", headers=provider_h, json=crm_payload)
    follow_up_retry = client.post("/provider/communications/sms", headers=provider_h, json=crm_payload)
    assert follow_up.status_code == 200, follow_up.text
    assert follow_up.json()["sent"] is True
    assert follow_up.json()["delivery"]["id"] == follow_up_retry.json()["delivery"]["id"]
    assert FakeProvider.calls == 2
    crm = client.get("/provider/crm/customers", headers=provider_h)
    assert crm.status_code == 200, crm.text
    assert next(row for row in crm.json() if row["phone"] == "+15551239998")["last_contacted_at"] is not None

    params = {"SmsSid": "SMstop", "From": "+15551239998", "To": "+15551230000", "Body": "STOP"}
    url = "http://testserver/twilio/sms/incoming"
    stop = client.post("/twilio/sms/incoming", data=params, headers={"X-Twilio-Signature": _twilio_signature(url, params)})
    assert stop.status_code == 200
    blocked = client.post("/provider/communications/sms", headers=provider_h, json={**payload, "purpose": "technician_en_route"})
    assert blocked.status_code == 200
    assert blocked.json()["sent"] is False
    assert blocked.json()["delivery"]["metadata"]["reason"] == "recipient_opted_out"
    assert FakeProvider.calls == 2
