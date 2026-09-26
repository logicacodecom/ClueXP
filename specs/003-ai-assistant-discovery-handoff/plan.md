# Implementation Plan: AI Assistant Provider Discovery And Web Handoff

**Spec**: [`spec.md`](spec.md)  
**Branch**: `feat/003-ai-assistant-discovery-handoff` (spec); implementation on per-phase branches from `origin/main`  
**Owner**: `Claude (implementation) · Codex (final review) · Human (product + production gates)`  
**Review Mode**: `Codex secondary review` — risky paths: MCP entrypoints/auth removal, public `/v1`
contract, migration, Vercel config, GitHub Actions monitor.

## Technical Approach

Keep ClueXP's existing shape: the MCP server stays a thin adapter over public `/v1`, and all
eligibility logic stays in the API's canonical Network Router path. The only new backend logic is
grouping the router's already-ranked eligible technicians by opted-in provider channel.

```text
Assistant ──MCP (no auth)──▶ mcp.cluexp.com
                               ├─ list_services  ─▶ GET  /v1/services
                               └─ find_providers ─▶ POST /v1/provider-matches  (scope providers:search)
                                                     ├─ geocode(address)            [geocode.py]
                                                     ├─ _network_routing_snapshot   [existing]
                                                     ├─ rank eligible techs (top_n = all)
                                                     └─ group by listed intake channel → top 3
Customer ──opens intake_url──▶ intake.cluexp.com/o/<slug>#skill=…&lat=…&lng=…&address=…&src=ai_assistant
                               (existing web flow; ticket created only on explicit customer action)
```

### `/v1/provider-matches` (phase 1)

1. Validate `service_skill` against the active catalog (existing `unknown_service_skill` path).
2. If `address` is given, call `geocode.geocode(address)`; on no result return 422
   `address_not_found`. Echo the formatted address and coordinates.
3. Run `_network_routing_snapshot(job, skill_needed=skill)` to get technicians plus org
   status/capabilities, then filter to org-eligible technicians exactly as `route_network_request`
   does, and call `rank_candidates(job, eligible, top_n=len(eligible))`.
   - Implementation note: extract the `_org_eligible` predicate from `route_network_request` into a
     module-level function reused by both. Do not duplicate it (FR-004).
4. Load listed channels: `intake_channels` where `active` and `ai_assistant_listed`, joined to
   organizations with `status='active'`, keyed by `organization_id`.
5. Walk ranked technicians in order. For each org id of a technician that has a listed channel and
   whose capabilities include the skill, emit that provider once. Stop at 3.
6. Response `data`: `{ matched_location: {formatted_address, lat, lng}, providers: [{ name,
   recommended, intake_url }] }`. Name is `intake_channels.display_name`, falling back to
   `organizations.display_name`.
7. Record `external_api_events` with `action="provider_matches.search"` and metadata
   `{skill, result_count}` only (NFR-001).

### MCP server (phase 1)

- `server.py`: delete the five request tools and the OAuth wiring. Add `find_providers(service_skill,
  address=None, lat=None, lng=None)`. Its description tells the assistant to present all returned
  providers, mark the recommended one, never invent availability or ETA, and that confirmation happens
  on the web link.
- `asgi.py`: delete `MCPBearerAuthMiddleware` and the protected-resource route. Keep `/healthz`, the
  OpenAI challenge route, and the `/api` mount for Vercel.
- Delete `oauth.py`, `api/oauth_protected_resource.py`, its `vercel.json` rewrite, `PyJWT` from
  requirements, and the OAuth/bearer tests. Update `.env.example`, `README.md`, and
  `INTERNAL-PREVIEW-RUNBOOK.md`.
- `client.py`: delete unused request functions; add `find_providers`.
- `chatgpt-app-submission.json`: two tools, no-auth security scheme (verify the current Apps SDK field
  name at implementation time).

### Intake web (phase 1)

- `IntakeFlow`: on mount, parse `location.hash` once. If it has a valid skill for this channel's
  catalog, store it as the pending selection and start at the situation step. Store location as the
  pending location. Remove the hash with `history.replaceState`.
- No network call on mount except the existing `/channels/{slug}` read. The ticket is created by the
  existing first customer action, which carries `access_type` plus the pre-filled location and
  `intake_source=ai_assistant` (FR-011).
- Backend `create_ticket`: accept `intake_source` in the sanitized payload and persist
  `origin_channel='ai_assistant'`. Observed: no constraint exists and the column is null in production.
- FR-013 re-check: at the commit step for tickets with `origin_channel='ai_assistant'`, the envelope
  includes `provider_eligible: bool`. It is computed with the same router snapshot, restricted to the
  ticket's owning org. The UI shows the notice when it is false.

### Database (phase 1)

Alembic migration `00NN_intake_channel_ai_listing`:

```sql
alter table intake_channels add column ai_assistant_listed boolean not null default false;
create unique index intake_channels_one_ai_listing_per_org
  on intake_channels (organization_id) where ai_assistant_listed;
```

No RLS change: the column sits on an existing table with existing policies. Rollback: drop the index
and column.

### Phase 2 (after phase 1 acceptance; independent of spec 002 activation per HD-9)

- Migration: `intake_handoff_tokens (id, job_id fk, token_hash, expires_at, consumed_at, created_at)`,
  default-deny RLS, and an index on `expires_at`.
- `/v1` endpoint `POST /v1/intake-drafts` with scope `intake_drafts:create`. It resolves the channel by
  slug, creates the ticket through the same `save()` path with `origin_channel='ai_assistant'`, and
  **always** holds the draft out of the queue, never taking the immediate `pending_dispatch` branch in
  `create_ticket` (FR-021). Commit activates the queue once: reuse spec 002's verified-commit
  activation, with the verification check applied only when `CLUEXP_PHONE_VERIFICATION_REQUIRED=true`. It returns `handoff_url` with the raw token in the fragment only.
- Web: `/o/<slug>/continue` page reads the fragment token and POSTs it same-origin to
  `/intake-handoff/consume`, which verifies the hash, checks expiry and single use, sets the intake
  capability cookie, and returns the resume screen (the spec 002 FR-009 pattern). Reuse spec 002's
  consume helper where it generalizes; do not fork it.
- Cleanup: an expired-draft purge in the existing scheduled sweep (FR-025).
- MCP: `prepare_service_request` tool (not destructive, not read-only, closed-world). No `confirm`
  flag is needed because it creates nothing visible to providers. Its description still requires the
  assistant to tell the user what will be shared.

## Affected Surfaces

- **Frontend**: `apps/intake-web/src/app/page.tsx` (`IntakeFlow` pre-fill, commit notice); phase 2:
  `apps/intake-web/src/app/o/[slug]/continue/page.tsx`.
- **Backend/API**: `apps/intake-web/api/main.py` (new `/v1/provider-matches`, `create_ticket` source
  attribution, commit-step eligibility flag), `dispatch.py` (extract `_org_eligible`), `store.py`
  (listed-channel query), `schema.py` (models), `docs/openapi-v1-snapshot.json`.
- **MCP**: `apps/cluexp-mcp-server/**` (tools, auth removal, tests, manifest, docs).
- **Database/storage**: `packages/db/alembic/versions/` (one migration per phase).
- **Docs/operations**: `docs/AGENT-INTEGRATION-MCP-PLAN.md`, `docs/AGENT-PLATFORM-SUBMISSION-PACKAGE.md`,
  `docs/PUBLIC-API-DEVELOPER-GUIDE.md`, `docs/SYSTEM-DESIGN.md` §20.4 (ADR-4 amendment),
  `docs/PRODUCTION-READINESS.md` (MCP section).
- **CI/release**: `.github/workflows/mcp-production-health.yml` (real tool call, Human-approved);
  existing `mcp-server`, `api`, `web`, `sdlc-policy` jobs.

## Contracts And Invariants

- MCP tool results never contain technician identity, location, distance, rating, count, ETA, price,
  or internal IDs.
- Ordering is the existing `rank_candidates` rule (distance asc, rating desc), applied identically for
  every caller.
- No MCP tool changes `jobs.status` or triggers SMS, calls, push, or provider alerts.
- `/v1` change is additive. Existing scopes and routes are untouched.
- The channel-less intake stays closed. Every AI-sourced ticket belongs to a provider channel resolved
  server-side.

## Verification Plan

- **Unit/integration**:
  - `apps/intake-web/api`: tests for `/v1/provider-matches` covering opt-in filter, inactive org,
    missing capability, unaffiliated tech excluded, ordering, cap of 3, recommended flag,
    `address_not_found`, response field allow-list, and event metadata without location. Also a test
    that `create_ticket` records `origin_channel` and that no ticket is created without customer action.
  - `apps/cluexp-mcp-server`: `uv run --with-requirements requirements-dev.txt pytest tests -q`, with
    `tests/test_local_v1_integration.py` extended to run `find_providers` against the real local `/v1`
    app.
- **Type/build**: `npm run build -w apps/intake-web`; `python -m compileall mcp_server`.
- **Migration/data**: alembic upgrade/downgrade on a scratch Postgres. Postgres-backed store tests for
  the listed-channel query (the default suite is InMemoryStore-only, so a green run alone does not
  verify SQL).
- **Tenant/RLS**: query review — the listed-channel query exposes only `display_name`/`slug` of
  opted-in channels; phase 2 token table default-deny test.
- **Public contract drift**: regenerate and diff `docs/openapi-v1-snapshot.json`; MCP `tools/list`
  snapshot test asserting exactly the two tool names and annotations.
- **Manual**: preview deploy of the MCP server and intake. Add it as a no-auth custom connector in
  Claude and in ChatGPT developer mode; run the primary scenario; open links in a private window and
  from a link-preview fetch.
- **Security/privacy**: grep logs of the preview deployment for the test address; confirm absence.

## Rollout And Rollback

- **Flags/config**: listing is opt-in per channel (default off), so shipping code lists nothing until a
  channel is flagged. Removing sign-in is gated by deploy.
- **Production approval needed**: `yes`, each separately — migration apply, `/v1` key creation
  (`services:read`, `providers:search`), Vercel env changes (remove `CLUEXP_MCP_OAUTH_*`,
  `CLUEXP_MCP_BEARER_TOKEN`; replace `CLUEXP_API_KEY`), Vercel Firewall rate-limit rule on `/mcp`,
  connecting the Vercel project to git, production deploy, and first channel opt-ins.
- **Rollback path**: unset `ai_assistant_listed` on all channels (discovery returns nothing), or revoke
  the MCP `/v1` key (tools fail closed), or promote the previous Vercel deployment. The migration is
  additive; downgrade drops the column and index.

## Open Questions

- Exact no-auth declaration for the OpenAI Apps SDK manifest and Claude directory requirements (verify
  against current platform docs before submission; not needed for custom-connector testing).
- Whether `IntakeFlow` can start at the situation step with a pending skill without refactoring the
  opener → ticket-creation coupling (`page.tsx` creates the ticket when the skill is chosen). If not,
  the pre-filled skill is simply pre-selected on the opener, and the customer taps once.
- Phase 2 draft endpoint vs. extending `POST /v1/service-requests`: that endpoint requires
  `consent.terms_accepted=true` at creation, which an assistant cannot truthfully give. A separate draft
  endpoint is proposed.
