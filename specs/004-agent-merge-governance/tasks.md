# Tasks: Agent-Owned Review And Merge Governance

**Spec**: [`spec.md`](spec.md) (rev 3)  
**Plan**: [`plan.md`](plan.md)  
**Owner**: `Hermes accountable lead; Claude implementation; Codex independent review`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means a Product Owner decision or authorization (FR-014 categories only).
- `[R]` means independent secondary review by a different agent family.

## Tasks — Spec

- [x] T001 Claude: draft the plan; Codex plan review 2026-09-27 returned changes-requested. All
  recommendations were accepted by the PO (PO-9).
- [x] T002 Claude: write spec 004 rev 1.
- [x] T003 [R] Codex: review spec 004.
  - 2026-09-27: rev 1 `8d2269f` → changes-requested (R1–R8).
  - Claude revised it as rev 2, addressing R1 (FR-013 attribution and incidents), R2 (FR-010/FR-011
    current metadata), R3 (FR-004/FR-009 modes, freshness, narrowed evidence), R4 (FR-001 grammar),
    R5 (FR-009 push diagnostics, all-zero `before` fails closed), R6 (plan canonical payloads,
    restore, order, PO-6 covering both PRs), R7 (FR-012 executable tests and template items), and R8
    (verification matrix, T021 sweep, FR-014 activation clarity).
  - 2026-09-27: rev 2 `d217114` → changes-requested (findings 1–7).
  - Claude revised it as rev 3 by simplifying:
    - 1 and 7: the incident freeze becomes an agent-enforced operational rule; push diagnostics drop
      the PR-provenance lookup (GitHub protection provides provenance);
    - 2: the MCP monitor and ASGI tests move to a semantic `status` check;
    - 3: a record-declared `required: yes` is always fully validated;
    - 4: canonical projection, `app_id: -1` restore, partial-failure procedure;
    - 5: `.github/scripts/**` classified risky;
    - 6: containment via the compare API, the build-every-commit prerequisite, success recording.
  - 2026-09-27: rev 3 `404bc52` → **approve**, no blockers. Codex listed seven implementation-time
    acceptance obligations (verdict in `checklists/sdlc-policy.md`); they apply to T010–T036.

## Tasks — Implementation (after T003 approve)

- [x] T010 Claude: `entries()`/`classify()`/`artifact_dirs()` status-aware (FR-007, FR-008).
- [x] T011 Claude: `parse_record()` grammar, agent normalization, strict keys (FR-001, FR-002, FR-003,
  FR-006).
- [x] T012 Claude: target resolution and modes, freshness, scope, record-declared validation, success
  re-fetch (FR-004, FR-005, FR-006, FR-009, FR-010) with `sdlc_github.py`; set the
  `.github/scripts/**` risky pattern.
- [x] T013 Claude: unit plus git-integration suites covering the plan Verification Matrix.
- [x] T014 Claude: `sdlc-policy.yml` (the only `sdlc-policy` producer; assertions and both suites
  moved), and remove the job from `ci.yml`.
- [x] T015 Claude: `revision` on intake and MCP `/healthz`, with tests; update the MCP ASGI exact-JSON
  tests and `mcp-production-health.yml` to a semantic status check, with tests.
- [x] T016 Claude: `post-deploy-verify.yml` plus `post_deploy_verify.py` (FR-013) with mocked-compare
  tests; `protection_projection.py` with fixtures (plan).
- [x] T020 Claude: policy text (FR-011, FR-012, FR-014, FR-015, FR-016, NFR-001, NFR-003).
- [x] T021 Claude: canonical doc and runbook sweep; fix active text, annotate history.
- [x] T022 Claude: templates (checklist review record plus FR-012 items, tasks `[R]`, PR template);
  delete `.github/CODEOWNERS`.
- [x] T023 Claude: `specs/000` annotations (T012, T017, T022 historical; T025 resolved; T026
  superseded).
- [x] T024 [R] Codex: independent review at the exact head.
- [x] T025 Claude: merge after Codex approve and green CI (agent merge; PO-6 revised, no human
  approval); verify `main` CI.

## Tasks — Transition (after T025)

- [x] T030 Claude/Hermes: bypass inventory (repo, Orca automations, local scripts: `--admin`, direct
  pushes to `main`, protection edits). No unresolved caller blocks the transition. Evidence: branch
  protection read-back shows PR-only `main`, `enforce_admins: true`, required checks, no force push or
  deletion; open PR inventory showed no armed auto-merges during the incident freeze.
- [x] T031 Claude/Hermes: live metadata check: body edits re-ran `sdlc-policy`, revoked approval failed,
  and a current approved body passed. Evidence: PR #83 `sdlc-policy` runs 36353910655 (failure),
  36353926569 (cancelled rerun after edit), and 36353936799 (success at approved body/current head).
- [x] T033-early Claude (2026-09-27, per revised PO-6): snapshot → PUT → read-back **match**:
  0 approvals, code-owner off, `enforce_admins` on, strict checks (`sdlc-policy`, `web`, `api`,
  `mcp-server`, `secret-scan`, all bound to app 15368), conversation resolution, no force-push or
  deletion; `allow_auto_merge` true. The raw before/after JSON is kept in the author's session
  artifacts. The restore payload is in the plan.
- [x] T033 Claude/Hermes: re-verified settings: protected `main` requires pull requests with 0 required
  approvals, code-owner review off, stale review dismissal on, strict required checks
  (`sdlc-policy`, `web`, `api`, `mcp-server`, `secret-scan`) bound to GitHub Actions, conversation
  resolution on, `enforce_admins` on, no force pushes/deletions, repository `allow_auto_merge` true,
  and Vercel ignored-build-step commands matching T037 on all six projects. Raw branch-protection,
  repository, and Vercel project reads are stored in session scratch artifacts.
- [x] T034 Claude/Hermes: positive acceptance: PR #83 merged to `main` with no human approval after the
  merge owner checked `deploy-incident` state; required checks were green. Push `sdlc-policy` run
  36354069177 passed. Post-deploy verification failed closed and opened incident #84 when Vercel
  build-rate limits blocked attribution; incident-fix PR #85 merged as `8df1967`, Vercel ignored-build
  steps were set, post-deploy verification run 36439628875 passed, and issue #84 was closed.
- [x] T035 Hermes: remove the deprecated `Secondary-agent review completed` allowance from the parser,
  tests, and active spec 004 review record.
- [x] T036 [R] Codex: verified T030–T035 evidence and the T035 policy change. Local review verdict:
  approve, no blockers; reviewed the staged T035 diff plus transition evidence, ran
  `git diff --cached --check` and `python .github/scripts/test_check_sdlc_policy.py` (34 passed).
- [x] T037 Claude (incident #84 fix, 2026-09-28): `scripts/vercel-ignore-build.sh`, `.vercelignore`
  keeps `.git`, `post_deploy_verify.py` `unchanged` state plus `sdlc_github.compare_files`, tests.
  Vercel `commandForIgnoringBuildStep` set on all six projects after merge.
- [x] T038 [R] Hermes: independent review of T037 at head `6ff7506be067597807df056c41e024becada2664`.
  Evidence recorded in PR #85 body; local review ran post-deploy/policy/git/projection tests and
  approved the incident fix before merge.

## Follow-ups

- [x] T040 Hermes: aligned locally installed agent guidance found by search. The active repo policy
  governs this project; no skill described Codex as sole final reviewer or a human production gate.
