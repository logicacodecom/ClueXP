"""Local MCP -> public /v1 proof.

This test exercises the MCP tool layer against the real FastAPI app via
httpx.ASGITransport. It opens no sockets, uses no production URL, and seeds
only an in-memory external API client/key.
"""
from __future__ import annotations

import sys
from pathlib import Path
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
async def test_mcp_tools_exercise_real_local_v1_api_without_side_effects(monkeypatch):
    from api import main as intake_main

    store = InMemoryStore()
    monkeypatch.setattr(intake_main, "store", store)

    async def no_latency() -> None:
        return None

    monkeypatch.setattr(intake_main, "latency", no_latency)
    store._organizations["abc-org"] = {"id": "abc-org", "display_name": "ABC Locksmith", "status": "active"}
    store._organization_capabilities["abc-org"] = {"locksmith.residential_lockout"}
    store._intake_channels.append({
        "organization_id": "abc-org", "slug": "abc-locksmith", "display_name": None,
        "active": True, "ai_assistant_listed": True,
    })
    store._technicians = [{
        "id": "tech-1", "display_name": "tech-1", "skills": ["locksmith.residential_lockout"],
        "is_available": True, "status": "active", "vetting_status": "verified",
        "service_area_center_lat": 40.0, "service_area_center_lng": -73.0,
        "service_area_radius_km": 25, "org_ids": ["abc-org"], "rating": 4.8,
    }]

    api_key = await _issue_key(store, ["services:read", "providers:search"])
    monkeypatch.setenv(mcp_client.CLUEXP_API_BASE_URL_ENV, "http://local-cluexp-api.test")
    monkeypatch.setenv(mcp_client.CLUEXP_API_KEY_ENV, api_key)

    real_async_client = httpx.AsyncClient

    def local_async_client_factory(**kwargs):
        assert kwargs.get("base_url") == "http://local-cluexp-api.test"
        kwargs["transport"] = httpx.ASGITransport(app=intake_main.app)
        return real_async_client(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", local_async_client_factory)
    tickets_before = len(store._tickets)

    services = await _tool_fn("list_services")()
    assert services["data"]

    found = await _tool_fn("find_providers")(
        service_skill="locksmith.residential_lockout", lat=40.0, lng=-73.0,
    )
    provider = found["data"]["providers"][0]
    assert provider["name"] == "ABC Locksmith" and provider["recommended"] is True
    assert "/o/abc-locksmith#" in provider["intake_url"]
    assert "tech-1" not in str(found)

    invalid = await _tool_fn("find_providers")(service_skill="locksmith.residential_lockout", lat=40.0)
    assert invalid["error"] == "invalid_request"

    # Discovery is read-only: no ticket, job, offer, or dispatch record appears.
    assert len(store._tickets) == tickets_before
    assert not getattr(store, "_offers", {})
    assert not getattr(store, "_dispatch_authorizations", {})
