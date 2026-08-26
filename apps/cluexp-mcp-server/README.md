# ClueXP MCP Server — controlled preview

**Status: controlled preview / launch candidate.** The server supports local stdio and remote
Streamable HTTP deployment, but it is not published, listed, or submitted to any external
agent platform (ChatGPT, Claude, Gemini, Siri, or otherwise) until the external platform
submission step is completed. See `docs/AGENT-INTEGRATION-MCP-PLAN.md` for the full design.

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

Required environment variables, no defaults, no committed secrets:

- `CLUEXP_API_BASE_URL` — base URL of the `/v1` API to call (e.g. a local dev server).
  There is no default, and in particular no default pointing at production — pointing
  this at `https://intake.cluexp.com` is a deliberate choice made by whoever runs the
  server, not something this code assumes.
- `CLUEXP_API_KEY` — an external API key with the scopes needed for the tools you intend
  to use (`services:read`, `coverage:check`, `service_requests:write`,
  `service_requests:authorize`, `service_requests:read`, `service_requests:cancel`).
  Never commit a real key.
- `CLUEXP_MCP_BEARER_TOKEN` — required for the remote HTTP `/mcp` endpoint. `/healthz`
  remains public for hosting checks. If this token is missing, remote MCP calls fail closed
  with `503 mcp_auth_not_configured`.
- `CLUEXP_MCP_ALLOWED_HOSTS` — optional comma-separated exact Host values for the MCP
  SDK DNS-rebinding guard. Defaults already include local/test hosts and `mcp.cluexp.com`;
  Vercel's `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` runtime hosts are also accepted
  automatically when present. Do not use wildcard values such as `*.vercel.app`; the SDK
  matches exact hosts only, plus `host:*` port wildcards.

## Running locally

```
cd apps/cluexp-mcp-server
uv run --with-requirements requirements.txt python -m mcp_server.server
```

This starts the MCP server over stdio, for a local MCP-speaking client (e.g. an editor's
MCP integration) to connect to. It does not open a network port and is not reachable
remotely.

## Running as a remote HTTP MCP server

```
cd apps/cluexp-mcp-server
uv run --with-requirements requirements.txt uvicorn mcp_server.asgi:app --host 0.0.0.0 --port 8000
```

The remote endpoint is:

```
GET  /healthz  -> public health check
POST /mcp      -> Streamable HTTP MCP endpoint, requires Authorization: Bearer <CLUEXP_MCP_BEARER_TOKEN>
```

A Dockerfile is included for container hosts. Production deployment must set
`CLUEXP_API_BASE_URL=https://api.cluexp.com`, a scoped production `CLUEXP_API_KEY`, and
`CLUEXP_MCP_BEARER_TOKEN` in the hosting platform's secret manager. On Vercel,
`CLUEXP_MCP_ALLOWED_HOSTS=mcp.cluexp.com` is sufficient for production; preview
deployments can rely on Vercel's runtime `VERCEL_URL` or add an exact preview alias if
needed for smoke testing.

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
