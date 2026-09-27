# ClueXP MCP — preview / launch runbook

Status: public, read-only provider discovery ([`specs/003`](../../specs/003-ai-assistant-discovery-handoff/spec.md)).
This is not by itself a marketplace listing; external platform submission and production credential
wiring are separate, Human-authorized launch steps.

## Safety boundary

- Use only a local/dev `/v1` API base URL unless Human + Codex authorize production wiring.
- Do not commit a real `CLUEXP_API_KEY`.
- The server exposes exactly two read-only tools, and nothing it does creates, books, dispatches, or
  cancels anything:
  - `list_services`
  - `find_providers` — up to three opted-in providers (name, recommended flag, branded intake link)
- `/mcp` needs no credentials. It is safe to expose because the tools reveal only the service catalog
  and opted-in providers' names and links. In production it sits behind a Vercel Firewall rate-limit
  rule on `/mcp`, and the `/v1` key carries its own rate limit.

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
providers:search
```

A provider appears in `find_providers` only when one of its active intake channels has
`intake_channels.ai_assistant_listed = true` (migration `0061`). ClueXP ops sets that flag on the
provider's written request (HD-6); it defaults to off.

## 3. Run the MCP server manually

From `apps/cluexp-mcp-server`:

```sh
uv run --with-requirements requirements.txt python -m mcp_server.server
```

This starts a stdio MCP server. It does not listen on a network port.

For remote HTTP mode:

```sh
uv run --with-requirements requirements.txt uvicorn mcp_server.asgi:app --host 0.0.0.0 --port 8000
```

Expected checks:

```text
GET  /healthz -> 200 {"status":"ok"}
POST /mcp (MCP initialize, no Authorization) -> 200 from the MCP app
POST /mcp with an unlisted Host header -> 421 (DNS-rebinding guard)
```

## 4. Connect an MCP client

- Claude: Settings → Connectors → Add custom connector → `https://<preview-host>/mcp`, no auth.
- ChatGPT: developer mode → add the remote MCP server URL, no auth.
- Local stdio: `examples/claude-desktop.local.example.json` or
  `examples/generic-mcp-client.local.example.json`, with placeholders replaced.

Keep real API keys outside Git. If a copied config contains a real key, do not commit it.

## 5. Manual smoke script for an MCP client

1. Ask what ClueXP can help with → `list_services` returns the catalog.
2. Ask for an urgent service at a precise address → `find_providers` returns up to three providers,
   the first marked recommended, each with an `intake_url`.
3. Ask with an ambiguous address (for example "100 Main Street") → the assistant asks which
   candidate you mean instead of listing providers.
4. Open a provider link in a private window → the branded intake opens with service and location
   pre-filled; **no ticket exists until you take the first step** (FR-011). Pasting the link into a
   chat that renders link previews must not create a ticket either.
5. Confirm no address or coordinates appear in `external_api_events` metadata or server logs.

Expected result: no ticket, job, customer, offer, or dispatch record is created by the MCP tools.

## 6. Stop conditions

Stop and ask Human + Codex before doing any of these:

- Using a production API base URL or production API key.
- Applying migration `0061` to production or flagging a production channel as listed.
- Publishing/submitting the MCP server to ChatGPT, Claude, Gemini, Siri, or any marketplace.
- Deploying the MCP server to production or changing its production environment variables.
