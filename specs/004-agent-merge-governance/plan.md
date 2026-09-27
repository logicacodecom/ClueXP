# Implementation Plan: Agent-Owned Review And Merge Governance

**Spec**: [`spec.md`](spec.md) (rev 2)  
**Branch**: `spec/004-agent-merge-governance` (spec), then an implementation branch from `origin/main`  
**Owner**: `Claude (implementation) · Codex (independent review, different family) · Hermes (accountable lead)`  
**Review Mode**: `Codex secondary review` (SDLC enforcement, GitHub Actions, health endpoints)

## Technical Approach

Keep one policy script and the required check name `sdlc-policy`. Change what it trusts:

- the current PR metadata (API, re-fetched);
- one strict review record bound to a commit;
- family independence;
- status-aware diffs;
- no fallback to on-disk evidence for PR events.

Add release attribution (a `revision` on both health endpoints) and a `post-deploy-verify` workflow
that turns failures into `deploy-incident` issues, which then block merges.

## Affected Surfaces

- **Policy text** (T020):
  - the constitution;
  - `AGENTS.md`;
  - `CLAUDE.md`;
  - `docs/AI-SDLC-WORKFLOW.md`: Decision Queue, AI Agent Roles, Review And Approval Gates, CI Gates,
    Branch/Environment Protection;
  - `.github/copilot-instructions.md`.
- **Canonical sweep** (T021): search active `docs/**`, runbooks, and non-historical specs for "human
  approval before merge", "code-owner", "Codex final review", "one approving review", and "production
  deployment requires Human". Fix active text; annotate history.
- **Templates** (T022): the Spec Kit checklist (a `## Review Record` block plus FR-012 migration/config
  items), the tasks template (`[R]` = independent different-family review), and the PR template
  (review record plus FR-014 field). Delete `.github/CODEOWNERS`.
- **Enforcement** (T010–T013):
  - `.github/scripts/check-sdlc-policy.py`;
  - `.github/scripts/test_check_sdlc_policy.py` (unit);
  - new `.github/scripts/test_check_sdlc_policy_git.py` (temporary-repo integration);
  - new `.github/scripts/sdlc_github.py`: a small `urllib` GitHub API client (`GITHUB_TOKEN`, repo
    from `GITHUB_REPOSITORY`) for PR fetch, commit→PRs lookup, open-issue query, and issue
    create/comment. Mocked in unit tests.
- **CI** (T014):
  - `.github/workflows/sdlc-policy.yml`: job `sdlc-policy`.
    - Triggers per FR-010; `permissions: {contents: read, pull-requests: read, issues: write}`.
    - `concurrency: {group: sdlc-policy-${{ github.event.pull_request.number || github.ref }},
      cancel-in-progress: true}`; `fetch-depth: 0`.
    - Env: `PR_NUMBER`, `PR_BASE_SHA`, `PR_HEAD_SHA`, `PUSH_BEFORE`, `PUSH_AFTER`.
    - Steps: policy-file assertions (moved from `ci.yml`), the gate, the unit suite, the integration
      suite.
  - Remove the `sdlc-policy` job from `ci.yml`.
- **Release** (T015, T016):
  - intake `api/main.py` `/healthz`: add `revision` (also served at `/api/healthz`);
  - MCP `mcp_server/asgi.py` `/healthz`: add `revision`;
  - tests for both;
  - new `.github/workflows/post-deploy-verify.yml` (FR-013).
- **Records** (T023): `specs/000` T012, T017, T022 (historical, superseded), T025 (resolved: on), T026
  (superseded for merge deploys; real-world operations per FR-014).

## Grammar Examples (mirrored as unit-test fixtures)

Valid PR body excerpt:

```markdown
## Review Record

- Secondary-agent review required: yes
- Author agents: Claude Code, Other: Gemini
- Reviewer agent: Codex
- Review scope: implementation
- Reviewed head: 8d2269fed1a11aba5ac2ca1cc87b46da60eddfa8
- Review result: approve
- Merge owner: Claude Code

## Verification
```

Invalid examples, each its own fixture:

- two `## Review Record` headings;
- `Review result` appearing twice (`changes-requested`, then `approve`);
- `Reviewer agent: Other`;
- `Author agents: Codex` with `Reviewer agent: Other: codex` (same family);
- `Reviewed head: 8d2269f` (not 40-hex);
- unknown key `Approved by: Codex`;
- `Secondary-agent review required: no` on a risky diff;
- `Review scope: spec` on a diff containing `apps/intake-web/api/main.py`;
- the heading only inside a fenced code block (counts as zero blocks).

## Script Design

1. **`entries(range_or_mode)`:**
   - Runs `git diff --name-status -M -C -z` and returns `(status, src, dst, dst_mode)`.
   - Working-tree mode unions the unstaged and staged diffs (with D) and `ls-files --others`.
2. **`classify(entries)`:** risky if `src` or `dst` matches a pattern.
   **`artifact_dirs(entries)`:** only `dst` paths with status A, M, R, or C.
3. **Target resolution (FR-009):**
   - PR: `pr = api.get_pull(PR_NUMBER)`. If `pr.head.sha != PR_HEAD_SHA`, fail as obsolete.
     Target = `pr.head.sha`; diff = `PR_BASE_SHA...target`.
   - Push: diff = `PUSH_BEFORE..PUSH_AFTER`. All-zero `before` fails. Run diagnostics, plus the
     `commits/{sha}/pulls` lookup and incident creation on failure; review is not evaluated.
   - `--base/--head`: diff = `B...H`; content via `git show H:path`.
   - `--working-tree`: preflight.
4. **`parse_record(text)`** per FR-001 (fence-aware, strict keys, duplicates, one block).
5. **Review errors:** FR-002, FR-003, FR-005, and the freshness check.
   - Freshness is `merge-base --is-ancestor reviewed target`.
   - Then `diff --name-status --raw reviewed..target`: every entry must be status A or M, mode 100644,
     path `specs/<F>/checklists/*.md`, with `<F>` in the complete artifact dirs.
6. **Incident gate:** if an open issue labelled `deploy-incident` exists and the PR isn't labelled
   `incident-fix`, fail.
7. **Success:** re-fetch the PR. If `body`, `head.sha`, or `updated_at` changed, fail as `metadata
   changed during evaluation`.

## Canonical Settings Payloads (T033)

Snapshot taken read-only on 2026-09-27; T033 re-reads and must match exactly before the PUT.

**Intended PUT** `/repos/logicacodecom/ClueXP/branches/main/protection`:

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "sdlc-policy", "app_id": 15368},
      {"context": "web", "app_id": 15368},
      {"context": "api", "app_id": 15368},
      {"context": "mcp-server", "app_id": 15368},
      {"context": "secret-scan", "app_id": 15368}
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
```

**Restore PUT** (the current state, 2026-09-27): identical except:

- `sdlc-policy` has `app_id: null`;
- `"enforce_admins": false`;
- `"require_code_owner_reviews": true`;
- `"required_approving_review_count": 1`.

Required signatures are off and not part of the PUT; they stay off.

**Repository** `PATCH /repos/logicacodecom/ClueXP`: `{"allow_auto_merge": true}`, restore
`{"allow_auto_merge": false}`. Merge methods are unchanged (squash, merge, and rebase all allowed).

**Procedure:**

1. Declare a no-merge window in Orca.
2. GET protection and repo, and diff against the snapshot; stop on drift.
3. PUT, then validate the response equals the intended payload.
4. GET read-back and compare again; on mismatch, PUT restore and stop.
5. PATCH `allow_auto_merge`, then read it back.
6. Record the before and after JSON in `tasks.md`.

**Restoration order** if we must roll back after `CODEOWNERS` is deleted:

1. Restore `.github/CODEOWNERS` with a revert PR under the new rules.
2. Then PUT restore.
3. Then PATCH auto-merge false.

Restoring the rules without the file would require a code owner nobody can satisfy.

## Verification Matrix

| Requirement | Evidence |
|---|---|
| FR-001 grammar | unit fixtures (all Grammar Examples, plus bullets, backticks, bold, and the deprecated-key bootstrap) |
| FR-002, FR-003 | unit: independence, aliases, multiple authors, same-family instances, author as merge owner, changes-requested, risky diff with required=no |
| FR-004 freshness | git-integration: new code after review fails; governing checklist A/M after review passes; other feature's checklist fails; D/R/T/symlink/mode change fails; force-push non-ancestor fails |
| FR-005 scope | unit and git: spec approval against implementation diff fails |
| FR-006 | unit: non-material PR with no record passes; malformed record on a non-material PR fails grammar |
| FR-007, FR-008 | git: delete-only risky change; rename out of and into risky paths; deleted artifacts; artifacts split across features; staged, unstaged, untracked |
| FR-009 modes | git: `--base/--head` reads head content while checkout differs; working-tree reports preflight and never "satisfied"; push fixtures for squash, merge-commit, rebase, multi-commit, and all-zero `before` |
| FR-010 | unit with a mocked API: obsolete head, metadata changed between fetches, empty or missing body, old-event re-run evaluates current; live T031 on OLD settings |
| FR-011 incident gate | unit with a mocked API: open incident blocks; the `incident-fix` label passes |
| FR-012 | template items present (T022); reviewer checklist item; enforced through review, not the script |
| FR-013 | unit for both health endpoints returning `revision`; workflow logic tested with fixtures (descendant, superseded, null, timeout → issue); live on the T034 acceptance merge |
| FR-014–FR-016, NFR-003 | T020/T021 sweep evidence; CI greps |
| Protection behavior (failing or pending check, stale branch, unresolved conversation, no approval needed) | T033 read-back equality (GitHub enforces the settings), plus the T034 positive merge. Negative protection cases are not re-tested live; GitHub is the enforcer, and the read-back proves the configuration. |

## Rollout And Rollback

1. Spec PR #82: Codex approve, then merge under PO-6 bootstrap.
2. Implementation PR: Codex approve at the exact head, then merge under PO-6 bootstrap; verify `main`
   CI and the new `sdlc-policy.yml`.
3. **T030** bypass inventory: any unresolved caller blocks.
4. **T031** live check on OLD settings: a harmless PR.
   - An edit re-runs.
   - A revoked approval fails.
   - An old run re-run evaluates current.
5. **T033** no-merge window, then the canonical PUT, read-back, and auto-merge.
6. **T034** positive acceptance merge, then `post-deploy-verify` attribution; end of PO-6.
7. **T035**: drop the deprecated-key allowance.

Rollback: the restoration order above; a revert PR for code.

## Open Questions

None blocking. The `app_id` binding and `count: 0` are documented by GitHub; T033 validates by
read-back and restores on mismatch.
