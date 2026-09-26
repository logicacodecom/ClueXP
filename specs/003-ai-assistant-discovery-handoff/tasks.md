# Tasks: AI Assistant Provider Discovery And Web Handoff

**Spec**: [`spec.md`](spec.md)  
**Plan**: [`plan.md`](plan.md)  
**Owner**: `Codex lead; Claude implementation; Human production gates`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means the task requires Human input or authorization before execution.
- `[R]` means Codex final review is required before merge.

## Tasks — Spec

- [x] T001 Claude: assess live MCP deployment and code (2026-09-24/26): 0 prod `/v1` keys, OAuth on an
  Auth0 dev tenant, CLI-deployed build ahead of committed code, health monitor blind to tool failure.
- [x] T002 Claude: draft spec, plan, tasks, and checklist from Human decisions HD-1..HD-5.
- [x] T003 [H] Human: decided 2026-09-26 — HD-6 ops-set opt-in, HD-7 ADR-4 amendment accepted, HD-8 approved in principle, HD-9 phase 2 independent of spec 002.
- [x] T006 Claude: apply the accepted ADR-4 amendment to `docs/SYSTEM-DESIGN.md` §20.4.
- [ ] T004 [R] Codex: review spec/plan; record approve or changes-requested in `checklists/sdlc-policy.md`.
  2026-09-26: changes-requested (R1 P1 draft isolation, R2 P2 ambiguous geocoding); re-review pending.
- [x] T007 Claude: resolve Codex R1/R2 and the checklist's implementation checks in spec/plan/tasks
  (docs only; HD-1..HD-9 preserved).
  - Review ownership: Codex owns T004 status and `checklists/sdlc-policy.md` for this review.
  - 2026-09-26: changes-requested against `b58dabf`; see checklist findings R1/R2. Approval remains pending.
- [ ] T005 Codex: report `/v1` network dispatch authorization (`dispatch_org_id=None`) as a separate
  finding/spec. Not part of this feature.

## Tasks — Phase 1

- [ ] T010 Claude: extract `org_eligible` (per-org) and `technician_org_eligible` from
  `route_network_request`. Make `_network_routing_snapshot` return `(technicians, org_status,
  org_capabilities)` and update its two callers. Regression tests show coverage-check and
  dispatch-authorization results are unchanged.
- [ ] T011 Claude: migration `intake_channels.ai_assistant_listed` + partial unique index; upgrade and
  downgrade verified on scratch Postgres.
- [ ] T012 Claude: store method for listed channels (InMemoryStore + PostgresStore) with a
  Postgres-backed test.
- [ ] T013a Claude: `geocode.geocode_candidates` (all results with `location_type`, `partial_match`,
  `types`), sharing only the HTTP fetch with `geocode()`. Pinned regression test for the existing
  first-result callers.
- [ ] T013 Claude: `POST /v1/provider-matches` + scope `providers:search`.
  - FR-009a acceptance rule with the `address_not_found`, `address_ambiguous`, `address_imprecise`,
    and `geocoding_unavailable` codes.
  - Per-org eligibility with multi-org and null-org tests.
  - Event metadata allow-list and failure-log privacy tests.
  - Regenerate `docs/openapi-v1-snapshot.json`.
- [ ] T014 [P] Claude: MCP server — delete five tools, OAuth, and bearer path; add `find_providers`;
  update tests, `tools/list` snapshot test, README, runbook, `.env.example`, `vercel.json`, manifest.
- [ ] T015 [P] Claude: intake web — fragment pre-fill in `IntakeFlow`, no ticket on load,
  `intake_source` → `origin_channel='ai_assistant'`, commit-step `provider_eligible` notice; build
  passes.
- [ ] T016 Claude: docs — `AGENT-INTEGRATION-MCP-PLAN.md`, `AGENT-PLATFORM-SUBMISSION-PACKAGE.md`,
  `PUBLIC-API-DEVELOPER-GUIDE.md`, `PRODUCTION-READINESS.md`.
- [ ] T017 [H] Human: approve the workflow edit, then Claude updates `mcp-production-health.yml` to call
  `list_services` via `/mcp`.
- [ ] T018 Claude: preview deploy; manual scenario in Claude (no-auth custom connector) and ChatGPT
  developer mode; link-preview and private-window checks; log grep for test address.
- [ ] T019 [R] Codex: secondary review of phase 1 implementation PR (markers in PR body).
- [ ] T020 [H] Human: authorize production — migration apply, scoped `/v1` key, Vercel env changes,
  Firewall rate-limit rule, git-connected Vercel project, production deploy.
- [ ] T021 [H] Human: first provider channel opt-ins (written provider consent per HD-6).
- [ ] T022 [H] Human: decommission the Auth0 dev tenant client/API used by the removed OAuth path.
- [ ] T023 Claude: post-deploy verification — health monitor green on the real tool call; one live
  discovery query per assistant; confirm no location in `external_api_events`.

## Tasks — Phase 2 (starts after T023; independent of spec 002 activation per HD-9)

- [ ] T030 Claude: migration `intake_drafts` (default-deny RLS, no customers FK) and the
  `intake_phone_verifications` subject change (nullable `job_id`, `draft_id`, exactly-one check).
  Upgrade/downgrade on scratch Postgres; spec 002 tests stay green.
- [ ] T031 Claude: `POST /v1/intake-drafts` + scope `intake_drafts:create`.
  - Server-side channel validation (FR-027).
  - Per-IP and per-phone caps.
  - Writes only `intake_drafts`; no `jobs`/`customers` write or read.
- [ ] T032 Claude: `/o/<slug>/continue` fragment-token consume (same-origin POST, single use, expiry)
  reusing spec 002 helpers, plus the draft review/edit endpoints and screen built from existing intake
  components.
- [ ] T032a Claude: subject-generalize spec 002 verification send/consume/status (`job_id` or
  `draft_id`), keeping job-subject behavior unchanged.
- [ ] T032b Claude: commit-from-draft.
  - Gates validated on the draft; `open → committing → committed` state machine.
  - Extract `_commit_ticket` shared with `commit()` and the pure price function.
  - Clear draft personal-data columns at commit.
  - Postgres-backed tests with verification on **and** off: CRM, queue, and alert invisibility before
    commit; same-phone customer unchanged before commit; exactly-once under retry and concurrency.
- [ ] T033 Claude: purge of open/stale-committing drafts (cascade draft verifications) in the scheduled
  sweep. Postgres test: `customers`, `jobs`, and job-subject verifications untouched.
- [ ] T034 Claude: MCP `prepare_service_request` tool + tests + docs.
- [ ] T035 [R] Codex: secondary review of phase 2 PR.
- [ ] T036 [H] Human: authorize phase 2 production migration, key scope change, and deploy.

## Verification

- [ ] `uv run --with-requirements requirements-dev.txt pytest tests -q` (MCP server)
- [ ] Full API suite plus Postgres-backed store tests for new SQL
- [ ] `npm run build -w apps/intake-web`
- [ ] OpenAPI v1 snapshot diff reviewed; MCP `tools/list` snapshot test
- [ ] `python .github/scripts/check-sdlc-policy.py --base main --head HEAD --merge-base`
- [ ] Privacy evidence: no location/PII in `external_api_events` or preview logs
- [ ] Human acceptance of the Claude and ChatGPT manual scenario
