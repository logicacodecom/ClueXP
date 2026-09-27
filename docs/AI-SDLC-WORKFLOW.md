# Orca + GitHub Spec Kit AI SDLC Workflow

This repository uses Spec Kit-style artifacts and Orca-managed worktrees to keep AI-assisted delivery explicit, reviewable, and gated. This file supplements `AGENTS.md`, `CLAUDE.md`, `.specify/memory/constitution.md`, `docs/EXECUTION-PLAN.md`, and `docs/SYSTEM-DESIGN.md`.

## Current Repository Shape

- Monorepo: `apps/*` plus shared packages under `packages/*`.
- Canonical product/architecture docs: `docs/EXECUTION-PLAN.md` and `docs/SYSTEM-DESIGN.md`.
- Agent coordination log: `docs/HANDOFF.md`.
- GitHub Actions: `.github/workflows/ci.yml` and `.github/workflows/mcp-production-health.yml`.
- Orca repo metadata: this workspace is registered in Orca and should use base ref `origin/main`. Discover the current repo id with `orca repo list --json` before copy-pasting commands on another machine.

## Reconciled Artifact Map

This section reconciles the older planning, handoff, review, TODO, and orchestration surfaces into the Orca + Spec Kit workflow. Do not create a parallel workflow namespace.

| Artifact | Current role | Reconciliation |
| --- | --- | --- |
| `CLUEXP-PLATFORM-PRODUCT-ROADMAP.md` | Product Owner authority for platform direction | Keep as product authority. Future implementation should create feature specs that cite the relevant roadmap sections rather than copying the whole roadmap into `specs/000-orca-speckit-sdlc/`. |
| `docs/EXECUTION-PLAN.md` | Canonical backlog, sprint state, release gates, and active product risks | Keep as canonical planning source. Open product work remains there until a Human/Codex-selected slice gets its own `specs/<###-feature>/` directory. |
| `docs/SYSTEM-DESIGN.md` | Canonical architecture, invariants, API reference, database, DevOps, and ADRs | Keep as architecture authority. Specs must reconcile conflicts against this file before implementation. |
| `docs/HANDOFF.md` | Historical multi-agent working log | Treat as evidence and handoff history only. New durable work must be summarized into canonical docs or a feature spec; do not rely on handoff entries as the only source of truth. |
| `.ai-orchestrator/README.md`, `.ai-orchestrator/config.yaml`, `.ai-orchestrator/orchestrator.py`, `.ai-orchestrator/test_orchestrator.py` | Legacy local Codex/Claude orchestration pilot | Preserve as legacy reference for deterministic routing/checkpoint ideas. Orca worktrees are the active coordination surface for new work. Reconsider the legacy files only as Human-approved incidental cleanup when related work already touches that area; do not create a dedicated cleanup spec solely for their disposition. |
| `.ai-orchestrator/runtime/` | Local runtime events and checkpoints | Gitignored runtime state. Do not migrate into Spec Kit artifacts; summarize only durable outcomes if needed. |
| `.qwen/state-snapshot.md`, `.qwen/settings*.json` | Legacy/local agent state from an earlier agent workflow | Local reference only. The snapshot describes completed Sprint 3 work already represented in canonical docs; do not treat it as current backlog authority. |
| `.claude/technician-mobile-polish-handoff.md` and `.claude/skills/**` | Local Claude workspace state and installed skill assets | Gitignored local tooling/reference. Do not migrate into repo specs unless a future feature explicitly depends on a durable instruction. |
| `.codex-review/**` | Ignored design-review images and generated HTML | Local design evidence/reference only. Use `docs/design-ref/` or a feature spec for durable product/design decisions. |
| `docs/archive/**` | Retired/historical planning material | Keep archived. It can inform discovery, but current specs must cite active roadmap/design docs instead. |
| `docs/implementation/**` and specialized handoff docs | Slice-specific implementation status or handoff notes | Keep as reference until superseded by canonical docs or feature specs. Future changes should create/update a spec rather than extending one-off handoff files by default. |
| `docs/TECHNICIAN-NATIVE-PILOT-QA.md` | Native pilot QA checklist | Keep as release/QA evidence. If implementation changes are needed to satisfy it, create a dedicated technician-native spec. |
| `docs/AGENT-INTEGRATION-MCP-PLAN.md`, `docs/AGENT-PLATFORM-SUBMISSION-PACKAGE.md` | MCP/agent platform policy and submission package | Keep as canonical integration docs. External submission or auth-flow changes require a dedicated spec and explicit Human authorization. |

Completed/obsolete items found during reconciliation:

- `.qwen/state-snapshot.md` records Sprint 3 cutover work that is already completed or represented in current roadmap/design docs.
- The old `.ai-orchestrator` pilot overlaps with the new Orca worktree workflow; it remains useful as historical implementation evidence, not as the active workflow.
- `docs/archive/*` contains superseded planning and gap assessment material; `docs/README.md` already marks it retired.

Still-open work is not copied wholesale into this SDLC setup spec. Product backlog and launch work remain in the Product Owner roadmap and canonical docs. The open SDLC/orchestration tasks are tracked in `specs/000-orca-speckit-sdlc/tasks.md`.

## Decision Queue

Settled by the Product Owner on 2026-09-27 (specs/004): no human code review or PR approval,
`enforce_admins` on, and no GitHub Production-environment reviewers for normal merge
deployments (merge = deploy; real-world operations stay Product Owner authorizations).

Still open:

- Triage the redacted historical Gitleaks findings and decide which credentials require restriction
  or rotation before enabling a full-history required scan.

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

The CI `sdlc-policy` job enforces Spec Kit coverage and approved secondary-agent review when a pull request touches high-risk path families. These changes must include `spec.md`, `plan.md`, `tasks.md`, and at least one `checklists/*.md` file under the same `specs/<###-feature-slug>/` directory:

- database migrations or schema SQL;
- auth or authorization code;
- public `/v1` API contracts, generated OpenAPI snapshots, API client contracts, MCP tools, or ChatGPT app submission metadata;
- RLS, tenant isolation, cross-tenant data, or tenant-sensitive storage/settings paths;
- dispatch routing/state/offer lifecycle, communications, or push paths;
- payment or billing semantics;
- secrets, environment, or configuration affecting production or security;
- GitHub Actions or SDLC policy enforcement;
- production runbooks/deployment workflows, launch/readiness docs, Vercel config, and external platform submission docs.

Changes outside those paths can still be material when they alter user-visible behavior, product scope, security/privacy posture, generated contracts, operational policy, or release behavior. The path gate is a minimum floor, not the full judgment model.

## AI Agent Roles

- **Human**: Product Owner only (product scope, risk acceptance, the production authorizations in
  the constitution). Not a code reviewer or PR approval gate.
- **Hermes**: engineering orchestrator and accountable lead. Coordinates work through Orca, resolves
  engineering disagreements (bounded to two debate rounds), owns deploy incidents.
- **Codex**: architect, lead engineer, implementer, reviewer.
- **Claude Code**: implementer, reviewer.
- **Other agents** (Copilot and others): optional workers following the same constitution, canonical
  docs, PR Review Record, and CI gates.

Any agent may merge once the merge gates pass. For risky changes the reviewer must be from a
different agent family than every author.

## Planning And Handoff Rules

Use the smallest durable place that matches the artifact:

- product direction and acceptance gates: `CLUEXP-PLATFORM-PRODUCT-ROADMAP.md`, then `docs/EXECUTION-PLAN.md`;
- architecture, API, database, invariants, and ADRs: `docs/SYSTEM-DESIGN.md`;
- feature-specific requirements, plan, task ownership, and review evidence: `specs/<###-feature-slug>/`;
- transient multi-agent notes: Orca worktree comments or `docs/HANDOFF.md`, then promote durable outcomes into the feature spec or canonical docs;
- active task/runtime state: the relevant Spec Kit feature and Orca task/worktree state;
- legacy/local historical state: `.ai-orchestrator/runtime/`, `.qwen/`, `.claude/`, and `.codex-review/`; preserve as reference where useful, but do not put new workflow task state there.

When a handoff or review note says work is complete, future agents must verify against code, tests, commits, and canonical docs before closing the related Spec Kit task. When a note says work is blocked, future agents must record the blocker in the relevant `tasks.md` as `[H]`, `[R]`, or a dependency rather than leaving it buried in a transcript.

## Ownership Model

- One writer per surface at a time.
- Use separate Orca worktrees for parallel tasks. Before editing, record the writer and owned files/surface in `tasks.md` or Orca task/worktree state; do not assign overlapping writable surfaces concurrently.
- Mark parallel-safe tasks with `[P]` in `tasks.md`.
- Mark Human-gated tasks with `[H]` in `tasks.md`.
- Mark independent secondary review (different agent family) with `[R]` in `tasks.md`.
- Delegated work must report scope, assumptions, files changed, tests run, risks, and recommended next action.

## Review And Approval Gates

There is no human code review and no human PR approval (specs/004). PRs are the only path to `main`
and serve as the CI and audit container.

An independent secondary-agent review is mandatory when any non-discretionary risky path is touched.
The reviewer must be from a **different agent family** than every author and records exactly one
block in the PR body:

```text
## Review Record
Secondary-agent review required: yes
Author agents: Claude Code
Reviewer agent: Codex
Review scope: implementation
Reviewed head: <40-character commit SHA reviewed>
Review result: approve
Merge owner: Claude Code
```

Agents are `Claude Code`, `Codex`, `Hermes`, or `Other: <name>`. The `sdlc-policy` gate re-fetches the
current PR body and head from the API. It fails when:

- a key is missing, duplicate, or unknown, or there isn't exactly one block;
- the reviewer and an author share a family;
- the result is not `approve`;
- a spec-scope approval is used on implementation changes;
- anything other than the governing feature's `checklists/*.md` changed after `Reviewed head`;
- the run is obsolete, or the body changed during evaluation.

A record that declares `required: yes` is always fully validated, even on spec-only PRs.
`--working-tree` runs are preflight only and never satisfy review.

Merge: any agent may merge, or arm auto-merge (`gh pr merge --squash --match-head-commit <sha>`), when:

- required checks are green on the up-to-date head;
- conversations are resolved;
- the record passes;
- `gh issue list --label deploy-incident --state open` is empty (only `incident-fix` PRs merge during
  an incident).

Re-run `sdlc-policy` for the current head before arming auto-merge. An author may be the merge owner
after independent approval.

Merge = deploy: see the constitution for deploy-safety rules. `post-deploy-verify` confirms both
Vercel projects serve the merged commit and smoke-checks them; a failure opens a `deploy-incident`
issue that Hermes acknowledges, disarming queued auto-merges.

Human approval (Product Owner authorization) is required only for the categories in the
constitution: product scope and risk; production activation; production DDL/migrations; out-of-band
promotion or rollback (including Vercel instant rollback); agent-triggered real sends or
dispatch/cancel/payment/refund transactions; domain, secret, or external-platform changes.

Trust boundary: all agents share one GitHub identity, so reviewer identity and independence are
recorded declarations, not authenticated. GitHub enforces checks, PR-only `main`, and
`enforce_admins`.

## CI Gates

Required checks on `main` (strict, bound to GitHub Actions):

- `secret-scan`
- `sdlc-policy` (its own workflow, `.github/workflows/sdlc-policy.yml`; runs on PR opened,
  synchronize, reopened, edited, and ready_for_review, and as post-merge diagnostics on push to `main`)
- `web`
- `api`
- `mcp-server`

The required `secret-scan` job scans only commits introduced by the PR or push with the official Gitleaks v8.30.1 container. GitHub native secret scanning and push protection are also enabled. Full-history Gitleaks is not yet a merge gate because a redacted baseline scan found four historical findings requiring Human triage; do not expose their values in docs or agent output.

Post-merge and scheduled (not merge gates):

- `post-deploy-verify`: release attribution and smoke on every push to `main`; opens
  `deploy-incident` issues.
- `mcp-production-health`: every 30 minutes, semantic health plus a real `list_services` call.

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

## GitHub Branch And Environment Protection

Current `main` protection (applied and read back 2026-09-27, specs/004):

- pull request required, with **0** required approvals and code-owner review off;
- dismiss stale approvals;
- conversation resolution required;
- required status checks `secret-scan`, `sdlc-policy`, `web`, `api`, and `mcp-server`, bound to GitHub
  Actions, on up-to-date branches;
- force pushes and deletions blocked;
- `enforce_admins` **on**: no admin bypass, including for the account agents use;
- repository auto-merge allowed.

The canonical PUT and restore payloads and the projection helper
(`.github/scripts/protection_projection.py`) are in `specs/004-agent-merge-governance/plan.md`.
Settings changes are Product Owner authorizations. There is no `.github/CODEOWNERS`. GitHub
Production environments are not used as a deployment gate: merging to `main` is the production
deployment.

## Secrets And Blockers

No repository secret is required to use this SDLC scaffolding or the containerized `secret-scan` job. CI uses local service containers and mocked MCP tests for normal PR checks. The separately packaged `gitleaks-action` would require a license secret for this organization-owned repository, so this workflow uses the official pinned Gitleaks container instead.

GitHub native secret scanning and push protection are enabled. A redacted full-history Gitleaks scan found four historical candidates; those require Human/security triage and possible credential restriction or rotation before a full-history baseline can be enforced.

Secrets or external authority may be needed only for production deployment, Vercel/Supabase changes, Auth0/OpenAI platform submission, Twilio/Expo production notification tests, real payment work, or live smoke tests. Store those in the relevant platform secret manager, never in repo files or agent transcripts.
