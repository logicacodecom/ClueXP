"""Tests for the MCP tool layer: confirmation enforcement and error mapping."""
from __future__ import annotations

import pytest

from mcp_server import server


def _tool_fn(name: str):
    return server.mcp._tool_manager.get_tool(name).fn


@pytest.mark.asyncio
async def test_exactly_seven_tools_registered():
    names = {t.name for t in server.mcp._tool_manager.list_tools()}
    assert names == {
        "list_services",
        "check_coverage",
        "create_service_request",
        "get_service_request",
        "get_tracking",
        "authorize_dispatch",
        "cancel_service_request",
    }


@pytest.mark.asyncio
async def test_create_service_request_requires_confirm_true(monkeypatch):
    called = False

    async def fake_create(**kwargs):
        nonlocal called
        called = True
        return {"data": {"request_reference": "SR-1"}}

    monkeypatch.setattr(server.client, "create_service_request", fake_create)
    fn = _tool_fn("create_service_request")

    result = await fn(
        dispatch_scope="private_partner",
        service_skill="plumbing.leak_repair",
        location={"lat": 1.0, "lng": 2.0},
        consent={"terms_accepted": True, "policy_version": "2026-01"},
        confirm=False,
    )
    assert result["error"] == "confirmation_required"
    assert called is False, "confirm=False must never reach the API"


@pytest.mark.asyncio
async def test_create_service_request_calls_api_when_confirmed(monkeypatch):
    async def fake_create(**kwargs):
        return {"data": {"request_reference": "SR-1", "dispatch_scope": kwargs["dispatch_scope"], "status": "received"}}

    monkeypatch.setattr(server.client, "create_service_request", fake_create)
    fn = _tool_fn("create_service_request")

    result = await fn(
        dispatch_scope="private_partner",
        service_skill="plumbing.leak_repair",
        location={"lat": 1.0, "lng": 2.0},
        consent={"terms_accepted": True, "policy_version": "2026-01"},
        confirm=True,
    )
    assert result["data"]["request_reference"] == "SR-1"


@pytest.mark.asyncio
async def test_authorize_dispatch_requires_confirm_true(monkeypatch):
    called = False

    async def fake_authorize(**kwargs):
        nonlocal called
        called = True
        return {"data": {"request_reference": kwargs["request_reference"], "status": "authorized"}}

    monkeypatch.setattr(server.client, "authorize_dispatch", fake_authorize)
    fn = _tool_fn("authorize_dispatch")

    result = await fn(
        request_reference="SR-1",
        channel="first_party_website",
        evidence_reference="consent-event-1",
        terms_version="2026-08-01",
        confirm=False,
    )
    assert result["error"] == "confirmation_required"
    assert called is False, "confirm=False must never reach the API"


@pytest.mark.asyncio
async def test_authorize_dispatch_calls_api_when_confirmed(monkeypatch):
    async def fake_authorize(**kwargs):
        return {"data": {"request_reference": kwargs["request_reference"], "status": "authorized"}}

    monkeypatch.setattr(server.client, "authorize_dispatch", fake_authorize)
    fn = _tool_fn("authorize_dispatch")

    result = await fn(
        request_reference="SR-1",
        channel="first_party_website",
        evidence_reference="consent-event-1",
        terms_version="2026-08-01",
        confirm=True,
    )
    assert result["data"]["request_reference"] == "SR-1"
    assert result["data"]["status"] == "authorized"


@pytest.mark.asyncio
async def test_cancel_service_request_requires_confirm_true(monkeypatch):
    called = False

    async def fake_cancel(**kwargs):
        nonlocal called
        called = True
        return {"data": {"request_reference": kwargs["request_reference"], "status": "cancelled"}}

    monkeypatch.setattr(server.client, "cancel_service_request", fake_cancel)
    fn = _tool_fn("cancel_service_request")

    result = await fn(request_reference="SR-1", reason="Customer requested cancellation", confirm=False)
    assert result["error"] == "confirmation_required"
    assert called is False, "confirm=False must never reach the API"


@pytest.mark.asyncio
async def test_cancel_service_request_calls_api_when_confirmed(monkeypatch):
    async def fake_cancel(**kwargs):
        return {"data": {"request_reference": kwargs["request_reference"], "status": "cancelled"}}

    monkeypatch.setattr(server.client, "cancel_service_request", fake_cancel)
    fn = _tool_fn("cancel_service_request")

    result = await fn(request_reference="SR-1", reason="Customer requested cancellation", confirm=True)
    assert result["data"]["request_reference"] == "SR-1"
    assert result["data"]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_read_only_tools_surface_api_errors_without_raising(monkeypatch):
    from mcp_server.client import ClueXPApiError

    async def fake_get(request_reference):
        raise ClueXPApiError(404, "service_request_not_found", "r5")

    monkeypatch.setattr(server.client, "get_service_request", fake_get)
    fn = _tool_fn("get_service_request")

    result = await fn(request_reference="SR-missing")
    assert result["error"] == "service_request_not_found"
    assert result["status_code"] == 404
