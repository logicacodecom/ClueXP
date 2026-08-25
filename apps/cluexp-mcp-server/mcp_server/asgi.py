"""Remote HTTP entrypoint for the ClueXP MCP server.

This is intentionally small: `/mcp` is the Streamable HTTP MCP endpoint,
`/healthz` is a public hosting health check, and every MCP request requires a
separate bearer token before it can reach the tool layer.
"""
from __future__ import annotations

import os
import secrets
from collections.abc import Awaitable, Callable

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route

from mcp_server.server import mcp

MCP_BEARER_TOKEN_ENV = "CLUEXP_MCP_BEARER_TOKEN"


async def healthz(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


class MCPBearerAuthMiddleware(BaseHTTPMiddleware):
    """Fail-closed bearer auth for the remotely reachable MCP endpoint."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path == "/healthz":
            return await call_next(request)

        expected = os.environ.get(MCP_BEARER_TOKEN_ENV)
        if not expected:
            return JSONResponse(
                {
                    "error": "mcp_auth_not_configured",
                    "detail": f"{MCP_BEARER_TOKEN_ENV} must be set before remote MCP traffic is accepted.",
                },
                status_code=503,
            )

        prefix = "Bearer "
        presented = request.headers.get("authorization", "")
        if not presented.startswith(prefix) or not secrets.compare_digest(presented[len(prefix):], expected):
            return JSONResponse({"error": "invalid_mcp_token"}, status_code=401)

        return await call_next(request)


mcp_app = mcp.streamable_http_app()

app = Starlette(
    routes=[
        Route("/healthz", healthz, methods=["GET"]),
        Mount("/", app=mcp_app),
    ],
    lifespan=lambda app: mcp.session_manager.run(),
)
app.add_middleware(MCPBearerAuthMiddleware)
