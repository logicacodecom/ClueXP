"""Thin HTTP wrapper over the ClueXP public `/v1` API.

Every function here does exactly one thing: call one `/v1` endpoint and
return its JSON body. No internal store/dispatch access, no business logic,
no defaults that point at production. Base URL and API key come from env
vars only -- never hardcoded, never committed.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

CLUEXP_API_BASE_URL_ENV = "CLUEXP_API_BASE_URL"
CLUEXP_API_KEY_ENV = "CLUEXP_API_KEY"


class ClueXPApiError(Exception):
    """Raised for any non-2xx `/v1` response, carrying the public error envelope."""

    def __init__(self, status_code: int, error: str, request_id: str | None, detail: str | None = None):
        self.status_code = status_code
        self.error = error
        self.request_id = request_id
        self.detail = detail
        super().__init__(f"{status_code} {error}: {detail or ''}".strip())


def _base_url() -> str:
    base_url = os.environ.get(CLUEXP_API_BASE_URL_ENV)
    if not base_url:
        raise RuntimeError(
            f"{CLUEXP_API_BASE_URL_ENV} is not set. This server never assumes a default "
            "(especially not production) -- set it explicitly, e.g. to a local dev API."
        )
    return base_url.rstrip("/")


def _api_key() -> str:
    api_key = os.environ.get(CLUEXP_API_KEY_ENV)
    if not api_key:
        raise RuntimeError(f"{CLUEXP_API_KEY_ENV} is not set. No default/test key is baked in.")
    return api_key


async def _request(
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {_api_key()}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    async with httpx.AsyncClient(base_url=_base_url(), timeout=15.0) as client:
        response = await client.request(method, path, json=json, headers=headers)
    if response.status_code >= 400:
        body = response.json() if response.content else {}
        raise ClueXPApiError(
            status_code=response.status_code,
            error=body.get("error", "unknown_error"),
            request_id=body.get("request_id"),
            detail=body.get("detail"),
        )
    return response.json()


async def list_services() -> dict[str, Any]:
    return await _request("GET", "/v1/services")


async def check_coverage(lat: float, lng: float, service_skill: str) -> dict[str, Any]:
    return await _request(
        "POST",
        "/v1/coverage-checks",
        json={"lat": lat, "lng": lng, "service_skill": service_skill},
    )


async def create_service_request(
    *,
    dispatch_scope: str,
    service_skill: str,
    location: dict[str, Any],
    consent: dict[str, Any],
    situation: str | None = None,
    urgency: str | None = None,
    customer: dict[str, Any] | None = None,
    notes: str | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "dispatch_scope": dispatch_scope,
        "service_skill": service_skill,
        "location": location,
        "consent": consent,
    }
    if situation is not None:
        payload["situation"] = situation
    if urgency is not None:
        payload["urgency"] = urgency
    if customer is not None:
        payload["customer"] = customer
    if notes is not None:
        payload["notes"] = notes
    return await _request("POST", "/v1/service-requests", json=payload, idempotency_key=idempotency_key)


async def get_service_request(request_reference: str) -> dict[str, Any]:
    return await _request("GET", f"/v1/service-requests/{request_reference}")


async def get_tracking(request_reference: str) -> dict[str, Any]:
    return await _request("GET", f"/v1/service-requests/{request_reference}/tracking")
