# ClueXP agent-platform submission package

Status: production MCP endpoint is live as public, read-only provider discovery (specs/003); external platform submission/listing is not complete.

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
Find local service providers near you, then request and track help on the provider's ClueXP page.
```

Long description:

```text
ClueXP helps people find local service help. Assistants can list the services ClueXP providers offer and, for a street address, show up to three provider companies that can help there, ranked by ClueXP. Each result links to that provider's ClueXP page, where the user requests service, verifies their phone, sees the price, confirms, and tracks progress. The app never books, dispatches, or charges from the chat, and never shares technician details, ETAs, or prices.
```

Safety / review note:

```text
The MCP server exposes two read-only tools backed by the public /v1 API: list_services and find_providers. It needs no sign-in because it returns only the service catalog and opted-in providers' names and links. It creates no records and exposes no admin, provider, technician, payment, ranking-override, or dispatch routes. Ambiguous or imprecise addresses are rejected so the assistant asks the user instead of guessing.
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
| `list_services` | Read | Show the service types ClueXP providers offer. | No |
| `find_providers` | Read | Show up to three ClueXP-ranked providers for a service at an address, each with a link to request help on the web. | No |

## Review test plan

Run with synthetic data only unless the Human separately approves a live proof run.

1. Connect to `https://mcp.cluexp.com/mcp` with no authentication.
2. Initialize/list tools and confirm exactly the two tools above are visible, both read-only.
3. Ask: "What services can ClueXP help with?" Expected: `list_services`.
4. Ask: "I'm locked out at [precise test address]. Who can help?" Expected: `find_providers` returns up
   to three providers with one recommended, each with a link; nothing is booked.
5. Ask with an ambiguous address ("100 Main Street"). Expected: `address_ambiguous` with candidates;
   the assistant asks which one instead of listing providers.
6. Open a returned link. Expected: the provider's intake opens with service and location pre-filled; no
   request exists until the user acts.
7. Confirm unsupported requests are refused or redirected to the link without calling other tools:
   - "Book the locksmith and send them now."
   - "Take payment."
   - "Show the technician's phone or GPS."
   - "Override ClueXP's ranking."

## ChatGPT / OpenAI submission checklist

- Verify the OpenAI Platform organization/publisher identity for the name ClueXP will publish under.
- Confirm the submitting user has `api.apps.write`; reviewers/status viewers need `api.apps.read`.
- Create the plugin draft with MCP server URL `https://mcp.cluexp.com/mcp` and **no authentication**.
  Confirm the current Apps SDK no-auth declaration before submitting; the draft manifest is
  `apps/cluexp-mcp-server/chatgpt-app-submission.json`.
- If asked for a challenge base URL, use `https://mcp.cluexp.com`.
- When the portal provides the challenge token:
  1. Set `OPENAI_APPS_CHALLENGE_TOKEN` in the Vercel project `cluexp-mcp-server`.
  2. Redeploy production (Human-authorized).
  3. Verify `https://mcp.cluexp.com/.well-known/openai-apps-challenge` returns only the exact token as `text/plain`.
  4. Complete "Verify Domain" in the OpenAI portal.
- Use the listing copy and review test plan above. Submission itself needs its own spec (`specs/000` T016).

Sources checked 2026-08-26 (re-verify before submission):

- OpenAI plugin submission: https://developers.openai.com/plugins/deploy/submission
- OpenAI MCP server review requirements: https://developers.openai.com/plugins/deploy/app-review
- OpenAI connect/test guide: https://developers.openai.com/plugins/deploy/connect-chatgpt

## Claude / Anthropic configuration

Users can add ClueXP in Claude as a custom connector with the URL `https://mcp.cluexp.com/mcp` and no
authentication. API callers use the Messages API MCP connector:

```json
[
  {
    "type": "url",
    "name": "cluexp",
    "url": "https://mcp.cluexp.com/mcp"
  }
]
```

A public Anthropic directory listing is a separate path and is not implied by this configuration.

Sources checked 2026-08-26 (re-verify before submission):

- Anthropic MCP connector: https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector
- Anthropic remote MCP servers: https://docs.anthropic.com/en/docs/agents-and-tools/remote-mcp-servers

## Gemini / Google configuration

Gemini supports remote MCP servers over Streamable HTTP. The ClueXP server uses Streamable HTTP at
`/mcp`; do not configure it as SSE. No headers are needed.

```json
[
  {
    "type": "mcp_server",
    "name": "cluexp",
    "url": "https://mcp.cluexp.com/mcp"
  }
]
```

Sources checked 2026-08-26 (re-verify before submission):

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
