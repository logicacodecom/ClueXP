"""Stripe-hosted provider billing and server-authoritative entitlements."""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone
from typing import Any

from api import config

ENTITLED_STATUSES = {"active", "trialing"}
TERMINAL_STATUSES = {"none", "canceled", "incomplete_expired"}


class BillingConfigurationError(RuntimeError):
    pass


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def _datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(
        str(value).replace("Z", "+00:00")
    )
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def entitlement_summary(
    record: dict[str, Any] | None, *, now: datetime | None = None
) -> dict[str, Any]:
    record = record or {}
    status = str(record.get("subscription_status") or "none").lower()
    grace_end = _datetime(record.get("subscription_grace_ends_at"))
    current = now or datetime.now(timezone.utc)
    entitled = status in ENTITLED_STATUSES
    in_grace = status == "past_due" and grace_end is not None and grace_end > current
    if not config.PROVIDER_BILLING_ENABLED:
        state = "disabled"
    elif entitled:
        state = "entitled"
    elif in_grace:
        state = "grace"
    else:
        state = "blocked"
    enforcement_enabled = (
        config.PROVIDER_BILLING_ENABLED
        and config.PROVIDER_BILLING_ENFORCEMENT_ENABLED
    )
    return {
        "state": state,
        "subscription_status": status,
        "can_receive_new_business": not enforcement_enabled or entitled or in_grace,
        "current_period_end": _iso(record.get("subscription_current_period_end")),
        "grace_ends_at": _iso(record.get("subscription_grace_ends_at")),
        "cancel_at_period_end": bool(record.get("subscription_cancel_at_period_end")),
        "billing_enabled": config.PROVIDER_BILLING_ENABLED,
        "enforcement_enabled": enforcement_enabled,
    }


def _require_settings(*, webhook: bool = False, allow_disabled: bool = False) -> None:
    required = {
        "STRIPE_BILLING_API_KEY": config.STRIPE_BILLING_API_KEY,
        "STRIPE_PROVIDER_PRICE_ID": config.STRIPE_PROVIDER_PRICE_ID,
    }
    if webhook:
        required = {
            "STRIPE_BILLING_WEBHOOK_SECRET": config.STRIPE_BILLING_WEBHOOK_SECRET
        }
    missing = [name for name, value in required.items() if not value]
    if (not webhook and not allow_disabled and not config.PROVIDER_BILLING_ENABLED) or missing:
        detail = ", ".join(missing) if missing else "PROVIDER_BILLING_ENABLED"
        raise BillingConfigurationError(f"Provider billing is not configured: {detail}")


class StripeBillingGateway:
    def __init__(self, *, webhook_sync: bool = False) -> None:
        _require_settings(allow_disabled=webhook_sync)
        from stripe import StripeClient

        self.client = StripeClient(config.STRIPE_BILLING_API_KEY, max_network_retries=2)

    async def create_customer(self, organization_id: str, name: str) -> str:
        customer = await self.client.v1.customers.create_async(
            {"name": name, "metadata": {"cluexp_organization_id": organization_id}},
            options={"idempotency_key": f"cluexp-provider-customer-{organization_id}"},
        )
        return customer.id

    async def verify_price(self) -> None:
        price = await self.client.v1.prices.retrieve_async(config.STRIPE_PROVIDER_PRICE_ID)
        recurring = getattr(price, "recurring", None) or {}
        interval = getattr(recurring, "interval", None) or recurring.get("interval")
        checks = {
            "amount": getattr(price, "unit_amount", None) == 41_900,
            "currency": getattr(price, "currency", "").lower() == "usd",
            "interval": interval == "month",
            "active": bool(getattr(price, "active", False)),
            "tax_behavior": getattr(price, "tax_behavior", None) == "exclusive",
            "mode": bool(getattr(price, "livemode", False))
            == ("_live_" in config.STRIPE_BILLING_API_KEY),
        }
        if not all(checks.values()):
            failed = ", ".join(name for name, valid in checks.items() if not valid)
            raise BillingConfigurationError(f"Configured Stripe Price failed validation: {failed}")

    async def create_checkout(
        self,
        organization_id: str,
        customer_id: str,
        *,
        previous_subscription_ref: str | None,
    ) -> str:
        await self.verify_price()
        suffix = "".join(secrets.choice(string.ascii_lowercase) for _ in range(8))
        subscription_data: dict[str, Any] = {
            "metadata": {"cluexp_organization_id": organization_id}
        }
        if not previous_subscription_ref:
            subscription_data["trial_period_days"] = config.PROVIDER_BILLING_TRIAL_DAYS
        session = await self.client.v1.checkout.sessions.create_async(
            {
                "mode": "subscription",
                "customer": customer_id,
                "client_reference_id": organization_id,
                "line_items": [{"price": config.STRIPE_PROVIDER_PRICE_ID, "quantity": 1}],
                "subscription_data": subscription_data,
                "payment_method_collection": "always",
                "success_url": (
                    f"{config.CLUEXP_PROVIDER_BASE_URL}/billing?checkout=success"
                    "&session_id={CHECKOUT_SESSION_ID}"
                ),
                "cancel_url": f"{config.CLUEXP_PROVIDER_BASE_URL}/billing?checkout=cancelled",
                "integration_identifier": f"cluexp_provider_{suffix}",
            },
            options={
                "idempotency_key": (
                    f"cluexp-provider-checkout-{organization_id}-"
                    f"{previous_subscription_ref or 'first'}"
                )
            },
        )
        return session.url

    async def create_portal(self, customer_id: str) -> str:
        params = {
            "customer": customer_id,
            "return_url": f"{config.CLUEXP_PROVIDER_BASE_URL}/billing",
        }
        if config.STRIPE_PORTAL_CONFIGURATION_ID:
            params["configuration"] = config.STRIPE_PORTAL_CONFIGURATION_ID
        session = await self.client.v1.billing_portal.sessions.create_async(params)
        return session.url

    async def current_subscription(
        self, customer_id: str, event: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Read current Stripe state; webhook delivery order is never authoritative."""
        subscriptions = await self.client.v1.subscriptions.list_async(
            {"customer": customer_id, "status": "all", "limit": 100}
        )
        expected_live = "_live_" in config.STRIPE_BILLING_API_KEY
        matches = []
        for subscription in subscriptions.data:
            items = getattr(getattr(subscription, "items", None), "data", []) or []
            price_ids = {
                getattr(getattr(item, "price", None), "id", None) for item in items
            }
            if (
                config.STRIPE_PROVIDER_PRICE_ID in price_ids
                and bool(getattr(subscription, "livemode", False)) == expected_live
            ):
                matches.append(subscription)
        if not matches:
            return None
        current = max(
            matches,
            key=lambda subscription: (
                getattr(subscription, "status", "") not in TERMINAL_STATUSES,
                int(getattr(subscription, "created", 0) or 0),
            ),
        )
        items = getattr(getattr(current, "items", None), "data", []) or []
        ends = [getattr(item, "current_period_end", None) for item in items]
        return {
            **event,
            "subscription_ref": current.id,
            "subscription_status": current.status,
            "current_period_end": max((value for value in ends if value), default=None),
            "cancel_at_period_end": bool(current.cancel_at_period_end),
        }


def verify_webhook(payload: bytes, signature: str) -> dict[str, Any]:
    _require_settings(webhook=True)
    from stripe import Webhook

    return Webhook.construct_event(
        payload, signature, config.STRIPE_BILLING_WEBHOOK_SECRET
    )


def normalize_event(event: dict[str, Any]) -> dict[str, Any] | None:
    event_type = str(event.get("type") or "")
    obj = dict(event.get("data", {}).get("object") or {})
    customer = obj.get("customer")
    subscription = obj.get("subscription")
    if event_type.startswith("customer.subscription."):
        subscription = obj.get("id")
    elif event_type not in {
        "invoice.paid",
        "invoice.payment_failed",
        "checkout.session.completed",
    }:
        return None
    parent = obj.get("parent") or {}
    subscription = subscription or (parent.get("subscription_details") or {}).get(
        "subscription"
    )
    return {
        "event_id": event["id"],
        "event_type": event_type,
        "created": int(event.get("created") or 0),
        "customer_ref": customer,
        "subscription_ref": subscription,
        "subscription_status": None,
        "current_period_end": None,
        "cancel_at_period_end": None,
    }
