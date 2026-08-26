# ClueXP agent-platform submission package

Status: production MCP endpoint is live; external platform submission/listing is not complete.

Use this package when submitting or configuring ClueXP in ChatGPT/OpenAI, Claude/Anthropic, Gemini/Google, or Apple/Siri channels. Do not paste production secrets into tickets, docs, screenshots, or handoff logs.

## Stable endpoints

- MCP server URL: `https://mcp.cluexp.com/mcp`
- Health check: `https://mcp.cluexp.com/healthz`
- OpenAI domain challenge URL: `https://mcp.cluexp.com/.well-known/openai-apps-challenge`
- Public API base used by MCP server: `https://api.cluexp.com`

## Suggested listing copy

Name:

```text
ClueXP
```

Short description:

```text
Check service coverage and create, track, authorize, or cancel ClueXP service requests with explicit user confirmation.
```

Long description:

```text
ClueXP helps people request service from hosted partners and the ClueXP network through a privacy-aware, confirmation-gated workflow. Assistants can list supported services, check coverage for a location, create a service request, read status/tracking, authorize dispatch, and cancel when the public API still allows it. Creation, dispatch authorization, and cancellation require an explicit confirmation flag enforced by the MCP server before any real write happens.
```

Safety / review note:

```text
The MCP server exposes only public /v1 API-backed tools. It does not expose internal admin, provider, technician, database, payment, ranking override, or dispatch-override routes. Mutating tools require confirm=true in server-side code and return confirmation_required without touching the API when confirm=false.
```

Support / contact placeholders:

```text
Support URL: https://cluexp.com/contact
Privacy Policy URL: https://cluexp.com/privacy
Terms URL: https://cluexp.com/terms
```

Update the URLs above if the public website uses different canonical paths before submission.

## Tool inventory for reviewers

| Tool | Type | User-visible purpose | Confirmation required |
| --- | --- | --- | --- |
| `list_services` | Read | Show service types ClueXP can help with. | No |
| `check_coverage` | Read | Check whether a service may be available near a user location. | No |
| `create_service_request` | Write | Create a real ClueXP service request, without dispatch. | Yes, `confirm=true` |
| `get_service_request` | Read | Read current request status by opaque reference. | No |
| `get_tracking` | Read | Read privacy-minimized tracking state. | No |
| `authorize_dispatch` | Write | Authorize fulfillment/dispatch; may trigger a technician offer. | Yes, `confirm=true` |
| `cancel_service_request` | Write | Cancel a request when allowed by the public API. | Yes, `confirm=true` |

## Review test plan

Run these with test/synthetic data only unless the Human separately approves a live proof run.

1. Connect to `https://mcp.cluexp.com/mcp` with the approved bearer token.
2. Initialize/list tools and confirm exactly the seven tools above are visible.
3. Ask: "What services can ClueXP help with?" Expected: `list_services`.
4. Ask: "Can ClueXP help with [supported service] near [test location]?" Expected: `check_coverage`.
5. Attempt to create a request with `confirm=false`. Expected: structured `confirmation_required`; no API write.
6. Attempt to authorize dispatch with `confirm=false`. Expected: structured `confirmation_required`; no dispatch.
7. Attempt to cancel with `confirm=false`. Expected: structured `confirmation_required`; no cancellation.
8. Read a nonexistent/synthetic request reference. Expected: API-shaped not-found/permission-safe error with `request_id` when provided.
9. Confirm unsupported requests are refused by the assistant or answered without calling internal/unavailable tools:
   - "Take payment."
   - "Assign a specific technician manually."
   - "Show technician private phone/GPS."
   - "Override network ranking."

## ChatGPT / OpenAI submission checklist

Current official OpenAI plugin submission docs require a public MCP server URL, domain verification for the MCP host, review materials, and appropriate publisher permissions.

- Verify the OpenAI Platform organization/publisher identity for the name ClueXP will publish under.
- Confirm the submitting user has `api.apps.write`; reviewers/status viewers need `api.apps.read`.
- Create the plugin draft with MCP server URL `https://mcp.cluexp.com/mcp`.
- If asked for a challenge base URL, use `https://mcp.cluexp.com`.
- When the portal provides the challenge token:
  1. Set `OPENAI_APPS_CHALLENGE_TOKEN` in the Vercel project `cluexp-mcp-server`.
  2. Redeploy production.
  3. Verify `https://mcp.cluexp.com/.well-known/openai-apps-challenge` returns only the exact token as `text/plain`.
  4. Complete "Verify Domain" in the OpenAI portal.
- Use the listing copy and review test plan above.
- Provide demo/reviewer auth through the platform-approved flow. Do not paste the production bearer token into docs or issue comments.

Sources checked 2026-08-26:

- OpenAI plugin submission: https://developers.openai.com/plugins/deploy/submission
- OpenAI MCP server review requirements: https://developers.openai.com/plugins/deploy/app-review
- OpenAI connect/test guide: https://developers.openai.com/plugins/deploy/connect-chatgpt

## Claude / Anthropic configuration

Claude's API can connect to remote MCP servers directly from the Messages API MCP connector. This is an integration path, not proof of a public directory listing.

Example request-tool config shape:

```json
[
  {
    "type": "mcp_server",
    "name": "cluexp",
    "url": "https://mcp.cluexp.com/mcp",
    "authorization_token": "replace-with-platform-held-token"
  }
]
```

For Claude Code or Claude Desktop, prefer the platform's current remote-MCP configuration UI/CLI and store the bearer token in the user's secret store, not in repository files.

Sources checked 2026-08-26:

- Anthropic MCP connector: https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector
- Anthropic remote MCP servers: https://docs.anthropic.com/en/docs/agents-and-tools/remote-mcp-servers

## Gemini / Google configuration

Gemini supports remote MCP servers over Streamable HTTP. The ClueXP server uses Streamable HTTP at `/mcp`; do not configure it as SSE.

Example tool config shape:

```json
[
  {
    "type": "mcp_server",
    "name": "cluexp",
    "url": "https://mcp.cluexp.com/mcp",
    "headers": {
      "Authorization": "Bearer replace-with-platform-held-token"
    }
  }
]
```

Sources checked 2026-08-26:

- Gemini function calling / MCP server tool: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini Agents API MCPServer schema: https://ai.google.dev/api/agents

## Siri / Apple path

Siri/Apple Intelligence discovery is not achieved by MCP. Apple's path is native app integration using App Intents, App Entities, App Schemas, Spotlight/Shortcuts exposure, and App Store/TestFlight/developer-account workflows.

Minimum product slice for Apple:

- Define ClueXP actions as App Intents: check coverage, create request, get status/tracking, cancel request.
- Map service/request records to App Entities only where privacy and data retention rules allow it.
- Preserve ClueXP's confirmation/finality boundary for create, dispatch authorization, and cancellation.
- Implement in an iOS app or app extension, test with App Intents Testing, then distribute through the Apple developer path.

Sources checked 2026-08-26:

- Apple Intelligence overview: https://developer.apple.com/apple-intelligence/
- App Intents docs: https://developer.apple.com/documentation/appintents
- App schema domains: https://developer.apple.com/documentation/appintents/app-schema-domains
