# ClueXP MCP — internal local preview runbook

Status: local/internal preview only. This is not a marketplace listing, public connector, production deployment, or permission to use production credentials.

## Safety boundary

- Use only a local/dev `/v1` API base URL.
- Use only a non-production external API key.
- Do not point `CLUEXP_API_BASE_URL` at `https://intake.cluexp.com` unless Human + Codex separately authorize a production MCP preview.
- Do not commit a real `CLUEXP_API_KEY`.
- First preview exposes exactly five tools:
  - `list_services`
  - `check_coverage`
  - `create_service_request`
  - `get_service_request`
  - `get_tracking`
- `authorize_dispatch` and `cancel_service_request` are intentionally absent.

## 1. Verify the package locally

From `apps/cluexp-mcp-server`:

```sh
uv run --with-requirements requirements-dev.txt pytest tests -q
uv run --with-requirements requirements.txt python -m compileall mcp_server
```

Expected result: all tests pass. The integration proof uses `httpx.ASGITransport` against the local FastAPI app and opens no socket.

## 2. Prepare local environment values

Start from `.env.example`, but keep real values in your shell or local MCP client config only:

```sh
CLUEXP_API_BASE_URL=http://127.0.0.1:8000
CLUEXP_API_KEY=<local-dev-api-key>
```

The key should have only these scopes:

```text
services:read
coverage:check
service_requests:write
service_requests:read
```

## 3. Run the MCP server manually

From `apps/cluexp-mcp-server`:

```sh
uv run --with-requirements requirements.txt python -m mcp_server.server
```

This starts a stdio MCP server. It does not listen on a network port.

## 4. Connect a local MCP client

Use one of the examples in `examples/` and replace placeholders:

- `examples/claude-desktop.local.example.json` — Windows-oriented example for a Claude Desktop-style MCP config.
- `examples/generic-mcp-client.local.example.json` — generic stdio MCP client shape.

Keep real API keys outside Git. If a copied config contains a real key, do not commit it.

## 5. Manual smoke script for an MCP client

In the connected MCP client, use this order:

1. Call `list_services`.
2. Call `check_coverage` with a known local/dev service skill and location.
3. Call `create_service_request` with `confirm=false`; verify it returns `confirmation_required`.
4. Summarize the request to the human.
5. Only after explicit yes, call `create_service_request` with `confirm=true`.
6. Call `get_service_request` with the returned request reference.
7. Call `get_tracking` with the returned request reference.

Expected result: one local/dev service request record is created. No dispatch authorization, cancellation, technician offer, production DB write, or real customer/provider action occurs.

## 6. Stop conditions

Stop and ask Human + Codex before doing any of these:

- Using production API base URL or production API key.
- Publishing/submitting the MCP server to ChatGPT, Claude, Gemini, Siri, or any marketplace.
- Adding `authorize_dispatch` or `cancel_service_request`.
- Deploying the MCP server as a remotely reachable service.
