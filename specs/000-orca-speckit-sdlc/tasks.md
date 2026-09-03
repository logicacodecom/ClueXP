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
- [x] T008 Codex: inspect legacy planning, handoff, review, TODO, and orchestration artifacts.
- [x] T009 Codex: classify legacy artifacts in `docs/AI-SDLC-WORKFLOW.md` as canonical authority, reference evidence, runtime state, or future-spec input.
- [x] T010 Codex: reconcile completed and obsolete legacy agent notes without deleting legacy files.
- [x] T011 Codex: verify `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` all point to the same SDLC workflow.
- [x] T012 [H] Human/repo admin: configure GitHub `main` branch protection with strict required checks (`sdlc-policy`, `web`, `api`, `mcp-server`), one approving review, stale-review dismissal, conversation resolution, and destructive/direct-push restrictions. Verified through the GitHub API on 2026-09-03; `enforce_admins` remains off pending T025.
- [x] T013 [H] Mohamed: keep tracked `.ai-orchestrator/*` as non-authoritative legacy reference. Do not move/delete it or create a dedicated cleanup spec; reconsider only during incidental future cleanup.
- [x] T014 [H] Mohamed/Codex: select **dispatcher alert acknowledgement and escalation** from `docs/EXECUTION-PLAN.md` §5/§10 as the first real Spec Kit slice because it addresses the confirmed unattended-queue risk and touches dispatch/production-notification paths. Create it as `specs/001-dispatch-alert-escalation/` before implementation.
- [x] T015 [R] Codex: confirm PR #73 passes `secret-scan`, `sdlc-policy`, `web`, `api`, and `mcp-server`, then merge the SDLC branch. Completed 2026-09-03; merge commit `36e7df2`.
- [x] T016 [H] Mohamed/Codex: require dedicated specs for MCP platform submission and the first real Website/API transaction. Technician-native pilot QA itself is exempt unless a finding requires a risky-path code fix; that fix requires its own spec.
- [x] T017 Codex: add CODEOWNERS for risky paths using the repository's valid GitHub collaborator identities. Codex/Claude remain workflow roles enforced through secondary-review evidence because they are not GitHub accounts.
- [x] T018 Codex: require independent secondary-agent review for risky changes and enforce completed approval markers in PR or local checklist evidence.
- [x] T019 [R] Codex/repo admin: add a pinned Gitleaks `secret-scan` CI job for introduced commits. GitHub native secret scanning and push protection are also confirmed enabled.
- [ ] T020 [P] Codex: keep payment/billing risky-path patterns aligned as real processor code lands. Existing payment and settlement routes/migrations are present and representative classifier coverage now passes; revisit for future Stripe service/webhook boundaries.
- [ ] T021 [P] Codex: document and verify one-writer-per-surface assignment in Orca task/worktree state for the first parallel feature execution.
- [x] T022 [H] Mohamed/repo admin: enable required code-owner reviews after CODEOWNERS lands. Verified enabled through the GitHub API on 2026-09-03.
- [x] T023 [H] Mohamed/repo admin: add `secret-scan` to required `main` status checks after its successful PR run. Verified enabled through the GitHub API on 2026-09-03.
- [ ] T024 [H] Mohamed/security owner: triage four redacted historical Gitleaks findings, determine false positives versus credentials requiring restriction/rotation, and establish a reviewed baseline before any full-history required scan.
- [ ] T025 [H] Mohamed: decide whether to keep `enforce_admins` off for emergency bypass or enable it so administrators cannot bypass branch protection.
- [ ] T026 [H] Mohamed/repo admin: configure required reviewers or equivalent approval rules on all GitHub Production environments; API verification on 2026-09-03 showed no environment protection rules.
- [ ] T027 Codex: create `specs/001-dispatch-alert-escalation/` from the Spec Kit templates before implementing the selected backlog slice.

## Verification

- [x] `python .github/scripts/check-sdlc-policy.py --working-tree`
- [x] `git diff --check`
- [x] Review branch protection recommendations in `docs/AI-SDLC-WORKFLOW.md`.
- [x] `python .github/scripts/check-sdlc-policy.py --base main --head HEAD --merge-base`
- [x] `python .github/scripts/test_check_sdlc_policy.py`
