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
- [x] T004 [R] Codex: review spec/plan; record approve or changes-requested in `checklists/sdlc-policy.md`.
  - Review ownership: Codex owns T004 status and `checklists/sdlc-policy.md` for this review.
  - 2026-09-26: changes-requested against `b58dabf`; see checklist findings R1/R2. Approval remains pending.
  - 2026-09-26 re-review of `d9c1904`: R1/R2 resolved; changes-requested for R3 (atomic draft materialization and recovery). See checklist; T004 remains open.
  - 2026-09-26 final re-review of `00449a8`: approve; R1/R2/R3 resolved at the design level. T004 complete. Merge awaits green CI and Human confirmation; implementation/production reviews remain separate.
- [x] T007 Claude: resolve Codex R1/R2 and the checklist's implementation checks in spec/plan/tasks
  (docs only; HD-1..HD-9 preserved). Resolution map posted on PR #78 for Codex re-review.
- [x] T008 Claude: resolve Codex R3 (atomic draft commit and recovery) in spec FR-024/FR-025/FR-028,
  plan phase 2, and T032b/T033 (docs only). Resolution posted on PR #78 for Codex re-review.
- [ ] T005 Codex: report `/v1` network dispatch authorization (`dispatch_org_id=None`) as a separate
  finding/spec. Not part of this feature.

## Tasks — Phase 1

- [x] T010 Claude: extract `org_eligible` (per-org) and `technician_org_eligible` from
  `route_network_request`. Make `_network_routing_snapshot` return `(technicians, org_status,
  org_capabilities)` and update its two callers. Regression tests show coverage-check and
  dispatch-authorization results are unchanged.
- [x] T011 Claude: migration `intake_channels.ai_assistant_listed` + partial unique index; upgrade and
  downgrade verified on scratch Postgres.
- [x] T012 Claude: store method for listed channels (InMemoryStore + PostgresStore) with a
  Postgres-backed test.
- [x] T013a Claude: `geocode.geocode_candidates` (all results with `location_type`, `partial_match`,
  `types`), sharing only the HTTP fetch with `geocode()`. Pinned regression test for the existing
  first-result callers.
- [x] T013 Claude: `POST /v1/provider-matches` + scope `providers:search`.
  - FR-009a acceptance rule with the `address_not_found`, `address_ambiguous`, `address_imprecise`,
    and `geocoding_unavailable` codes.
  - Per-org eligibility with multi-org and null-org tests.
  - Event metadata allow-list and failure-log privacy tests.
  - Regenerate `docs/openapi-v1-snapshot.json`.
- [x] T014 [P] Claude: MCP server — delete five tools, OAuth, and bearer path; add `find_providers`;
  update tests, `tools/list` snapshot test, README, runbook, `.env.example`, `vercel.json`, manifest.
- [x] T015 [P] Claude: intake web — fragment pre-fill in `IntakeFlow`, no ticket on load,
  `intake_source` → `origin_channel='ai_assistant'`, commit-step `provider_eligible` notice; build
  passes.
- [x] T016 Claude: docs — `AGENT-INTEGRATION-MCP-PLAN.md`, `AGENT-PLATFORM-SUBMISSION-PACKAGE.md`,
  `PUBLIC-API-DEVELOPER-GUIDE.md`, `PRODUCTION-READINESS.md`.
- [x] T017 [H] Human approved 2026-09-27 ("if PR 75 affected 79 badly, fix"); Claude updated
  `mcp-production-health.yml`. It now calls `list_services` through `/mcp` and fails on an MCP error,
  an API error inside the tool result, or an empty catalog. While the pre-cutover sign-in build is
  still live it falls back to PR #75's 401 auth-boundary contract. Verified: pre-cutover branch against
  live production (green, `oauth` mode); public branch against a local server (OK, bad key, and empty
  catalog cases).
- [x] T018 Claude: preview deploy; manual scenario in Claude (no-auth custom connector) and ChatGPT
  developer mode; link-preview and private-window checks; log grep for test address.
  - 2026-09-28: Product Owner ran the in-product scenario in Claude and confirmed it works. ChatGPT is
    not required for acceptance (PO decision); it stays a follow-up.
  - 2026-09-27 (partial): protocol-level acceptance against production `https://mcp.cluexp.com/mcp`,
    with no credentials:
    - `initialize` works, and `tools/list` returns exactly two read-only tools;
    - `list_services` returns the live catalog;
    - `find_providers` with coordinates, and with a precise address (CN Tower, ROOFTOP), returns
      `providers: []`;
    - an ambiguous address returns `address_ambiguous` with candidates;
    - `/.well-known/oauth-protected-resource/mcp` returns 404;
    - `external_api_events` metadata holds only skill, outcome, and count.
  - 2026-09-27, browser check in the Orca embedded browser: a handoff link to `/o/metro-key` with a
    Tampa address.
    - The page shows "From your assistant: <address>", **Home** is pre-selected (`active`,
      `aria-pressed=true`), and the fragment is stripped from the URL.
    - Metro Key jobs stayed at 40 before and after.
    - Vercel production logs show no `POST /tickets`, no autocomplete or geocode call, and no address
      in any request path; the only load call was `GET /api/channels/metro-key`.
  - Still open, needing the Human's own accounts: the in-product Claude custom connector and ChatGPT
    developer-mode runs. No Anthropic or OpenAI API key is available to Claude Code.
- [x] T019 [R] Codex: secondary review of phase 1 implementation PR (markers in PR body).
  - Review ownership: Codex owns T019 status and `checklists/phase1-implementation.md`.
  - 2026-09-26: changes-requested on `167d618`; findings R1-R4 in the implementation checklist.
    Review performed; T019 remains open pending fixes and approving re-review. T017/T018 and
    production T020-T023 remain gated; T005 remains separate.
  - 2026-09-26 re-review of `e39762d`: approve; R1-R4 resolved. T019 complete.
    Browser/preview acceptance remains T018; approval does not authorize merge or release.
  - 2026-09-27 re-review of `6580661`: approve; includes the Human-approved T017 workflow
    and docs. Independent exact-step Bash validation: 23 fixture scenarios passed; all five
    required CI checks green. Evidence and pilot spec 001 T012 deployment dependency are
    recorded in the reviewer-owned implementation checklist. T018/T020-T023 remain open.
- [x] T020 [H] Human authorized 2026-09-27 ("start and do all now"). Claude executed:
  - **Migration 0061:** SQL applied via Supabase MCP. The column is non-null with default false;
    `intake_channels_one_ai_listing_per_org` is present. `alembic_version` intentionally stays at
    `0059_job_origin_client`, because spec 002's `0060` is separately gated and not applied; a later
    `alembic upgrade head` runs 0060, then re-runs 0061 idempotently.
  - **API client/key:** external client `5da58620-a119-4cff-b7f9-535d0cffc07f`, type `agent`, no
    organization, scopes `services:read` + `providers:search`, 120 requests/min. Key prefix
    `cxp_live_bP5ZcDh`; the raw key exists only in Vercel. Verified: `services:read` 200,
    `providers:search` 200, and `coverage:check` 403.
  - **Vercel env (`cluexp-mcp-server`, production):** removed `CLUEXP_MCP_OAUTH_{ISSUER,
    RESOURCE_SERVER_URL,AUDIENCE,SCOPE}` and `CLUEXP_MCP_BEARER_TOKEN`; set a new sensitive
    `CLUEXP_API_KEY` and `CLUEXP_API_BASE_URL=https://api.cluexp.com`.
  - **Firewall:** rule "MCP per-IP rate limit", published: 60 requests/60 s per IP on `/mcp` and
    `/api/mcp`. A 70-request burst gave 60 × 200 then 10 × 429.
  - **Deploy:** production deployment from a clean `git archive origin/main` (`3c08e65`); Ready.
  - **Git connection:** the project is now linked to `logicacodecom/ClueXP` with production branch
    `main` and `rootDirectory=apps/cluexp-mcp-server`. There is no ignored-build-step command, because
    the root `.vercelignore` strips `.git`, so git-based skip commands fail. A git preview build of
    `main` succeeded (26 s).
- [x] T021 [H] Human: first provider channel opt-ins (written provider consent per HD-6).
  - 2026-09-27: the Human confirmed both providers' consent. Claude set `ai_assistant_listed = true`
    for `florida-locksmith` (Florida Locksmith) and `metro-key` (Metro Key Partners). Keep the written
    requests on file.
  - Both operate around Tampa, FL (3 and 6 verified technicians). At listing time no technician was
    `is_available`, so `find_providers` correctly returns `[]` until one goes on shift. Technician
    availability was not modified.
- [ ] T022 [H] Human: decommission the Auth0 dev tenant client/API used by the removed OAuth path.
  The MCP server no longer references it (env vars removed 2026-09-27). No other code or Vercel
  project uses Auth0, so the whole dev tenant `dev-w317wetforjtbtvk` can be deleted. This needs
  Auth0 dashboard access, which Claude does not have.
- [x] T023 Claude: post-deploy verification — health monitor green on the real tool call; one live
  discovery query per assistant; confirm no location in `external_api_events`.
  - 2026-09-27: a `workflow_dispatch` of `mcp-production-health` on `main` passed via the **public**
    branch (no pre-cutover notice).
  - Live discovery calls were verified at the protocol level (see T018); the per-assistant UI runs
    remain in T018.
  - `external_api_events` rows for this client carry no location.
  - The monitor's transitional 401 branch is removed in this change, so a rollback to the sign-in
    build now turns the monitor red.

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
- [ ] T032b Claude: commit-from-draft (resolves R3).
  - Extract the `_save_ticket_tx` cursor helper from `PostgresStore.save()`, with the `save()`
    regression test.
  - Extract the shared activation decision from `commit()` and the pure price function.
  - Transactional `commit_intake_draft`: lock, re-validate, materialize, activate, transitions,
    mapping, personal-data clear, draft-verification delete, all in one transaction.
  - At-most-once post-commit effects claim; `PATCH` fencing on `state='open'`.
  - Postgres-backed tests with verification on **and** off:
    - CRM, queue, and alert invisibility before commit;
    - same-phone customer unchanged before commit;
    - exactly-once under retry and concurrency;
    - failure injection at each boundary listed in the plan;
    - concurrent commit/`PATCH`.
- [ ] T033 Claude: sweep work.
  - Skip-locked purge of expired `open` drafts (cascade draft verifications).
  - Post-commit effects for unclaimed committed drafts.
  - 30-day deletion of committed rows (which hold no personal data).
  - Postgres tests: concurrent commit/purge leaves no orphan job; `customers`, `jobs`, and job-subject
    verifications untouched; no draft personal data after `expires_at` + one sweep.
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
