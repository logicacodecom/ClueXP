# Feature Specification: Agent-Owned Review And Merge Governance

**Feature Branch**: `spec/004-agent-merge-governance`  
**Spec Directory**: `specs/004-agent-merge-governance`  
**Created**: `2026-09-27` (rev 3: addresses Codex T003 re-review findings 1–7 by simplifying)  
**Owner**: `Claude (author) with Product Owner authority; Codex review`  
**Status**: `draft`

## Summary

The Human acts only as Product Owner, not as a code reviewer or pull-request approval gate. Engineering
review and merge become agent-owned:

- pull requests remain the only path to `main`, serving as the CI and audit container;
- any agent may merge once required CI is green and, for risky changes, an independent agent from a
  different agent family has approved the exact current head.

Merging to `main` is the production deployment of application code, so merged changes must be safe
live, and every release is verified against the commit actually serving production. Product Owner
authorization is kept only for scoped decision categories.

This spec also fixes existing gate defects found in review: deleted and renamed files escape
classification, approvals can go stale, duplicate markers are accepted, and PR-body edits do not re-run
the gate.

## Product Owner Decisions (2026-09-27)

- **PO-1**: No human code review and no human PR approval gate. The Human is Product Owner only.
- **PO-2**: Merge authority: any agent, subject to this spec's gates. An author may be the merge owner
  after independent approval.
- **PO-3**: GitHub identity stays simple. The GitHub account is whatever authenticated account or
  automation may push and open PRs. Workflow roles are recorded in the PR body and spec checklists. No
  reviewer bot.
- **PO-4**: Merging to `main` deploys to production (Vercel git integration: `cluexp-intake`,
  `cluexp-mcp-server`), and this is accepted.
- **PO-5**: Roles:
  - Human = Product Owner;
  - Hermes = engineering orchestrator and accountable lead (coordination, disagreement resolution,
    incident ownership);
  - Orca = coordination runtime;
  - Codex = architect, lead engineer, implementer, reviewer;
  - Claude Code = implementer, reviewer;
  - other agents are optional workers.
- **PO-6**: One-time bootstrap exception. Both transition PRs (this spec PR #82 and the implementation
  PR) merge under today's rules, each authored by `logicacodecom` and approved once by
  `ferrybarbarossa`. This is not a continuing gate and ends when T034 completes.
- **PO-7**: Reviewer independence means a different agent family from every author. Two instances of
  the same family are not independent.
- **PO-8**: Vercel instant rollback, and the promotion that restores automatic domain assignment after
  it, are Product Owner authorizations.
- **PO-9**: All Codex plan-review recommendations are accepted. "Cidex" is a typo for Codex.

## Scope

### In Scope

- Policy text in the constitution, `AGENTS.md`, `CLAUDE.md`, `docs/AI-SDLC-WORKFLOW.md`, and
  `.github/copilot-instructions.md`, plus any other active canonical doc or runbook that still states a
  human merge/review gate (sweep, T021).
- Templates (Spec Kit checklist and tasks, PR template) and deleting `.github/CODEOWNERS`.
- SDLC gate script and tests, and a dedicated `sdlc-policy` workflow.
- Release attribution: a `revision` on both health endpoints and a `post-deploy-verify` workflow with
  incident issues.
- The transition: bypass inventory, an OLD-settings behavior check, canonical settings payloads,
  read-back, and acceptance.
- Reconciling `specs/000` records.

### Out Of Scope

- A reviewer bot or second identity (PO-3).
- Changing Vercel's deployment model (PO-4).
- Cryptographic proof of reviewer independence. It remains a recorded declaration (NFR-001).
- Updating locally installed agent skills (follow-up T040).

## Users And Scenarios

### Primary Scenario

1. Given Claude Code opens a risky PR whose body holds one `## Review Record` block
2. When Codex reviews head `H` and sets `Reviewed head: H`, `Review result: approve`
3. Then `sdlc-policy`, which re-fetches the current PR body and head from the API, passes
4. And any agent merges with `gh pr merge --squash --match-head-commit H`, or arms auto-merge
5. And `post-deploy-verify` confirms both projects serve a revision containing the merge commit, then
   runs the smoke checks; on failure it opens a `deploy-incident` issue.

### Edge And Failure Scenarios

- **A code commit after review:** the head moved and non-evidence files changed → fail until
  re-review.
- **The reviewer commits evidence** to the governing feature's own `checklists/*.md` after the review →
  allowed (FR-004).
- **A force-push drops the reviewed head** → fail.
- **An old run is re-run after a body edit** → the script re-fetches the current body and head, and
  evaluates those or fails as obsolete (FR-010).
- **A body edit revokes approval while auto-merge is armed** → the new run fails or pends and the merge
  cannot complete; any residual race is acknowledged (NFR-001).
- **Same-family author and reviewer, a bare `Other`, a duplicate or unknown key, or multiple blocks** →
  fail.
- **A delete-only or rename-away risky change** → classified risky.
- **An open `deploy-incident` issue** → merge owners must not merge or arm auto-merge (except
  `incident-fix` PRs), and Hermes disarms queued auto-merges. This is an agent-enforced operational
  rule, not a required-check freeze (FR-011).
- **After a Vercel rollback, production serves an old revision** → post-deploy verification fails and
  opens an incident. Restoring requires a PO-authorized promotion (PO-8).
- **A push to `main` with all-zero `before`, or a risky diff without artifacts** → the post-merge
  diagnostic fails (a red run on `main`). It cannot prevent deployment.
- **Local `--working-tree`** → preflight only; it never reports a review as satisfied.

## Requirements

### Functional Requirements

- **FR-001 Review record grammar.**
  - **Block boundaries:**
    - A block starts at a line exactly `## Review Record` outside fenced code.
    - It ends at the next line starting with `# ` or `## ` outside fences, or at end of text.
    - A PR body, or a governing checklist file, must contain exactly one block; zero or several fail.
  - **Lines:**
    - Inside the block, each non-empty line may carry one leading `- ` or `* ` and surrounding
      `**`/backticks, which are stripped, followed by `Key: value`.
    - Lines without `:` are ignored.
    - Keys are case-insensitive, but the key set is strict: an unknown key fails, and a duplicate key
      fails.
  - **Required keys**, each exactly once:
    - `Secondary-agent review required: yes|no`
    - `Author agents: <agent>(, <agent>)*`
    - `Reviewer agent: <agent>`
    - `Review scope: implementation|spec`
    - `Reviewed head: <40 lowercase hex>`
    - `Review result: approve|changes-requested`
    - `Merge owner: <agent>`
  - **Deprecated key:** `Secondary-agent review completed` is accepted and ignored during the bootstrap
    period, then rejected after T034 (tracked by T035).
  - **Agent names:** `Claude Code` | `Codex` | `Hermes` | `Other: <name>`, where `<name>` matches
    `[A-Za-z0-9 ._-]{1,40}` (commas forbidden).
    - Names are case- and whitespace-normalized.
    - Families are `claude code`, `codex`, `hermes`, and `other:<name>`.
    - The aliases `other: claude`, `other: claude code`, `other: codex`, and `other: hermes` map to
      their family.
    - A blank value or a bare `Other` fails.
  - Valid and invalid examples are in `plan.md` §Grammar Examples and are mirrored as test fixtures.
- **FR-002 Required review and independence.**
  - If the classifier marks the diff risky, `Secondary-agent review required` must be `yes`; a
    supplied `no` fails.
  - The reviewer's family must differ from every author family.
- **FR-003 Result.** Only `approve` satisfies the gate.
- **FR-004 Freshness.**
  - The target is the current PR head commit (FR-010).
  - `Reviewed head` must equal the target or be its ancestor.
  - Between `Reviewed head` and the target, the only permitted entries are regular Markdown files
    (mode 100644, status A or M) at `specs/<F>/checklists/*.md`, where `<F>` is a complete feature
    directory supplying the risky diff's artifacts (FR-008).
  - Any other status (D, R, C, T), mode, symlink, path, or feature fails.
  - Content inside those checklist files is unrestricted: they are reviewer-owned evidence, and
    shipped behavior never lives there.
  - No self-referential SHA is needed for the evidence commit.
- **FR-005 Scope.** If the PR diff contains any risky path outside `specs/**`, `Review scope` must be
  `implementation`.
- **FR-006 Non-material PRs.** A PR with no risky path passes without a record. One rule applies to
  every PR, including spec-only ones: **if a record is present and declares `Secondary-agent review
  required: yes`, it is fully validated (FR-002..FR-005)**. So a spec-only PR carrying a
  `changes-requested` record is blocked, which is enforced, not advisory. A record declaring `no` on a
  non-risky PR is validated for grammar only.
- **FR-007 Status-aware diffs.**
  - Classification uses `git diff --name-status -M -C` including D, and classifies both endpoints of a
    rename or copy.
  - Artifact supply (FR-008) counts only surviving destination paths with status A, M, R, or C.
    Deleted artifacts never count.
- **FR-008 Artifacts.** Unchanged: a risky diff requires `spec.md`, `plan.md`, `tasks.md`, and one
  `checklists/*.md` changed and surviving in one feature directory. Free-text exemptions never satisfy
  a risky diff.
- **FR-009 Modes and content source.**
  - **PR event:** diff = `base.sha...target`. Evidence is the current PR body from the API only; there
    is no disk fallback, and an absent or empty body means no evidence.
  - **Push to `main`:** post-merge diagnostics only; this is not proof of review.
    - Diff = `payload.before..payload.after`.
    - An all-zero `before` fails closed as an unexpected branch creation.
    - Classify and check artifacts. A failure makes the push run red; it cannot prevent deployment.
    - It does not try to prove the push came from a merged PR. With `enforce_admins` on and PR-only
      `main`, GitHub itself refuses pushes that skip a PR. Protection-setting edits (the only way
      around that) are visible in the GitHub audit log and are PO-category actions (FR-014).
    - The job has read-only permissions.
  - **`--base B --head H` (local or CI replay):** diff = `B...H`. All content, including the review
    record in the governing checklist, is read with `git show H:<path>`, independent of the checkout.
    Freshness is checked against `H`.
  - **`--working-tree`:** preflight. It reports classification and artifact completeness and prints
    `review: not evaluated (preflight)`. It never reports a review as satisfied.
- **FR-010 Current metadata and triggers.**
  - **Workflow:**
    - `.github/workflows/sdlc-policy.yml` is the only producer of the required `sdlc-policy` check.
    - It runs on `pull_request` types opened, synchronize, reopened, edited, and ready_for_review, and
      on push to `main`.
    - Per-PR concurrency cancels in-progress runs.
    - It never uses `pull_request_target`.
    - Permissions are read-only (`contents: read`, `pull-requests: read`).
    - It contains the existing policy-file assertions and both test suites.
  - **Script:**
    - Re-fetches the PR (`GET /pulls/{n}`: `body`, `head.sha`, `updated_at`) at start and again
      immediately before reporting success.
    - If `head.sha` differs from the triggering run's head, it fails as `obsolete run`, and the newer
      run decides.
    - If `body` or `updated_at` changed between the two fetches, it fails as `metadata changed during
      evaluation`, and the edit's own run decides.
    - A re-run of an old event therefore always evaluates current metadata.
- **FR-011 Merge.**
  - Any agent may merge or arm auto-merge when:
    - all required checks are green on the current, up-to-date head;
    - conversations are resolved;
    - FR-001..FR-008 pass.
  - **Incident rule (agent-enforced, not a required check):**
    - Immediately before merging or arming auto-merge, the merge owner checks for open issues labelled
      `deploy-incident` (`gh issue list --label deploy-incident --state open`). If any is open, it merges
      only PRs labelled `incident-fix`.
    - When `post-deploy-verify` opens an incident, Hermes disarms every armed auto-merge
      (`gh pr merge --disable-auto`) and acknowledges it on the issue.
    - This is deliberately operational: GitHub doesn't re-run required checks on issue changes, and
      `GITHUB_TOKEN`-created issues don't trigger workflows (NFR-001).
  - The merge owner merges with `--match-head-commit <reviewed head or evidence-only descendant>`.
  - Before arming auto-merge, the merge owner re-runs `sdlc-policy` for the current head.
  - Any body edit disarms queued merge intent in policy: the merge owner must re-verify before
    re-arming.
  - Direct pushes to `main` are forbidden.
- **FR-012 Deploy safety (merge = deploy).**
  - **General rules:** a merged change must:
    - start and serve existing traffic against the currently applied production schema and current
      configuration;
    - default new capabilities off, server-side, and fail closed until their migration, env, or
      activation step happens;
    - keep migrations additive (expand/contract), with the contract step only after no deployed
      revision depends on the old shape, which is recorded in the spec;
    - never run migrations or real sends during build or startup;
    - keep the intake and MCP deployments compatible with each other's previous revision where a
      contract between them changes.
  - **PRs adding migrations or new config** must add tests that:
    - run the affected startup and existing-traffic paths against the schema at the currently applied
      production alembic revision (recorded in the PR from a read-only query; no secrets committed),
      with the new config absent or flags off;
    - include a mixed-version case when an intake↔MCP contract changes.
  - Templates carry these as required checklist items. Governance-only PRs don't invent unrelated
    migrations.
- **FR-013 Release attribution and post-deploy verification.**
  - **Revision on health endpoints:** intake `/api/healthz` and MCP `/healthz` add
    `"revision": <VERCEL_GIT_COMMIT_SHA or null>`. This is additive; the existing `status` stays.
  - **Prerequisite:** both Vercel projects build every `main` commit. Neither has an
    ignored-build-step command (verified 2026-09-27 via the project API; re-verified in T033). Adding
    one later would require updating this workflow.
  - **`post-deploy-verify.yml`**, triggered on push to `main` and separate from the five pre-merge
    checks.
    - It polls both endpoints for up to 20 minutes until each reports a revision that contains the
      pushed commit.
    - Containment is decided by GitHub's compare API (`GET /compare/{pushed}...{revision}`, status
      `identical` or `ahead`), so a superseding commit missing from the local checkout still counts.
    - The revision must be 40-hex. A non-descendant, or an unrelated-branch SHA, never counts. An API
      error is retried and reported as `unknown`, distinct from `not deployed`.
    - A `null` or non-containing revision after the timeout covers a failed or queued build, a
      rollback-paused alias, or a one-project failure.
    - Responses are fetched with `Cache-Control: no-cache`. Revision and smoke results for both
      projects are written to the job summary on success too.
    - Permissions: `contents: read`, `issues: write` (this trusted `main`-only job is the only one that
      writes issues).
  - **Checks once attributed:** intake `/api/healthz` `status == ok`, and MCP `tools/call
    list_services`, reusing the monitor's semantic parser.
  - **On failure:** create or comment on a GitHub issue labelled `deploy-incident`, naming the pushed
    SHA, the per-project observed revisions, and the failing check.
    - Hermes acknowledges it by comment and owns resolution.
    - While any `deploy-incident` is open, the FR-011 incident rule applies.
    - If issue creation itself fails, the job still fails red; Hermes treats a red
      `post-deploy-verify` run as an incident.
    - Closing the issue requires a passing re-run or recorded recovery.
- **FR-014 Product Owner decisions.** The PR template field
  `Product Owner decision required: yes|no; category; evidence; target` uses these categories:
  - product scope;
  - risk acceptance;
  - production activation (flags, listings, channel enablement);
  - production DDL or migrations;
  - production promotion or rollback outside merge-to-deploy, including Vercel instant rollback and
    the promotion restoring auto-assignment (PO-8);
  - agent-triggered real SMS, voice, push, or email sends;
  - agent-triggered real dispatch, cancel, payment, or refund transactions;
  - domain, secret, or external-platform changes, including GitHub settings and submissions.
  A merge that itself activates something (for example it flips a default-on flag or enables a
  channel) needs its category's authorization. Ordinary code, including customer-facing UI fixes, and
  already-authorized customer workflows running normally need none.
- **FR-015 Recovery.**
  - Normal: a revert PR through the same gates, labelled `incident-fix` when an incident is open.
  - Out-of-band: Vercel instant rollback with PO authorization (PO-8), a target deployment ID, and
    schema/config compatibility recorded. Automatic domain assignment stays paused until a
    PO-authorized promotion, and `post-deploy-verify` will fail until then, by design.
  - Database changes are never rolled back by Vercel.
  - No admin bypass. If CI itself is broken, use the Vercel route, or a PO-authorized, audited,
    time-boxed protection exception, restored afterwards via the T034 restore payload.
- **FR-016 Roles text.** Active policy states the PO-5 roles. There is no mandatory Codex-only sign-off.
  Engineering disagreements are resolved by Hermes, with bounded agent debate (maximum two rounds);
  only FR-014 categories go to the PO.

### Non-Functional Requirements

- **NFR-001 Honest trust boundary.**
  - GitHub enforces required checks, PR-only `main`, up-to-date branches, conversation resolution, and
    `enforce_admins`.
  - Reviewer identity and independence are self-declared under a shared account.
  - A small window between a body edit and the start of its run remains.
  - Push diagnostics detect but cannot prevent, and they don't prove PR provenance (GitHub
    protection does).
  - The deploy-incident freeze is agent-enforced, not a required check.
  - Admins can edit protection.
- **NFR-002 Tests.** All gate logic is covered by unit tests and by integration tests against real
  temporary git repos. GitHub protection behavior is verified by read-back assertions and the T031
  live check, not by claims (plan §Verification Matrix).
- **NFR-003 CI greps pass.** `"Human approval"` stays in the constitution as scoped prose, and
  `"Codex"` and `"Claude"` stay in `AGENTS.md` and `CLAUDE.md`.

## Data, API, And Trust Boundaries

- **Data touched**: none.
- **API contracts**: additive `revision` field on `GET /api/healthz` (intake) and `GET /healthz` (MCP).
  `/v1` is unchanged.
  - Existing exact-match consumers must change with it: the `mcp-production-health` workflow compares
    the whole body to `{"status":"ok"}`, and so do two MCP ASGI tests. All move to a semantic
    `status == "ok"` check in the same PR (T015).
- **Trust boundary**: NFR-001.
- **External side effects**:
  - GitHub branch-protection and repository settings (PO-authorized);
  - issues labelled `deploy-incident`;
  - no production data changes.

## Acceptance Criteria

- [ ] Every FR maps to a test or a read-back/live check (plan §Verification Matrix), and all pass.
- [ ] Active policy, templates, and swept canonical docs contain no human-review or code-owner gate;
  historical records are annotated, not erased.
- [ ] The OLD-settings live check (T031) shows:
  - a body edit re-runs `sdlc-policy`;
  - a revoked approval fails;
  - an old-run re-run evaluates the current body.
  All before protection changes.
- [ ] Settings: the drift re-read matched the snapshot, the PUT response and read-back equal the
  intended canonical payload, and `allow_auto_merge` is true. Restore payloads for both are recorded.
- [ ] Positive acceptance: a harmless PR merges with no human approval, and `post-deploy-verify`
  attributes the revision on both projects and passes.
- [ ] The bypass inventory found no unresolved dependency. Any unresolved caller blocks the transition.

## Risks, Assumptions, And Human Decisions

- **Risks**: see NFR-001. Additionally, `VERCEL_GIT_COMMIT_SHA` is empty for CLI deploys; the next git
  deploy restores attribution, and verification fails meanwhile, by design.
- **Assumptions** (verified in T031/T033): `edited` events re-run the required check; GitHub accepts
  `required_approving_review_count: 0` with a non-null reviews object and a per-check `app_id`
  (documented by GitHub).
- **Human decisions**: none open (PO-1..PO-9).
