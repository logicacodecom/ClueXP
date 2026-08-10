"""Provider-neutral communications integration.

All provider credentials stay server-side. Routes depend on these small typed
results and never expose raw callee numbers when masked calling is required.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlsplit, urlunsplit

from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Dial, VoiceResponse


E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def normalize_e164(raw: str | None, *, default_country: str = "US") -> str | None:
    value = (raw or "").strip()
    if not value:
        return None
    if value.startswith("+"):
        candidate = "+" + re.sub(r"\D", "", value)
    else:
        digits = re.sub(r"\D", "", value)
        if default_country.upper() == "US" and len(digits) == 10:
            candidate = "+1" + digits
        elif default_country.upper() == "US" and len(digits) == 11 and digits.startswith("1"):
            candidate = "+" + digits
        else:
            candidate = "+" + digits
    return candidate if E164_RE.fullmatch(candidate) else None


def redact_phone(value: str | None) -> str | None:
    phone = normalize_e164(value)
    if not phone:
        return None
    return f"{phone[:3]}***{phone[-2:]}"


def public_request_url(raw_url: str, headers: dict[str, str]) -> str:
    """Reconstruct the exact public URL Twilio signed behind Vercel/proxies."""
    split = urlsplit(raw_url)
    proto = headers.get("x-forwarded-proto")
    host = headers.get("x-forwarded-host") or headers.get("host")
    if proto or host:
        split = split._replace(scheme=proto or split.scheme, netloc=host or split.netloc)
    base = os.environ.get("TWILIO_WEBHOOK_BASE_URL", "").strip().rstrip("/")
    if base:
        base_split = urlsplit(base)
        split = split._replace(scheme=base_split.scheme, netloc=base_split.netloc)
    return urlunsplit(split)


def verify_twilio_signature(url: str, params: dict[str, Any], signature: str | None) -> bool:
    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    if not token or not signature:
        return False
    safe_params = {k: str(v) for k, v in params.items()}
    return RequestValidator(token).validate(url, safe_params, signature)


@dataclass(frozen=True)
class VoiceStartResult:
    available: bool
    provider: str | None
    provider_call_sid: str | None
    provider_status: str
    status: str
    masked_number: str | None
    message: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class SmsSendResult:
    sent: bool
    provider: str | None
    provider_message_sid: str | None
    provider_status: str
    error_code: str | None = None
    metadata: dict[str, Any] | None = None


class CommunicationsProvider(Protocol):
    name: str | None

    def start_masked_call(
        self, *, caller_number: str, callee_number: str, from_number: str, status_callback_url: str | None
    ) -> VoiceStartResult:
        ...

    def send_sms(
        self, *, to_number: str, from_number: str, body: str, status_callback_url: str | None
    ) -> SmsSendResult:
        ...


class NoopCommunicationsProvider:
    name = None

    def start_masked_call(
        self, *, caller_number: str, callee_number: str, from_number: str, status_callback_url: str | None
    ) -> VoiceStartResult:
        return VoiceStartResult(
            available=False,
            provider=None,
            provider_call_sid=None,
            provider_status="skipped_no_provider",
            status="unavailable",
            masked_number=None,
            message="Masked calling provider is not configured.",
            metadata={"reason": "communications_provider_not_configured"},
        )

    def send_sms(
        self, *, to_number: str, from_number: str, body: str, status_callback_url: str | None
    ) -> SmsSendResult:
        return SmsSendResult(
            sent=False,
            provider=None,
            provider_message_sid=None,
            provider_status="skipped_no_provider",
            metadata={"reason": "communications_provider_not_configured"},
        )


class TwilioCommunicationsProvider:
    name = "twilio"

    def __init__(self, client: Client | None = None) -> None:
        account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
        auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
        self.client = client or Client(account_sid, auth_token)

    def start_masked_call(
        self, *, caller_number: str, callee_number: str, from_number: str, status_callback_url: str | None
    ) -> VoiceStartResult:
        response = VoiceResponse()
        dial = Dial(caller_id=from_number, answer_on_bridge=True)
        dial.number(callee_number)
        response.append(dial)
        kwargs: dict[str, Any] = {
            "to": caller_number,
            "from_": from_number,
            "twiml": str(response),
        }
        if status_callback_url:
            kwargs["status_callback"] = status_callback_url
            kwargs["status_callback_event"] = ["initiated", "ringing", "answered", "completed"]
        try:
            call = self.client.calls.create(**kwargs)
        except TwilioRestException as exc:
            return VoiceStartResult(
                available=False,
                provider=self.name,
                provider_call_sid=None,
                provider_status="failed",
                status="failed",
                masked_number=from_number,
                message="Masked call could not be started.",
                metadata={"twilio_error_code": str(exc.code or ""), "twilio_status": exc.status},
            )
        return VoiceStartResult(
            available=True,
            provider=self.name,
            provider_call_sid=getattr(call, "sid", None),
            provider_status=getattr(call, "status", None) or "queued",
            status="requested",
            masked_number=from_number,
            message="Masked call session started.",
            metadata={},
        )

    def send_sms(
        self, *, to_number: str, from_number: str, body: str, status_callback_url: str | None
    ) -> SmsSendResult:
        kwargs: dict[str, Any] = {"to": to_number, "from_": from_number, "body": body}
        if status_callback_url:
            kwargs["status_callback"] = status_callback_url
        try:
            msg = self.client.messages.create(**kwargs)
        except TwilioRestException as exc:
            return SmsSendResult(
                sent=False,
                provider=self.name,
                provider_message_sid=None,
                provider_status="failed",
                error_code=str(exc.code or ""),
                metadata={"twilio_status": exc.status},
            )
        return SmsSendResult(
            sent=True,
            provider=self.name,
            provider_message_sid=getattr(msg, "sid", None),
            provider_status=getattr(msg, "status", None) or "queued",
            metadata={},
        )


def get_communications_provider() -> CommunicationsProvider:
    provider = (
        os.environ.get("COMMUNICATIONS_PROVIDER")
        or os.environ.get("VOICE_PROVIDER")
        or "noop"
    ).strip().lower()
    if provider in {"twilio", "twilio_voice"}:
        if os.environ.get("TWILIO_ACCOUNT_SID") and os.environ.get("TWILIO_AUTH_TOKEN"):
            return TwilioCommunicationsProvider()
    return NoopCommunicationsProvider()


def inbound_forward_twiml(
    *,
    primary_number: str | None,
    backup_number: str | None,
    caller_id: str | None,
    timeout_seconds: int,
    voicemail_enabled: bool,
    fallback_message: str,
    action_url: str | None = None,
) -> str:
    response = VoiceResponse()
    if primary_number:
        dial = Dial(
            caller_id=caller_id,
            timeout=max(5, min(timeout_seconds, 60)),
            action=action_url,
            method="POST" if action_url else None,
        )
        dial.number(primary_number)
        response.append(dial)
    if backup_number:
        dial = Dial(caller_id=caller_id, timeout=max(5, min(timeout_seconds, 60)))
        dial.number(backup_number)
        response.append(dial)
    if not primary_number and not backup_number:
        response.say(fallback_message)
    if voicemail_enabled:
        response.say("No dispatcher is available right now. Please leave a message after the tone.")
        response.record(max_length=120, play_beep=True)
    else:
        response.say(fallback_message)
    return str(response)
