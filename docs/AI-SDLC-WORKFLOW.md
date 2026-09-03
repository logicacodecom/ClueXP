# Orca + GitHub Spec Kit AI SDLC Workflow

This repository uses Spec Kit-style artifacts and Orca-managed worktrees to keep AI-assisted delivery explicit, reviewable, and gated. This file supplements `AGENTS.md`, `CLAUDE.md`, `.specify/memory/constitution.md`, `docs/EXECUTION-PLAN.md`, and `docs/SYSTEM-DESIGN.md`.

## Current Repository Shape

- Monorepo: `apps/*` plus shared packages under `packages/*`.
- Canonical product/architecture docs: `docs/EXECUTION-PLAN.md` and `docs/SYSTEM-DESIGN.md`.
- Agent coordination log: `docs/HANDOFF.md`.
- GitHub Actions: `.github/workflows/ci.yml` and `.github/workflows/mcp-production-health.yml`.
- Orca repo metadata: this workspace is registered in Orca and should use base ref `origin/main`. Discover the current repo id with `orca repo list --json` before copy-pasting commands on another machine.

## Spec Kit Flow

Use this flow for any material feature, API, database, production policy, launch, or AI-agent integration work:

1. Create a branch and feature directory: `specs/[###-feature-slug]/`.
2. Draft `spec.md` from `.specify/templates/spec-template.md`.
3. Run clarification before planning when requirements are ambiguous.
4. Draft `plan.md` from `.specify/templates/plan-template.md`.
5. Add reviewer-owned checklists under `specs/[###-feature-slug]/checklists/` when the feature touches privacy, security, production readiness, accessibility, payments, dispatch, auth, migrations, or public APIs.
6. Draft `tasks.md` from `.specify/templates/tasks-template.md`.
7. Implement only tasks that are explicitly in scope.
8. Update specs when accepted behavior changes. Do not let implementation drift away from the spec.

Recommended command flow after installing GitHub Spec Kit:

```text
/speckit.constitution
/speckit.specify
/speckit.clarify
/speckit.plan
/speckit.checklist
/speckit.tasks
/speckit.analyze
/speckit.implement
/speckit.converge
```

For small docs-only changes that do not alter behavior, a pull request may mark the Spec Kit section as exempt and explain why.

## Non-Discretionary Material Triggers

The CI `sdlc-policy` job enforces Spec Kit coverage when a pull request touches high-risk path families. These changes must include `spec.md`, `plan.md`, `tasks.md`, and at least one `checklists/*.md` file under the same `specs/<###-feature-slug>/` directory:

- database migrations or schema SQL;
- auth or authorization code;
- public `/v1` API contracts, generated OpenAPI snapshots, API client contracts, MCP tools, or ChatGPT app submission metadata;
- tenant-sensitive store, dispatch, privacy, storage, communications, push, settings, or payment-adjacent backend paths;
- production workflow files, launch/readiness docs, Vercel config, and external platform submission docs.

Changes outside those paths can still be material when they alter user-visible behavior, product scope, security/privacy posture, generated contracts, operational policy, or release behavior. The path gate is a minimum floor, not the full judgment model.

## AI Agent Roles

Codex is the engineering lead. Codex owns the implementation plan, scope control, integration, final technical review, and merge recommendation.

Claude Code is a delegated specialist. Claude may implement bounded tasks, critique plans, review risky changes, and surface disagreement. Claude does not make final architecture, product, production, or merge decisions.

Copilot or other coding agents must follow the same constitution, canonical docs, PR checklist, and CI gates. Agent output is not complete until reviewed by Codex and accepted by the Human where required.

## Ownership Model

- One writer per surface at a time.
- Use separate Orca worktrees for parallel tasks.
- Mark parallel-safe tasks with `[P]` in `tasks.md`.
- Mark Human-gated tasks with `[H]` in `tasks.md`.
- Mark Codex final review with `[R]` in `tasks.md`.
- Delegated work must report scope, assumptions, files changed, tests run, risks, and recommended next action.

## Review And Approval Gates

CI must pass before merge. Codex final review is required before merging delegated or agent-authored implementation.

Human approval is mandatory before:

- production DDL or production migrations;
- production deployment, promotion, or rollback;
- external platform submissions or public app listing changes;
- domain, Vercel, Supabase, or production secret changes;
- real dispatch, cancellation, payment, refund, SMS/voice send, push notification, or provider/customer-impacting workflow;
- product-scope or architecture decisions that change ClueXP's approved model.

## CI Gates

Required GitHub Actions jobs for ordinary PRs:

- `sdlc-policy`
- `web`
- `api`
- `mcp-server`

Scheduled production health is informative for operations and should not be the only merge gate:

- `mcp-production-health`

## Recommended Orca Commands

Check runtime and repo metadata:

```powershell
orca status --json
orca repo list --json
orca repo show --repo id:<repo-id> --json
orca worktree current --json
```

Set or verify the base ref:

```powershell
orca repo set-base-ref --repo id:<repo-id> --ref origin/main --json
```

Create an independent Codex feature worktree from the repo base:

```powershell
orca worktree create --repo id:<repo-id> --name spec-001-feature-slug --no-parent --agent codex --prompt "Create Spec Kit artifacts for <feature>, then stop before implementation." --json
```

Create a Claude review worktree for bounded critique:

```powershell
orca worktree create --repo id:<repo-id> --name review-001-feature-slug --no-parent --agent claude --prompt "Review specs/001-feature-slug for risks, missing tests, tenant/privacy issues, and unclear Human decisions. Return findings only." --json
```

Update visible worktree status:

```powershell
orca worktree set --worktree active --comment "spec drafted; planning next" --json
orca worktree set --worktree active --workspace-status in-review --json
```

## Recommended GitHub Branch Protection

Protect `main` with:

- require pull request before merge;
- require at least one approving review;
- require review from code owners if CODEOWNERS is added later;
- dismiss stale approvals when new commits are pushed;
- require conversation resolution;
- require status checks: `sdlc-policy`, `web`, `api`, and `mcp-server`;
- require branches to be up to date before merge;
- block force pushes and deletions;
- restrict direct pushes to `main`;
- require signed commits if the organization uses commit signing;
- require deployments/environments with manual approval for production.

## Secrets And Blockers

No repository secret is required to use this SDLC scaffolding. CI uses local service containers and mocked MCP tests for normal PR checks.

Secrets or external authority may be needed only for production deployment, Vercel/Supabase changes, Auth0/OpenAI platform submission, Twilio/Expo production notification tests, real payment work, or live smoke tests. Store those in the relevant platform secret manager, never in repo files or agent transcripts.
