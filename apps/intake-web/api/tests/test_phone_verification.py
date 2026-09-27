from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from starlette.testclient import TestClient

from api.communications import SmsSendResult, get_platform_sms_provider
from api.main import app, store as app_store


@pytest.fixture(autouse=True)
def reset_verification_state():
    for name in ("_intake_phone_verifications", "_job_phone_verified", "_sms_opt_outs"):
        value = getattr(app_store, name, None)
        if hasattr(value, "clear"):
            value.clear()
    yield
    for name in ("_intake_phone_verifications", "_job_phone_verified", "_sms_opt_outs"):
        value = getattr(app_store, name, None)
        if hasattr(value, "clear"):
            value.clear()


class FakeSmsProvider:
    name = "twilio"

    def __init__(self) -> None:
        self.messages: list[dict] = []

    def send_sms(self, **kwargs):
        self.messages.append(kwargs)
        return SmsSendResult(
            sent=True,
            provider="twilio",
            provider_message_sid=f"SM{uuid4().hex}",
            provider_status="queued",
        )


def _enable_verification(monkeypatch, provider: FakeSmsProvider) -> None:
    monkeypatch.setattr("api.main.config.CLUEXP_VERIFICATION_SMS_ENABLED", True)
    monkeypatch.setattr("api.main.config.CLUEXP_A2P_REGISTERED", True)
    monkeypatch.setattr("api.main.config.CLUEXP_PHONE_VERIFICATION_REQUIRED", True)
    monkeypatch.setattr("api.main.config.CLUEXP_SMS_STATUS_WEBHOOK_ENABLED", False)
    monkeypatch.setattr("api.main.config.PHONE_VERIFICATION_RESEND_MAX", 3)
    monkeypatch.setattr("api.main.config.PHONE_VERIFICATION_PHONE_RESEND_MAX", 5)
    monkeypatch.setenv("CLUEXP_VERIFICATION_FROM_NUMBER", "+17275136040")
    monkeypatch.setattr("api.main.get_platform_sms_provider", lambda: provider)


def _channel(monkeypatch, *, slug: str = "metro-key") -> str:
    org_id = str(uuid4())

    async def resolve(value: str | None):
        if value != slug:
            return None
        return {
            "intake_channel_id": str(uuid4()),
            "origin_org_id": org_id,
            "customer_owner_org_id": org_id,
            "dispatch_cutover_enabled": True,
            "organization_name": "Metro Key Partners",
            "dispatch_phone": None,
        }

    monkeypatch.setattr(app_store, "resolve_intake_channel", resolve)
    return org_id


def _ticket_with_phone(client: TestClient, phone: str = "+15550140199") -> str:
    created = client.post(
        "/tickets", json={"intake_channel": "metro-key", "access_type": "vehicle"}
    )
    assert created.status_code == 200, created.text
    ticket_id = created.json()["ticket"]["ticket_id"]
    patched = client.patch(
        f"/tickets/{ticket_id}",
        json={
            "customer_name": "Verification Customer",
            "customer_phone": phone,
            "identity": {"claims_ownership": True, "authority_role": "owner"},
        },
    )
    assert patched.status_code == 200, patched.text
    return ticket_id


def _send_and_token(client: TestClient, ticket_id: str, provider: FakeSmsProvider) -> str:
    sent = client.post(
        f"/tickets/{ticket_id}/phone-verification",
        json={
            "consent_accepted": True,
            "consent_version": "transactional-verification-v1",
        },
    )
    assert sent.status_code == 200, sent.text
    assert sent.json() == {"sent": True, "verified": False, "expires_in": 900}
    assert "token" not in sent.text.lower()
    body = provider.messages[-1]["body"]
    match = re.search(r"/verify#([A-Za-z0-9_-]+)", body)
    assert match, body
    return match.group(1)


def test_phone_verification_safe_defaults_cannot_send(monkeypatch):
    _channel(monkeypatch)
    monkeypatch.setattr("api.main.config.CLUEXP_PHONE_VERIFICATION_REQUIRED", True)
    monkeypatch.setattr("api.main.config.CLUEXP_VERIFICATION_SMS_ENABLED", False)
    monkeypatch.setattr("api.main.config.CLUEXP_A2P_REGISTERED", False)
    client = TestClient(app)
    ticket_id = _ticket_with_phone(client)

    response = client.post(
        f"/tickets/{ticket_id}/phone-verification",
        json={
            "consent_accepted": True,
            "consent_version": "transactional-verification-v1",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Phone verification is not available"


def test_sms_enablement_does_not_implicitly_activate_status_webhook(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    client = TestClient(app)
    ticket_id = _ticket_with_phone(client, "+15550140188")

    _send_and_token(client, ticket_id, provider)

    assert provider.messages[-1]["status_callback_url"] is None


def test_send_requires_and_records_versioned_sms_consent(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    client = TestClient(app)
    ticket_id = _ticket_with_phone(client, "+15550140177")

    rejected = client.post(
        f"/tickets/{ticket_id}/phone-verification",
        json={"consent_accepted": False, "consent_version": "transactional-verification-v1"},
    )
    assert rejected.status_code == 422

    _send_and_token(client, ticket_id, provider)
    row = getattr(app_store, "_intake_phone_verifications")[-1]
    assert row["consent_version"] == "transactional-verification-v1"
    assert row["consented_at"] is not None


def test_platform_sms_selector_does_not_inherit_provider_communications(monkeypatch):
    monkeypatch.setenv("COMMUNICATIONS_PROVIDER", "twilio")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC-test")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test-token")
    monkeypatch.delenv("CLUEXP_SMS_PROVIDER", raising=False)

    assert get_platform_sms_provider().name is None


def test_verification_link_is_single_use_and_resumes_without_job_id(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    sender = TestClient(app)
    ticket_id = _ticket_with_phone(sender)
    token = _send_and_token(sender, ticket_id, provider)

    receiver = TestClient(app)
    consumed = receiver.post("/phone-verification/consume", json={"token": token})

    assert consumed.status_code == 200
    assert consumed.json()["redirect_path"] == "/o/metro-key?verified=1"
    assert ticket_id not in consumed.json()["redirect_path"]
    resumed = receiver.get("/tickets/resume")
    assert resumed.status_code == 200
    assert resumed.json()["ticket"]["ticket_id"] == ticket_id
    status = receiver.get(f"/tickets/{ticket_id}/phone-verification")
    assert status.status_code == 200
    assert status.json()["verified"] is True
    reused = receiver.post("/phone-verification/consume", json={"token": token})
    assert reused.status_code == 400


def test_resend_supersedes_previous_link_and_rate_limits(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    client = TestClient(app)
    ticket_id = _ticket_with_phone(client)
    first = _send_and_token(client, ticket_id, provider)
    second = _send_and_token(client, ticket_id, provider)
    third = _send_and_token(client, ticket_id, provider)

    assert client.post("/phone-verification/consume", json={"token": first}).status_code == 400
    assert client.post("/phone-verification/consume", json={"token": second}).status_code == 400
    limited = client.post(
        f"/tickets/{ticket_id}/phone-verification",
        json={
            "consent_accepted": True,
            "consent_version": "transactional-verification-v1",
        },
    )
    assert limited.status_code == 429
    assert client.post("/phone-verification/consume", json={"token": third}).status_code == 200


def test_cross_intake_phone_limit_cannot_be_bypassed(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    monkeypatch.setattr("api.main.config.PHONE_VERIFICATION_PHONE_RESEND_MAX", 1)
    _channel(monkeypatch)
    client = TestClient(app)
    phone = "+15550140666"
    first_ticket = _ticket_with_phone(client, phone)
    _send_and_token(client, first_ticket, provider)
    second_ticket = _ticket_with_phone(client, phone)

    limited = client.post(
        f"/tickets/{second_ticket}/phone-verification",
        json={
            "consent_accepted": True,
            "consent_version": "transactional-verification-v1",
        },
    )

    assert limited.status_code == 429
    assert len(provider.messages) == 1


def test_concurrent_success_activation_leaves_one_delivered_link_active(monkeypatch):
    _channel(monkeypatch)
    client = TestClient(app)
    ticket_id = _ticket_with_phone(client, "+15550140667")
    now = datetime.now(timezone.utc)

    async def reserve_and_activate() -> None:
        common = {
            "job_id": UUID(ticket_id),
            "phone_e164": "+15550140667",
            "intake_channel_slug": "metro-key",
            "expires_at": now + timedelta(minutes=15),
            "consent_version": "transactional-verification-v1",
            "since": now - timedelta(hours=1),
            "job_limit": 3,
            "phone_limit": 5,
        }
        assert await app_store.create_intake_phone_verification(
            **common, token_hash="a" * 64
        )
        assert await app_store.create_intake_phone_verification(
            **common, token_hash="b" * 64
        )
        await asyncio.gather(
            app_store.supersede_other_intake_phone_verifications(
                job_id=UUID(ticket_id), keep_token_hash="a" * 64
            ),
            app_store.supersede_other_intake_phone_verifications(
                job_id=UUID(ticket_id), keep_token_hash="b" * 64
            ),
        )

    asyncio.run(reserve_and_activate())
    rows = [
        row for row in getattr(app_store, "_intake_phone_verifications")
        if row["job_id"] == ticket_id
    ]
    active_delivered = [
        row for row in rows
        if row.get("send_succeeded_at") and not row.get("superseded_at")
    ]
    assert len(active_delivered) == 1


def test_failed_resend_does_not_invalidate_last_delivered_link(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    client = TestClient(app)
    ticket_id = _ticket_with_phone(client, "+15550140555")
    delivered = _send_and_token(client, ticket_id, provider)

    def fail_send(**kwargs):
        provider.messages.append(kwargs)
        return SmsSendResult(
            sent=False,
            provider="twilio",
            provider_message_sid=None,
            provider_status="failed",
            error_code="test_failure",
        )

    monkeypatch.setattr(provider, "send_sms", fail_send)
    failed = client.post(
        f"/tickets/{ticket_id}/phone-verification",
        json={
            "consent_accepted": True,
            "consent_version": "transactional-verification-v1",
        },
    )
    assert failed.status_code == 503
    assert client.post("/phone-verification/consume", json={"token": delivered}).status_code == 200


def test_opted_out_phone_cannot_receive_verification(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    client = TestClient(app)
    phone = "+15550140444"
    ticket_id = _ticket_with_phone(client, phone)
    app_store._sms_opt_outs = getattr(app_store, "_sms_opt_outs", {})
    app_store._sms_opt_outs[phone] = {"phone_e164": phone}

    response = client.post(
        f"/tickets/{ticket_id}/phone-verification",
        json={
            "consent_accepted": True,
            "consent_version": "transactional-verification-v1",
        },
    )

    assert response.status_code == 409
    assert provider.messages == []


def test_expired_link_and_changed_phone_fail_closed(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    client = TestClient(app)
    ticket_id = _ticket_with_phone(client)
    token = _send_and_token(client, ticket_id, provider)
    rows = getattr(app_store, "_intake_phone_verifications")
    rows[-1]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert client.post("/phone-verification/consume", json={"token": token}).status_code == 400

    fresh = _send_and_token(client, ticket_id, provider)
    assert client.post("/phone-verification/consume", json={"token": fresh}).status_code == 200
    changed = client.patch(
        f"/tickets/{ticket_id}", json={"customer_phone": "+15550140200"}
    )
    assert changed.status_code == 200
    status = client.get(f"/tickets/{ticket_id}/phone-verification")
    assert status.json()["verified"] is False


def test_link_for_previous_phone_cannot_restore_intake_access(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    sender = TestClient(app)
    ticket_id = _ticket_with_phone(sender, "+15550140777")
    stale_token = _send_and_token(sender, ticket_id, provider)
    changed = sender.patch(
        f"/tickets/{ticket_id}", json={"customer_phone": "+15550140778"}
    )
    assert changed.status_code == 200

    unintended_recipient = TestClient(app)
    rejected = unintended_recipient.post(
        "/phone-verification/consume", json={"token": stale_token}
    )

    assert rejected.status_code == 400
    assert unintended_recipient.get("/tickets/resume").status_code == 404


def test_required_verification_defers_dispatch_until_verified_commit(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    client = TestClient(app)
    ticket_id = _ticket_with_phone(client)
    assert getattr(app_store, "_job_status", {}).get(ticket_id) != "pending_dispatch"

    quote = client.post(f"/tickets/{ticket_id}/price-quote")
    assert quote.status_code == 200
    accepted = client.patch(
        f"/tickets/{ticket_id}",
        json={
            "price_quote": {"accepted_by_customer": True},
            "cancellation_policy": {"accepted_by_customer": True},
        },
    )
    assert accepted.status_code == 200, accepted.text
    blocked = client.post(f"/tickets/{ticket_id}/commit")
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "Phone verification required"

    token = _send_and_token(client, ticket_id, provider)
    assert client.post("/phone-verification/consume", json={"token": token}).status_code == 200
    committed = client.post(f"/tickets/{ticket_id}/commit")
    assert committed.status_code == 200, committed.text
    assert getattr(app_store, "_job_status", {}).get(ticket_id) == "pending_dispatch"


def test_commit_conflict_does_not_duplicate_dispatch_alert(monkeypatch):
    provider = FakeSmsProvider()
    _enable_verification(monkeypatch, provider)
    _channel(monkeypatch)
    client = TestClient(app)
    ticket_id = _ticket_with_phone(client, "+15550140888")
    quote = client.post(f"/tickets/{ticket_id}/price-quote")
    assert quote.status_code == 200
    accepted = client.patch(
        f"/tickets/{ticket_id}",
        json={
            "price_quote": {"accepted_by_customer": True},
            "cancellation_policy": {"accepted_by_customer": True},
        },
    )
    assert accepted.status_code == 200
    token = _send_and_token(client, ticket_id, provider)
    assert client.post("/phone-verification/consume", json={"token": token}).status_code == 200

    async def lose_transition(*args, **kwargs):
        return None

    alerts: list[dict] = []

    async def record_alert(*args, **kwargs):
        alerts.append(kwargs)

    monkeypatch.setattr(app_store, "set_job_status", lose_transition)
    monkeypatch.setattr("api.main._create_alert_best_effort", record_alert)

    committed = client.post(f"/tickets/{ticket_id}/commit")

    assert committed.status_code == 200
    assert alerts == []
