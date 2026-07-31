"""Push-send scaffolding, honest about what this deployment can actually do.

Implements the client side of ADR-0001 SS6's four-event delivery model as far as
a backend WITHOUT a configured APNs/FCM provider can go:

  1. Provider receipt   -- attempted here; always 'skipped_no_provider' today.
  2. Device receipt     -- NOT tracked. No provider exists to report it.
  3. User display       -- NOT tracked, same reason.
  4. Acknowledgement     -- the client's job (see /technicians/me/notifications/*
                            endpoints in api/main.py), not this module.

`PushSender` is the seam a real provider plugs into later without touching any
caller. Selecting one is env-driven (`PUSH_PROVIDER`); unset/unknown always
resolves to `NullPushSender`, which never claims a send succeeded.
"""
from __future__ import annotations

import os
from typing import Any, Protocol
from uuid import UUID


class PushSender(Protocol):
    async def send(self, *, device: dict[str, Any], envelope: dict[str, Any]) -> str:
        """Attempt one device delivery. Returns a provider_status value
        ('sent' | 'failed' | 'skipped_no_provider'). Must never raise for an
        ordinary delivery failure -- only for a genuine programming error."""
        ...


class NullPushSender:
    """The only sender available until a real APNs/FCM provider is configured
    and credentialed (ADR-0001 SS7, an explicit open decision -- not something
    this backend can decide or fake). Every call is honestly a no-op."""

    async def send(self, *, device: dict[str, Any], envelope: dict[str, Any]) -> str:
        return "skipped_no_provider"


def get_push_sender() -> PushSender:
    provider = os.environ.get("PUSH_PROVIDER", "").strip().lower()
    # No real provider is wired up yet; any value (including unset) resolves
    # here. Extend this dispatch when a provider is actually credentialed.
    if provider in ("", "none", "null"):
        return NullPushSender()
    return NullPushSender()


async def notify_technician(
    store: Any, technician_id: UUID, *, alert_class: str, envelope: dict[str, Any],
    job_id: UUID | None = None, offer_id: UUID | None = None, thread_id: UUID | None = None,
) -> list[dict[str, Any]]:
    """Best-effort fan-out to every device the technician has registered.
    Records one technician_notifications row per device (or one un-targeted
    row if they have none registered, so the attempt is still visible/
    auditable) and never raises -- a push failure must never block the
    caller's real mutation (e.g. offer creation)."""
    sender = get_push_sender()
    devices = await store.list_technician_devices(technician_id)
    if not devices:
        record = await store.create_technician_notification(
            technician_id, device_id=None, alert_class=alert_class, payload=envelope,
            job_id=job_id, offer_id=offer_id, thread_id=thread_id,
            provider_status="skipped_no_provider",
        )
        return [record]
    records = []
    for device in devices:
        try:
            status = await sender.send(device=device, envelope=envelope)
        except Exception:
            status = "failed"
        record = await store.create_technician_notification(
            technician_id, device_id=UUID(device["id"]), alert_class=alert_class,
            payload=envelope, job_id=job_id, offer_id=offer_id, thread_id=thread_id,
            provider_status=status,
        )
        records.append(record)
    return records
