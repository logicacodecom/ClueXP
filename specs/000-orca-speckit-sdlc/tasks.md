# Tasks: Orca + Spec Kit AI SDLC Workflow

**Spec**: `specs/000-orca-speckit-sdlc/spec.md`  
**Plan**: `specs/000-orca-speckit-sdlc/plan.md`  
**Owner**: `Codex lead`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means the task requires Human input or authorization before execution.
- `[R]` means Codex final review is required before merge.

## Tasks

- [x] T001 Codex: inspect repository structure, existing GitHub workflows, current agent policy, and Orca repo metadata.
- [x] T002 Codex: add Spec Kit constitution and templates.
- [x] T003 Codex: add AI SDLC workflow guide and PR template.
- [x] T004 Codex: update Codex, Claude, and Copilot policy entrypoints.
- [x] T005 Codex: add diff-aware SDLC CI policy gate.
- [x] T006 Codex: dogfood the policy with this feature spec, plan, tasks, and checklist.
- [x] T007 [R] Codex final review: verify implementation, specs, docs, tests, and unresolved risks before merge.
- [ ] T008 [H] Human/repo admin: configure GitHub branch protection and production environment gates.

## Verification

- [x] `python .github/scripts/check-sdlc-policy.py --working-tree`
- [x] `git diff --check`
- [x] Review branch protection recommendations in `docs/AI-SDLC-WORKFLOW.md`.
