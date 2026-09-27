# Checklist: AI Assistant Provider Discovery And Web Handoff

**Artifact Reviewed**: `spec.md, plan.md, tasks.md`  
**Reviewer**: `Codex`
**Date**: `2026-09-26`

Secondary-agent review required: yes
Secondary-agent review completed: yes
Reviewer agent: Codex
Review result: approve

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

## Codex Re-review — 2026-09-26, head `d9c1904`

Current verdict remains **changes-requested**. R1 and R2 above are historical findings, now resolved
at the design level; the new R3 below blocks approval. T004 remains open.

- **R1 resolved:** FR-021 now isolates drafts in `intake_drafts`, with no pre-commit job/customer
  writes or customer reads. Draft-subject verification, provider-read exclusion, and Postgres-backed
  tests with verification on/off cover the original privacy failure. The shared customer upsert
  after an authorized web commit is explicitly documented as existing behavior.
- **R2 resolved:** FR-009a specifies precise geocoding acceptance and error outcomes;
  `geocode_candidates` preserves the necessary evidence while existing callers retain their behavior.
- The additional checks are incorporated: per-org eligibility and shared snapshot data, null-org
  exclusion, phase-1 queue timing, failure-log privacy, and server-side draft channel validation.
- Confirmed the reviewer-owned checklist was unchanged from `7caadc3` at the submitted head.

### R3 — P1: make draft materialization and its recovery reference atomic

`plan.md` phase-2 Commit steps 2–3 first mark the draft `committing`, then call the normal `save()`
and record `job_id`. `PostgresStore.save()` (`store.py:6613–6750`) owns its database connection and
persists the customer/job independently of a later draft update. If the process dies after that save
but before recording `job_id`, the shared job exists while the draft is `committing` with no ID.
The proposed retry only resumes a committing draft **with** an ID; the proposed one-hour cleanup
deletes a committing draft **without** an ID. That can leave an orphan job/customer mutation and
discard the recovery information, contradicting FR-028 and the cleanup design. Conditional state
updates alone do not close this crash window.

Required correction: specify a store-level transaction that locks/revalidates the draft and writes
the customer/job plus draft-to-job mapping atomically, or an equally explicit durable idempotency
design that cannot lose the materialized job's identity. State how concurrent edits/commits and the
purge are fenced. Define recovery for failure before materialization and after materialization but
before activation/finalization, including `committing` rows with a job ID if the customer never
retries. Cleanup must not discard recovery state or retain draft PII indefinitely. Preserve the
existing cutover/global gates and HD-9; no product-scope change is requested.

Add targeted Postgres failure-injection tests at the save/mapping boundary and before finalization,
including concurrent commit/purge. Assert no orphan/duplicate job, no duplicate activation, and
eventual finalization/PII clearing. Update the plan's store surfaces and T032b/T033 accordingly.

### Re-review verification

- Documentation diff and existing `PostgresStore.save()` transaction boundary reviewed.
- `git diff --check` and working-tree SDLC policy check passed for this review record.
- No application code, production action, or merge. T005 remains separate.

## Codex Final Re-review — 2026-09-26, head `00449a8`

**Current verdict: approve (docs-only spec/design).** This supersedes the historical
changes-requested verdicts above. R1, R2, and R3 are resolved at the design level; T004 is complete.

- R3 is closed by `commit_intake_draft`: one Postgres transaction locks/revalidates the draft,
  invokes the extracted cursor-level save helper, applies activation and transitions, records the
  draft-to-job mapping, clears draft PII, and deletes draft-subject verifications. The previous
  independent-save/mapping crash window and durable `committing` state are removed.
- `open`/`committed` plus the mapping check, row-locked commit/PATCH, and skip-locked purge give a
  coherent concurrency and recovery plan. The transaction, rather than the check constraint alone,
  prevents a materialized draft job from losing its mapping.
- T032b/T033 cover failure injection before/after the transaction and effects claim, concurrent
  commit/PATCH/purge, same-job retries, PII cleanup, and unchanged normal `save()` behavior.
- Post-commit effects are explicitly **at most once / best effort**, not guaranteed delivery:
  the sweep handles unclaimed effects; a crash after claim can lose an alert/message. This is a
  disclosed limitation consistent with existing best-effort behavior, not a remaining R3 blocker.
  Read the acceptance criterion about effects completing after a database crash as the
  before-claim case, as specified by the detailed plan's failure-injection cases.
- Implementation review must preserve HD-9 activation with verification off, respect cutover/global
  gates, and issue new-job effects only for actual activation. The detailed transaction/shared
  activation plan supersedes the residual `_commit_ticket` name in the affected-surfaces summary.
- R1/R2 remain resolved; no new blocking design finding. Confirmed the submitted checklist was
  byte-identical to `eaadd8e` before this reviewer update.

Verification: documentation diff and existing store/activation boundaries reviewed;
`git diff --check` and working-tree SDLC policy checks passed. Application tests were not rerun
for this docs-only review. CI on the submitted head was still running at review time; all required
checks must pass before merge. This approval does not approve implementation or production actions.
Human confirmation is still required to merge. T005 remains separate.
