# Implementation Plan: Agent-Owned Review And Merge Governance

**Spec**: [`spec.md`](spec.md)  
**Branch**: `spec/004-agent-merge-governance` (spec), then an implementation branch from `origin/main`  
**Owner**: `Claude (implementation) · Codex (independent review, different family) · Hermes (accountable lead)`  
**Review Mode**: `Codex secondary review` (SDLC policy enforcement and GitHub Actions paths)

## Technical Approach

Keep the existing single policy script and its required check name. Change what it trusts:

- one strict review record, bound to a commit;
- family independence;
- status-aware diffs;
- no fallback to on-disk evidence for PR events.

Move `sdlc-policy` into its own workflow file so PR-body edits re-run only the policy job, not the
full build and test matrix.

## Affected Surfaces

- **Policy text**:
  - `.specify/memory/constitution.md`: Authority, Review And Merge Gates, Agent Ownership.
  - `AGENTS.md`: Authority, required workflow steps 9–10, Safety and repository rules.
  - `CLAUDE.md`: Role, secondary-reviewer paragraph, Orca/Spec Kit paragraph.
  - `docs/AI-SDLC-WORKFLOW.md`: Decision Queue, AI Agent Roles, Review And Approval Gates, CI Gates,
    GitHub Branch And Environment Protection.
  - `.github/copilot-instructions.md`: AI SDLC Policy block.
- **Templates**:
  - `.specify/templates/checklist-template.md`: review record fields.
  - `.specify/templates/tasks-template.md`: `[R]` becomes "independent secondary review".
  - `.github/pull_request_template.md`: FR-001 record plus the FR-014 PO-decision field.
- **Enforcement**:
  - `.github/scripts/check-sdlc-policy.py`: FR-001..FR-010.
  - `.github/scripts/test_check_sdlc_policy.py`: unit tests.
  - New `.github/scripts/test_check_sdlc_policy_git.py`: integration tests with temporary git repos.
- **CI**:
  - `.github/workflows/ci.yml`: remove the `sdlc-policy` job.
  - New `.github/workflows/sdlc-policy.yml`: job name `sdlc-policy`; PR types opened, synchronize,
    reopened, edited, ready_for_review; push to `main`; `concurrency: sdlc-policy-${{ PR number or ref }}`
    with `cancel-in-progress: true`; checkout with `fetch-depth: 0`; passes `PR_HEAD_SHA`,
    `PR_BASE_SHA`, `PUSH_BEFORE`, and `PUSH_AFTER` from the event payload to the script, and the PR
    body via `GITHUB_EVENT_PATH`.
  - New `.github/workflows/post-deploy-smoke.yml`: on push to `main`, after a delay, poll
    `https://intake.cluexp.com/api/healthz` and an MCP `tools/call list_services` (reusing the
    `mcp-production-health` parser) for up to 10 minutes, then fail loudly.
- **Removal**: `.github/CODEOWNERS`.
- **Records**: `specs/000-orca-speckit-sdlc/{spec,plan,tasks}.md`. T012, T017 and T022 are annotated
  historical/superseded by spec 004. T025 is resolved (`enforce_admins` on). T026 is superseded for
  merge deployments; real-world operations stay PO-authorized per FR-014.

## Script Design (`check-sdlc-policy.py`)

1. **`changed_entries(args)`** returns `(status, old_path, new_path)` from
   `git diff --name-status -M -C`, including D. Working-tree mode unions unstaged, staged (both with
   deletions), and untracked files. Classification uses both rename/copy endpoints. Artifact detection
   ignores entries whose status is D.
2. **Diff range:**
   - PR: `PR_BASE_SHA...PR_HEAD_SHA`.
   - Push: `PUSH_BEFORE..PUSH_AFTER`; when `before` is all zeros, fall back to the first-parent range.
   - Local: `--base/--head`.
   - `GITHUB_EVENT_BEFORE` and `HEAD^` guessing are removed.
3. **`parse_review_record(text)`**: exact key set per FR-001. Duplicates raise. Unknown keys inside
   the block are ignored, and the block is delimited by the `## Review Record` heading (PR template
   and checklist). Agent normalization:
   - lowercase, collapse whitespace;
   - `other: <name>` → `other:<name>`, with known-family aliases mapped to the family;
   - bare `other` or blank → error.
4. **`review_errors(record, entries, head_sha)`**:
   - required and approve (FR-003);
   - family independence (FR-002);
   - scope (FR-005);
   - freshness (FR-004): `git merge-base --is-ancestor reviewed head`, then name-status
     `reviewed..head` must be only `specs/*/checklists/*.md`.
5. **Evidence source (FR-009)**:
   - PR: parse `pull_request.body` from the event payload; empty or missing → no evidence.
   - Push: skip review.
   - Local: only a review record in a changed checklist of the complete feature directory, with
     `Reviewed head` checked against `--head`.

## Verification Plan

- **Unit tests** (`test_check_sdlc_policy.py`):
  - normalization, aliases, bare or blank `other`;
  - multiple authors and same-family instance rejection;
  - author-as-merge-owner allowed;
  - duplicate and conflicting fields;
  - `changes-requested`;
  - scope mismatch;
  - PR body absent vs empty;
  - non-risky exemption passes; risky exemption fails.
- **Git integration tests** (`test_check_sdlc_policy_git.py`, real `git init` in a temp dir):
  - delete-only risky change;
  - rename out of and into risky paths;
  - removed artifacts don't count;
  - staged, unstaged and untracked in working-tree mode;
  - complete artifacts in one feature vs split across features;
  - freshness: new code after the reviewed head fails; checklist-only change after it passes;
  - force-push with the reviewed head not an ancestor fails;
  - unchanged old checklist plus a different changed checklist fails;
  - multi-commit push range from the payload.
- **Workflow behavior**: after merge (T030), verify on a harmless PR that editing the body re-runs
  `sdlc-policy` and that a superseded run is cancelled.
- **Existing checks**: CI greps pass; the full current test suite passes.

## Rollout And Rollback

- **Order**:
  1. Spec PR (docs only), reviewed by Codex.
  2. Implementation PR, reviewed by Codex; merges under the PO-6 bootstrap approval.
  3. Verify `main` CI.
  4. The `enforce_admins` pre-flight inventory (T029).
  5. Snapshot the protection JSON.
  6. Apply settings in one PUT, then read them back (T030).
  7. Enable auto-merge.
  8. Run the positive acceptance PR, observing the new `sdlc-policy` edited-event behavior.
  9. Record evidence.
- **Rollback**: restore the snapshotted protection JSON with the same admin account (PO-authorized per
  FR-015's exception clause). Revert the implementation PR through a normal PR.
- **Production approval needed**: settings changes are authorized by PO-1..PO-9. No production data or
  deploy is involved beyond normal merge = deploy of CI/docs files, which deploy nothing user-facing.

## Open Questions

- The exact GitHub API form for binding a required status check to the GitHub Actions app
  (`checks: [{context, app_id: 15368}]`). Verify in T030; if unsupported, record the residual risk.
