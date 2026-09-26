"""Tests for the thin /v1 HTTP wrapper. No production traffic -- httpx is
mocked at the transport level via httpx.MockTransport, never a real socket."""
from __future__ import annotations

import json

import httpx
import pytest

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
async def test_find_providers_error_envelope_keeps_candidates(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            422,
            json={"error": "address_ambiguous", "request_id": "r2", "candidates": ["A St, X", "A St, Y"]},
        )

    _patch_async_client(monkeypatch, handler)
    with pytest.raises(client.ClueXPApiError) as exc_info:
        await client.find_providers(service_skill="locksmith.residential_lockout", address="A St")
    assert exc_info.value.status_code == 422
    assert exc_info.value.error == "address_ambiguous"
    assert exc_info.value.request_id == "r2"
    assert exc_info.value.candidates == ["A St, X", "A St, Y"]


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
@pytest.mark.parametrize("kwargs,expected", [
    ({"address": "221 King St W, Toronto"}, {"address": "221 King St W, Toronto"}),
    ({"lat": 43.6, "lng": -79.4}, {"lat": 43.6, "lng": -79.4}),
])
async def test_find_providers_path_and_payload(monkeypatch, kwargs, expected):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"], seen["path"] = request.method, request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": {"providers": []}, "meta": {"request_id": "r3"}})

    _patch_async_client(monkeypatch, handler)
    await client.find_providers(service_skill="locksmith.residential_lockout", **kwargs)
    assert (seen["method"], seen["path"]) == ("POST", "/v1/provider-matches")
    assert seen["body"] == {"service_skill": "locksmith.residential_lockout", **expected}
