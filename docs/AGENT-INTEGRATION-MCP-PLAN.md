# Agent Integration / MCP Plan

Status: controlled production endpoint live. `apps/cluexp-mcp-server` implements the approved MCP
slice, including confirmation-gated mutating tools and a remote Streamable HTTP entrypoint. The
production MCP endpoint is live at `https://mcp.cluexp.com/mcp`, with public health at
`https://mcp.cluexp.com/healthz`. The server is not yet published/listed in any external agent
platform directory. Human approval is still required before external platform submission, public
listing, OAuth conversion, or any live `confirm=true` dispatch/cancel smoke.

Scope: how AI agents (ChatGPT, Claude, Gemini, Siri, or any MCP-speaking client) call ClueXP's public `/v1` API. This document governs the adapter boundary; it does not authorize publishing or connecting an adapter externally.

## 1. Principle

An MCP tool is a thin, typed wrapper over an existing `/v1` HTTP endpoint. A tool must never call internal store/dispatch functions directly, and must never expose `/ops`, `/provider`, technician, admin, tracking-token, or database routes. If a capability doesn't exist as a `/v1` endpoint, it is not available as a tool — the fix is a public API endpoint, not a shortcut in the adapter.

## 2. Tools

### 2.1 `list_services`
- Maps to: `GET /v1/services`
- Scope required: `services:read`
- Input: none
- Output: service catalog (id, name, description).
- Idempotent: yes (read-only).
- Confirmation: none.

### 2.2 `check_coverage`
- Maps to: `POST /v1/coverage-checks`
- Scope required: `coverage:check`
- Input: service id, location (lat/lng or address).
- Output: coverage boolean + eligible service window info.
- Idempotent: yes (read-only, no side effects, safe to retry/repeat).
- Confirmation: none.

### 2.3 `create_service_request`
- Maps to: `POST /v1/service-requests`
- Scope required: `service_requests:write`
- Input: service id, location, customer contact fields, requested window, `Idempotency-Key` (tool must generate and persist one per logical user intent, not per HTTP retry).
- Output: `request_reference` (operational id), status `received`.
- Idempotency: tool MUST reuse the same `Idempotency-Key` on retry of the same user-intended request. A new user request (e.g. "actually, book another visit") must get a new key.
- Confirmation: **required before calling**. This creates a real record. The agent must show the caller a summary (service, location, window) and get explicit yes/no before invoking. Never call opportunistically or speculatively.
- Note: creation only — this never dispatches or authorizes fulfillment (matches existing `/v1/service-requests` contract).

### 2.4 `authorize_dispatch`
- Maps to: `POST /v1/service-requests/{id}/dispatch-authorizations`
- Scope required: `service_requests:authorize`
- Input: `request_reference`, `dispatch_scope` (`private_partner` | `network`), channel, evidence reference, terms version.
- Output: authorization result, routing outcome if `network` scope.
- Idempotency: endpoint is already atomic (`ON CONFLICT (job_id) DO NOTHING`); tool passes through, does not need its own key.
- Confirmation: **required, always, no exceptions**. This can trigger a real technician offer. The agent must explicitly confirm with the caller that they want to authorize dispatch now, and must not auto-chain this after `create_service_request` without a distinct confirmation step.
- Not available: no re-offer, no overflow, no ranking override via this tool — it exposes exactly what `/v1` exposes and nothing more.

### 2.5 `get_service_request`
- Maps to: `GET /v1/service-requests/{id}`
- Scope required: `service_requests:read`
- Input: `request_reference`.
- Output: `request_reference`, `dispatch_scope`, `status`, `created_at`.
- Idempotent: yes.
- Confirmation: none.

### 2.6 `get_tracking`
- Maps to: `GET /v1/service-requests/{id}/tracking`
- Scope required: `service_requests:read`
- Input: `request_reference`.
- Output: privacy-minimized dispatch/tracking state (same shape `/v1` already returns — no raw coordinates beyond what the endpoint already discloses, no technician PII).
- Idempotent: yes.
- Confirmation: none.

### 2.7 `cancel_service_request`
- Maps to: `POST /v1/service-requests/{id}/cancellations`
- Scope required: `service_requests:cancel`
- Input: `request_reference`, `reason` (min-length validated, same as endpoint).
- Output: cancellation result (idempotent if already cancelled).
- Confirmation: **required, always**. Must state which request will be cancelled and get explicit yes/no. Idempotent replay of an already-cancelled request should be reported back as "already cancelled," not treated as an error requiring re-confirmation.

## 3. Auth model for the adapter

- The MCP server holds one external API key (client credential) per deployment/environment, configured via env var, never committed.
- A remotely deployed MCP server also requires inbound bearer auth (`CLUEXP_MCP_BEARER_TOKEN`) before requests can reach `/mcp`; missing token configuration fails closed.
- The production bearer token is an operational secret stored in Vercel. If access needs to be shared
  with a platform, reviewer, or internal tester, create a scoped distribution plan first; if custody is
  unclear, rotate the token in Vercel and redeploy.
- The MCP server does not implement its own auth scheme for the calling agent platform beyond whatever that platform requires (e.g. ChatGPT connector auth) — that is a separate, later concern and out of scope for this doc.
- Scopes are enforced server-side by `/v1` exactly as today; the MCP layer does not re-implement or bypass scope checks.

## 4. Error mapping

`/v1` returns a flat error envelope (ADR-5): `{ "error": "invalid_request", "request_id": "...", "detail": "..." }` with an HTTP status (`detail` is optional).

Mapping to MCP tool errors:
- `4xx` → tool returns a structured error result (not a thrown exception where avoidable) so the calling agent can explain to the end user in natural language, including `error` and `request_id` for support escalation.
- `404 *_not_found` → treated as "not found," not as "forbidden" (matches the API's existence-hiding convention — the adapter must not infer or expose whether a resource exists for another tenant).
- `429` (rate limit) → tool reports "rate limited, retry after X" without inventing a retry loop that could stack requests; a single retry hint is enough, no automatic silent retries for non-idempotent tools (§2.3, §2.4, §2.7).
- `5xx` → tool reports a generic "temporarily unavailable" error; no retries for non-idempotent tools without a fresh confirmation.

## 5. Audit requirements

- Every tool call must be attributable to the external API key used (already true — every `/v1` call is logged against `external_api_keys`/`external_clients` server-side).
- No additional client-side audit log is required beyond what `/v1` already writes, since the MCP layer adds no new capability, only a new transport.
- If the MCP server is later extended to log tool invocations locally (e.g. for support debugging), those logs must not duplicate or leak PII beyond what `/v1` responses already contain.

## 6. Rate limiting

- Enforced entirely server-side via existing `external_api_rate_limits` (per external client/key), unchanged by this plan.
- The MCP layer must not implement a separate limiter that could mask or double-count against the real limit; on `429` it surfaces the server's response as-is.

## 7. What is allowed vs not allowed, per platform

The safety rules apply uniformly, but the integration/discovery path is not identical by platform.

Allowed (once a reviewed, tested MCP server exists and is explicitly authorized for connection):
- Read-only tools (`list_services`, `check_coverage`, `get_service_request`, `get_tracking`) may be exposed with only the confirmation rules above.
- Mutating tools (`create_service_request`, `authorize_dispatch`, `cancel_service_request`) may be exposed only with the mandatory confirmation step enforced in the tool implementation itself, not left to the calling platform's own confirmation UX (defense in depth — some platforms' confirmation UX is not guaranteed or auditable).

Not allowed, explicitly, until separately re-scoped by Human/Codex:
- No public marketplace listing or submission of the MCP server to any platform's plugin/action store
  without a human-held publisher account, verified domain/identity where required, final listing copy,
  and reviewer/demo auth plan.
- No partner self-service provisioning via an agent conversation (an agent cannot create its own external API key).
- No payments capability of any kind.
- No private-to-network overflow, automatic re-offer, or ranking override exposed as a tool parameter.
- No tool that reads or writes internal-only data (organization directories, technician PII, raw tracking tokens, admin/provisioning endpoints).
- No live `confirm=true` dispatch/cancel smoke without a separate human authorization.

### 7.1 Platform launch/discovery matrix

| Platform | Current ClueXP state | What is possible now | What still requires owner/action |
| --- | --- | --- | --- |
| ChatGPT / OpenAI plugins | Production MCP endpoint is live and HTTPS-reachable. | Submit an MCP-backed plugin using the universal URL `https://mcp.cluexp.com/mcp` once publisher identity, domain challenge, listing assets, tool annotations, and reviewer/demo auth are ready. | OpenAI Platform publisher verification, `api.apps.write`/`api.apps.read` permissions, domain challenge at `/.well-known/openai-apps-challenge`, final terms/privacy/support URLs, demo/reviewer credentials or an OAuth plan. |
| Claude / Anthropic | Remote MCP endpoint is compatible with Claude's URL-based MCP connector shape. | Internal/API consumers can connect by providing the MCP URL and authorization token in Anthropic's `mcp_servers`/`mcp_toolset` request config. | Any Anthropic directory/listing path, connector publishing, or customer-facing distribution still needs an Anthropic account/operator workflow; do not assume ChatGPT plugin submission also lists it in Claude. |
| Gemini / Google | Remote MCP endpoint is Streamable HTTP, which matches Gemini's documented Remote MCP transport requirement. | Gemini API / Interactions API callers can register the MCP server URL and pass auth headers. | Public Gemini/Spark/Antigravity listing, if desired, is a separate Google-side configuration/submission path; Siri-style native discovery is not achieved by MCP alone. |
| Siri / Apple Intelligence | MCP endpoint does not make ClueXP discoverable to Siri. | Website SEO and web discovery can still help general search-like assistants. | Native Siri/Apple Intelligence discovery requires an Apple app path using App Intents/App Schemas/Shortcuts and App Store/TestFlight/developer-account work. This is a separate product surface, not an MCP deployment task. |

## 8. Testing approach

- Tools are tested against a local FastAPI test client or a mocked HTTP layer, never against production `intake.cluexp.com`.
- Confirmation-gated tools (§2.3, §2.4, §2.7) get explicit unit tests asserting the confirmation step cannot be bypassed programmatically.
- Production endpoint monitoring is limited to public health and negative auth-boundary probes unless a
  separate secret custody plan is approved. Scheduled monitoring must not store the production MCP
  bearer token just to prove the positive initialize path.

## 9. Implementation status and remaining stop points

- The MCP server ships as a standalone package under `apps/cluexp-mcp-server/`.
- The preview now exposes all seven tools in §2. Mutating tools (`create_service_request`, `authorize_dispatch`, `cancel_service_request`) require `confirm=true` in the MCP tool implementation before any API request is sent.
- The production deployment exposes Streamable HTTP at `https://mcp.cluexp.com/mcp`, with public
  `GET https://mcp.cluexp.com/healthz` and fail-closed bearer auth on MCP traffic.
- `GET https://mcp.cluexp.com/.well-known/openai-apps-challenge` is implemented for OpenAI plugin
  domain verification. It returns `404` until `OPENAI_APPS_CHALLENGE_TOKEN` is set in the Vercel
  environment, then returns that exact token as `text/plain`.
- A scheduled GitHub Actions workflow (`mcp-production-health`) checks `/healthz` and verifies no-token
  / wrong-token requests to `/mcp` remain rejected.
- Remaining stop points: external connector/marketplace submission, OAuth/user-auth conversion if a
  platform requires it, positive production MCP initialize monitoring with real bearer custody, and any
  live dispatch/cancel smoke still require explicit Human + Codex authorization.
