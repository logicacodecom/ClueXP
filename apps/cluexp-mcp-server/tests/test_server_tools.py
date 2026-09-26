"""Tests for the MCP tool layer: surface, annotations, and error mapping."""
from __future__ import annotations

import pytest

from mcp_server import server
from mcp_server.client import ClueXPApiError


def _tool_fn(name: str):
    return server.mcp._tool_manager.get_tool(name).fn


def test_exactly_two_read_only_tools_registered():
    tools = {t.name: t for t in server.mcp._tool_manager.list_tools()}
    assert set(tools) == {"list_services", "find_providers"}
    for tool in tools.values():
        assert (
            tool.annotations.readOnlyHint,
            tool.annotations.openWorldHint,
            tool.annotations.destructiveHint,
        ) == (True, False, False)
        # No sign-in: tools carry no OAuth security scheme.
        assert not tool.meta


@pytest.mark.asyncio
async def test_find_providers_passes_arguments_through(monkeypatch):
    seen = {}

    async def fake_find(**kwargs):
        seen.update(kwargs)
        return {"data": {"providers": []}}

    monkeypatch.setattr(server.client, "find_providers", fake_find)
    result = await _tool_fn("find_providers")(service_skill="locksmith.residential_lockout", address="221 King St W")

    assert result == {"data": {"providers": []}}
    assert seen == {
        "service_skill": "locksmith.residential_lockout", "address": "221 King St W", "lat": None, "lng": None,
    }


@pytest.mark.asyncio
async def test_find_providers_surfaces_ambiguity_candidates_without_raising(monkeypatch):
    async def fake_find(**kwargs):
        raise ClueXPApiError(422, "address_ambiguous", "r1", "pick one", candidates=["A St, X", "A St, Y"])

    monkeypatch.setattr(server.client, "find_providers", fake_find)
    result = await _tool_fn("find_providers")(service_skill="s", address="A St")

    assert result == {
        "error": "address_ambiguous", "status_code": 422, "request_id": "r1",
        "detail": "pick one", "candidates": ["A St, X", "A St, Y"],
    }


@pytest.mark.asyncio
async def test_list_services_surfaces_api_errors_without_raising(monkeypatch):
    async def fake_list():
        raise ClueXPApiError(401, "invalid_api_key", "r2")

    monkeypatch.setattr(server.client, "list_services", fake_list)
    result = await _tool_fn("list_services")()

    assert result["error"] == "invalid_api_key" and result["status_code"] == 401
    assert "candidates" not in result
