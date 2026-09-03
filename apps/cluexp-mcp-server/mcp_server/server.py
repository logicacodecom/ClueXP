"""ClueXP MCP server -- controlled production endpoint.

Exposes seven tools, each a thin wrapper over one `/v1` endpoint
(see `mcp_server.client` and `docs/AGENT-INTEGRATION-MCP-PLAN.md`):
list_services, check_coverage, create_service_request, get_service_request,
get_tracking, authorize_dispatch, cancel_service_request.

The mutating tools require an explicit `confirm=true` argument enforced in
this module before any HTTP request is sent. This is defense-in-depth over
whatever confirmation UX the calling agent platform may or may not provide.

The production endpoint is live at https://mcp.cluexp.com/mcp, but it is not
published/listed in any external agent-platform directory until the separate
submission step is complete. It talks to whatever `/v1` API
`CLUEXP_API_BASE_URL` points at -- pointing it at production is an explicit
deployment decision, not a code default.
"""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlsplit

from mcp.server.fastmcp import FastMCP
from mcp.server.auth.settings import AuthSettings
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from mcp_server import client
from mcp_server.client import ClueXPApiError
from mcp_server.oauth import JwtTokenVerifier, load_oauth_config, oauth_security_schemes

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


oauth_config = load_oauth_config()
oauth_enabled = oauth_config is not None
oauth_scope = oauth_config.required_scope if oauth_config else "cluexp:use"

mcp = FastMCP(
    "cluexp-mcp-server",
    website_url="https://cluexp.com",
    stateless_http=True,
    token_verifier=JwtTokenVerifier(oauth_config) if oauth_config else None,
    auth=(
        AuthSettings(
            issuer_url=oauth_config.issuer,
            resource_server_url=oauth_config.resource_server_url,
            required_scopes=[oauth_config.required_scope],
        )
        if oauth_config
        else None
    ),
    transport_security=TransportSecuritySettings(allowed_hosts=_allowed_hosts()),
)


def _error_result(exc: ClueXPApiError) -> dict[str, Any]:
    return {
        "error": exc.error,
        "status_code": exc.status_code,
        "request_id": exc.request_id,
        "detail": exc.detail,
    }


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=True,
        openWorldHint=False,
        destructiveHint=False,
    ),
    meta=oauth_security_schemes(oauth_scope),
)
async def list_services() -> dict[str, Any]:
    """List ClueXP service types that an assistant can offer to a user.

    Use this first when a user asks what ClueXP can help with. Read-only; no
    customer record is created and no confirmation is needed.
    """
    try:
        return await client.list_services()
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=True,
        openWorldHint=False,
        destructiveHint=False,
    ),
    meta=oauth_security_schemes(oauth_scope),
)
async def check_coverage(lat: float, lng: float, service_skill: str) -> dict[str, Any]:
    """Check whether ClueXP may be able to serve a requested skill near a location.

    Use before creating a request when the user gives a service location. Read-only;
    it does not reserve capacity, contact a technician, or dispatch anyone.
    """
    try:
        return await client.check_coverage(lat, lng, service_skill)
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=False,
        openWorldHint=False,
        destructiveHint=False,
    ),
    meta=oauth_security_schemes(oauth_scope),
)
async def create_service_request(
    dispatch_scope: str,
    service_skill: str,
    location: dict[str, Any],
    consent: dict[str, Any],
    confirm: bool,
    situation: str | None = None,
    urgency: str | None = None,
    customer: dict[str, Any] | None = None,
    notes: str | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Create a real ClueXP service request, but do not dispatch it.

    Use only after the user chooses the service, location, and contact details.
    This creates a real record in ClueXP. It does not authorize fulfillment or send
    a technician offer. `confirm` MUST be explicitly set to true after showing the
    caller a summary of dispatch_scope, service_skill, and location and getting a
    clear yes. This check is enforced here, in code.
    """
    if not confirm:
        return {
            "error": "confirmation_required",
            "detail": (
                "Set confirm=true only after showing the caller a summary of "
                "dispatch_scope, service_skill, and location, and getting explicit yes. "
                "This call was not sent to the API."
            ),
        }
    try:
        return await client.create_service_request(
            dispatch_scope=dispatch_scope,
            service_skill=service_skill,
            location=location,
            consent=consent,
            situation=situation,
            urgency=urgency,
            customer=customer,
            notes=notes,
            idempotency_key=idempotency_key,
        )
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=True,
        openWorldHint=False,
        destructiveHint=False,
    ),
    meta=oauth_security_schemes(oauth_scope),
)
async def get_service_request(request_reference: str) -> dict[str, Any]:
    """Read a ClueXP service request's current status by opaque request reference.

    Read-only; use when the user asks for request status or wants to verify what
    was created.
    """
    try:
        return await client.get_service_request(request_reference)
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=True,
        openWorldHint=False,
        destructiveHint=False,
    ),
    meta=oauth_security_schemes(oauth_scope),
)
async def get_tracking(request_reference: str) -> dict[str, Any]:
    """Read privacy-minimized tracking state for a ClueXP service request.

    Read-only; returns only what the public tracking endpoint exposes, not raw
    internal dispatch data or technician PII.
    """
    try:
        return await client.get_tracking(request_reference)
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=False,
        openWorldHint=True,
        destructiveHint=True,
    ),
    meta=oauth_security_schemes(oauth_scope),
)
async def authorize_dispatch(
    request_reference: str,
    channel: str,
    evidence_reference: str,
    terms_version: str,
    confirm: bool,
) -> dict[str, Any]:
    """Authorize dispatch for a ClueXP service request.

    This can trigger a real technician offer for eligible network requests or move
    a private-partner request into its provider queue. `confirm` MUST be explicitly
    set to true after showing the caller the request reference, dispatch consequence,
    consent evidence, and terms version, then getting a clear yes. This check is
    enforced here, in code.
    """
    if not confirm:
        return {
            "error": "confirmation_required",
            "detail": (
                "Set confirm=true only after showing the caller the request reference, "
                "dispatch consequence, consent evidence, and terms version, and getting "
                "explicit yes. This call was not sent to the API."
            ),
        }
    try:
        return await client.authorize_dispatch(
            request_reference=request_reference,
            channel=channel,
            evidence_reference=evidence_reference,
            terms_version=terms_version,
        )
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool(
    annotations=ToolAnnotations(
        readOnlyHint=False,
        openWorldHint=False,
        destructiveHint=True,
    ),
    meta=oauth_security_schemes(oauth_scope),
)
async def cancel_service_request(request_reference: str, reason: str, confirm: bool) -> dict[str, Any]:
    """Cancel a ClueXP service request when the public API still allows cancellation.

    `confirm` MUST be explicitly set to true after showing the caller the request
    reference and cancellation reason, then getting a clear yes. This check is
    enforced here, in code.
    """
    if not confirm:
        return {
            "error": "confirmation_required",
            "detail": (
                "Set confirm=true only after showing the caller the request reference "
                "and cancellation reason, and getting explicit yes. This call was not "
                "sent to the API."
            ),
        }
    try:
        return await client.cancel_service_request(request_reference=request_reference, reason=reason)
    except ClueXPApiError as exc:
        return _error_result(exc)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
