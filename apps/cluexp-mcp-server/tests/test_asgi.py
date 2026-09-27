"""Remote HTTP entrypoint tests.

These do not exercise production traffic. They prove the deployable ASGI app
serves a public health check and a public, credential-free MCP endpoint on both
the direct and Vercel-rewritten paths (specs/003 FR-002).
"""
from __future__ import annotations

import httpx
import pytest
from starlette.testclient import TestClient

from mcp_server import asgi
from mcp_server import server


def test_allowed_hosts_include_production_and_vercel_runtime_hosts(monkeypatch):
    monkeypatch.setenv("VERCEL_URL", "https://cluexp-mcp-server-preview-logicacode-projects.vercel.app")
    monkeypatch.setenv("VERCEL_PROJECT_PRODUCTION_URL", "cluexp-mcp-server.vercel.app")
    monkeypatch.setenv(server.MCP_ALLOWED_HOSTS_ENV, "mcp-preview.cluexp.com, mcp.cluexp.com")

    allowed_hosts = server._allowed_hosts()

    assert "localhost:*" in allowed_hosts
    assert "127.0.0.1:*" in allowed_hosts
    assert "mcp.cluexp.com" in allowed_hosts
    assert "cluexp-mcp-server-preview-logicacode-projects.vercel.app" in allowed_hosts
    assert "cluexp-mcp-server.vercel.app" in allowed_hosts
    assert "mcp-preview.cluexp.com" in allowed_hosts


@pytest.mark.asyncio
async def test_healthz_is_public(monkeypatch):
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_vercel_rewritten_healthz_path_is_public(monkeypatch):
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.get("/api/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_openai_apps_challenge_is_public_and_exact_when_configured(monkeypatch):
    monkeypatch.setenv(asgi.OPENAI_APPS_CHALLENGE_TOKEN_ENV, "openai-domain-proof-token")
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.get("/.well-known/openai-apps-challenge")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert response.text == "openai-domain-proof-token"


@pytest.mark.asyncio
async def test_vercel_rewritten_openai_apps_challenge_path(monkeypatch):
    monkeypatch.setenv(asgi.OPENAI_APPS_CHALLENGE_TOKEN_ENV, "openai-domain-proof-token")
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.get("/api/openai_apps_challenge")
    assert response.status_code == 200
    assert response.text == "openai-domain-proof-token"


@pytest.mark.asyncio
async def test_openai_apps_challenge_404_when_unconfigured(monkeypatch):
    monkeypatch.delenv(asgi.OPENAI_APPS_CHALLENGE_TOKEN_ENV, raising=False)
    transport = httpx.ASGITransport(app=asgi.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mcp.local") as client:
        response = await client.get("/.well-known/openai-apps-challenge")
    assert response.status_code == 404
    assert response.text == "not configured"


_INITIALIZE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}},
}
_MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def test_mcp_endpoint_is_public_and_host_guarded():
    # One lifespan per process: the MCP SDK session manager can only run once.
    with TestClient(asgi.app, base_url="https://mcp.cluexp.com") as client:
        direct = client.post("/mcp", json=_INITIALIZE, headers=_MCP_HEADERS)
        rewritten = client.post("/api/mcp", json=_INITIALIZE, headers=_MCP_HEADERS)
        oauth_metadata = client.get("/api/oauth_protected_resource")
        foreign_host = client.post(
            "/mcp", json=_INITIALIZE, headers={**_MCP_HEADERS, "Host": "evil.example"},
        )

    # No credentials needed on either the direct or the Vercel-rewritten path.
    assert direct.status_code == 200 and "cluexp-mcp-server" in direct.text
    assert rewritten.status_code == 200 and "cluexp-mcp-server" in rewritten.text
    # The OAuth protected-resource metadata route is gone.
    assert oauth_metadata.status_code != 200
    # The DNS-rebinding host guard still applies.
    assert foreign_host.status_code == 421
