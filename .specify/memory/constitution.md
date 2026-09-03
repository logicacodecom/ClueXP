# ClueXP Spec Kit Constitution

## Authority

The Human Product Owner owns product and business decisions. Codex owns engineering interpretation, implementation planning, integration, and final technical review. Claude Code is a delegated specialist for bounded implementation, critique, second-opinion review, and failure-mode analysis. GitHub Actions is an objective gate, not a substitute for Codex review or Human approval.

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
3. Do not create production DDL, run production migrations, deploy production, submit external platform listings, rotate domains, or trigger real dispatch/cancel/payment workflows without explicit Human authorization for the exact target.
4. Never commit secrets, credentials, production tokens, private customer evidence, or unmasked sensitive operational data.
5. Specs and tasks must distinguish observed facts, assumptions, inferred behavior, and unresolved decisions.

## Review And Merge Gates

Pull requests must include the relevant Spec Kit artifact links or state why the change is exempt. CI must be green before merge. Codex final review is required for delegated or agent-authored implementation.

An independent secondary-agent review is required for database migrations; authentication/authorization; RLS, tenant isolation, or cross-tenant data; dispatch routing/state/offer lifecycle; public API or MCP contracts; payment/billing semantics; secrets/environment/configuration affecting production or security; GitHub Actions or SDLC policy enforcement; and production runbooks/deployment workflows. The secondary reviewer must not be the author/implementer. Claude Code normally reviews Codex-authored work; Codex reviews Claude-authored work; another explicitly identified agent may review either. The CI policy gate requires these markers in the PR body, or in `specs/<feature>/checklists/sdlc-policy.md` when no PR body is available:

```text
Secondary-agent review required: yes
Secondary-agent review completed: yes
Reviewer agent: Claude Code|Codex|Other
Review result: approve
```

A `changes-requested` result blocks merge until findings are resolved and a secondary reviewer records `approve`.

Team policy forbids direct pushes to `main`. GitHub branch protection enforces pull requests, one approval, conversation resolution, and the required `sdlc-policy`, `web`, `api`, and `mcp-server` checks for non-admin contributors. Organization admins retain an emergency bypass pending a Human decision on `enforce_admins`. New required checks, including `secret-scan`, must be added to branch protection after their workflow lands.

Human approval is required before merging or executing changes that alter product scope, production DDL, production deployment/promotion, external app listing submission, public policy, payment handling, or real-world dispatch authority.

## Agent Ownership

Codex may implement directly or assign bounded work to Claude. Delegated work must return scope, assumptions, files changed, tests run, risks, and recommended next action. One writer owns each surface at a time. Concurrent work must use Orca worktrees based on `origin/main` unless the Human explicitly requests stacked work, with ownership recorded before editing. `.ai-orchestrator/*` is legacy/historical reference only; new task state belongs in Spec Kit artifacts and Orca. Reconsider legacy orchestrator files only as Human-approved incidental cleanup when related work already touches that area.
