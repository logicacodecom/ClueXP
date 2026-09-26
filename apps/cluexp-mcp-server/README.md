# ClueXP MCP Server — public provider discovery

**Status:** controlled production endpoint at `https://mcp.cluexp.com/mcp`, with public health at
`https://mcp.cluexp.com/healthz`. It is not published or listed in any external assistant directory
until the separate submission step is completed. Design:
[`specs/003-ai-assistant-discovery-handoff`](../../specs/003-ai-assistant-discovery-handoff/spec.md).

## What this is

A thin [MCP](https://modelcontextprotocol.io) server that lets any personal AI assistant (Claude,
ChatGPT, Gemini, or another MCP client) discover ClueXP services and providers by location. It has
two read-only tools, each a direct wrapper over one public `/v1` endpoint:

- `list_services` -> `GET /v1/services`
- `find_providers` -> `POST /v1/provider-matches`: up to three provider companies that opted in to
  assistant listing and can serve the skill at the location, in ClueXP's Network Router order. The
  first is marked `recommended`. Each result carries only a name and a branded intake link.

The customer requests, verifies, confirms, and tracks service **on the web** through that link.
Nothing in this server creates, books, dispatches, or cancels anything, and it never returns
technician identity, ETA, price, or ratings.

Addresses are accepted only when they geocode to exactly one full, street-precise match. Otherwise
the tool returns `address_not_found`, `address_ambiguous` (with `candidates`), `address_imprecise`,
or `geocoding_unavailable`, so the assistant asks the user rather than guessing.

## Configuration

Required environment variables, no defaults, no committed secrets:

- `CLUEXP_API_BASE_URL` — base URL of the `/v1` API to call. There is no default, and in particular
  no default pointing at production.
- `CLUEXP_API_KEY` — an external API key with only `services:read` and `providers:search`.
- `CLUEXP_MCP_ALLOWED_HOSTS` — optional comma-separated exact Host values for the MCP SDK
  DNS-rebinding guard. Defaults already include local/test hosts and `mcp.cluexp.com`; Vercel's
  `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` runtime hosts are also accepted automatically. The
  SDK matches exact hosts only (plus `host:*` port wildcards), so do not use `*.vercel.app`.
- `OPENAI_APPS_CHALLENGE_TOKEN` — optional domain-verification token for OpenAI submission. When set,
  `GET /.well-known/openai-apps-challenge` returns it as `text/plain`; when unset, it returns `404`.

`/mcp` is public, with no sign-in. That is intentional: the tools reveal only the service catalog and
opted-in providers' names and links. Production relies on a Vercel Firewall rate-limit rule on
`/mcp` plus the `/v1` key's own rate limit.

Production is hosted on the Vercel project `cluexp-mcp-server` under `logicacode-projects`. Secret
values live only in Vercel's environment store.

## Running locally

```
cd apps/cluexp-mcp-server
uv run --with-requirements requirements.txt python -m mcp_server.server
```

This starts the MCP server over stdio for a local MCP client. It does not open a network port.

## Running as a remote HTTP MCP server

```
cd apps/cluexp-mcp-server
uv run --with-requirements requirements.txt uvicorn mcp_server.asgi:app --host 0.0.0.0 --port 8000
```

```
GET  /healthz                              -> public health check
GET  /.well-known/openai-apps-challenge    -> optional OpenAI domain verification
POST /mcp                                  -> Streamable HTTP MCP endpoint (no credentials)
```

A Dockerfile is included for container hosts. For the step-by-step preview procedure, see
[`INTERNAL-PREVIEW-RUNBOOK.md`](INTERNAL-PREVIEW-RUNBOOK.md). Placeholder-only client configs live
under [`examples/`](examples/). Platform submission prep lives in
[`docs/AGENT-PLATFORM-SUBMISSION-PACKAGE.md`](../../docs/AGENT-PLATFORM-SUBMISSION-PACKAGE.md).

## Tests

```
cd apps/cluexp-mcp-server
uv run --with-requirements requirements-dev.txt pytest tests -q
```

All tests use `httpx.MockTransport` (no real sockets) or monkeypatch the client module directly;
nothing here talks to production. `tests/test_local_v1_integration.py` also runs both tools against
the real local FastAPI `/v1` app via `httpx.ASGITransport` and proves that no ticket, job, offer, or
dispatch record is created.
