# ClueXP MCP Server — internal preview

**Status: internal preview only.** Not published, listed, or submitted to any external
agent platform (ChatGPT, Claude, Gemini, Siri, or otherwise). Not connected to production
by default, and never should be without a separate, explicit decision. See
`docs/AGENT-INTEGRATION-MCP-PLAN.md` for the full design and open decisions this skeleton
implements for local/internal preview.

## What this is

A thin [MCP](https://modelcontextprotocol.io) server exposing seven tools, each a
direct wrapper over one `/v1` endpoint of the ClueXP public API. No tool calls internal
store/dispatch code or any non-`/v1` route.

Tools exposed:

- `list_services` -> `GET /v1/services`
- `check_coverage` -> `POST /v1/coverage-checks`
- `create_service_request` -> `POST /v1/service-requests` (requires `confirm=true`, enforced in code)
- `get_service_request` -> `GET /v1/service-requests/{id}`
- `get_tracking` -> `GET /v1/service-requests/{id}/tracking`
- `authorize_dispatch` -> `POST /v1/service-requests/{id}/dispatch-authorizations` (requires `confirm=true`, enforced in code)
- `cancel_service_request` -> `POST /v1/service-requests/{id}/cancellations` (requires `confirm=true`, enforced in code)

## Configuration

Two required environment variables, no defaults, no committed secrets:

- `CLUEXP_API_BASE_URL` — base URL of the `/v1` API to call (e.g. a local dev server).
  There is no default, and in particular no default pointing at production — pointing
  this at `https://intake.cluexp.com` is a deliberate choice made by whoever runs the
  server, not something this code assumes.
- `CLUEXP_API_KEY` — an external API key with the scopes needed for the tools you intend
  to use (`services:read`, `coverage:check`, `service_requests:write`,
  `service_requests:authorize`, `service_requests:read`, `service_requests:cancel`).
  Never commit a real key.

## Running locally

```
cd apps/cluexp-mcp-server
uv run --with-requirements requirements.txt python -m mcp_server.server
```

This starts the MCP server over stdio, for a local MCP-speaking client (e.g. an editor's
MCP integration) to connect to. It does not open a network port and is not reachable
remotely.

For a safer step-by-step internal preview procedure, see
[`INTERNAL-PREVIEW-RUNBOOK.md`](INTERNAL-PREVIEW-RUNBOOK.md). Placeholder-only MCP client
config examples live under [`examples/`](examples/).

## Tests

```
cd apps/cluexp-mcp-server
uv run --with-requirements requirements-dev.txt pytest tests -q
```

All tests use `httpx.MockTransport` (no real sockets) or monkeypatch the client module
directly — nothing here talks to production or any real service.

`tests/test_local_v1_integration.py` additionally proves the MCP tools against the
real local FastAPI `/v1` app via `httpx.ASGITransport`; it still opens no socket and uses
only an in-memory external API client/key fixture.

## Confirmation policy

The mutating tools — `create_service_request`, `authorize_dispatch`, and
`cancel_service_request` — each take a required `confirm: bool` parameter.
Calling any of them with `confirm=false` returns a `confirmation_required` error and
**never reaches the API**. A calling agent must show the end user a summary of what will
happen and get explicit consent before setting `confirm=true`.
