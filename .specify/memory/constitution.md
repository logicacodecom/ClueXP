# ClueXP Spec Kit Constitution

## Authority

The Human is the Product Owner only: product scope, business decisions, risk acceptance, and the production authorizations listed under Review And Merge Gates. The Human is not a code reviewer or pull-request approval gate. Hermes is the engineering orchestrator and accountable engineering lead: it coordinates work through Orca, resolves engineering disagreements (bounded to two debate rounds), and owns deploy incidents. Codex is architect, lead engineer, implementer, and reviewer. Claude Code is implementer and reviewer. Other agents may work when useful. GitHub Actions is an objective gate, not a substitute for independent agent review or Product Owner authorization.

## Spec-Driven Workflow

Every material feature or workflow change starts with a Spec Kit feature directory under `specs/` before application code changes. The expected artifact order is:

1. `spec.md` for user outcomes, scope, non-goals, requirements, acceptance scenarios, risks, and human decisions.
2. `plan.md` for architecture, affected surfaces, data/API contracts, tests, rollout, rollback, and observability.
3. `tasks.md` for small, reviewable tasks with owner, dependency, parallelism, and verification notes.
4. Optional `checklists/` files for requirements quality, privacy, security, accessibility, production readiness, or release acceptance.

Small documentation-only edits may skip a feature directory when they do not change application behavior, API contracts, deployment, data, or operational policy.

## Material Change Definition

The following path families are always material and risky. They must include `spec.md`, `plan.md`, `tasks.md`, at least one reviewer checklist under `specs/<###-feature-slug>/`, and completed secondary-agent review evidence in the same pull request:

- database migrations and schema SQL: `packages/db/alembic/versions/**`, `packages/db/**/*.sql`;
- authentication or authorization code: `apps/intake-web/api/auth.py`, `apps/**/auth/**`, `**/*auth*.py`, `**/*auth*.ts`, `**/*auth*.tsx`, MCP OAuth files;
- public API or MCP contracts: `docs/openapi-v1-snapshot.json`, `apps/intake-web/api/schema.py`, `apps/intake-web/api/main.py`, `apps/intake-web/scripts/export_openapi_v1.py`, `packages/api-client/**`, `apps/cluexp-mcp-server/api/**`, and MCP server/client entrypoints;
- RLS, tenant isolation, cross-tenant data, dispatch routing/state/offer lifecycle, privacy, storage, communications, push, settings, payment, or billing paths;
- secrets/environment/configuration affecting production or security;
- GitHub Actions and SDLC policy enforcement;
- production runbooks/deployment workflows, launch docs, Vercel config, platform submission docs, and external integration docs.

Changes outside those paths may still be material when they alter user-visible behavior, product scope, operational policy, security/privacy posture, generated contracts, or release behavior. When unsure, create the spec.

## Canonical Sources

Use the existing ClueXP canonical docs before inventing new product or architecture:

- `docs/EXECUTION-PLAN.md` for backlog, release gates, current status, and operational risks.
- `docs/SYSTEM-DESIGN.md` for durable architecture, invariants, APIs, database, DevOps, and ADRs.
- `docs/DESIGN-SYSTEM.md` for UI rules.
- `docs/PILOT-OPERATIONS.md`, `docs/PRODUCTION-READINESS.md`, and `docs/PRIVACY-SECURITY-REVIEW.md` for launch and production gates.
- `docs/HANDOFF.md` for agent coordination only; durable decisions must be copied into canonical docs.

If a generated Spec Kit artifact conflicts with canonical docs, stop and reconcile the conflict explicitly before implementation.

## Safety Principles

1. ClueXP is a multi-tenant dispatch SaaS platform. Preserve tenant isolation, trust-state/API-contract rules, and privacy minimization.
2. Never invent technician identity, ETA, tracking, price, payment, compliance, or dispatch status. These values must come from verified backend state or be omitted.
3. Do not run production DDL or migrations, activate production features, roll back or promote outside merge-to-deploy, submit external platform listings, change domains/secrets/platform settings, or trigger real sends or dispatch/cancel/payment/refund transactions without explicit Product Owner authorization for the exact target. Merging to `main` is the normal production deployment of application code (see Review And Merge Gates).
4. Never commit secrets, credentials, production tokens, private customer evidence, or unmasked sensitive operational data.
5. Specs and tasks must distinguish observed facts, assumptions, inferred behavior, and unresolved decisions.

## Review And Merge Gates

No human code review and no human pull-request approval is required (specs/004). Pull requests remain the only path to `main`, serving as the CI and audit container; direct pushes to `main` are forbidden. GitHub identity is whatever authenticated account or automation opens and merges PRs; workflow roles are recorded in the PR body's `## Review Record` and in spec checklists.

Pull requests touching material paths must change `spec.md`, `plan.md`, `tasks.md`, and one `checklists/*.md` in one `specs/<feature>/` directory; a free-text exemption never satisfies a risky diff.

An independent secondary-agent review is required for database migrations; authentication/authorization; RLS, tenant isolation, or cross-tenant data; dispatch routing/state/offer lifecycle; public API or MCP contracts; payment/billing semantics; secrets/environment/configuration affecting production or security; GitHub Actions or SDLC policy enforcement; and production runbooks/deployment workflows. The reviewer must belong to a **different agent family** from every author (for example Claude Code reviews Codex work). The PR body carries exactly one machine-readable record, which the `sdlc-policy` gate validates against the current PR head:

```text
## Review Record
Secondary-agent review required: yes
Author agents: Claude Code
Reviewer agent: Codex
Review scope: implementation
Reviewed head: <40-character commit SHA the reviewer reviewed>
Review result: approve
Merge owner: Claude Code
```

Only `approve` satisfies the gate. The approval covers the reviewed head; any later change other than the governing feature's `checklists/*.md` requires re-review. `changes-requested` blocks merge until findings are resolved and the reviewer records `approve`.

Any agent may merge, or arm auto-merge, when required checks are green on the current up-to-date head, conversations are resolved, the review record passes, and no `deploy-incident` issue is open (only `incident-fix` PRs may merge during an incident). An author may be the merge owner after independent approval. GitHub branch protection enforces pull requests, the required `secret-scan`, `sdlc-policy`, `web`, `api`, and `mcp-server` checks on up-to-date branches, conversation resolution, and `enforce_admins`; it requires no human approval.

Merging to `main` deploys to production. A merged change must start and serve existing traffic against the currently applied production schema and configuration, ship new capabilities off by default and fail closed until their migration/env/activation step, keep migrations additive (expand/contract), never migrate or send during build or startup, and keep intake and MCP compatible with each other's previous revision. `post-deploy-verify` confirms both projects serve the merged commit; a failure opens a `deploy-incident` issue owned by Hermes. Recovery is a revert PR; Vercel rollback needs Product Owner authorization; there is no admin bypass.

Human approval (Product Owner authorization) is required only for these categories (specs/004 FR-014):

- product scope and risk acceptance;
- production activation (feature flags, provider listings, channel enablement), including a merge
  that itself activates something;
- production DDL or migrations;
- production promotion or rollback outside normal merge-to-deploy, including Vercel instant rollback
  and the promotion that restores automatic domain assignment afterwards;
- agent-triggered real SMS, voice, push, or email sends;
- agent-triggered real dispatch, cancellation, payment, or refund transactions;
- domain, secret, or external-platform changes, including GitHub settings and platform submissions.

Ordinary code changes, including customer-facing fixes, and already-authorized customer workflows
running normally need no Product Owner step.

## Agent Ownership

Hermes assigns work; Codex, Claude Code, or other agents implement and review. Delegated work must return scope, assumptions, files changed, tests run, risks, and recommended next action. One writer owns each surface at a time. Concurrent work must use Orca worktrees based on `origin/main` unless the Product Owner or Hermes explicitly requests stacked work, with ownership recorded before editing. `.ai-orchestrator/*` is legacy/historical reference only; new task state belongs in Spec Kit artifacts and Orca. Reconsider legacy orchestrator files only as Human-approved incidental cleanup when related work already touches that area.
