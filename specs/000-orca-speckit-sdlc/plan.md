# Implementation Plan: Orca + Spec Kit AI SDLC Workflow

**Spec**: `specs/000-orca-speckit-sdlc/spec.md`  
**Branch**: `chore/orca-speckit-sdlc`  
**Owner**: `Codex`  
**Review Mode**: `direct`

## Technical Approach

Add repository-native Markdown policy files and a small Python CI script. Keep the workflow independent of app runtime code so this setup changes governance only.

## Affected Surfaces

- **Frontend**: none.
- **Backend/API**: none.
- **Database/storage**: none.
- **Docs/operations**: `.specify/`, `specs/`, `docs/AI-SDLC-WORKFLOW.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`, legacy artifact classification for `.ai-orchestrator`, `.qwen`, `.claude`, `.codex-review`, `docs/HANDOFF.md`, `docs/archive`, and `docs/implementation`.
- **CI/release**: `.github/workflows/ci.yml`, `.github/scripts/check-sdlc-policy.py`, `.github/scripts/test_check_sdlc_policy.py`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `.github/copilot-instructions.md`.

## Contracts And Invariants

- Material change categories are defined by explicit path patterns.
- Material changes require `spec.md`, `plan.md`, `tasks.md`, and `checklists/*.md` in the same PR.
- Risky changes require an approving review by a secondary agent who did not author the change, recorded with machine-checkable markers in the PR body or local feature checklist.
- Specs do not outrank `docs/EXECUTION-PLAN.md` or `docs/SYSTEM-DESIGN.md`.
- Legacy handoff/review/runtime artifacts do not outrank the roadmap, execution plan, system design, or feature specs.
- Human approval remains mandatory for production DDL, deployments, platform submissions, domain/secret changes, and real-world actions.

## Verification Plan

- **Unit/integration**: not applicable; no runtime app code changed.
- **Type/build**: not applicable for docs and CI policy.
- **Migration/data**: not applicable.
- **Manual/browser/mobile**: not applicable.
- **Security/privacy**: run `git diff --check`, focused policy-script unit tests, and the SDLC policy script in working-tree and merge-base modes.
- **Legacy reconciliation**: inspect tracked and ignored planning/handoff/review/orchestration artifacts and classify them in `docs/AI-SDLC-WORKFLOW.md`.

## Rollout And Rollback

- **Flags/config**: none.
- **Production approval needed**: `no`.
- **Rollback path**: revert the SDLC scaffolding commit or relax `.github/scripts/check-sdlc-policy.py` in a policy-only PR.

## Open Questions

- Whether Mohamed wants `enforce_admins` enabled or prefers the current emergency administrator bypass.
- A repository administrator must enable required code-owner review and the `secret-scan` status check after this branch lands.
- GitHub Production environments still need required reviewers or equivalent approval protection.
- Four redacted historical Gitleaks findings need Human/security triage before full-history scanning can become a required gate.

Settled decisions: keep `.ai-orchestrator/*` as legacy reference; use `specs/001-dispatch-alert-escalation/` as the next product spec; require dedicated specs for MCP platform submission and the first real Website/API transaction; do not require a spec for a technician-native QA pass unless it produces a risky-path code fix.
