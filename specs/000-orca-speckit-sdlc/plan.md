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
- **Docs/operations**: `.specify/`, `specs/`, `docs/AI-SDLC-WORKFLOW.md`, `docs/README.md`, `AGENTS.md`, `CLAUDE.md`.
- **CI/release**: `.github/workflows/ci.yml`, `.github/scripts/check-sdlc-policy.py`, `.github/pull_request_template.md`, `.github/copilot-instructions.md`.

## Contracts And Invariants

- Material change categories are defined by explicit path patterns.
- Material changes require `spec.md`, `plan.md`, `tasks.md`, and `checklists/*.md` in the same PR.
- Specs do not outrank `docs/EXECUTION-PLAN.md` or `docs/SYSTEM-DESIGN.md`.
- Human approval remains mandatory for production DDL, deployments, platform submissions, domain/secret changes, and real-world actions.

## Verification Plan

- **Unit/integration**: not applicable; no runtime app code changed.
- **Type/build**: not applicable for docs and CI policy.
- **Migration/data**: not applicable.
- **Manual/browser/mobile**: not applicable.
- **Security/privacy**: run `git diff --check` and the SDLC policy script locally.

## Rollout And Rollback

- **Flags/config**: none.
- **Production approval needed**: `no`.
- **Rollback path**: revert the SDLC scaffolding commit or relax `.github/scripts/check-sdlc-policy.py` in a policy-only PR.

## Open Questions

- A repository administrator must configure GitHub branch protection and environments after this branch is reviewed.
