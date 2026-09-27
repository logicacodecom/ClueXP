# Tasks: Agent-Owned Review And Merge Governance

**Spec**: [`spec.md`](spec.md)  
**Plan**: [`plan.md`](plan.md)  
**Owner**: `Hermes accountable lead; Claude implementation; Codex independent review`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means a Product Owner decision or authorization (FR-014 categories only).
- `[R]` means independent secondary review by a different agent family.

## Tasks — Spec

- [x] T001 Claude: draft the plan; Codex plan review 2026-09-27 returned changes-requested (P1 ×5, P2 ×5,
  P3 ×1). All recommendations were accepted by the PO (PO-9).
- [x] T002 Claude: write spec 004, plan, tasks, and checklist from PO-1..PO-9.
- [ ] T003 [R] Codex: review spec 004; record the verdict in `checklists/sdlc-policy.md`.

## Tasks — Implementation (after T003 approve)

- [ ] T010 Claude: `check-sdlc-policy.py`: status-aware entries (FR-007) and the payload-based diff
  range (plan §2).
- [ ] T011 Claude: review record parser, normalization, duplicates, and family independence (FR-001,
  FR-002, FR-006).
- [ ] T012 Claude: freshness and scope checks (FR-004, FR-005) and the evidence-source rules (FR-009).
- [ ] T013 Claude: unit tests plus the new git integration test file (plan Verification).
- [ ] T014 Claude: `sdlc-policy.yml` (FR-010) replacing the `ci.yml` job; `post-deploy-smoke.yml`
  (FR-013).
- [ ] T015 Claude: policy text in the constitution, `AGENTS.md`, `CLAUDE.md`,
  `docs/AI-SDLC-WORKFLOW.md`, and copilot instructions (FR-011, FR-012, FR-014, FR-015, FR-016,
  NFR-001, NFR-003).
- [ ] T016 Claude: templates (checklist, tasks, PR template) and delete `.github/CODEOWNERS`.
- [ ] T017 Claude: annotate `specs/000` T012, T017, T022 (historical), T025 (resolved), and T026
  (superseded for merge deploys).
- [ ] T018 [R] Codex: independent review of the implementation PR, at the exact head.
- [ ] T019 [H] PO-6 bootstrap: one final `ferrybarbarossa` approval, then merge; verify `main` CI.

## Tasks — Transition (after T019)

- [ ] T029 Claude: `enforce_admins` pre-flight inventory. Search the repo, Orca automations, and local
  scripts for `--admin`, direct pushes to `main`, and protection edits; remove or record each.
- [ ] T030 Claude: snapshot branch protection JSON, then apply in one PUT:
  - approvals 0, code-owner off, `enforce_admins` on;
  - PR required, strict checks (`secret-scan`, `sdlc-policy` bound to GitHub Actions, `web`, `api`,
    `mcp-server`), conversation resolution, no force-push or deletion.
  Then read back, enable repository auto-merge, and record the before/after JSON in this spec.
- [ ] T031 Claude: positive acceptance with a harmless PR:
  - editing the body re-runs `sdlc-policy`;
  - it merges with no human approval;
  - post-deploy smoke runs green.
- [ ] T032 [R] Codex: verify the T030 read-back and T031 evidence; negative cases are covered by T013
  tests.

## Follow-ups

- [ ] T040 Hermes: align locally installed agent skills (for example launch-ops) that still describe
  Codex as sole final reviewer or a human production gate; repo policy governs.
