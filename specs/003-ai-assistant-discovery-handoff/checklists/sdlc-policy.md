# Checklist: AI Assistant Provider Discovery And Web Handoff

**Artifact Reviewed**: `spec.md, plan.md, tasks.md`  
**Reviewer**: `Codex`
**Date**: `2026-09-26`

Secondary-agent review required: yes
Secondary-agent review completed: yes
Reviewer agent: Codex
Review result: changes-requested

## Requirements Quality

- [x] Requirements are testable and observable.
- [x] Scope and non-goals are explicit.
- [x] Ambiguities are resolved or listed as Human decisions. (HD-1..HD-9 recorded 2026-09-26.)

## ClueXP Safety

- [x] Tenant isolation is preserved (only opted-in channel names and links cross providers; no job/customer data).
- [ ] Tenant isolation has test, query-review, or documented non-applicability evidence. (Planned: T012, T013.)
- [x] Trust-state and privacy gates are named where relevant (FR-007, NFR-001, FR-021..FR-025).
- [x] Provider-managed dispatch boundaries remain intact; ClueXP does not dispatch from the assistant path.
- [x] Public `/v1`, MCP, generated type, and OpenAPI contracts are identified for update.
- [x] Database migrations include RLS/default-deny impact review (phase 1: existing table; phase 2: default-deny).
- [x] No technician, ETA, tracking, price, payment, or dispatch state is invented by UI or agent code.
- [x] No production DDL, deployment, platform submission, payment, or dispatch action is authorized by this checklist alone.

## Verification

- [x] Tests/checks are listed in `plan.md` and mapped to tasks.
- [x] CI requirements are identified.
- [x] Manual acceptance evidence is identified for user-facing or production-facing changes.

## Codex Secondary / Final Review — 2026-09-26

Reviewed PR #78 at `b58dabfd84577a7a41a6a5fe7125f9afd11c5e55`, including the ADR-4 amendment,
against current API/store/router code. This verdict covers the documentation design only.
T004 remains open pending corrections and re-review; no implementation or production action is approved.

### R1 — P1: isolate assistant draft PII before using the normal save path

`plan.md` phase 2 proposes creating the draft through the existing `save()` path and holding its
status out of the queue. That does not meet FR-021's requirement that it be invisible to provider
operations. `PostgresStore.save()` (`apps/intake-web/api/store.py:6644`) immediately upserts
`customers` by phone, including overwriting an existing customer's name. The provider CRM query
(`store.py:10047`, exposed by `/provider/crm/customers`) joins all owned jobs without excluding drafts,
returning name, phone, situation, and address before commit. Under HD-9, an unverified assistant
draft can therefore expose PII and modify a shared customer record before customer acceptance.

Required correction: specify isolated draft storage or an explicit pre-commit isolation mechanism
covering customer writes as well as all provider reads. Defer shared customer creation/update until
the authorized web commit; merely filtering the dispatch queue is insufficient. Define cleanup of
draft PII without deleting or modifying existing customer records. Update affected surfaces/tasks
and require Postgres-backed tests proving a prepared draft neither appears in provider CRM nor
changes an existing same-phone customer, with verification both on and off, followed by exactly-once
commit activation and expiry cleanup tests.

### R2 — P2: implement the promised ambiguous-address rejection

The spec's edge scenarios require ambiguous addresses to return `address_not_found` without guessing.
`plan.md` provider-matches step 2 only handles a missing geocode result. The reused helper
(`apps/intake-web/api/geocode.py:73`) selects `results[0]` and discards alternative results and
partial-match evidence; the endpoint cannot enforce the promised ambiguity rule from that return
value. It can silently recommend providers for the wrong location.

Required correction: define the discovery geocoding acceptance rule, preserve the evidence needed
to reject ambiguous/partial results, and include that helper change in the plan/tasks. Require tests
for multiple plausible results, partial matches, no result, and an accepted precise address. Keep
existing intake callers' behavior explicit rather than changing it accidentally.

### Other review conclusions and implementation checks

- Router reuse is the right design: extract `_org_eligible` and reuse `rank_candidates` over the
  full eligible pool before provider deduplication. `_network_routing_snapshot` currently returns
  technicians plus a routing result, not org status/capability maps; the implementation must expose
  the shared snapshot data without duplicating eligibility. Test multi-org technicians so one
  eligible affiliation cannot admit a different, ineligible listed organization.
- FR-011 correctly forbids ticket creation on load/prefetch. Confirmed that `create_ticket` immediately
  queues and alerts on cutover channels with verification off. Phase 1's commit-time notice does
  not delay that existing first-action behavior; the stronger hold-until-commit rule is phase 2.
- FR-021/FR-024 and T031 correctly preserve HD-9: phone remains unverified while the flag is off;
  commit activation must work independently of that flag, with the existing cutover/global gates.
- The default-false boolean and partial unique index enforce one listed channel per non-null org,
  including inactive listed channels. Existing platform channels have nullable organization IDs;
  the active-org join must exclude those. No phase-1 RLS policy change is needed.
- Provider result allow-list is explicit; `matched_location` is customer-supplied/geocoded location,
  not technician location. Event metadata excludes PII. Implementation must also test failure logs
  and avoid logging fragment-bearing response URLs or phase-2 tokens.
- Phase 2 must validate the selected channel server-side; a caller-provided slug is not proof of a
  previous discovery result. Explicitly cover inactive/unlisted channels in implementation review.
- T005 remains a separate, unimplemented finding, outside this PR.

### Verification evidence

- PR head CI: all five required checks (`secret-scan`, `sdlc-policy`, `web`, `api`, `mcp-server`)
  succeeded at the reviewed head, verified through GitHub.
- Read-only code/query review; no production probes or application changes. Application suites are
  not rerun for this documentation-only verdict.
- Review-record checks: `git diff --check` and the working-tree SDLC policy check passed.
