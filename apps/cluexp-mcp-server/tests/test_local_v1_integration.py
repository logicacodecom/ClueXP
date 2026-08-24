"""Local MCP -> public /v1 proof.

This test exercises the MCP tool layer against the real FastAPI app via
httpx.ASGITransport. It opens no sockets, uses no production URL, and seeds
only an in-memory external API client/key.
"""
from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

INTAKE_WEB = Path(__file__).resolve().parents[2] / "intake-web"
sys.path.insert(0, str(INTAKE_WEB))

from api.store import InMemoryStore  # noqa: E402
from mcp_server import client as mcp_client  # noqa: E402
from mcp_server import server as mcp_server  # noqa: E402


def _tool_fn(name: str):
    return mcp_server.mcp._tool_manager.get_tool(name).fn


async def _issue_key(store: InMemoryStore, scopes: list[str]) -> str:
    external_client = await store.create_external_client(
        name="Local MCP proof client",
        client_type="agent",
        scopes=scopes,
        rate_limit_per_minute=100,
    )
    issued = await store.issue_external_api_key(external_client["id"], scopes=scopes)
    return issued["api_key"]


@pytest.mark.asyncio
async def test_mcp_tools_exercise_real_local_v1_api_without_dispatch_or_production(monkeypatch):
    from api import main as intake_main

    store = InMemoryStore()
    monkeypatch.setattr(intake_main, "store", store)

    async def no_latency() -> None:
        return None

    monkeypatch.setattr(intake_main, "latency", no_latency)

    api_key = await _issue_key(
        store,
        ["services:read", "coverage:check", "service_requests:write", "service_requests:read"],
    )
    monkeypatch.setenv(mcp_client.CLUEXP_API_BASE_URL_ENV, "http://local-cluexp-api.test")
    monkeypatch.setenv(mcp_client.CLUEXP_API_KEY_ENV, api_key)

    real_async_client = httpx.AsyncClient
    seen_urls: list[str] = []

    def local_async_client_factory(**kwargs):
        assert kwargs.get("base_url") == "http://local-cluexp-api.test"
        assert "intake.cluexp.com" not in str(kwargs.get("base_url"))
        kwargs["transport"] = httpx.ASGITransport(app=intake_main.app)
        original_request = real_async_client.request

        async def recording_request(self, method, url, **request_kwargs):
            seen_urls.append(str(url))
            assert "dispatch-authorizations" not in str(url)
            assert "cancellations" not in str(url)
            return await original_request(self, method, url, **request_kwargs)

        class RecordingAsyncClient(real_async_client):
            async def request(self, method, url, **request_kwargs):  # type: ignore[override]
                return await recording_request(self, method, url, **request_kwargs)

        return RecordingAsyncClient(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", local_async_client_factory)

    services = await _tool_fn("list_services")()
    assert services["data"]

    coverage = await _tool_fn("check_coverage")(
        lat=40.0,
        lng=-73.0,
        service_skill="locksmith.residential_lockout",
    )
    assert coverage["data"]["service_skill"] == "locksmith.residential_lockout"

    before_ticket_count = len(store._tickets)
    blocked_create = await _tool_fn("create_service_request")(
        dispatch_scope="network",
        service_skill="locksmith.residential_lockout",
        location={"lat": 40.0, "lng": -73.0, "raw_text": "Local MCP proof address"},
        consent={"terms_accepted": True, "policy_version": "2026-08-01"},
        customer={"name": "Local MCP Proof", "phone": "+15550000000"},
        confirm=False,
    )
    assert blocked_create["error"] == "confirmation_required"
    assert len(store._tickets) == before_ticket_count

    request_idempotency_key = f"local-mcp-proof-{uuid4()}"
    created = await _tool_fn("create_service_request")(
        dispatch_scope="network",
        service_skill="locksmith.residential_lockout",
        location={"lat": 40.0, "lng": -73.0, "raw_text": "Local MCP proof address"},
        consent={"terms_accepted": True, "policy_version": "2026-08-01"},
        customer={"name": "Local MCP Proof", "phone": "+15550000000"},
        confirm=True,
        idempotency_key=request_idempotency_key,
    )
    reference = created["data"]["request_reference"]
    assert created["data"]["status"] == "received"
    assert len(store._tickets) == before_ticket_count + 1

    read_back = await _tool_fn("get_service_request")(request_reference=reference)
    assert read_back["data"]["request_reference"] == reference
    assert read_back["data"]["status"] == "received"
    assert read_back["data"]["created_at"] is not None

    tracking = await _tool_fn("get_tracking")(request_reference=reference)
    assert "state" in tracking["data"]
    assert tracking["data"]["assignment"] is None

    assert {tool.name for tool in mcp_server.mcp._tool_manager.list_tools()} == {
        "list_services",
        "check_coverage",
        "create_service_request",
        "get_service_request",
        "get_tracking",
    }
    assert not getattr(store, "_dispatch_authorizations", {})
    assert not getattr(store, "_offers", {})
    assert all("dispatch-authorizations" not in url for url in seen_urls)
    assert all("cancellations" not in url for url in seen_urls)
