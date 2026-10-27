from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from api import config
from api import main as api_main
from api.auth import create_access_token
from api.billing import StripeBillingGateway, entitlement_summary, normalize_event
from api.main import app
from api.store import InMemoryStore
from starlette.testclient import TestClient


def test_billing_is_disabled_by_default() -> None:
    assert config.PROVIDER_BILLING_ENABLED is False
    assert config.PROVIDER_BILLING_ENFORCEMENT_ENABLED is False
    summary = entitlement_summary({"subscription_status": "none"})
    assert summary["state"] == "disabled"
    assert summary["can_receive_new_business"] is True


def test_disabled_billing_status_is_provider_scoped() -> None:
    client = TestClient(app)
    provider = create_access_token({"sub": "usr_provider_demo"})
    technician = create_access_token({"sub": "usr_tech_demo"})
    response = client.get(
        "/provider/billing", headers={"Authorization": f"Bearer {provider}"}
    )
    assert response.status_code == 200
    assert response.json()["state"] == "disabled"
    forbidden = client.get(
        "/provider/billing", headers={"Authorization": f"Bearer {technician}"}
    )
    assert forbidden.status_code == 403


def test_past_due_is_entitled_only_during_grace(monkeypatch) -> None:
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENABLED", True)
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENFORCEMENT_ENABLED", True)
    now = datetime(2026, 10, 26, tzinfo=timezone.utc)
    during = entitlement_summary(
        {"subscription_status": "past_due", "subscription_grace_ends_at": now + timedelta(days=1)},
        now=now,
    )
    expired = entitlement_summary(
        {"subscription_status": "past_due", "subscription_grace_ends_at": now},
        now=now,
    )
    assert during["state"] == "grace"
    assert during["can_receive_new_business"] is True
    assert expired["state"] == "blocked"
    assert expired["can_receive_new_business"] is False


def test_new_business_guard_fails_closed_for_blocked_org(monkeypatch) -> None:
    organization_id = str(uuid4())

    class Store:
        async def get_organization_billing(self, requested_id):
            assert requested_id == organization_id
            return {"subscription_status": "unpaid"}

    monkeypatch.setattr(config, "PROVIDER_BILLING_ENABLED", True)
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENFORCEMENT_ENABLED", True)
    monkeypatch.setattr(api_main, "store", Store())
    with pytest.raises(Exception) as caught:
        asyncio.run(api_main.require_provider_new_business({
            "roles": ["provider_admin"], "active_organization_id": organization_id
        }))
    assert getattr(caught.value, "status_code", None) == 402


def test_new_business_guard_is_noop_when_enforcement_is_off(monkeypatch) -> None:
    class Store:
        async def get_organization_billing(self, _requested_id):
            raise AssertionError("disabled enforcement must not query migrated billing columns")

    monkeypatch.setattr(config, "PROVIDER_BILLING_ENABLED", False)
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENFORCEMENT_ENABLED", True)
    monkeypatch.setattr(api_main, "store", Store())
    asyncio.run(api_main.require_provider_new_business({}))


def test_subscription_event_is_only_a_reconciliation_trigger() -> None:
    normalized = normalize_event({
        "id": "evt_1",
        "type": "customer.subscription.updated",
        "created": 100,
        "data": {"object": {
            "id": "sub_1", "customer": "cus_1", "status": "active",
            "cancel_at_period_end": False,
            "items": {"data": [{"current_period_end": 200}, {"current_period_end": 300}]},
        }},
    })
    assert normalized is not None
    assert normalized["current_period_end"] is None
    assert normalized["subscription_ref"] == "sub_1"


def test_reconciliation_selects_current_matching_price_and_mode(monkeypatch) -> None:
    monkeypatch.setattr(config, "STRIPE_PROVIDER_PRICE_ID", "price_target")
    monkeypatch.setattr(config, "STRIPE_BILLING_API_KEY", "rk_test_example")
    old = SimpleNamespace(
        id="sub_old", status="canceled", created=100, livemode=False,
        cancel_at_period_end=False,
        items=SimpleNamespace(data=[SimpleNamespace(
            price=SimpleNamespace(id="price_target"), current_period_end=200
        )]),
    )
    current = SimpleNamespace(
        id="sub_current", status="active", created=200, livemode=False,
        cancel_at_period_end=True,
        items=SimpleNamespace(data=[SimpleNamespace(
            price=SimpleNamespace(id="price_target"), current_period_end=400
        )]),
    )

    class Subscriptions:
        async def list_async(self, _params):
            return SimpleNamespace(data=[old, current])

    gateway = object.__new__(StripeBillingGateway)
    gateway.client = SimpleNamespace(v1=SimpleNamespace(subscriptions=Subscriptions()))
    result = asyncio.run(gateway.current_subscription("cus_1", {"event_id": "evt_1"}))
    assert result is not None
    assert result["subscription_ref"] == "sub_current"
    assert result["subscription_status"] == "active"
    assert result["current_period_end"] == 400


def test_checkout_validates_price_and_does_not_repeat_trial(monkeypatch) -> None:
    monkeypatch.setattr(config, "STRIPE_PROVIDER_PRICE_ID", "price_target")
    monkeypatch.setattr(config, "STRIPE_BILLING_API_KEY", "rk_test_example")
    monkeypatch.setattr(config, "CLUEXP_PROVIDER_BASE_URL", "https://partners.example")
    calls = []

    class Prices:
        async def retrieve_async(self, _price_id):
            return SimpleNamespace(
                unit_amount=41_900, currency="usd", active=True,
                tax_behavior="exclusive", livemode=False,
                recurring=SimpleNamespace(interval="month"),
            )

    class CheckoutSessions:
        async def create_async(self, params, options=None):
            calls.append((params, options))
            return SimpleNamespace(url="https://checkout.stripe.test/session")

    gateway = object.__new__(StripeBillingGateway)
    gateway.client = SimpleNamespace(v1=SimpleNamespace(
        prices=Prices(), checkout=SimpleNamespace(sessions=CheckoutSessions())
    ))
    first = asyncio.run(gateway.create_checkout(
        "org_1", "cus_1", previous_subscription_ref=None
    ))
    returning = asyncio.run(gateway.create_checkout(
        "org_1", "cus_1", previous_subscription_ref="sub_old"
    ))
    assert first == returning == "https://checkout.stripe.test/session"
    assert calls[0][0]["subscription_data"]["trial_period_days"] == 30
    assert "trial_period_days" not in calls[1][0]["subscription_data"]
    assert calls[0][1]["idempotency_key"].endswith("-first")
    assert calls[1][1]["idempotency_key"].endswith("-sub_old")


def test_webhook_application_is_idempotent_and_preserves_latest_event_time() -> None:
    store = InMemoryStore()
    asyncio.run(store.set_organization_billing_customer("org-metro", "cus_1"))
    active = {
        "event_id": "evt_active", "event_type": "customer.subscription.updated",
        "created": 200, "customer_ref": "cus_1", "subscription_ref": "sub_1",
        "subscription_status": "active", "current_period_end": 500,
        "cancel_at_period_end": False,
    }
    older_trigger_same_current_state = {
        **active, "event_id": "evt_stale", "created": 100,
    }
    assert asyncio.run(store.apply_stripe_billing_event(active)) == "applied"
    assert asyncio.run(store.apply_stripe_billing_event(active)) == "duplicate"
    assert asyncio.run(store.apply_stripe_billing_event(older_trigger_same_current_state)) == "applied"
    record = asyncio.run(store.get_organization_billing("org-metro"))
    assert record is not None
    assert record["subscription_status"] == "active"
    assert record["subscription_grace_ends_at"] is None
    assert datetime.fromisoformat(record["subscription_event_created_at"]) == datetime.fromtimestamp(200, timezone.utc)


def test_payment_failure_starts_seven_day_grace() -> None:
    store = InMemoryStore()
    asyncio.run(store.set_organization_billing_customer("org-metro", "cus_1"))
    event = {
        "event_id": "evt_failed", "event_type": "invoice.payment_failed",
        "created": 1_800_000_000, "customer_ref": "cus_1",
        "subscription_ref": "sub_1", "subscription_status": "past_due",
        "current_period_end": None, "cancel_at_period_end": None,
    }
    assert asyncio.run(store.apply_stripe_billing_event(event)) == "applied"
    record = asyncio.run(store.get_organization_billing("org-metro"))
    assert record is not None
    expected = datetime.fromtimestamp(event["created"], timezone.utc) + timedelta(days=7)
    assert datetime.fromisoformat(record["subscription_grace_ends_at"]) == expected
