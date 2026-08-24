"""ClueXP MCP server -- internal preview.

Exposes exactly five tools, each a thin wrapper over one `/v1` endpoint
(see `mcp_server.client` and `docs/AGENT-INTEGRATION-MCP-PLAN.md`):
list_services, check_coverage, create_service_request, get_service_request,
get_tracking.

Deliberately does NOT expose `authorize_dispatch` or `cancel_service_request`
-- those stay out of this first internal-preview tool set per the plan doc's
own §9 recommendation (highest blast-radius actions, held back for a
separate reviewed pass). There is no code path in this module that can
reach `/v1/service-requests/{id}/dispatch-authorizations` or
`/v1/service-requests/{id}/cancellations`.

This server is not published, listed, or connected to any external agent
platform. It talks to whatever `/v1` API `CLUEXP_API_BASE_URL` points at --
pointing it at production is a deployment decision for someone else to make
deliberately, not a default of this code.
"""
from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from mcp_server import client
from mcp_server.client import ClueXPApiError

mcp = FastMCP("cluexp-mcp-server")


def _error_result(exc: ClueXPApiError) -> dict[str, Any]:
    return {
        "error": exc.error,
        "status_code": exc.status_code,
        "request_id": exc.request_id,
        "detail": exc.detail,
    }


@mcp.tool()
async def list_services() -> dict[str, Any]:
    """List the active ClueXP service catalog. Read-only, no confirmation needed."""
    try:
        return await client.list_services()
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool()
async def check_coverage(lat: float, lng: float, service_skill: str) -> dict[str, Any]:
    """Check whether a service skill is coverable at a location. Read-only, no side effects."""
    try:
        return await client.check_coverage(lat, lng, service_skill)
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool()
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
    """Create a ClueXP service request. This creates a real record -- never dispatches by itself.

    `confirm` MUST be explicitly set to true. Before calling with confirm=true, show the
    caller a summary of dispatch_scope, service_skill, and location, and get an explicit
    yes. This check is enforced here, in code, not left to the calling agent's own UX.
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


@mcp.tool()
async def get_service_request(request_reference: str) -> dict[str, Any]:
    """Read a service request's current status by its opaque reference. Read-only."""
    try:
        return await client.get_service_request(request_reference)
    except ClueXPApiError as exc:
        return _error_result(exc)


@mcp.tool()
async def get_tracking(request_reference: str) -> dict[str, Any]:
    """Read a service request's privacy-minimized tracking state. Read-only."""
    try:
        return await client.get_tracking(request_reference)
    except ClueXPApiError as exc:
        return _error_result(exc)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
