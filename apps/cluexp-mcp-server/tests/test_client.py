"""Tests for the thin /v1 HTTP wrapper. No production traffic -- httpx is
mocked at the transport level via httpx.MockTransport, never a real socket."""
from __future__ import annotations

import pytest
import httpx

from mcp_server import client


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(client.CLUEXP_API_BASE_URL_ENV, "http://local-test-api.invalid")
    monkeypatch.setenv(client.CLUEXP_API_KEY_ENV, "test-key-not-real")


_RealAsyncClient = httpx.AsyncClient


def _patch_async_client(monkeypatch, handler):
    def factory(**kwargs):
        kwargs.pop("transport", None)
        return _RealAsyncClient(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_missing_base_url_raises(monkeypatch):
    monkeypatch.delenv(client.CLUEXP_API_BASE_URL_ENV, raising=False)
    with pytest.raises(RuntimeError):
        client._base_url()


@pytest.mark.asyncio
async def test_missing_api_key_raises(monkeypatch):
    monkeypatch.delenv(client.CLUEXP_API_KEY_ENV, raising=False)
    with pytest.raises(RuntimeError):
        client._api_key()


@pytest.mark.asyncio
async def test_list_services_success(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/services"
        assert request.headers["authorization"] == "Bearer test-key-not-real"
        return httpx.Response(200, json={"data": [], "meta": {"request_id": "r1"}})

    _patch_async_client(monkeypatch, handler)
    result = await client.list_services()
    assert result["meta"]["request_id"] == "r1"


@pytest.mark.asyncio
async def test_check_coverage_error_envelope(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "insufficient_scope", "request_id": "r2"})

    _patch_async_client(monkeypatch, handler)
    with pytest.raises(client.ClueXPApiError) as exc_info:
        await client.check_coverage(1.0, 2.0, "plumbing.leak_repair")
    assert exc_info.value.status_code == 403
    assert exc_info.value.error == "insufficient_scope"
    assert exc_info.value.request_id == "r2"


@pytest.mark.asyncio
async def test_non_json_error_body_is_still_structured(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="<html>bad gateway</html>")

    _patch_async_client(monkeypatch, handler)
    with pytest.raises(client.ClueXPApiError) as exc_info:
        await client.list_services()
    assert exc_info.value.status_code == 502
    assert exc_info.value.error == "unknown_error"
    assert exc_info.value.request_id is None


@pytest.mark.asyncio
async def test_create_service_request_sends_idempotency_key(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["idempotency_key"] = request.headers.get("idempotency-key")
        return httpx.Response(
            200,
            json={"data": {"request_reference": "SR-1", "dispatch_scope": "private_partner", "status": "received"}, "meta": {"request_id": "r3"}},
        )

    _patch_async_client(monkeypatch, handler)
    result = await client.create_service_request(
        dispatch_scope="private_partner",
        service_skill="plumbing.leak_repair",
        location={"lat": 1.0, "lng": 2.0},
        consent={"terms_accepted": True, "policy_version": "2026-01"},
        idempotency_key="key-123",
    )
    assert seen["idempotency_key"] == "key-123"
    assert result["data"]["request_reference"] == "SR-1"


@pytest.mark.asyncio
async def test_get_service_request_and_tracking_paths(monkeypatch):
    paths = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(200, json={"data": {}, "meta": {"request_id": "r4"}})

    _patch_async_client(monkeypatch, handler)
    await client.get_service_request("SR-1")
    await client.get_tracking("SR-1")
    assert paths == ["/v1/service-requests/SR-1", "/v1/service-requests/SR-1/tracking"]


@pytest.mark.asyncio
async def test_request_reference_path_segments_are_escaped(monkeypatch):
    urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        return httpx.Response(200, json={"data": {}, "meta": {"request_id": "r5"}})

    _patch_async_client(monkeypatch, handler)
    await client.get_service_request("SR-1/extra")
    await client.get_tracking("SR-2/extra")
    assert urls == [
        "http://local-test-api.invalid/v1/service-requests/SR-1%2Fextra",
        "http://local-test-api.invalid/v1/service-requests/SR-2%2Fextra/tracking",
    ]


@pytest.mark.asyncio
async def test_authorize_dispatch_path_and_payload(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["payload"] = request.read().decode()
        return httpx.Response(
            200,
            json={"data": {"request_reference": "SR-1", "status": "authorized"}, "meta": {"request_id": "r6"}},
        )

    _patch_async_client(monkeypatch, handler)
    result = await client.authorize_dispatch(
        request_reference="SR-1/extra",
        channel="first_party_website",
        evidence_reference="consent-event-1",
        terms_version="2026-08-01",
    )
    assert seen["url"] == "http://local-test-api.invalid/v1/service-requests/SR-1%2Fextra/dispatch-authorizations"
    assert '"channel":"first_party_website"' in seen["payload"]
    assert '"evidence_reference":"consent-event-1"' in seen["payload"]
    assert '"terms_version":"2026-08-01"' in seen["payload"]
    assert result["data"]["status"] == "authorized"


@pytest.mark.asyncio
async def test_cancel_service_request_path_and_payload(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["payload"] = request.read().decode()
        return httpx.Response(
            200,
            json={"data": {"request_reference": "SR-1", "status": "cancelled"}, "meta": {"request_id": "r7"}},
        )

    _patch_async_client(monkeypatch, handler)
    result = await client.cancel_service_request(
        request_reference="SR-1/extra",
        reason="Customer requested cancellation",
    )
    assert seen["url"] == "http://local-test-api.invalid/v1/service-requests/SR-1%2Fextra/cancellations"
    assert '"reason":"Customer requested cancellation"' in seen["payload"]
    assert result["data"]["status"] == "cancelled"
