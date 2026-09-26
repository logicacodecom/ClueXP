"""Remote HTTP entrypoint for the ClueXP MCP server.

`/mcp` is the Streamable HTTP MCP endpoint and `/healthz` a hosting health
check. The server is public and read-only (specs/003): no sign-in, because its
tools only return the service catalog and opted-in providers' names and links.
Abuse is bounded by the Vercel Firewall rate limit on `/mcp` and the `/v1` key's
own rate limit. Vercel's Python runtime presents rewritten function
destinations such as `/api/mcp` to ASGI, so this app also accepts
`/api/healthz` and mounts the same MCP app under `/api`.
"""
from __future__ import annotations

import os

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route

from mcp_server.server import mcp

OPENAI_APPS_CHALLENGE_TOKEN_ENV = "OPENAI_APPS_CHALLENGE_TOKEN"


async def healthz(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


async def openai_apps_challenge(request: Request) -> Response:
    token = os.environ.get(OPENAI_APPS_CHALLENGE_TOKEN_ENV)
    if not token:
        return Response("not configured", status_code=404, media_type="text/plain")
    return Response(token, media_type="text/plain")


mcp_app = mcp.streamable_http_app()

app = Starlette(
    routes=[
        Route("/healthz", healthz, methods=["GET"]),
        Route("/api/healthz", healthz, methods=["GET"]),
        Route("/.well-known/openai-apps-challenge", openai_apps_challenge, methods=["GET"]),
        Route("/api/openai_apps_challenge", openai_apps_challenge, methods=["GET"]),
        Mount("/api", app=mcp_app),
        Mount("/", app=mcp_app),
    ],
    lifespan=lambda app: mcp.session_manager.run(),
)
