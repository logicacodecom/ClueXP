# Checklist: Spec 003 Phase 1 Implementation

**Artifact Reviewed**: `implementation (feat/003-phase1-provider-discovery)`
**Reviewer**: `Codex (independent secondary/final reviewer, T019)`
**Date**: `2026-09-27`

Secondary-agent review required: yes
Secondary-agent review completed: yes
Reviewer agent: Codex
Review result: approve

## Scope

- MCP server: two read-only tools, no sign-in; OAuth and bearer paths removed (FR-001, FR-002).
- `POST /v1/provider-matches` with scope `providers:search` (FR-003..FR-009a, NFR-001, NFR-006).
- Migration `0061_intake_channel_ai_listing` (FR-016).
- Intake fragment pre-fill, attribution, and commit-step re-check (FR-010..FR-013).
- Docs and OpenAPI snapshot (FR-015).

## Author Evidence (Claude, local)

- [x] Full non-Postgres API suite: 545 passed, 1 skipped.
- [x] New `api/tests/test_provider_matches.py` (23 tests): opt-in filter, inactive/non-capable orgs,
  unaffiliated technicians, multi-org per-affiliation eligibility, null-org platform channel,
  ordering/cap/recommended, response allow-list, fragment link, event privacy, exactly-one-location
  validation, every FR-009a outcome, the pinned existing `geocode()` first-result behavior,
  allow-listed attribution, and provider-availability (eligible, suspended, out of range, no cookie).
- [x] MCP server suite: 19 passed, including a public `initialize` on `/mcp` and `/api/mcp`, the
  DNS-rebinding guard (421), and a local `/v1` integration that creates no ticket, offer, or dispatch.
- [x] `export_openapi_v1.py --check`, `generate_types.py` drift check, `compileall`, `tsc --noEmit`,
  and the `apps/intake-web` production build.
- [x] Migration SQL rendered offline (`alembic upgrade 0060:0061 --sql`).
- [ ] Postgres-backed `test_ai_listed_channels_query_and_one_listing_per_org` (CI only; no local
  Postgres).

## Reviewer Focus

- Router extraction leaves `/v1/coverage-checks` and dispatch-authorization behavior unchanged.
- Per-affiliation eligibility in `_listed_provider_matches`.
- FR-011: no ticket is created on load or on link prefetch (`page.tsx` fragment handling).
- Address outcomes, the `candidates` field on the public error envelope, and event/log privacy.
- Removal of OAuth and bearer auth, and the public `/mcp` with the host guard retained.
- `origin_channel` added to `PostgresStore.save` (insert plus coalesce-on-conflict).

## ClueXP Safety

- [x] No technician, ETA, price, rating, count, or internal ID is exposed by discovery.
- [x] No MCP tool creates or changes jobs, customers, offers, or dispatch state.
- [x] Migration is additive and default-off, with no RLS change on an existing table.
- [x] No production DDL, deployment, key creation, env change, platform submission, or workflow edit
  is performed or authorized by this change.

## Independent Review — 167d618 (2026-09-26)

Changes requested. Review is performed, but T019 approval remains open.

### R1 — P1: Fragment address leaks into an automatic GET query

`apps/intake-web/src/app/page.tsx:640` copies the fragment address into `form.address`.
The autocomplete effect at lines 687-706 reacts to that change without requiring a customer
edit or the location screen, and after 350 ms calls `/places/autocomplete?q=<address>`.
Thus opening the handoff puts its private address into a request URL, defeating FR-008's
fragment/log protection even before the customer acts. Only run autocomplete for explicit
address edits; preserve prefilled coordinates without this request. Add a browser-level
regression proving a valid handoff load sends neither an address-bearing URL nor a ticket POST.
Preview log inspection remains T018, not performed by this review.

### R2 — P2: Eligibility re-check disappears on resume

`page.tsx:644-649` requires `aiPrefill`, which exists only in React state. The fragment is
removed on first load; local session storage retains only ticket ID, screen, and timestamp.
Reloading an AI ticket (including at commit), or returning through the SMS verification link,
therefore restores the ticket with `aiPrefill=null` and skips the check and notice entirely.
FR-013 applies to AI-sourced intakes, not only uninterrupted page sessions. Derive the check
from durable ticket attribution, or safely check all owning-provider intakes. Test reload and
verification-return paths with a provider that became ineligible. Ensure the result is
available before offering the customer's proceed/back choice.

### R3 — P2: Service prefill is parsed but never applied

`page.tsx:307` sets `AiPrefill.accessType`, but no consumer reads it. Lines 735-790 show the
ordinary unselected service chooser and create from the newly clicked value. Even the plan's
fallback requires a pre-selected service; the current flow drops that part of FR-010.
Apply and display the validated service selection while retaining an explicit customer action
before ticket creation. Test a residential/vehicle handoff and unsupported service handling.

### R4 — P2: New error contract is absent from OpenAPI

`api/main.py:254-262` still defines `PublicApiError` without `candidates`, although the new
helper emits that field. The new `/provider-matches` operation in the snapshot advertises
`HTTPValidationError` for 422 and no 503 response. Generated clients cannot discover the
address-disambiguation contract. Add optional `candidates: list[str]` to the public error
model, document the new endpoint's actual 422/503 envelope, regenerate the snapshot, and
assert the exported contract includes candidates. A drift check alone cannot catch this.

### Other requested checks

- Router extraction: the old any-affiliation predicate and snapshot construction are moved
  unchanged; `_network_routing_snapshot` keeps its existing return shape and callers. No new
  coverage/dispatch-authorization behavior found. T005 is untouched and remains separate.
- Per-affiliation matching: each emitted org passes `org_eligible`; both store implementations
  exclude null-org, inactive, or unlisted channels. SQL uses an active-org inner join.
- FR-011: source review finds ticket creation only in explicit action handlers, not mount or
  link-prefetch paths. This does not excuse R1's automatic read request.
- FR-009a: outcome precedence matches the approved rule; old geocoding keeps first-result
  selection. Discovery audit metadata is allow-listed; geocoder fetch suppresses raw exceptions,
  and API unhandled-error logging records type rather than exception text. Existing privacy
  tests cover mocked address outcomes, not the browser leak in R1.
- MCP: exactly two read-only tools remain, incoming OAuth/bearer enforcement is removed,
  outbound scoped API authentication remains, and the host guard is retained and tested.
- `PostgresStore.save`: added column, placeholder, and parameter align; `coalesce` preserves
  an existing attribution on later saves. No SQL defect found. Dedicated attribution SQL
  round-trip assertions would strengthen coverage beyond the in-memory attribution test.
- Migration is additive/default-off and the unique index matches the approved rule. CI's
  clean-Postgres migration and 12 integration tests passed, including the new listing test.
  Scratch downgrade evidence is still absent; do not equate offline rendering with that check.
- SDLC note confirmed: non-PR fallback reads only `checklists/sdlc-policy.md`, so the old spec
  approval can pass a later implementation diff. PR events use the PR body exclusively and
  cannot fall back to that approval. Track remediation separately; no workflow/policy edits here.

### Validation and release limits

- CI run `36287457209` at reviewed head: API 545 passed/1 skipped; Postgres 12 passed;
  web, MCP, secret-scan passed. SDLC failed with review pending, correctly.
- Independent local MCP rerun: 19 passed.
- Independent local full non-Postgres API rerun: 545 passed, 1 skipped (188.91 s).
  One duplicate OpenAPI operation-ID warning; no test failures.
- No browser/preview acceptance or scratch Postgres downgrade performed. T017, T018,
  T020-T023 remain pending their existing gates. No merge, deployment, keys, workflow changes,
  or production actions performed. The monitor must change in the same authorized release.

## Independent Re-review — e39762d (2026-09-26)

**Verdict: approve.** R1-R4 are resolved at the implementation-review level; T019 is complete.
The earlier findings above are retained as review history, not outstanding blockers.

- R1: `addressTypedByCustomer` starts false and is set by the address input handler. Fragment
  hydration does not enable the autocomplete effect. Source tracing still finds no ticket POST
  on initial handoff load or prefetch. The pure parser and autocomplete guard have four passing
  Node tests. These are not browser tests: real load/prefetch/network and preview-log checks
  remain explicit T018 acceptance work. This evidence limit does not block code-review approval.
- R2: both stores return durable `origin_channel`; the API checks it after capability-cookie
  authorization. The commit-screen effect no longer depends on `aiPrefill`, so reload and SMS
  return take the same path. Confirmation is disabled while the check is pending, stale effect
  responses are ignored, and an ineligible result renders the notice. Fresh-client API coverage
  and the Postgres write-once attribution round-trip test pass. The check remains advisory:
  a request error resolves to unknown (`null`), not a claim of eligibility.
- R3: the parsed service bucket now selects the highlighted/`aria-pressed` opener option;
  the customer must still tap. This implements the plan's explicit fallback without creating
  a ticket on load. Unsupported buckets remain unselected.
- R4: `PublicApiError.candidates` is optional; 422 and 503 on provider-matches reference that
  model in OpenAPI. The contract regression test and independent snapshot drift check pass.
- Rebase review: range-diff confirms prior implementation/review commits were preserved apart
  from the production-readiness conflict resolution. Both the upcoming phase 1 cutover gates
  and PR #75's checks for the still-live OAuth/bearer deployment are retained. `next-env.d.ts`
  has no net change against main. No new workflow edit is included.

Validation at `e39762d928b660a55acfbe56043f4c1772020b43`:

- Independent local provider-matches, Network Router, public API foundation, and OpenAPI tests:
  **93 passed**. Node handoff tests: **4 passed**. OpenAPI `--check`: passed.
- CI run `36288580369`: API suite and clean-Postgres migration/integration checks passed;
  **13 Postgres tests passed**, including origin attribution. Web, MCP, and secret-scan passed.
  The SDLC run used the previous changes-requested markers; updated approval must be checked
  on the review-record push. Existing required CI/Human gates still apply before merge.
- No browser or preview validation, scratch downgrade, merge, deployment, workflow edit, key
  creation, or production action performed. T017/T018 and production T020-T023 remain gated;
  T005 remains separate. This approval authorizes none of those actions.

## Independent T017 Re-review — 6580661 (2026-09-27)

**Verdict: approve.** No blocking findings. Codex independently reviewed Claude's
`65806618d671de8ec48ca7a7111d4d150760b54c`, the sole implementation commit since the
`89aacc1` approval record. T019 approval now includes the Human-approved T017 workflow
change and its tasks, plan, and production-readiness updates.

- The monitor calls the read-only `list_services` tool without incoming credentials.
  HTTP 200 requires a parsed JSON/SSE tool result, no MCP/tool error, no error in
  `structuredContent`, and a nonempty catalog. This matches the server's API-error envelope;
  a failed outbound API key cannot pass merely because MCP returns HTTP 200.
- The 401 fallback preserves PR #75's two-probe implementation byte-for-byte, including
  missing/wrong-token rejection, recognized bearer/OAuth errors, and mode agreement.
  Other statuses and transport failures fail the step.
- The fallback is deliberately transitional: a green auth-mode run does not prove cutover.
  Follow PRODUCTION-READINESS: require the "public discovery OK" summary after deployment
  and remove the 401 branch. This remains authorized release follow-up, not work performed here.
- Independent validation: YAML loaded; extracted Bash step passed `bash -n`; 23 local
  fixture-driven executions of the exact step passed. Cases cover JSON/SSE success, MCP error,
  `isError`, nested API error, empty/missing/wrong-type catalog, absent structured content,
  malformed/non-object JSON, HTTP 301/403/429/500, curl failure, bearer/OAuth fallback,
  mode mismatch, either probe accepting the request, unknown auth error, and invalid auth JSON.
  Only curl was replaced with fixtures; no live production request or workflow dispatch occurred.
- CI run `36315016148` at `6580661`: all five required checks (`secret-scan`, `sdlc-policy`,
  `web`, `api`, `mcp-server`) passed. Claude's local-server/live-production evidence remains
  author evidence, separate from the independent fixture checks above.
- Pilot `specs/001-pilot-readiness/tasks.md` T012: phase 1 removes the MCP mutating tools,
  satisfying its disable-the-mutating-surface option once deployed and verified. Do not close
  that production gate on code-review approval alone.
- T018 browser/preview acceptance and production T020-T023 remain open; T005 remains separate.
  No merge, deployment, production change, or release authorization is included in this review.
