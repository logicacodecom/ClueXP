# Feature Specification: Agent-Owned Review And Merge Governance

**Feature Branch**: `spec/004-agent-merge-governance`  
**Spec Directory**: `specs/004-agent-merge-governance`  
**Created**: `2026-09-27`  
**Owner**: `Claude (author) with Product Owner authority; Codex review`  
**Status**: `draft`

## Summary

The Human acts only as Product Owner, not as a code reviewer or pull-request approval gate. Engineering
review and merge become agent-owned:

- pull requests remain the only path to `main`, serving as the CI and audit container;
- any agent may merge once required CI is green and, for risky changes, an independent agent from a
  different agent family has approved the exact revision being merged.

Merging to `main` is the production deployment of application code, so merged changes must be safe
live. Product Owner authorization is kept only for scoped decision categories: product scope, risk,
activation, migrations, rollback, real-world sends and transactions, and secrets/platform changes.

This spec also fixes existing gate defects found in review (Codex plan review, 2026-09-27): deleted and
renamed files escape classification, approvals can go stale, duplicate markers are accepted, and
PR-body edits do not re-run the gate.

## Product Owner Decisions (2026-09-27)

- **PO-1**: No human code review and no human PR approval gate. The Human is Product Owner only.
- **PO-2**: Merge authority: any agent, subject to the gates in this spec.
- **PO-3**: GitHub identity stays simple. The GitHub account is whatever authenticated account or
  automation may push and open PRs. Workflow roles are recorded in the PR body and spec checklists. No
  reviewer bot account.
- **PO-4**: Merging to `main` deploys to production (Vercel git integration for `cluexp-intake` and
  `cluexp-mcp-server`), and this is accepted.
- **PO-5**: Roles: Human = Product Owner; Hermes = engineering orchestrator and accountable lead
  (coordination, incident ownership); Orca = coordination runtime; Codex = architect, lead engineer,
  implementer, reviewer; Claude Code = implementer, reviewer; other agents are optional workers.
- **PO-6**: A one-time bootstrap exception. The PR that implements this spec merges under today's
  rules, with one final approval from `ferrybarbarossa`. This is not a continuing gate.
- **PO-7**: Reviewer independence means a **different agent family** from every author (for example,
  Claude Code reviews Codex work). Two instances of the same family do not count as independent.
- **PO-8**: A Vercel instant rollback stays a Product Owner authorization. It pauses automatic
  production-domain assignment until an explicit promotion.
- **PO-9**: All Codex plan-review recommendations are accepted. "Cidex" in an earlier prompt is
  treated as a typo for Codex; no Cidex role exists.

## Scope

### In Scope

- Policy text: constitution, `AGENTS.md`, `CLAUDE.md`, `docs/AI-SDLC-WORKFLOW.md`,
  `.github/copilot-instructions.md`, and the Spec Kit templates.
- `.github/pull_request_template.md` review record and PO-decision fields.
- Deleting `.github/CODEOWNERS`.
- SDLC gate (`.github/scripts/check-sdlc-policy.py`) and its tests: review record schema, family
  independence, freshness, duplicate rejection, status-aware diffs, event handling.
- CI wiring so PR-body edits re-run the gate, with concurrency control.
- A post-merge read-only production smoke workflow.
- Deploy-safety acceptance rules, the recovery procedure, and the `enforce_admins` pre-flight
  inventory.
- GitHub settings change with snapshot, read-back, and acceptance checks.
- Reconciling `specs/000` records (T012, T017, T022, T025, T026) as superseded or historical.

### Out Of Scope

- A reviewer bot, GitHub App, or second account (PO-3).
- Changing Vercel's deployment model (PO-4).
- Cryptographic proof of reviewer independence. With a shared identity this remains a recorded
  declaration; see the risks.
- Updating locally installed agent skills outside the repository. A follow-up is recorded (T040).

## Users And Scenarios

### Primary Scenario

1. Given Claude Code opens a PR touching a risky path, with a complete spec 004-style review record
2. When Codex reviews head `abc123` and the record says `Reviewed head: abc123`,
   `Review result: approve`, `Author agents: Claude Code`, `Reviewer agent: Codex`
3. Then `sdlc-policy` passes, and any agent (including Claude Code) may merge, or queue auto-merge,
   once all required checks are green
4. And after merge, the post-merge smoke confirms intake and MCP are healthy; the merging agent records
   the result on the PR.

### Edge And Failure Scenarios

- A new code commit after the review → the reviewed head no longer matches and non-record files
  changed → gate fails until re-review.
- Only the review record changed after the reviewed head → allowed.
- A force-push removes the reviewed head from history → gate fails.
- The record has `Reviewer agent: Codex` and `Author agents: Codex, Claude Code` → fails (same family).
- `Reviewer agent: Other` (bare) → fails; `Other: Gemini` → valid, family `other:gemini`.
- A duplicate or conflicting marker (for example `changes-requested` then `approve`) → fails.
- A spec-scope approval on a PR with implementation changes → fails.
- A PR that only deletes an auth file, or renames a risky file to a non-risky path → classified risky.
- Editing the PR body re-runs `sdlc-policy`; a stale green result from an older body is superseded.
- An empty PR body on a PR event does not fall back to on-disk approvals.
- A merged change needs an unapplied migration → it must fail closed against the current production
  schema (deploy acceptance rule).
- CI itself is broken → no admin bypass; recover with a revert PR, or with PO-authorized Vercel
  rollback.

## Requirements

### Functional Requirements

- **FR-001 Review record.** Risky PRs carry exactly one machine-readable review record in the PR body,
  with each field exactly once:
  ```text
  Secondary-agent review required: yes|no
  Author agents: <agent>[, <agent>...]
  Reviewer agent: <agent>
  Review scope: implementation|spec
  Reviewed head: <40-hex commit sha>
  Review result: approve|changes-requested
  Merge owner: <agent>
  ```
  Agents are `Claude Code`, `Codex`, `Hermes`, or `Other: <name>`. Names are case- and
  whitespace-normalized. The family is `claude code`, `codex`, `hermes`, or `other:<name>`, and an
  alias of a known family (for example `Other: codex`) maps to that family.
- **FR-002 Independence.** For risky changes, the reviewer's family must differ from every author's
  family. Blank authors or reviewer, and bare `Other`, fail.
- **FR-003 Result.** Only `approve` satisfies the gate; `changes-requested` is valid but blocking.
- **FR-004 Freshness.** `Reviewed head` must be an ancestor of, or equal to, the PR head commit
  (`pull_request.head.sha`, not the merge ref). Files changed between the reviewed head and the PR head
  may only be review-evidence files (`specs/*/checklists/*.md`). Any other change requires a new review
  of the new head.
- **FR-005 Scope.** If the PR diff contains any risky path outside `specs/**`, `Review scope` must be
  `implementation`. A `spec` approval covers spec-only diffs.
- **FR-006 Duplicates.** A duplicate or conflicting record field fails. Historical reviews are kept
  outside the machine-readable block, for example in the spec checklist or PR comments.
- **FR-007 Status-aware diffs.** The gate uses `git diff --name-status` including deletions:
  - both endpoints of a rename or copy are classified;
  - deleted spec artifacts do not count as supplied artifacts;
  - working-tree mode includes deletions and untracked files.
- **FR-008 Artifacts.** Unchanged rule: a risky diff requires `spec.md`, `plan.md`, `tasks.md`, and
  one `checklists/*.md` changed (and not deleted) in one feature directory. A free-text exemption
  never satisfies a risky diff.
- **FR-009 Evidence source.**
  - **PR events:** the PR body is the only evidence; there is no fallback to files on disk.
  - **Push events to `main`:** re-run classification and artifacts over `event.before..event.after`,
    taken from the event payload, but do not re-evaluate review. Review was enforced on the PR, and
    PR-only `main` with `enforce_admins` makes other paths impossible.
  - **Local runs** (`--working-tree`, `--base/--head`): only a review record inside a checklist file
    changed in that diff, in the same complete feature directory, counts.
- **FR-010 Triggers.**
  - `sdlc-policy` runs on `pull_request` types `opened`, `synchronize`, `reopened`, `edited`, and
    `ready_for_review`, with per-PR concurrency and cancel-in-progress.
  - It never uses `pull_request_target`.
  - The required check name stays `sdlc-policy`.
- **FR-011 Merge.** Any agent may merge, or arm auto-merge, when all required checks are green on an
  up-to-date branch, conversations are resolved, and FR-001..FR-008 pass. An author may be the merge
  owner after independent approval. Direct pushes to `main` stay forbidden.
- **FR-012 Deploy safety (merge = deploy).** A merged change must:
  - start and serve existing traffic against the current production schema and configuration;
  - ship new capabilities off by default, server-side, and fail closed until their migration, env, or
    activation step happens;
  - keep migrations additive (expand/contract), never run migrations or real sends during build or
    startup, and keep the intake and MCP deployments compatible with each other's previous version.
  Reviewers check this; PRs adding migrations or new config must describe their fail-closed behavior.
- **FR-013 Post-merge verification.** A `post-deploy-smoke` workflow on push to `main` polls intake
  `/api/healthz` and MCP `list_services` (read-only, with retries and timeouts) until healthy or
  timed out. The merge owner records the result on the PR, and Hermes owns follow-up on failure.
- **FR-014 Product Owner decisions.** The PR template field
  `Product Owner decision required: yes|no; category; evidence; target` uses these categories:
  - product scope;
  - risk acceptance;
  - production activation (flags, listings, channel enablement);
  - production DDL or migrations;
  - production promotion or rollback outside merge-to-deploy, including Vercel instant rollback;
  - real SMS, voice, push, or email sends;
  - real dispatch, cancel, payment, or refund transactions;
  - domain, secret, or external-platform changes, including submissions.
  Ordinary code changes, including customer-facing UI fixes, are not a PO category.
- **FR-015 Recovery.**
  - Normal: a revert PR through the same gates.
  - Out-of-band: Vercel instant rollback with PO authorization, a target deployment ID, and
    schema/config compatibility noted. It must record that automatic production-domain assignment is
    paused and how it is restored (a PO-authorized promotion).
  - Database changes are never rolled back by Vercel.
  - No admin bypass. If CI itself is broken, recover through Vercel or through a PO-authorized, audited,
    time-boxed protection exception that is restored afterwards.
- **FR-016 Roles text.** Every active policy file states the PO-5 roles. There is no mandatory
  Codex-only final sign-off. Engineering disagreements are resolved by Hermes (accountable lead) with
  bounded agent debate; only PO-category decisions go to the Human.

### Non-Functional Requirements

- **NFR-001** The gate's trust boundary is documented honestly: shared GitHub identity; declarations
  are recorded, not authenticated.
- **NFR-002** All new gate logic is covered by unit tests and by integration tests against real
  temporary git repositories (see plan).
- **NFR-003** `ci.yml`'s policy-file greps keep passing: `"Human approval"` stays in the constitution
  as scoped prose, and `"Codex"` and `"Claude"` stay in `AGENTS.md` and `CLAUDE.md`.

## Data, API, And Trust Boundaries

- **Data touched**: none (repository policy, CI, and GitHub settings only).
- **API contracts**: none.
- **Trust boundary**:
  - GitHub enforces required checks, PR-only `main`, up-to-date branches, conversation resolution, and
    (after this spec) `enforce_admins`.
  - Reviewer identity and independence are self-declared under a shared account. A careless or
    malicious agent can write a false record.
  - Mitigations: required-check source bound to GitHub Actions, freshness binding to a commit, family
    independence, historical audit in PRs.
- **External side effects**: GitHub branch-protection and repository settings changes (PO-authorized
  by PO-1..PO-9); no production data changes.

## ClueXP-Specific Checks

- **Provider-managed dispatch rule**: unaffected.
- **Public `/v1`/MCP rule**: unaffected; FR-012 protects against deploying incompatible contracts.
- **Migration/RLS rule**: no migration; FR-012 codifies expand/contract.
- **Generated artifacts**: none.

## Acceptance Criteria

- [ ] All FR-001..FR-011 cases are covered by tests, including the Codex plan-review test list, and
  pass.
- [ ] Active policy files and templates contain no human-review, human-approval-to-merge, or
  code-owner gate wording; historical records are annotated, not erased.
- [ ] `CODEOWNERS` is deleted and the code-owner requirement is disabled in the same transition.
- [ ] Branch protection is snapshotted before and read back after: approvals 0, code-owner off,
  `enforce_admins` on, PR required, five strict checks with `sdlc-policy` bound to GitHub Actions,
  conversation resolution, no force-push or deletion. Auto-merge is enabled.
- [ ] Positive acceptance: a harmless PR merges with no human approval.
- [ ] Negative acceptance comes from tests/fixtures, not unsafe production merges: failing or pending
  check, stale branch, unresolved conversation, and a risky diff with a missing, stale, self-family, or
  duplicate review record.
- [ ] The post-deploy smoke workflow runs green on the first post-transition merge.
- [ ] The `enforce_admins` pre-flight inventory finds no `--admin` or direct-push dependency, or each
  one is removed.

## Risks, Assumptions, And Human Decisions

- **Risks**:
  - Self-declared review under a shared identity (accepted, PO-3).
  - A metadata race between a body edit and a merge (mitigated by FR-010 concurrency and the required
    check on the latest run).
  - `enforce_admins` removes emergency bypass (FR-015 defines recovery).
  - Merge = deploy means a bad merge reaches production in minutes (FR-012, FR-013).
- **Assumptions**:
  - A GitHub `edited` event re-runs a required check and the latest result governs mergeability.
  - The required-check `app_id` binding to GitHub Actions is supported for this repository.
  - Both are verified during T030.
- **Human decisions**: none open. PO-1..PO-9 are recorded. Executing GitHub settings changes is covered
  by PO-1..PO-9 per this spec; any deviation returns to the PO.
