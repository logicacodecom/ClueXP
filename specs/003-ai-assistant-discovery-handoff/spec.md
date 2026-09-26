# Feature Specification: AI Assistant Provider Discovery And Web Handoff

**Feature Branch**: `feat/003-ai-assistant-discovery-handoff`  
**Spec Directory**: `specs/003-ai-assistant-discovery-handoff`  
**Created**: `2026-09-26`  
**Owner**: `Claude (author) with Human product authority; Codex review`  
**Status**: `clarified`

## Summary

A person asks a personal AI assistant (Claude, ChatGPT, Gemini, or any MCP-capable assistant) for urgent
help near a location. The assistant uses the public ClueXP MCP server — with no sign-in — to discover
which services exist and which opted-in provider companies can serve that skill near that location.
The customer chooses one provider from a short ClueXP-ranked list, and the assistant hands them a link
to that provider's branded ClueXP intake. Phone verification, price, terms, confirmation, provider
dispatch, and tracking all happen on the web exactly as today. Nothing is confirmed or dispatched
inside the assistant.

Phase 2 lets the assistant use what it already knows (the user's situation, name, phone, address) to
prepare a provisional intake for the chosen provider, so the web page opens pre-filled and the customer
only verifies, reviews, and confirms.

This replaces the current MCP design (seven tools, OAuth, request creation/dispatch/cancel through the
agent), which is live at `https://mcp.cluexp.com/mcp` but non-functional: production has zero
`external_api_keys`, so every tool call fails with 401 (observed 2026-09-24/26).

## Human Decisions Recorded (2026-09-24 → 2026-09-26)

- **HD-1**: The assistant discovers services and providers by location only; request, confirmation, and
  follow-up happen through a web link. No end-user authentication in the assistant.
- **HD-2**: Applies to every assistant platform, not only Claude.
- **HD-3**: Include the phase 2 pre-filled draft now "to utilize personal AI capabilities".
- **HD-4**: Fulfillment always goes to a provider company, whose dispatchers assign the technician.
- **HD-5**: The customer chooses one provider from a short list of opted-in providers, ranked by ClueXP
  (option 2). This amends ADR-4's "no marketplace in MVP" (see ADR-4 amendment below).
- **HD-6** (2026-09-26): Pilot opt-in is set by ClueXP ops on a provider's written request; no UI.
  Provider self-serve Settings toggle is deferred.
- **HD-7** (2026-09-26): ADR-4 amendment accepted; applied to `docs/SYSTEM-DESIGN.md` §20.4.
- **HD-8** (2026-09-26): Production steps approved in principle. Each production action (migration
  apply, `/v1` key, Vercel env, firewall rule, deploy, Auth0 decommission) is still confirmed with
  its exact target at execution time, per the constitution.
- **HD-9** (2026-09-26): Phase 2 does **not** wait for spec 002 production activation. Drafts still
  never reach a provider queue before the customer's web commit; phone verification applies whenever
  spec 002 is active.

## Scope

### In Scope

Phase 1 — discovery + link:

- MCP server exposes exactly two read-only tools: `list_services` and `find_providers`.
- `find_providers` accepts a service skill plus either a free-text address or `lat`/`lng`; the API
  geocodes addresses server-side with the existing Maps server key.
- It returns up to 3 opted-in providers eligible for that skill near that location, in ClueXP rank
  order, the first marked `recommended`, each with a provider-branded intake link.
- New public `/v1` endpoint backing `find_providers`, gated by a new scope.
- Provider opt-in to AI-assistant listing, per intake channel, default off.
- Provider-branded intake (`/o/<slug>`) accepts pre-fill (skill, location, AI-source attribution) from
  the link.
- MCP endpoint becomes unauthenticated; OAuth and the internal-preview bearer path are removed.
- Abuse controls for the now-public endpoint.
- Production health monitor exercises a real tool call.
- Agent-platform docs and the ChatGPT submission manifest updated to the new tool surface.

Phase 2 — assistant-prepared draft (built after phase 1 is live and accepted; independent of spec 002 activation per HD-9):

- MCP tool `prepare_service_request` creates a provisional intake on the chosen provider's channel,
  pre-filled with what the assistant collected, and returns a single-use, expiring handoff link.
- Opening the link restores the intake on the web; the customer verifies the phone when spec 002 is active, sees
  the price, accepts terms, and commits.

### Out Of Scope

- Creating, confirming, authorizing dispatch for, tracking, or cancelling a request from inside an
  assistant. Tools `create_service_request`, `get_service_request`, `get_tracking`,
  `authorize_dispatch`, `cancel_service_request` are removed from the MCP server. The underlying `/v1`
  endpoints are unchanged.
- End-user sign-in / account linking in assistants.
- ETA, price, technician identity, technician count, or ratings in assistant responses.
- Listing unaffiliated individual technicians (they have no provider intake channel).
- Bidding, auctions, or provider-paid placement.
- Reopening the channel-less main intake page (`intake.cluexp.com/`), which stays closed.
- Submitting or publishing to any assistant directory (separate Human-authorized step; `specs/000`
  T016 requires its own spec).
- Fixing `/v1` network dispatch authorization, which offers straight to a technician with
  `dispatch_org_id=None` (`apps/intake-web/api/main.py`, `public_v1_authorize_dispatch`) contrary
  to HD-4/ADR-4. Reported to Codex as a separate finding; it no longer affects the assistant path.

## Users And Scenarios

### Primary Scenario (phase 1)

1. Given a customer locked out at "221 King St W, Toronto" asks their assistant for urgent help
2. When the assistant calls `list_services`, then `find_providers(service_skill="locksmith.residential_lockout",
   address="221 King St W, Toronto")`
3. Then it receives up to 3 opted-in providers, e.g. `ABC Locksmith (recommended)`, `Keyway Pro`, each
   with an intake link, and presents them
4. When the customer picks one and opens its link
5. Then the provider's branded intake opens with the service and location pre-filled; the customer
   continues through the existing web flow (situation, details, phone verification when enabled,
   price, terms, commit) and the committed request enters that provider's dispatch queue.

### Primary Scenario (phase 2)

1. Given the same conversation, where the assistant already knows the situation, name, and phone
2. When the customer picks a provider and agrees to let the assistant prepare the request
3. Then the assistant calls `prepare_service_request` and returns a handoff link
4. When the customer opens it
5. Then the intake opens with everything pre-filled at the review step; the customer verifies the phone,
   reviews price and terms, and commits. Nothing reaches the provider's queue before that commit.

### Edge And Failure Scenarios

- No opted-in provider is eligible → `find_providers` returns an empty list and a plain message; the
  assistant must not suggest a provider exists. It may still show `list_services`.
- Address cannot be geocoded → `address_not_found`. Address matches several places or only partially
  → `address_ambiguous` with up to 3 candidate formatted addresses for the assistant to confirm with
  the user. Address resolves only to an area (city, postal code, street without number) →
  `address_imprecise`. In every rejection no providers are returned; no guessing (FR-009a).
- Unknown skill → `unknown_service_skill` (existing `/v1` behavior).
- Provider becomes ineligible between discovery and the customer opening the link → the intake shows an
  honest notice before commit (FR-013); no ETA or availability is invented.
- Link previews / crawlers / assistant prefetch fetch the intake link → no ticket is created and nothing
  enters any queue (FR-011).
- Phase 2 handoff link reused, expired, or fetched by a preview bot → fails safely; a GET never consumes
  it (FR-022).
- Phase 2 draft names a phone that already belongs to an existing customer → the existing customer
  record is not read, created, or changed, and no provider sees the draft, until the customer commits
  on the web (FR-021).
- Phase 2 draft names a channel that is inactive, not listed, or no longer eligible → rejected at
  creation; a caller-supplied slug is not trusted as proof of a prior discovery result (FR-027).
- Endpoint abuse (scraping provider coverage by sweeping coordinates, flooding) → per-IP rate limiting
  plus `/v1` per-client limits; responses reveal only opted-in providers.
- `/v1` API or key misconfigured → tools return the public error envelope; health monitor turns red
  (FR-017).

## Requirements

### Functional Requirements — Phase 1

- **FR-001**: The MCP server registers exactly `list_services` and `find_providers`, both annotated
  read-only, non-destructive, closed-world.
- **FR-002**: `/mcp` accepts unauthenticated Streamable HTTP MCP traffic. OAuth resource-server code,
  protected-resource metadata, and the `CLUEXP_MCP_BEARER_TOKEN` path are removed. The host allow-list
  (DNS-rebinding guard) stays.
- **FR-003**: New `POST /v1/provider-matches` requires a new scope `providers:search`. Input:
  `service_skill` (required) and exactly one of `address` (string) or `lat`+`lng`.
- **FR-004**: Eligibility reuses the canonical Network Router eligibility path
  (`_network_routing_snapshot` → `route_network_request` → `rank_candidates`): available technician,
  skill match, within service radius, org `status=active`, org capability includes the skill. No second
  eligibility engine: the org-eligibility predicate and the snapshot's org status/capability data are
  shared with `route_network_request`, not re-derived.
- **FR-005**: A provider is listed only if it has an active intake channel with AI-assistant listing
  enabled, a non-null `organization_id` whose organization is active, and at least one eligible
  technician for the request **through that organization's own affiliation**. For a technician
  affiliated with several organizations, each organization is judged separately: one eligible
  affiliation never admits a different, inactive or non-capable listed organization. Unaffiliated
  technicians and platform channels without an organization never produce a listing.
- **FR-006**: Providers are ordered by their best eligible technician's rank (distance ascending, then
  rating descending — the existing deterministic rule); at most 3 are returned; the first is
  `recommended=true`. The assistant cannot influence ordering.
- **FR-007**: Each result exposes only: provider display name, `recommended`, and `intake_url`. It must
  not expose technician identity, count, location, distance, rating, ETA, price, or internal IDs.
- **FR-008**: `intake_url` is `https://<intake-host>/o/<slug>#<prefill>` where the fragment carries
  `skill`, `lat`, `lng`, the formatted address, and `src=ai_assistant`. Location stays in the fragment so
  it is not sent in request paths or server logs.
- **FR-009**: `find_providers` returns the geocoded, formatted address it matched so the assistant can
  confirm the location with the user.
- **FR-009a — geocoding acceptance rule (discovery only)**: an `address` is accepted only when the
  geocoder returns status `OK` with **exactly one** result, that result has no `partial_match` flag, and
  its `geometry.location_type` is `ROOFTOP` or `RANGE_INTERPOLATED` (the values the existing helper
  already maps to `high` confidence). Otherwise:
  - zero results or `ZERO_RESULTS` → 422 `address_not_found`;
  - more than one result, or `partial_match=true` → 422 `address_ambiguous`, with up to 3 candidate
    `formatted_address` values;
  - one full-match result with `GEOMETRIC_CENTER` or `APPROXIMATE` → 422 `address_imprecise`;
  - geocoder unavailable, unconfigured, or any other status → 503 `geocoding_unavailable`, never a
    silent fallback.
  Callers with precise coordinates (for example device location) use `lat`/`lng` and skip geocoding.
  The existing `geocode()` helper and its intake callers (`GET /geocode`, provider manual intake) keep
  their current first-result behavior unchanged; discovery uses a new evidence-preserving helper.
- **FR-010**: The branded intake reads the fragment and pre-fills the service and location, starting the
  customer at the first step after them.
- **FR-011**: Opening an intake link must not create a ticket. A ticket is created only on an explicit
  customer action, as today. This matters because ticket creation on a cutover channel with phone
  verification off immediately sets `pending_dispatch` and alerts the provider (`create_ticket`).
- **FR-012**: AI-sourced intakes are attributed (`src=ai_assistant`) for conversion measurement. The
  attribution is client-supplied and used only for analytics — never for authorization or routing.
- **FR-013**: When an AI-sourced intake reaches the commit step, the backend re-checks that provider's
  eligibility for the skill and location. If it is no longer eligible, the customer sees a plain notice
  ("this provider may not have a technician available right now") and chooses to proceed or go back. No
  ETA or availability figure is shown. Phase 1 does **not** change when an intake enters the queue: on a
  cutover channel with verification off, the existing first customer action still sets
  `pending_dispatch` (observed in `create_ticket`). The hold-until-commit rule is phase 2 only (FR-021).
- **FR-014**: A production `/v1` key for the MCP server has only `services:read` and
  `providers:search`.
- **FR-015**: The ChatGPT submission manifest and `docs/AGENT-PLATFORM-SUBMISSION-PACKAGE.md` /
  `docs/AGENT-INTEGRATION-MCP-PLAN.md` describe the two-tool, no-auth surface.
- **FR-016**: Provider opt-in is stored per intake channel, defaults to off, and at most one listed
  channel exists per organization (database-enforced).
- **FR-017**: The production health monitor calls `list_services` through `/mcp` and asserts a
  well-formed result, replacing the 401 auth-boundary probe.

### Functional Requirements — Phase 2

- **FR-020**: `prepare_service_request` takes the provider's `intake_url` (or slug) from a prior
  `find_providers` result, `service_skill`, location, and optional `situation`, `customer_name`,
  `customer_phone`, `notes`. It sends no SMS and makes no call. Phase 2 drafts are for immediate
  requests only; scheduled requests use the phase 1 link, because the appointment-window step stays in
  the full web flow.
- **FR-021 — draft isolation**: A draft is stored **only** in a dedicated `intake_drafts` table until
  the customer's web commit. Before commit, the draft path must not:
  - insert or update any `jobs` row;
  - insert, update, or read any `customers` row, including an existing customer with the same phone;
  - create alerts, offers, communications, or governance events that reference customer data.
  No provider, ops, or console read path (queue, CRM `/provider/crm/customers`, job search, alerts,
  exports) reads `intake_drafts`. This holds whether `CLUEXP_PHONE_VERIFICATION_REQUIRED` is on or off,
  and regardless of the channel's `dispatch_cutover_enabled` (HD-9).
- **FR-022**: It returns a single-use, expiring (≤ 24 h) handoff link. The raw token is never stored or
  logged (hash only), travels in the URL fragment, and is consumed by a same-origin POST, so preview
  fetches cannot consume it — mirroring spec 002 FR-003/FR-009.
- **FR-023**: Consuming the link sets an HttpOnly, Secure, SameSite=Strict draft capability cookie bound
  to that draft and opens a review screen on the provider-branded intake, built from the draft (existing
  intake components). The customer can correct name, phone, address, and notes; edits update the draft
  row only. No raw draft or job identifier appears in the URL.
- **FR-024 — commit from draft**: A single commit endpoint first validates every gate **against the
  draft**, before any shared write:
  - price acceptance, or terms acceptance when the provider hides estimates (same rules as `commit`);
  - phone verification of the draft's current phone when `CLUEXP_PHONE_VERIFICATION_REQUIRED=true`.
    Spec 002 verification is bound to the draft as its subject, so it can happen before any job exists.
  Only after all gates pass does it materialize the ticket through the normal save path (the first
  permitted customer-record write) and run the shared commit/activation logic, with the existing
  channel cutover and global kill-switch gates. When verification is off the phone is unverified,
  exactly as in today's web intake (HD-9).
- **FR-025 — cleanup**: A scheduled purge deletes expired or abandoned drafts and their draft-subject
  verification rows. It deletes only `intake_drafts` rows and verification rows whose subject is a
  draft; it never deletes or modifies `customers`, `jobs`, or verification rows bound to a job.
  Committed drafts have their personal-data columns cleared at commit, keeping only
  `id, job_id, committed_at` for exactly-once and audit purposes.
- **FR-026**: Per-IP and per-phone creation caps prevent flooding providers' channels with drafts.
- **FR-027 — channel validation**: At draft creation the server resolves the slug and requires the
  channel to be active, `ai_assistant_listed`, owned by an active organization, and eligible for the
  skill at the location under FR-004/FR-005. A caller-provided slug is never treated as proof of a
  prior `find_providers` result. Inactive, unlisted, platform (null-org), and ineligible channels are
  rejected with the same generic error.
- **FR-028 — exactly once**: The draft moves `open → committing → committed` through conditional
  updates. The first successful commit records `job_id`. A retry after a partial failure resumes with
  that `job_id` and never creates a second job or a second activation. Concurrent commits produce one
  job and one activation.

### Non-Functional Requirements

- **NFR-001 Privacy**: Location, address, name, and phone are not written to `external_api_events`
  metadata or to application logs, including error and exception logs of discovery, draft creation,
  consume, and commit. Fragment-bearing `intake_url`/`handoff_url` values and phase 2 tokens are never
  logged by the API or the MCP server. Only skill and outcome codes are recorded.
- **NFR-002 Abuse**: `/mcp` has a per-IP rate limit at the Vercel Firewall; `/v1` per-client limits
  remain as a backstop.
- **NFR-003 Neutrality**: Ranking is deterministic, identical for every caller, and documented. No
  placement is purchasable.
- **NFR-004 Latency**: `find_providers` p95 under 3 s including geocoding.
- **NFR-005 Honesty**: Tool descriptions state that ClueXP does not dispatch from the assistant and that
  confirmation happens on the web.
- **NFR-006 Observability**: `/v1/provider-matches` records an `external_api_events` row with skill,
  result count, and outcome (no location).

## Data, API, And Trust Boundaries

- **Data touched**:
  - Phase 1: `intake_channels` (new opt-in column; partial unique index per organization);
    `jobs.origin_channel` attribution.
  - Phase 2: new `intake_drafts` table (draft fields, token hash, expiry, state, `job_id` after commit;
    default-deny RLS; no FK to `customers`). `intake_phone_verifications` gains a nullable `draft_id`,
    `job_id` becomes nullable, and a check constraint enforces exactly one subject. `customers` and
    `jobs` are written only at commit (FR-021, FR-024).
- **API contracts**: New `POST /v1/provider-matches` + scope `providers:search`; OpenAPI v1 snapshot
  regenerated. MCP tool surface shrinks from 7 to 2 (phase 2: 3). `/v1/coverage-checks` and all other
  `/v1` routes unchanged.
- **Trust-state/privacy rules**: Only opted-in provider display names are exposed. Technician
  identity, location, count, rating, ETA, and price are never returned by discovery.
- **Tenant isolation**: Discovery reads across providers but only surfaces opted-in channel names and
  public intake links. No job or customer data crosses tenants. Phase 2 drafts are invisible to every
  provider, including the chosen one, until the customer commits (FR-021); after commit the job belongs
  solely to the chosen provider.
- **Dispatch state**: Phase 1 does not touch job status. Phase 2 must never set `pending_dispatch`
  before the customer's web commit (FR-021).
- **Payments/closeout**: Not applicable.
- **External side effects**: None from the assistant path. No SMS, call, push, or provider alert is
  triggered by any MCP tool.

## ClueXP-Specific Checks

- **Trust-state rule**: Assistants never receive technician, ETA, or status data; tracking stays on the
  web behind the customer capability.
- **Provider-managed dispatch rule**: The customer picks a provider; that provider's own dispatchers
  assign. ClueXP never dispatches from the assistant path.
- **Public `/v1`/MCP rule**: Additive `/v1` change with a new scope; existing keys unaffected. The MCP
  tool removal is a breaking change for any existing MCP client — acceptable because no client has ever
  succeeded in production.
- **Migration/RLS rule**: One migration in phase 1 (channel opt-in; no RLS change). One in phase 2:
  `intake_drafts` default-deny under RLS like spec 002's verification table, plus the
  `intake_phone_verifications` subject change. That table's existing job-bound behavior must stay
  unchanged, proven by spec 002's tests.
- **Generated artifacts**: OpenAPI v1 snapshot, `packages/api-client` if generated from it.

## ADR-4 Amendment (accepted HD-7; applied to `docs/SYSTEM-DESIGN.md` §20.4)

> **Amendment 2026-09-26 — assistant provider discovery (HD-5).** Customers arriving from AI
> assistants may choose among up to three provider organizations that explicitly opted in to
> assistant listing, ranked by ClueXP's deterministic Network Router eligibility and ordering. This is
> discovery, not a marketplace: no bidding, no paid placement, no cross-tenant job or customer data.
> Provider identity is revealed before assignment only for opted-in providers and only as a display
> name and branded intake link. Fulfillment remains provider-managed.

## Acceptance Criteria

- [ ] In Claude (custom connector, no auth) and ChatGPT (developer mode), asking for an urgent service
  at an address yields `find_providers` results, and the chosen link opens the provider's intake
  pre-filled.
- [ ] Discovery returns only opted-in providers, at most 3, in router order; non-opted-in or ineligible
  providers and unaffiliated technicians never appear (tests).
- [ ] Discovery responses contain no technician, ETA, price, rating, or internal ID fields (contract
  test).
- [ ] Opening or prefetching an intake link creates no ticket (test).
- [ ] `/mcp` works without credentials; OAuth code, metadata route, and env vars are gone.
- [ ] Health monitor calls a real tool and goes red when the `/v1` key is invalid.
- [ ] No location or personal data in `external_api_events` or logs for discovery calls (test).
- [ ] Geocoding: multiple results, partial match, coarse area, no result, and geocoder failure are
  rejected with the specified codes; a precise single address is accepted; existing `geocode()`
  callers are unchanged (tests).
- [ ] Multi-org technician: an eligible affiliation never lists a different ineligible listed
  organization; platform (null-org) channels are never listed (tests).
- [ ] Phase 2, Postgres-backed, with verification **both on and off**:
  - a prepared draft does not appear in `/provider/crm/customers`, the provider queue, alerts, or job
    reads;
  - an existing same-phone customer's row is byte-identical before commit;
  - commit activates exactly once, including under retry and concurrent commit;
  - expiry cleanup removes draft rows and draft verifications and leaves `customers`, `jobs`, and
    job-bound verifications untouched.
- [ ] Phase 2: handoff links are single-use, expiring, and not consumed by GET; inactive, unlisted,
  null-org, and ineligible channels are rejected at draft creation (tests).
- [ ] No PII, fragment-bearing URLs, or tokens in error logs of discovery or draft paths (tests).
- [ ] Independent secondary review approves each implementation PR.

## Risks, Assumptions, And Human Decisions

- **Risks**:
  - Public discovery lets anyone map which opted-in providers cover which areas. Accepted by opt-in;
    mitigated by rate limits and returning names only.
  - "Recommended" plus ordering strongly steers choice; ranking rules become a fairness commitment to
    providers.
  - With only 4 active provider orgs and 2 intake channels in production today (observed 2026-09-26),
    most queries will return zero or one provider until more providers opt in.
  - Per HD-9, phase 2 may ship before spec 002 is active in production (A2P pending). Until then an
    assistant-prepared intake carries an unverified phone — the same exposure as today's web intake —
    and a draft could name someone else's number. FR-021 keeps that draft away from the shared customer
    record and every provider until the customer commits. No SMS is sent by the tool, so this is not
    an SMS-abuse vector; FR-026 caps limit flooding.
  - At commit, the normal save path upserts `customers` by phone and may update an existing same-phone
    customer's name (observed at `store.py` `PostgresStore.save`). That is existing behavior for every
    web intake and now happens only after the customer's authorized commit. Changing it is outside
    this spec.
  - Platforms differ in no-auth support and review rules; each needs verification before listing.
- **Assumptions** (to verify in plan tasks):
  - Claude custom connectors and ChatGPT developer mode accept an unauthenticated remote MCP server.
  - The branded intake flow can start past its opening steps without restructuring `IntakeFlow`.
  - Observed: `jobs.origin_channel` has no check constraint and is currently null on every production job, so `ai_assistant` needs no schema change.
- **Human decisions needed**: none open for the spec. HD-6..HD-9 are recorded above; production
  actions remain individually confirmed at execution (HD-8).
