# Feature Specification: Orca + Spec Kit AI SDLC Workflow

**Feature Branch**: `chore/orca-speckit-sdlc`  
**Spec Directory**: `specs/000-orca-speckit-sdlc`  
**Created**: `2026-09-03`  
**Owner**: `Codex`  
**Status**: `implemented; reconciliation pass complete`

## Summary

Prepare ClueXP for a repeatable Orca + GitHub Spec Kit workflow so future AI-assisted changes are planned, owned, reviewed, and gated before implementation or merge.

## Scope

### In Scope

- Add project-level Spec Kit constitution and templates.
- Add repo-specific AI SDLC workflow documentation.
- Update Codex, Claude, and Copilot policy entrypoints.
- Add PR and CI policy checks for material workflow-sensitive changes.
- Configure Orca repo metadata where supported.
- Reconcile existing planning, handoff, review, TODO, and orchestration artifacts into this workflow without deleting legacy files.

### Out Of Scope

- Application behavior changes.
- Production deployment, production DDL, platform submission, or live smoke actions.
- Creating real feature specs beyond this SDLC setup spec.
- Migrating the entire product roadmap into this SDLC setup spec.
- Deleting or rewriting legacy agent/runtime artifacts.

## Users And Scenarios

### Primary Scenario

1. Given a future agent or human wants to change ClueXP behavior or policy,
2. When the change touches a material path,
3. Then CI requires Spec Kit artifacts in the same PR and reviewers can evaluate scope, ownership, tests, risks, and Human approval needs.

### Edge And Failure Scenarios

- A PR touches migrations, auth, public API/MCP contracts, tenant-sensitive backend paths, production workflow files, or external-platform docs without `spec.md`, `plan.md`, `tasks.md`, and a checklist under `specs/`; CI fails.
- A docs-only PR can proceed without a feature directory when it does not alter behavior, API contracts, deployment, data, or operational policy.
- A future Orca repo id changes; the workflow doc tells agents how to rediscover repo metadata rather than treating hardcoded examples as product authority.
- A future agent finds an old handoff, `.qwen` snapshot, `.ai-orchestrator` checkpoint, or design-review export; the workflow doc tells them whether it is authority, evidence, or local runtime/reference state.

## Requirements

### Functional Requirements

- **FR-001**: The repository must contain a project constitution under `.specify/memory/constitution.md`.
- **FR-002**: The repository must contain templates for `spec.md`, `plan.md`, `tasks.md`, and reviewer checklists.
- **FR-003**: The repository must contain an AI SDLC workflow guide with Orca commands, ownership rules, review gates, CI gates, and Human approval gates.
- **FR-004**: CI must include a diff-aware `sdlc-policy` job that fails risky PRs missing Spec Kit artifacts or an explicit completed, approving secondary-agent review marker.
- **FR-005**: Agent policy files must tell Codex, Claude, and Copilot to follow the constitution and relevant feature specs.
- **FR-006**: Existing planning, handoff, review, TODO, and orchestration artifacts must be classified as canonical authority, reference evidence, runtime state, or future-spec input.
- **FR-007**: Remaining open workflow/orchestration work must be listed in this feature's `tasks.md`.

### Non-Functional Requirements

- **NFR-001**: The workflow setup must not modify application behavior.
- **NFR-002**: The policy must use explicit path-based material triggers for high-risk ClueXP surfaces.
- **NFR-003**: The policy must preserve existing Human authorization rules for production and real-world actions.

## Data, API, And Trust Boundaries

- **Data touched**: repository workflow files and documentation only.
- **API contracts**: none changed.
- **Trust-state/privacy rules**: templates and policy require future specs to name trust-state, privacy, and tenant isolation impacts.
- **Tenant isolation**: no runtime tenant behavior is changed; CI requires high-risk tenant-sensitive changes to carry Spec Kit artifacts and review checklists.
- **Legacy artifacts**: `.ai-orchestrator`, `.qwen`, `.claude`, `.codex-review`, `docs/HANDOFF.md`, `docs/archive`, and implementation handoff notes are classified in `docs/AI-SDLC-WORKFLOW.md`.

## Acceptance Criteria

- [x] Local policy-file existence checks pass.
- [x] `python .github/scripts/check-sdlc-policy.py --working-tree` passes for this branch because this spec directory is included.
- [x] `git diff --check` passes.
- [x] No production deployment, production DDL, or push to `main` occurs.
- [x] Legacy planning/orchestration artifacts are reconciled into the workflow doc and remaining SDLC work is tracked in `tasks.md`.

## Risks, Assumptions, And Human Decisions

- **Risks**: CI can enforce artifact presence and path triggers, but cannot prove semantic tenant isolation without targeted tests and review.
- **Assumptions**: GitHub Actions runs with enough history for PR diffs after `actions/checkout` uses `fetch-depth: 0`.
- **Settled decisions**: `main` branch protection is configured with required code-owner review and `secret-scan`; `.ai-orchestrator/*` stays as legacy reference; dispatcher alert acknowledgement/escalation is the first dedicated product spec; MCP platform submission and the first real Website/API transaction require dedicated specs; technician-native QA alone does not.
- **Human decisions needed**: Mohamed must decide whether to enable `enforce_admins`. A repository administrator must configure GitHub Production-environment approvals and coordinate security triage for four redacted historical Gitleaks findings.
