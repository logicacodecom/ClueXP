# Feature Specification: Orca + Spec Kit AI SDLC Workflow

**Feature Branch**: `chore/orca-speckit-sdlc`  
**Spec Directory**: `specs/000-orca-speckit-sdlc`  
**Created**: `2026-09-03`  
**Owner**: `Codex`  
**Status**: `implemented`

## Summary

Prepare ClueXP for a repeatable Orca + GitHub Spec Kit workflow so future AI-assisted changes are planned, owned, reviewed, and gated before implementation or merge.

## Scope

### In Scope

- Add project-level Spec Kit constitution and templates.
- Add repo-specific AI SDLC workflow documentation.
- Update Codex, Claude, and Copilot policy entrypoints.
- Add PR and CI policy checks for material workflow-sensitive changes.
- Configure Orca repo metadata where supported.

### Out Of Scope

- Application behavior changes.
- Production deployment, production DDL, platform submission, or live smoke actions.
- Creating real feature specs beyond this SDLC setup spec.

## Users And Scenarios

### Primary Scenario

1. Given a future agent or human wants to change ClueXP behavior or policy,
2. When the change touches a material path,
3. Then CI requires Spec Kit artifacts in the same PR and reviewers can evaluate scope, ownership, tests, risks, and Human approval needs.

### Edge And Failure Scenarios

- A PR touches migrations, auth, public API/MCP contracts, tenant-sensitive backend paths, production workflow files, or external-platform docs without `spec.md`, `plan.md`, `tasks.md`, and a checklist under `specs/`; CI fails.
- A docs-only PR can proceed without a feature directory when it does not alter behavior, API contracts, deployment, data, or operational policy.
- A future Orca repo id changes; the workflow doc tells agents how to rediscover repo metadata rather than treating hardcoded examples as product authority.

## Requirements

### Functional Requirements

- **FR-001**: The repository must contain a project constitution under `.specify/memory/constitution.md`.
- **FR-002**: The repository must contain templates for `spec.md`, `plan.md`, `tasks.md`, and reviewer checklists.
- **FR-003**: The repository must contain an AI SDLC workflow guide with Orca commands, ownership rules, review gates, CI gates, and Human approval gates.
- **FR-004**: CI must include a diff-aware `sdlc-policy` job that fails material PRs missing Spec Kit artifacts.
- **FR-005**: Agent policy files must tell Codex, Claude, and Copilot to follow the constitution and relevant feature specs.

### Non-Functional Requirements

- **NFR-001**: The workflow setup must not modify application behavior.
- **NFR-002**: The policy must use explicit path-based material triggers for high-risk ClueXP surfaces.
- **NFR-003**: The policy must preserve existing Human authorization rules for production and real-world actions.

## Data, API, And Trust Boundaries

- **Data touched**: repository workflow files and documentation only.
- **API contracts**: none changed.
- **Trust-state/privacy rules**: templates and policy require future specs to name trust-state, privacy, and tenant isolation impacts.
- **Tenant isolation**: no runtime tenant behavior is changed; CI requires high-risk tenant-sensitive changes to carry Spec Kit artifacts and review checklists.

## Acceptance Criteria

- [ ] Local policy-file existence checks pass.
- [ ] `python .github/scripts/check-sdlc-policy.py --working-tree` passes for this branch because this spec directory is included.
- [ ] `git diff --check` passes.
- [ ] No production deployment, production DDL, or push to `main` occurs.

## Risks, Assumptions, And Human Decisions

- **Risks**: CI can enforce artifact presence and path triggers, but cannot prove semantic tenant isolation without targeted tests and review.
- **Assumptions**: GitHub Actions runs with enough history for PR diffs after `actions/checkout` uses `fetch-depth: 0`.
- **Human decisions needed**: branch protection rules and production environment approval gates must be configured in GitHub by a repository administrator.
