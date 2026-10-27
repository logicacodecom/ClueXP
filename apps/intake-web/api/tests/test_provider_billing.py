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
    repeated = asyncio.run(gateway.create_checkout(
        "org_1", "cus_1", previous_subscription_ref=None
    ))
    returning = asyncio.run(gateway.create_checkout(
        "org_1", "cus_1", previous_subscription_ref="sub_old"
    ))
    assert first == repeated == returning == "https://checkout.stripe.test/session"
    assert calls[0][0]["subscription_data"]["trial_period_days"] == 30
    assert calls[0] == calls[1]
    assert "integration_identifier" not in calls[0][0]
    assert "trial_period_days" not in calls[2][0]["subscription_data"]
    assert calls[0][1]["idempotency_key"].endswith("-first")
    assert calls[2][1]["idempotency_key"].endswith("-sub_old")


def test_checkout_and_portal_require_provider_admin() -> None:
    async def dispatcher_session():
        return {
            "user": {"id": "dispatcher-1"},
            "roles": ["dispatcher"],
            "active_organization_id": "org-metro",
            "organization_status": "active",
        }

    app.dependency_overrides[api_main.require_session] = dispatcher_session
    try:
        client = TestClient(app)
        assert client.post("/provider/billing/checkout-session").status_code == 403
        assert client.post("/provider/billing/portal-session").status_code == 403
    finally:
        app.dependency_overrides.pop(api_main.require_session, None)


def test_webhook_route_rejects_missing_and_invalid_signatures(monkeypatch) -> None:
    client = TestClient(app)
    assert client.post("/webhooks/stripe", content=b"{}").status_code == 400

    monkeypatch.setattr(config, "STRIPE_BILLING_WEBHOOK_SECRET", "whsec_test")
    invalid = client.post(
        "/webhooks/stripe",
        content=b"{}",
        headers={"Stripe-Signature": "invalid"},
    )
    assert invalid.status_code == 400
    assert invalid.json()["detail"] == "Invalid Stripe webhook"


def test_webhook_route_reports_unconfigured_and_ignores_other_events(monkeypatch) -> None:
    client = TestClient(app)
    monkeypatch.setattr(config, "STRIPE_BILLING_WEBHOOK_SECRET", "")
    unconfigured = client.post(
        "/webhooks/stripe", content=b"{}", headers={"Stripe-Signature": "sig"}
    )
    assert unconfigured.status_code == 503

    monkeypatch.setattr(
        api_main,
        "verify_webhook",
        lambda _payload, _signature: {
            "id": "evt_other", "type": "customer.created", "data": {"object": {}}
        },
    )
    ignored = client.post(
        "/webhooks/stripe", content=b"{}", headers={"Stripe-Signature": "sig"}
    )
    assert ignored.status_code == 200
    assert ignored.json()["outcome"] == "ignored_event_type"


def test_webhook_customer_mapping_is_server_authoritative(monkeypatch) -> None:
    webhook_event = {
        "id": "evt_subscription",
        "type": "customer.subscription.updated",
        "created": 200,
        "data": {"object": {"id": "sub_1", "customer": "cus_unknown"}},
    }

    class Gateway:
        def __init__(self, *, webhook_sync=False):
            assert webhook_sync is True

        async def current_subscription(self, customer_id, event):
            return {
                **event,
                "customer_ref": customer_id,
                "subscription_ref": "sub_1",
                "subscription_status": "active",
                "current_period_end": 300,
                "cancel_at_period_end": False,
            }

    test_store = InMemoryStore()
    monkeypatch.setattr(api_main, "store", test_store)
    monkeypatch.setattr(api_main, "StripeBillingGateway", Gateway)
    monkeypatch.setattr(api_main, "verify_webhook", lambda *_args: webhook_event)
    response = TestClient(app).post(
        "/webhooks/stripe", content=b"{}", headers={"Stripe-Signature": "sig"}
    )
    assert response.status_code == 200
    assert response.json()["outcome"] == "ignored_unknown_customer"
    assert asyncio.run(test_store.get_organization_billing("org-metro"))["subscription_status"] == "none"


def test_webhook_route_reconciles_known_customer(monkeypatch) -> None:
    webhook_event = {
        "id": "evt_known",
        "type": "customer.subscription.updated",
        "created": 200,
        "data": {"object": {"id": "sub_1", "customer": "cus_known"}},
    }

    class Gateway:
        def __init__(self, *, webhook_sync=False):
            assert webhook_sync is True

        async def current_subscription(self, customer_id, event):
            assert customer_id == "cus_known"
            assert event["reconciliation_generation"] == 1
            return {
                **event,
                "subscription_ref": "sub_1",
                "subscription_status": "active",
                "current_period_end": 300,
                "cancel_at_period_end": False,
            }

    test_store = InMemoryStore()
    asyncio.run(test_store.set_organization_billing_customer("org-metro", "cus_known"))
    monkeypatch.setattr(api_main, "store", test_store)
    monkeypatch.setattr(api_main, "StripeBillingGateway", Gateway)
    monkeypatch.setattr(api_main, "verify_webhook", lambda *_args: webhook_event)
    response = TestClient(app).post(
        "/webhooks/stripe", content=b"{}", headers={"Stripe-Signature": "sig"}
    )
    assert response.status_code == 200
    assert response.json()["outcome"] == "applied"
    assert asyncio.run(test_store.get_organization_billing("org-metro"))["subscription_status"] == "active"


def test_checkout_maps_stripe_failures_to_safe_upstream_error(monkeypatch) -> None:
    from stripe import APIConnectionError

    organization_id = str(uuid4())
    test_store = InMemoryStore()
    test_store._organizations[organization_id] = {
        "id": organization_id,
        "display_name": "Provider",
        "status": "active",
        "billing_customer_ref": "cus_known",
        "stripe_subscription_ref": None,
        "subscription_status": "none",
    }

    class Gateway:
        def __init__(self):
            pass

        async def create_checkout(self, *_args, **_kwargs):
            raise APIConnectionError("provider detail must not leak")

    async def admin_session():
        return {
            "user": {"id": "admin-1"},
            "roles": ["provider_admin"],
            "active_organization_id": organization_id,
            "organization_status": "active",
        }

    monkeypatch.setattr(api_main, "store", test_store)
    monkeypatch.setattr(api_main, "StripeBillingGateway", Gateway)
    app.dependency_overrides[api_main.require_session] = admin_session
    try:
        response = TestClient(app).post("/provider/billing/checkout-session")
    finally:
        app.dependency_overrides.pop(api_main.require_session, None)
    assert response.status_code == 502
    assert response.json()["detail"] == "Stripe billing is temporarily unavailable"
    assert "provider detail" not in response.text


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


def test_older_concurrent_reconciliation_cannot_overwrite_newer_state() -> None:
    store = InMemoryStore()
    asyncio.run(store.set_organization_billing_customer("org-metro", "cus_1"))
    older_generation = asyncio.run(
        store.begin_stripe_billing_reconciliation("cus_1")
    )
    newer_generation = asyncio.run(
        store.begin_stripe_billing_reconciliation("cus_1")
    )
    assert older_generation is not None and newer_generation is not None
    canceled = {
        "event_id": "evt_newer", "event_type": "customer.subscription.deleted",
        "created": 201, "customer_ref": "cus_1", "subscription_ref": "sub_1",
        "subscription_status": "canceled", "current_period_end": 500,
        "cancel_at_period_end": False,
        "reconciliation_generation": newer_generation,
    }
    stale_active = {
        **canceled,
        "event_id": "evt_older",
        "created": 200,
        "subscription_status": "active",
        "reconciliation_generation": older_generation,
    }
    assert asyncio.run(store.apply_stripe_billing_event(canceled)) == "applied"
    assert asyncio.run(store.apply_stripe_billing_event(stale_active)) == "superseded"
    record = asyncio.run(store.get_organization_billing("org-metro"))
    assert record is not None
    assert record["subscription_status"] == "canceled"


def test_blocked_provider_new_business_routes_and_wind_down(monkeypatch) -> None:
    organization_id = str(uuid4())
    other_organization_id = str(uuid4())
    test_store = InMemoryStore()
    test_store._organizations[organization_id] = {
        "id": organization_id,
        "display_name": "Blocked Provider",
        "status": "active",
        "subscription_status": "unpaid",
        "subscription_grace_ends_at": None,
    }

    async def provider_session():
        return {
            "user": {"id": "provider-admin"},
            "roles": ["provider_admin", "dispatcher"],
            "active_organization_id": organization_id,
            "organization_status": "active",
            "organization_name": "Blocked Provider",
        }

    async def no_latency():
        return None

    monkeypatch.setattr(config, "PROVIDER_BILLING_ENABLED", True)
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENFORCEMENT_ENABLED", True)
    monkeypatch.setattr(api_main, "store", test_store)
    monkeypatch.setattr(api_main, "latency", no_latency)
    app.dependency_overrides[api_main.require_session] = provider_session
    try:
        client = TestClient(app)
        blocked = [
            client.post("/provider/requests", json={"address": "123 Main St"}),
            client.post("/provider/intake-channel"),
            client.post(
                "/provider/partners", json={"partner_org_id": other_organization_id}
            ),
            client.post(f"/provider/partners/{other_organization_id}/accept"),
            client.post(f"/provider/queue/{uuid4()}/partner-accept"),
        ]
        assert [response.status_code for response in blocked] == [402] * len(blocked)

        # Assignment is an in-progress wind-down action and must remain reachable.
        wind_down = client.post(
            f"/provider/queue/{uuid4()}/assign",
            json={"technician_id": str(uuid4())},
        )
        assert wind_down.status_code == 404
    finally:
        app.dependency_overrides.pop(api_main.require_session, None)


def test_blocked_branded_intake_is_generic_and_creates_nothing(monkeypatch) -> None:
    organization_id = str(uuid4())
    test_store = InMemoryStore()
    test_store._organizations[organization_id] = {
        "id": organization_id,
        "display_name": "Blocked Provider",
        "status": "active",
        "subscription_status": "unpaid",
        "subscription_grace_ends_at": None,
    }

    async def resolve_channel(_slug):
        return {
            "origin_org_id": organization_id,
            "customer_owner_org_id": organization_id,
            "dispatch_cutover_enabled": True,
        }

    async def no_latency():
        return None

    monkeypatch.setattr(config, "PROVIDER_BILLING_ENABLED", True)
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENFORCEMENT_ENABLED", True)
    monkeypatch.setattr(api_main, "store", test_store)
    monkeypatch.setattr(api_main, "latency", no_latency)
    monkeypatch.setattr(test_store, "resolve_intake_channel", resolve_channel)
    response = TestClient(app).post(
        "/tickets", json={"intake_channel": "blocked-provider"}
    )
    assert response.status_code == 503
    assert "billing" not in response.text.lower()
    assert test_store._tickets == {}


def test_private_partner_block_happens_before_idempotency_reservation(monkeypatch) -> None:
    organization_id = str(uuid4())
    test_store = InMemoryStore()
    test_store._organizations[organization_id] = {
        "id": organization_id,
        "display_name": "Blocked Partner",
        "status": "active",
        "subscription_status": "unpaid",
        "subscription_grace_ends_at": None,
    }
    external = asyncio.run(test_store.create_external_client(
        name="Blocked partner client",
        client_type="partner",
        scopes=["service_requests:write"],
        rate_limit_per_minute=60,
        organization_id=organization_id,
    ))
    api_key = asyncio.run(test_store.issue_external_api_key(
        external["id"], scopes=["service_requests:write"]
    ))["api_key"]
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENABLED", True)
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENFORCEMENT_ENABLED", True)
    monkeypatch.setattr(api_main, "store", test_store)
    response = TestClient(app).post(
        "/v1/service-requests",
        headers={"X-API-Key": api_key, "Idempotency-Key": "blocked-request"},
        json={
            "dispatch_scope": "private_partner",
            "service_skill": "locksmith.residential_lockout",
            "location": {"lat": 40.0, "lng": -73.0, "raw_text": "123 Main St"},
            "consent": {"terms_accepted": True, "policy_version": "2026-08-01"},
        },
    )
    assert response.status_code == 402
    assert response.json()["error"] == "provider_subscription_required"
    assert test_store._external_api_idempotency == {}


def test_network_snapshot_excludes_blocked_organizations(monkeypatch) -> None:
    class Store:
        async def list_available_technicians(self):
            return [{"id": "tech-1", "org_ids": ["org-blocked"]}]

        async def get_organizations_status(self, _organization_ids):
            return {"org-blocked": "active"}

        async def get_organizations_billing(self, _organization_ids):
            return {"org-blocked": {"subscription_status": "unpaid"}}

        async def list_organization_capabilities(self, _organization_id):
            raise AssertionError("blocked organizations must not load routing capabilities")

    monkeypatch.setattr(config, "PROVIDER_BILLING_ENABLED", True)
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENFORCEMENT_ENABLED", True)
    monkeypatch.setattr(api_main, "store", Store())
    _, statuses, capabilities = asyncio.run(api_main._network_eligibility_snapshot())
    assert statuses == {"org-blocked": "subscription_blocked"}
    assert capabilities == {}


def test_existing_job_availability_ignores_later_billing_block(monkeypatch) -> None:
    class Store:
        async def list_available_technicians(self):
            return [{"id": "tech-1", "org_ids": ["org-blocked"]}]

        async def get_organizations_status(self, _organization_ids):
            return {"org-blocked": "active"}

        async def get_organizations_billing(self, _organization_ids):
            raise AssertionError("existing-job wind-down must not consult billing")

        async def list_organization_capabilities(self, _organization_id):
            return ["locksmith.residential_lockout"]

    monkeypatch.setattr(config, "PROVIDER_BILLING_ENABLED", True)
    monkeypatch.setattr(config, "PROVIDER_BILLING_ENFORCEMENT_ENABLED", True)
    monkeypatch.setattr(api_main, "store", Store())
    _, statuses, capabilities = asyncio.run(
        api_main._network_eligibility_snapshot(enforce_billing=False)
    )
    assert statuses == {"org-blocked": "active"}
    assert capabilities == {"org-blocked": {"locksmith.residential_lockout"}}
