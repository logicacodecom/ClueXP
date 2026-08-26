"""Remote HTTP entrypoint tests.

These do not exercise production traffic. They prove the deployable ASGI app
has an open health check and a fail-closed MCP auth boundary.
"""
from __future__ import annotations

import httpx
import pytest
from starlette.testclient import TestClient

from mcp_server import asgi


@pytest.mark.asyncio
async def test_healthz_is_public(monkeypatch):
    monkeypatch.delenv(asgi.MCP_BEARER_TOKEN_ENV, raising=False)
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_vercel_rewritten_healthz_path_is_public(monkeypatch):
    monkeypatch.delenv(asgi.MCP_BEARER_TOKEN_ENV, raising=False)
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.get("/api/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_mcp_endpoint_fails_closed_without_bearer_token_configured(monkeypatch):
    monkeypatch.delenv(asgi.MCP_BEARER_TOKEN_ENV, raising=False)
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.post("/mcp", json={})
    assert response.status_code == 503
    assert response.json()["error"] == "mcp_auth_not_configured"


@pytest.mark.asyncio
async def test_vercel_rewritten_mcp_path_fails_closed_without_bearer_token_configured(monkeypatch):
    monkeypatch.delenv(asgi.MCP_BEARER_TOKEN_ENV, raising=False)
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.post("/api/mcp", json={})
    assert response.status_code == 503
    assert response.json()["error"] == "mcp_auth_not_configured"


@pytest.mark.asyncio
async def test_mcp_endpoint_rejects_wrong_bearer_token(monkeypatch):
    monkeypatch.setenv(asgi.MCP_BEARER_TOKEN_ENV, "correct-token")
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.post("/mcp", json={}, headers={"Authorization": "Bearer wrong-token"})
    assert response.status_code == 401
    assert response.json() == {"error": "invalid_mcp_token"}


@pytest.mark.asyncio
async def test_vercel_rewritten_mcp_path_rejects_wrong_bearer_token(monkeypatch):
    monkeypatch.setenv(asgi.MCP_BEARER_TOKEN_ENV, "correct-token")
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.post("/api/mcp", json={}, headers={"Authorization": "Bearer wrong-token"})
    assert response.status_code == 401
    assert response.json() == {"error": "invalid_mcp_token"}


def test_mcp_paths_allow_correct_bearer_token_to_reach_mcp_app(monkeypatch):
    monkeypatch.setenv(asgi.MCP_BEARER_TOKEN_ENV, "correct-token")
    with TestClient(asgi.app) as client:
        local_response = client.post("/mcp", json={}, headers={"Authorization": "Bearer correct-token"})
        vercel_response = client.post("/api/mcp", json={}, headers={"Authorization": "Bearer correct-token"})
    assert local_response.status_code not in {401, 503}
    assert vercel_response.status_code not in {401, 503}
