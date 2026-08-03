"""Technician push delivery via the Expo Push Service.

Implements ADR-0001 §6's four-event delivery model:

  1. Provider receipt -- the Expo push ticket from `ExpoPushProvider.send()`
     ('sent' with a ticket id, or 'failed' with the provider's error code).
     Still 'skipped_no_provider' when no provider is configured.
  2. Device receipt   -- Expo push receipts, polled by `poll_push_receipts()`
     (wired into /cron/dispatch-sweep). A permanently dead token deactivates
     the device instead of being pushed to on every future offer.
  3. User display     -- NOT tracked. No provider reports it. Left null, not faked.
  4. Acknowledgement  -- the client's job (see /technicians/me/notifications/*
                         endpoints in api/main.py), not this module.

Provider selection is env-driven (`PUSH_PROVIDER`); unset/unknown resolves to
`NoopPushProvider`, so deploying this before credentials exist behaves exactly
as it did before: every row honestly 'skipped_no_provider'.

Env: PUSH_PROVIDER=expo enables sending. EXPO_ACCESS_TOKEN is optional — only
needed when the Expo project has enhanced push security enabled.
"""
from __future__ import annotations

import asyncio
import json
import os
import urllib.request
from typing import Any, Protocol
from uuid import UUID

EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPT_URL = "https://exp.host/--/api/v2/push/getReceipts"

# The one Expo error meaning this token is dead forever (app uninstalled, token
# invalidated). Anything else — rate limits, transport, provider outages — is
# retryable and must NOT cost the technician their device registration.
DEVICE_DEAD_ERROR = "DeviceNotRegistered"

# Android channels created by technician-native (features/offerAlarm.ts).
# 'job-offers-v2' is MAX importance with sound+vibration — a ride-hail-style
# incoming-offer alert; everything else stays on the quieter default channel.
OFFER_CHANNEL_ID = "job-offers-v2"
DEFAULT_CHANNEL_ID = "job-alerts"
OFFER_SOUND = "offer_alarm.wav"

# Alert classes worth breaking through iOS Focus / notification summaries.
URGENT_ALERT_CLASSES = {"offer", "safety"}

# technician-native's `scheme` (app.json); RootApp.tsx parseWorkHint() matches
# cluexp-tech://(work|jobs|offers)/<id>.
DEEP_LINK_SCHEME = "cluexp-tech"


class PushProvider(Protocol):
    configured: bool

    async def send(self, *, device: dict[str, Any], message: dict[str, Any]) -> dict[str, Any]:
        """Attempt one device delivery. Returns
        {"status": 'sent'|'failed'|'skipped_no_provider', "ticket_id"?,
         "error_code"?, "error_message"?}. Must never raise for an ordinary
        delivery failure -- only for a genuine programming error."""
        ...

    async def receipts(self, ticket_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Look up provider receipts. Returns {ticket_id: <same shape as send>}
        for tickets the provider has an answer for; a missing key means 'not
        ready yet', never 'lost'."""
        ...


class NoopPushProvider:
    """The provider until Expo credentials are configured (PUSH_PROVIDER unset).
    Every call is honestly a no-op; it never claims a send succeeded."""

    configured = False

    async def send(self, *, device: dict[str, Any], message: dict[str, Any]) -> dict[str, Any]:
        return {"status": "skipped_no_provider"}

    async def receipts(self, ticket_ids: list[str]) -> dict[str, dict[str, Any]]:
        return {}


class ExpoPushProvider:
    """https://docs.expo.dev/push-notifications/sending-notifications/

    Stdlib HTTP run in a thread so it doesn't block the event loop, mirroring
    api/geocode.py — no extra dependency on the Vercel function.
    """

    configured = True

    def __init__(self, access_token: str | None = None) -> None:
        self._access_token = access_token or os.environ.get("EXPO_ACCESS_TOKEN") or None

    # ponytail: one HTTP call per device. Expo accepts 100 messages per request,
    # but a technician has one or two devices — batch when that stops being true.
    async def send(self, *, device: dict[str, Any], message: dict[str, Any]) -> dict[str, Any]:
        push_token = str(device.get("push_token") or "").strip()
        if not push_token:
            return {"status": "failed", "error_code": "NoPushToken",
                    "error_message": "device row has no push token"}
        try:
            body = await asyncio.to_thread(
                _post_json, EXPO_SEND_URL, _expo_message(push_token, message), self._access_token,
            )
        except Exception as exc:
            return _transport_failure(exc)
        ticket = body.get("data")
        if isinstance(ticket, list):
            ticket = ticket[0] if ticket else None
        if not isinstance(ticket, dict):
            first = (body.get("errors") or [{}])[0]
            return {"status": "failed",
                    "error_code": str(first.get("code") or "MalformedResponse"),
                    "error_message": str(first.get("message") or "Expo returned no push ticket")[:500]}
        return _expo_outcome(ticket)

    async def receipts(self, ticket_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not ticket_ids:
            return {}
        try:
            body = await asyncio.to_thread(
                _post_json, EXPO_RECEIPT_URL, {"ids": list(ticket_ids)}, self._access_token,
            )
        except Exception:
            return {}  # transport failure: leave the rows pending for the next sweep
        data = body.get("data")
        if not isinstance(data, dict):
            return {}
        return {tid: _expo_outcome(entry) for tid, entry in data.items() if isinstance(entry, dict)}


def _post_json(url: str, body: dict[str, Any], access_token: str | None) -> dict[str, Any]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    request = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers=headers, method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as resp:
        return json.loads(resp.read().decode())


def _expo_message(push_token: str, message: dict[str, Any]) -> dict[str, Any]:
    alert_class = message.get("alert_class")
    urgent = alert_class in URGENT_ALERT_CLASSES
    payload = {
        "to": push_token,
        "title": message.get("title") or "ClueXP",
        "body": message.get("body") or "",
        "data": message.get("data") or {},
        "sound": OFFER_SOUND if alert_class == "offer" else "default",
        "priority": "high" if urgent else "default",
        "channelId": OFFER_CHANNEL_ID if alert_class == "offer" else DEFAULT_CHANNEL_ID,
    }
    if urgent:
        # iOS 15+: an expiring offer must not sit in a scheduled summary.
        # NOT 'critical' — that needs an approved Apple entitlement we don't have.
        payload["interruptionLevel"] = "time-sensitive"
    return payload


def _expo_outcome(entry: dict[str, Any]) -> dict[str, Any]:
    """Normalize one Expo ticket OR receipt (same shape) into a status dict."""
    if entry.get("status") == "ok":
        return {"status": "sent", "ticket_id": entry.get("id")}
    details = entry.get("details") or {}
    return {"status": "failed",
            "error_code": str(details.get("error") or "UnknownError"),
            "error_message": str(entry.get("message") or "")[:500]}


def _transport_failure(exc: Exception) -> dict[str, Any]:
    # Type + message only, never the request: the access token lives in a header
    # and must not reach a stored error string.
    return {"status": "failed", "error_code": "TransportError",
            "error_message": f"{type(exc).__name__}: {exc}"[:500]}


def get_push_provider() -> PushProvider:
    if os.environ.get("PUSH_PROVIDER", "").strip().lower() == "expo":
        return ExpoPushProvider()
    return NoopPushProvider()


def _deep_link(alert_class: str, job_id: UUID | None, offer_id: UUID | None) -> str:
    if alert_class == "offer" and offer_id:
        return f"{DEEP_LINK_SCHEME}://offers/{offer_id}"
    if job_id:
        return f"{DEEP_LINK_SCHEME}://jobs/{job_id}"
    return f"{DEEP_LINK_SCHEME}://work"


def _push_data(
    *, alert_class: str, notification_id: str, job_id: UUID | None,
    offer_id: UUID | None, thread_id: UUID | None, envelope: dict[str, Any],
) -> dict[str, Any]:
    """The `data` block technician-native reads in RootApp.tsx notificationHint():
    `url` wins, with kind/job_id/offer_id as the fallback path. `urgent` +
    `expires_at` drive the foreground incoming-offer alarm (features/offerAlarm.ts)."""
    data: dict[str, Any] = {
        "kind": alert_class,
        "notification_id": str(notification_id),
        "url": _deep_link(alert_class, job_id, offer_id),
        "urgent": alert_class in URGENT_ALERT_CLASSES,
    }
    if job_id:
        data["job_id"] = str(job_id)
    if offer_id:
        data["offer_id"] = str(offer_id)
    if thread_id:
        data["thread_id"] = str(thread_id)
    if envelope.get("expires_at"):
        data["expires_at"] = str(envelope["expires_at"])
    return data


async def _deactivate_device(store: Any, technician_id: UUID, device_id: Any) -> bool:
    """Expo says this token is permanently dead — stop pushing to it. Revoking
    is the existing 'device is no longer usable' state (same as a user removing
    it), so readiness/fan-out both drop it automatically."""
    try:
        result = await store.revoke_technician_device(UUID(str(technician_id)), UUID(str(device_id)))
    except Exception:
        return False
    return result is not None


async def notify_technician(
    store: Any, technician_id: UUID, *, alert_class: str, envelope: dict[str, Any],
    job_id: UUID | None = None, offer_id: UUID | None = None, thread_id: UUID | None = None,
) -> list[dict[str, Any]]:
    """Best-effort fan-out to every device the technician has registered.
    Records one technician_notifications row per device (or one un-targeted
    row if they have none registered, so the attempt is still visible/
    auditable) and never raises -- a push failure must never block the
    caller's real mutation (e.g. offer creation)."""
    provider = get_push_provider()
    devices = await store.list_technician_devices(technician_id, with_tokens=True)
    if not devices:
        record = await store.create_technician_notification(
            technician_id, device_id=None, alert_class=alert_class, payload=envelope,
            job_id=job_id, offer_id=offer_id, thread_id=thread_id,
            provider_status="skipped_no_provider",
        )
        return [record]
    records = []
    for device in devices:
        # The row exists before the send so its id can ride along in the push
        # data — that's the handle the client acks with.
        record = await store.create_technician_notification(
            technician_id, device_id=UUID(device["id"]), alert_class=alert_class,
            payload=envelope, job_id=job_id, offer_id=offer_id, thread_id=thread_id,
            provider_status="queued" if provider.configured else "skipped_no_provider",
        )
        if provider.configured:
            record = await _send_one(
                store, provider, technician_id, device, record, alert_class=alert_class,
                envelope=envelope, job_id=job_id, offer_id=offer_id, thread_id=thread_id,
            )
        records.append(record)
    return records


async def _send_one(
    store: Any, provider: PushProvider, technician_id: UUID, device: dict[str, Any],
    record: dict[str, Any], *, alert_class: str, envelope: dict[str, Any],
    job_id: UUID | None, offer_id: UUID | None, thread_id: UUID | None,
) -> dict[str, Any]:
    message = {
        "alert_class": alert_class,
        "title": envelope.get("title"),
        "body": envelope.get("body"),
        "data": _push_data(
            alert_class=alert_class, notification_id=record["id"], job_id=job_id,
            offer_id=offer_id, thread_id=thread_id, envelope=envelope,
        ),
    }
    try:
        outcome = await provider.send(device=device, message=message)
    except Exception as exc:
        outcome = _transport_failure(exc)
    if outcome.get("error_code") == DEVICE_DEAD_ERROR:
        await _deactivate_device(store, technician_id, device["id"])
    try:
        updated = await store.record_push_delivery(
            UUID(record["id"]), status=outcome.get("status", "failed"),
            ticket_id=outcome.get("ticket_id"), error_code=outcome.get("error_code"),
            error_message=outcome.get("error_message"),
        )
    except Exception:
        return record
    return updated or record


async def poll_push_receipts(store: Any, *, limit: int = 200) -> dict[str, int]:
    """Delivery event 2: ask Expo whether each ticket actually reached the device.
    Called by /cron/dispatch-sweep. Tickets Expo has no answer for yet are left
    pending for the next sweep; a permanently dead token deactivates its device."""
    result = {"checked": 0, "delivered": 0, "failed": 0, "devices_deactivated": 0}
    provider = get_push_provider()
    if not provider.configured:
        return result
    pending = await store.list_pending_push_receipts(limit=limit)
    if not pending:
        return result
    receipts = await provider.receipts([row["provider_ticket_id"] for row in pending])
    for row in pending:
        outcome = receipts.get(row["provider_ticket_id"])
        if outcome is None:
            continue
        result["checked"] += 1
        result["delivered" if outcome["status"] == "sent" else "failed"] += 1
        if outcome.get("error_code") == DEVICE_DEAD_ERROR and row.get("device_id"):
            if await _deactivate_device(store, row["technician_id"], row["device_id"]):
                result["devices_deactivated"] += 1
        await store.record_push_delivery(
            UUID(str(row["id"])), status=outcome["status"],
            error_code=outcome.get("error_code"), error_message=outcome.get("error_message"),
            stage="receipt",
        )
    return result
