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
2. If `address` is given, call a new `geocode.geocode_candidates(address)` helper. It returns the
   geocoder status plus every result's `formatted_address`, `lat`/`lng`, `location_type`,
   `partial_match`, and `types`, instead of only `results[0]`. Apply the FR-009a acceptance rule in
   `/v1/provider-matches`. On acceptance, echo the formatted address and coordinates.
   - The existing `geocode()` and `_geocode_sync` keep their exact behavior for `GET /geocode` and
     provider manual intake. Share only the HTTP fetch, not the selection logic. A regression test
     pins the old first-result behavior.
3. Refactor `_network_routing_snapshot` to return a snapshot object `(technicians, org_status,
   org_capabilities)`. Today it returns `(technicians, routed)`, and the org maps are internal.
   `route_network_request` and provider matching then consume the same snapshot.
   - Extract `_org_eligible` into a module-level `org_eligible(org_id, skill, org_status,
     org_capabilities)`, judged **per organization**, and a technician-level wrapper
     `technician_org_eligible(tech, ...)` that keeps `route_network_request`'s current any-affiliation
     semantics. Both callers use these functions; nothing is duplicated (FR-004).
   - Filter technicians with the wrapper, then call `rank_candidates(job, eligible,
     top_n=len(eligible))` for the full ranked pool before provider deduplication.
   - Existing `/v1/coverage-checks` and dispatch-authorization results must be unchanged (regression
     tests on the refactor).
4. Load listed channels: `intake_channels` where `active`, `ai_assistant_listed`, and `organization_id
   is not null`, inner-joined to organizations with `status='active'`, keyed by `organization_id`.
   Platform channels with a null org are excluded by the inner join.
5. Walk ranked technicians in order. For each of a technician's org ids, emit that org once only if
   `org_eligible(org_id, ...)` holds **for that org itself** and it has a listed channel. Stop at 3. A
   technician's eligible affiliation with org A never admits a listed but inactive or non-capable
   org B (FR-005).
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

Design principle (resolves Codex R1): **nothing shared is written until commit.** The existing
`save()` path upserts `customers` by phone and the provider CRM reads every owned job regardless of
status, so a draft must never exist as a `jobs` row or touch `customers` before commit.

- **Migration** `00NN_intake_drafts`:
  - `intake_drafts (id uuid pk, intake_channel_id fk, organization_id fk, service_skill,
    location jsonb, situation, customer_name, customer_phone_e164, notes, handoff_token_hash unique,
    handoff_expires_at, handoff_consumed_at, expires_at, state check in ('open','committing','committed'),
    job_id uuid null references jobs(id), created_at, updated_at)`.
  - Default-deny RLS, like `intake_phone_verifications`. No FK to `customers`. Indexes on `expires_at`
    and `(customer_phone_e164, created_at)` for the per-phone cap.
  - `intake_phone_verifications`: add `draft_id uuid null references intake_drafts(id) on delete
    cascade`, drop `not null` on `job_id`, add `check (num_nonnulls(job_id, draft_id) = 1)` and an index
    on `(draft_id, created_at desc)`.
  - Downgrade reverses these; it is safe only while no draft-subject verification rows exist, and the
    runbook says to purge them first.
- **Create**: `POST /v1/intake-drafts`, scope `intake_drafts:create`.
  - Validates the channel server-side per FR-027 by re-running the phase 1 matching for that org.
  - Normalizes the phone, enforces the per-IP and per-phone caps (FR-026), and inserts **only** an
    `intake_drafts` row.
  - Returns `handoff_url = https://<intake-host>/o/<slug>/continue#t=<raw token>`. The raw token is
    never stored, and the response is never logged.
- **Consume**: `/o/<slug>/continue` reads the fragment and POSTs the token same-origin to
  `/intake-drafts/consume`.
  - That endpoint verifies the hash, expiry, and single use, then sets the draft capability cookie
    (spec 002 FR-009 pattern). Reuse spec 002's token hashing and consume helpers; do not fork them.
- **Review/edit**: `GET`/`PATCH /intake-drafts/current`, authorized by the draft cookie.
  - They read and update draft fields only. A phone change invalidates the draft's verification.
  - The price quote uses the same static table as `price_quote`, extracted into a pure function shared
    by both. Price and terms acceptance are stored on the draft.
- **Verify** (only when `CLUEXP_PHONE_VERIFICATION_REQUIRED=true`): spec 002 send/consume helpers are
  generalized to a subject (`job_id` or `draft_id`). Job-subject behavior is unchanged.
- **Commit**: `POST /intake-drafts/current/commit`.
  1. Validate every gate against the draft: price or terms acceptance, and verification of the draft
     phone when the flag is on.
  2. Conditional update `open → committing`. If the draft is already `committing` with a `job_id`,
     resume.
  3. Build the `Ticket` from the draft (`origin_channel='ai_assistant'`), `save()` it (first shared
     write, including the customer upsert), and record `job_id` on the draft.
  4. Run the shared commit/activation function. Extract the body of `commit()` into
     `_commit_ticket(ticket, ...)` so both paths use the same cutover, global kill-switch, alert, and
     tracking logic, exactly once.
  5. Conditional update to `committed`, clearing the draft's personal-data columns. Set the normal
     intake capability cookie and clear the draft cookie.
- **Cleanup**: purge `intake_drafts` rows where `state='open'` and `expires_at < now()`, or `state =
  'committing'` older than 1 h with no `job_id`. Draft-subject verifications go by cascade. The purge
  never touches `customers`, `jobs`, or job-subject verifications (FR-025). It runs in the existing
  scheduled sweep.
- **MCP**: `prepare_service_request` tool (not destructive, not read-only, closed-world).
  - No `confirm` flag, because it creates nothing any provider can see.
  - Its description requires the assistant to tell the user what will be shared and that confirmation
    happens on the web.

## Affected Surfaces

- **Frontend**: `apps/intake-web/src/app/page.tsx` (`IntakeFlow` pre-fill, commit notice); phase 2:
  `apps/intake-web/src/app/o/[slug]/continue/page.tsx`.
- **Backend/API**:
  - `apps/intake-web/api/main.py`: new `/v1/provider-matches`; `create_ticket` source attribution;
    commit-step eligibility flag; `_network_routing_snapshot` return shape. Phase 2: draft endpoints,
    `_commit_ticket` extraction, and the pure price function.
  - `dispatch.py`: `org_eligible`/`technician_org_eligible` extraction.
  - `geocode.py`: new `geocode_candidates`; existing `geocode()` unchanged.
  - `store.py`: listed-channel query. Phase 2: draft CRUD, state transitions, purge, and
    subject-generalized verification methods, in both InMemoryStore and PostgresStore.
  - `schema.py` (models) and `docs/openapi-v1-snapshot.json`.
  - Explicitly **not** changed: the `/provider/crm/customers` query, the provider queue, and
    `PostgresStore.save` customer upsert. Isolation comes from never writing drafts to `jobs`/`customers`,
    and tests prove those reads stay draft-free.
- **MCP**: `apps/cluexp-mcp-server/**` (tools, auth removal, tests, manifest, docs).
- **Database/storage**: `packages/db/alembic/versions/`. Phase 1: channel opt-in. Phase 2:
  `intake_drafts` plus the `intake_phone_verifications` subject change.
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
  - `apps/intake-web/api`, `/v1/provider-matches` tests:
    - opt-in filter, inactive org, missing capability, unaffiliated tech excluded;
    - **multi-org technician** (eligible via org A; listed org B inactive or non-capable → B not listed);
    - null-org platform channel never listed;
    - ordering, cap of 3, recommended flag, and the response field allow-list;
    - event metadata without location.
  - Router refactor regression: `/v1/coverage-checks` and `route_network_request` outputs are unchanged
    for existing fixtures.
  - Geocoding with mocked geocoder payloads (`geocode_candidates` + FR-009a):
    - two plausible results → `address_ambiguous` with candidates;
    - `partial_match` → `address_ambiguous`;
    - `APPROXIMATE`/`GEOMETRIC_CENTER` → `address_imprecise`;
    - `ZERO_RESULTS` → `address_not_found`;
    - `OVER_QUERY_LIMIT`/network error → `geocoding_unavailable`;
    - one `ROOFTOP` full match → accepted.
    - A pinned regression test proves the existing `geocode()` still returns the first result for
      `GET /geocode` and provider manual intake.
  - `create_ticket` records `origin_channel`, and no ticket is created without customer action.
  - Log privacy: capture logs on forced failures of discovery (and phase 2 draft create, consume, and
    commit); assert no address, phone, name, fragment-bearing URL, or token appears.
  - **Phase 2, Postgres-backed** (a real Postgres store, parametrized over
    `CLUEXP_PHONE_VERIFICATION_REQUIRED` on and off):
    - a prepared draft is absent from `/provider/crm/customers`, the provider queue, alerts, and job
      reads;
    - an existing same-phone `customers` row is unchanged before commit;
    - commit is blocked without price/terms and, when the flag is on, without draft verification;
    - commit creates one job and one activation, including retry-after-partial-failure and two
      concurrent commits;
    - post-commit draft personal-data columns are cleared;
    - expiry purge removes open and stale-committing drafts plus their verifications, and leaves
      `customers`, `jobs`, and job-subject verifications untouched;
    - spec 002's job-subject verification tests stay green after the subject change;
    - handoff token single use, expiry, GET non-consumption;
    - channel validation for inactive, unlisted, null-org, and ineligible channels.
  - `apps/cluexp-mcp-server`: `uv run --with-requirements requirements-dev.txt pytest tests -q`, with
    `tests/test_local_v1_integration.py` extended to run `find_providers` against the real local `/v1`
    app.
- **Type/build**: `npm run build -w apps/intake-web`; `python -m compileall mcp_server`.
- **Migration/data**: alembic upgrade/downgrade on a scratch Postgres. Postgres-backed store tests for
  the listed-channel query (the default suite is InMemoryStore-only, so a green run alone does not
  verify SQL).
- **Tenant/RLS**: query review. The listed-channel query exposes only `display_name`/`slug` of opted-in
  channels with a non-null active org. Phase 2: `intake_drafts` default-deny RLS test and a
  subject-check constraint test on `intake_phone_verifications`.
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
  `consent.terms_accepted=true` at creation, which an assistant cannot truthfully give, and it writes
  `jobs`/`customers` immediately. The separate isolated draft endpoint is required by FR-021.
- Geocoder region bias: FR-009a may reject valid addresses that need a country hint. If pilot
  testing shows this, add a configured `region`/`components` bias. That is a config change, not a
  relaxation of the acceptance rule.
