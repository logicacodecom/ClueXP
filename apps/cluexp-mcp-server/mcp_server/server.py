"""ClueXP MCP server -- public, read-only provider discovery (specs/003).

Two tools, each a thin wrapper over one public `/v1` endpoint:
list_services and find_providers. No sign-in: the tools only reveal the
service catalog and opted-in providers' names plus branded intake links.
The customer requests, confirms, and tracks on the web; nothing here creates,
dispatches, or cancels anything. The `/v1` API it calls is whatever
`CLUEXP_API_BASE_URL` points at -- there is no production default.
"""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlsplit

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from mcp_server import client
from mcp_server.client import ClueXPApiError

MCP_ALLOWED_HOSTS_ENV = "CLUEXP_MCP_ALLOWED_HOSTS"
DEFAULT_ALLOWED_HOSTS = (
    "localhost",
    "localhost:*",
    "127.0.0.1",
    "127.0.0.1:*",
    "testserver",
    "mcp.cluexp.com",
)
VERCEL_HOST_ENV_VARS = ("VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL")


def _split_hosts(value: str | None) -> list[str]:
    if not value:
        return []
    hosts: list[str] = []
    for raw_host in value.split(","):
        host = raw_host.strip()
        if not host:
            continue
        parsed = urlsplit(host if "://" in host else f"//{host}")
        hosts.append(parsed.netloc or parsed.path.split("/", maxsplit=1)[0])
    return hosts


def _allowed_hosts() -> list[str]:
    """Return exact Host values accepted by the MCP SDK DNS-rebinding guard.

    The MCP SDK intentionally does not support domain wildcards such as
    `*.vercel.app`; Vercel preview deployments therefore rely on Vercel's own
    runtime host env vars or on an explicit comma-separated override.
    """

    hosts: list[str] = []
    for host in DEFAULT_ALLOWED_HOSTS:
        if host not in hosts:
            hosts.append(host)

    for env_var in VERCEL_HOST_ENV_VARS:
        for host in _split_hosts(os.environ.get(env_var)):
            if host not in hosts:
                hosts.append(host)

    for host in _split_hosts(os.environ.get(MCP_ALLOWED_HOSTS_ENV)):
        if host not in hosts:
            hosts.append(host)

    return hosts


mcp = FastMCP(
    "cluexp-mcp-server",
    website_url="https://cluexp.com",
    stateless_http=True,
    transport_security=TransportSecuritySettings(allowed_hosts=_allowed_hosts()),
)

READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False, destructiveHint=False)


def _error_result(exc: ClueXPApiError) -> dict[str, Any]:
    result: dict[str, Any] = {
        "error": exc.error,
        "status_code": exc.status_code,
        "request_id": exc.request_id,
        "detail": exc.detail,
    }
    if exc.candidates:
        result["candidates"] = exc.candidates
    return result


@mcp.tool(annotations=READ_ONLY)
async def list_services() -> dict[str, Any]:
    """List the service types ClueXP providers offer (for example locksmith lockouts).

    Use this first to map what the user needs to a `service_skill` code for
    find_providers. Read-only.
    """
    try:
        return await client.list_services()
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool(annotations=READ_ONLY)
async def find_providers(
    service_skill: str,
    address: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
) -> dict[str, Any]:
    """Find up to three ClueXP provider companies that can serve a skill at a location.

    Pass `service_skill` from list_services plus either a full street `address`
    or precise `lat`/`lng` (not both). Results are ranked by ClueXP; show every
    returned provider to the user, mark the one with `recommended: true`, and let
    the user choose. Each provider has an `intake_url`: the user opens it to
    request service, confirm, and track progress on the provider's ClueXP page.
    Nothing is booked, dispatched, or confirmed by this tool, and it gives no
    ETA, price, or technician details -- never invent them.

    If the result says `address_ambiguous`, ask the user which of `candidates`
    they mean; if `address_imprecise` or `address_not_found`, ask for a full
    street address with a number. An empty `providers` list means no listed
    provider is available there right now -- say so plainly.
    """
    try:
        return await client.find_providers(service_skill=service_skill, address=address, lat=lat, lng=lng)
    except ClueXPApiError as exc:
        return _error_result(exc)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
