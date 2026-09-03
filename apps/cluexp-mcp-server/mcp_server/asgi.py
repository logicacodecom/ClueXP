"""Remote HTTP entrypoint for the ClueXP MCP server.

This is intentionally small: `/mcp` is the Streamable HTTP MCP endpoint,
`/healthz` is a public hosting health check. Production plugin traffic uses
OAuth 2.1 through the MCP SDK; the shared bearer-token middleware remains only
as a fail-closed compatibility path for internal previews. Vercel's Python
runtime presents rewritten function destinations such as `/api/mcp` to ASGI,
so this app also accepts `/api/healthz` and mounts the same MCP app under
`/api` for the deployed function path.
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

from mcp_server.server import mcp, oauth_config, oauth_enabled

MCP_BEARER_TOKEN_ENV = "CLUEXP_MCP_BEARER_TOKEN"
OPENAI_APPS_CHALLENGE_TOKEN_ENV = "OPENAI_APPS_CHALLENGE_TOKEN"
PUBLIC_PATHS = {
    "/healthz",
    "/api/healthz",
    "/.well-known/openai-apps-challenge",
    "/api/openai_apps_challenge",
    "/api/oauth_protected_resource",
}


async def healthz(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


async def openai_apps_challenge(request: Request) -> Response:
    token = os.environ.get(OPENAI_APPS_CHALLENGE_TOKEN_ENV)
    if not token:
        return Response("not configured", status_code=404, media_type="text/plain")
    return Response(token, media_type="text/plain")


async def oauth_protected_resource(request: Request) -> JSONResponse:
    """Serve RFC 9728 metadata at Vercel's rewritten function path."""

    if oauth_config is None:
        return JSONResponse({"error": "oauth_not_configured"}, status_code=404)
    return JSONResponse(
        {
            "resource": oauth_config.resource_server_url,
            "authorization_servers": [oauth_config.issuer],
            "scopes_supported": [oauth_config.required_scope],
            "bearer_methods_supported": ["header"],
        }
    )


class MCPBearerAuthMiddleware(BaseHTTPMiddleware):
    """Fail-closed compatibility auth used only when OAuth is not configured."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if oauth_enabled:
            return await call_next(request)
        if request.url.path in PUBLIC_PATHS:
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
        Route("/api/healthz", healthz, methods=["GET"]),
        Route("/.well-known/openai-apps-challenge", openai_apps_challenge, methods=["GET"]),
        Route("/api/openai_apps_challenge", openai_apps_challenge, methods=["GET"]),
        Route("/api/oauth_protected_resource", oauth_protected_resource, methods=["GET"]),
        Mount("/api", app=mcp_app),
        Mount("/", app=mcp_app),
    ],
    lifespan=lambda app: mcp.session_manager.run(),
)
app.add_middleware(MCPBearerAuthMiddleware)
