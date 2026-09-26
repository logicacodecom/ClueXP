# Agent Integration / MCP Plan

Status: public, read-only provider discovery per
[`specs/003-ai-assistant-discovery-handoff`](../specs/003-ai-assistant-discovery-handoff/spec.md)
(Human decisions HD-1..HD-9, 2026-09-26). The production MCP endpoint is `https://mcp.cluexp.com/mcp`,
with public health at `https://mcp.cluexp.com/healthz`. The server is not yet published or listed in any
external agent-platform directory; that remains a separate, Human-authorized step.

Scope: how AI assistants (ChatGPT, Claude, Gemini, or any MCP-speaking client) discover ClueXP services
and providers. This document governs the adapter boundary; it does not authorize publishing or
connecting an adapter externally.

## 1. Principle

An MCP tool is a thin, typed wrapper over an existing `/v1` HTTP endpoint. A tool must never call
internal store/dispatch functions directly, and must never expose `/ops`, `/provider`, technician,
admin, tracking-token, or database routes.

**The assistant discovers; the web transacts.** Tools only reveal the service catalog and opted-in
providers' names and branded intake links. Requesting, phone verification, price, terms, confirmation,
provider dispatch, and tracking all happen on the provider's ClueXP intake page, which the customer
opens from the link. No tool creates, books, dispatches, or cancels anything.

## 2. Tools

### 2.1 `list_services`
- Maps to: `GET /v1/services`
- Scope required: `services:read`
- Output: service catalog (categories and skill codes).
- Read-only; no confirmation.

### 2.2 `find_providers`
- Maps to: `POST /v1/provider-matches`
- Scope required: `providers:search`
- Input: `service_skill` plus exactly one of `address` or `lat`+`lng`.
- Output: `matched_location` (the formatted address and coordinates matched) and up to three
  `providers`, each only `{name, recommended, intake_url}`.
  - Providers are listed only when an intake channel opted in (`intake_channels.ai_assistant_listed`,
    set by ClueXP ops on the provider's written request).
  - The organization must be active, and at least one technician must be eligible **through that
    organization's own affiliation**.
  - Order is the Network Router's deterministic rule (distance, then rating), and the first result is
    `recommended`.
- Address rule: accepted only when the geocoder returns exactly one full, `ROOFTOP` or
  `RANGE_INTERPOLATED` match. Otherwise the tool returns one of these, and never guesses:
  - `address_not_found`;
  - `address_ambiguous`, with up to three `candidates`;
  - `address_imprecise`;
  - `geocoding_unavailable`.
- `intake_url` is `https://intake.cluexp.com/o/<slug>#skill=…&lat=…&lng=…&address=…&src=ai_assistant`. The
  pre-fill rides in the fragment, so location never reaches server logs. Opening the link creates
  nothing; a ticket exists only after the customer's first tap.
- Never returns technician identity, count, location, distance, rating, ETA, price, or internal IDs.
- Read-only; no confirmation.

### 2.3 Phase 2 (specified, not built): `prepare_service_request`
A draft the assistant pre-fills for the chosen provider, handed off through a single-use, expiring link.
Drafts live in an isolated table and never touch `jobs`/`customers` or any provider view until the
customer commits on the web, in one transaction. See `specs/003` FR-020..FR-028.

## 3. Auth model for the adapter

- The MCP endpoint is **public (no sign-in)**. This is safe because tools expose only the catalog and
  opted-in providers' names and links.
- The MCP server holds one external API key per deployment, with only `services:read` and
  `providers:search`, configured via env var and never committed.
- Abuse limits: a Vercel Firewall rate-limit rule on `/mcp` (per IP) plus the `/v1` key's own rate
  limit. The earlier OAuth resource server and internal-preview bearer token were removed.
- Scopes are enforced server-side by `/v1`; the MCP layer does not re-implement or bypass them.

## 4. Error mapping

`/v1` returns a flat error envelope (ADR-5): `{ "error": "...", "request_id": "...", "detail": "..." }`,
plus `candidates` for `address_ambiguous`. Tools return that envelope as a structured result, not a
thrown exception, so the assistant can ask the user to clarify. `429` and `5xx` are surfaced as-is; the
adapter never retries silently.

## 5. Audit and privacy

- Every call is attributable to the MCP deployment's external API key (`external_api_events`).
- `provider_matches.search` events record only `service_skill`, `outcome`, and `result_count`, never
  the address, coordinates, or links (NFR-001). The MCP server does not log tool arguments or results.
- AI-sourced intakes are attributed with `jobs.origin_channel = 'ai_assistant'` for conversion
  measurement only; the label is client-supplied and never used for authorization or routing.

## 6. Rate limiting

Server-side via `external_api_rate_limits` per external client, plus the Vercel Firewall rule on `/mcp`.
The MCP layer implements no separate limiter.

## 7. What is allowed vs not allowed, per platform

Not allowed, until separately re-scoped by Human/Codex:
- Public marketplace listing or submission without a human-held publisher account, verified
  domain/identity, final listing copy, and a submission spec (`specs/000` T016).
- Any tool that creates, confirms, dispatches, cancels, or pays for a request from inside an assistant.
- Any tool that reads or writes internal-only data (organization directories, technician PII, raw
  tracking tokens, admin endpoints).
- Listing a provider without its written opt-in.

### 7.1 Platform launch/discovery matrix

| Platform | What works now (no auth) | What still requires owner/action |
| --- | --- | --- |
| ChatGPT / OpenAI | Developer mode can add `https://mcp.cluexp.com/mcp` as a remote MCP server. The submission manifest (`apps/cluexp-mcp-server/chatgpt-app-submission.json`) describes the two read-only tools. | Publisher verification, domain challenge at `/.well-known/openai-apps-challenge`, final terms/privacy/support URLs, and confirming the no-auth declaration against current Apps SDK docs. |
| Claude / Anthropic | Users can add a custom connector with the MCP URL and no auth; API callers pass the URL in `mcp_servers` with no token. | Any Anthropic directory listing path. |
| Gemini / Google | Remote MCP over Streamable HTTP can be registered by URL with no headers. | Any Google-side public listing. |
| Siri / Apple Intelligence | Not reachable through MCP. | A native App Intents/App Store path; a separate product surface. |

## 8. Testing approach

- Tools are tested against a mocked HTTP layer and against the real local FastAPI `/v1` app via
  `httpx.ASGITransport`, never against production.
- `/v1/provider-matches` tests cover the opt-in filter, per-org eligibility including multi-org
  technicians, null-org platform channels, ordering and the cap, the response allow-list, every
  address outcome, and log/event privacy.
- The production health monitor calls `list_services` through `/mcp`, so it turns red if the `/v1`
  key or API wiring breaks (specs/003 FR-017).

## 9. Implementation status and remaining stop points

- Phase 1 is implemented in this repository (MCP server, `/v1/provider-matches`, migration `0061`,
  intake fragment pre-fill, commit-step provider re-check).
- Production stop points, each requiring explicit Human authorization for the exact target:
  - applying migration `0061`;
  - creating the scoped production `/v1` key;
  - Vercel env changes (remove the OAuth and bearer variables; set the new key);
  - the Firewall rule;
  - a git-connected production deploy;
  - the first channel opt-ins;
  - decommissioning the Auth0 dev tenant client.
