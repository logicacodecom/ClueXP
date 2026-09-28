# Implementation Plan: Agent-Owned Review And Merge Governance

**Spec**: [`spec.md`](spec.md) (rev 3)  
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
that turns failures into `deploy-incident` issues. The incident freeze is agent-enforced (FR-011), and
push diagnostics don't try to prove PR provenance. Both are deliberate simplifications (rev 3).

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
  - new `.github/scripts/sdlc_github.py`: a small read-mostly `urllib` GitHub API client
    (`GITHUB_TOKEN`, repo from `GITHUB_REPOSITORY`) for PR fetch (the gate), plus compare and issue
    create/comment (post-deploy only). Mocked in unit tests.
  - **Risky classification:** replace the individually listed script and test filenames with
    `.github/scripts/**`, so every policy, incident, and deploy-verification helper and its tests are
    risky, including helper-only modify, delete, or rename (classifier tests).
- **CI** (T014):
  - `.github/workflows/sdlc-policy.yml`: job `sdlc-policy`.
    - Triggers per FR-010; `permissions: {contents: read, pull-requests: read}` (read-only).
    - `concurrency: {group: sdlc-policy-${{ github.event.pull_request.number || github.ref }},
      cancel-in-progress: true}`; `fetch-depth: 0`.
    - Env: `PR_NUMBER`, `PR_BASE_SHA`, `PR_HEAD_SHA`, `PUSH_BEFORE`, `PUSH_AFTER`.
    - Steps: policy-file assertions (moved from `ci.yml`), the gate, the unit suite, the integration
      suite.
  - Remove the `sdlc-policy` job from `ci.yml`.
- **Release** (T015, T016):
  - intake `api/main.py` `/healthz`: add `revision` (also served at `/api/healthz`);
  - MCP `mcp_server/asgi.py` `/healthz`: add `revision`;
  - tests for both; update the two MCP ASGI tests that assert the exact health JSON;
  - `.github/workflows/mcp-production-health.yml`: parse JSON and assert `status == "ok"` instead of
    whole-body equality, keeping the `list_services` semantic check. Tests cover revision
    present/null, malformed JSON, and `status != ok`;
  - new `.github/workflows/post-deploy-verify.yml` (FR-013), with its decision logic in
    `.github/scripts/post_deploy_verify.py` so it is unit-testable and classified risky.
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
   - Push: diff = `PUSH_BEFORE..PUSH_AFTER`. All-zero `before` fails. Run classification and
     artifact diagnostics only (no PR lookup, no issue writes); review is not evaluated.
   - `--base/--head`: diff = `B...H`; content via `git show H:path`.
   - `--working-tree`: preflight.
4. **`parse_record(text)`** per FR-001 (fence-aware, strict keys, duplicates, one block).
5. **Review errors:** FR-002, FR-003, FR-005, and the freshness check.
   - Freshness is `merge-base --is-ancestor reviewed target`.
   - Then `diff --name-status --raw reviewed..target`: every entry must be status A or M, mode 100644,
     path `specs/<F>/checklists/*.md`, with `<F>` in the complete artifact dirs.
6. **Record-declared review (FR-006):** a record declaring `required: yes` on any PR is fully
   validated, even when the diff is not risky.
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

- `sdlc-policy` has `app_id: -1` (the documented "any app" value; the current read-back shows it
  unbound, as `null`);
- `"enforce_admins": false`;
- `"require_code_owner_reviews": true`;
- `"required_approving_review_count": 1`.

Required signatures are off and not part of the PUT; they stay off.

**Repository** `PATCH /repos/logicacodecom/ClueXP`: `{"allow_auto_merge": true}`, restore
`{"allow_auto_merge": false}`. Merge methods are unchanged (squash, merge, and rebase all allowed).

**Canonical projection** (`.github/scripts/protection_projection.py`, unit-tested with recorded
request/response fixtures). It maps a GET or PUT response and a request payload to one comparable
policy object:

- strip `url`, `contexts_url`, and any other URL fields;
- flatten `{enabled: x}` objects to `x`;
- sort `checks` by context and normalize an unbound app (`null`/`-1`) to `any`;
- drop the derived `contexts` list;
- treat an absent `bypass_pull_request_allowances` as empty and `restrictions: null` as none.

It includes a fixture where a successful PUT response must not trigger rollback.

**Procedure:**

1. Declare a no-merge window in Orca, and keep it open through any recovery.
2. GET protection and repo; project the result; compare it with the projected snapshot; stop on drift.
3. PUT the intended payload. Project the response and compare it with the projected intent.
4. GET the read-back, project it, and compare with the intent.
   - On mismatch, PUT restore, project the read-back, confirm it equals the snapshot, and stop.
5. PATCH `allow_auto_merge: true` and read it back.
   - On failure, restore it to `false`, then PUT the protection restore, then stop.
6. Record the raw and projected before/after JSON in `tasks.md`.
7. End the no-merge window only after all steps succeed, or after a full restore is verified.

**Emergency rule restoration** (steps 4–5) is separate from a later decision to revert the governance
change, which uses the restoration order below.

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
| FR-006 | unit: non-material PR with no record passes; malformed record on a non-material PR fails grammar; a `required: yes` record on a spec-only PR is fully validated (`changes-requested` blocks) |
| FR-007, FR-008 | git: delete-only risky change; rename out of and into risky paths; deleted artifacts; artifacts split across features; staged, unstaged, untracked |
| FR-009 modes | git: `--base/--head` reads head content while checkout differs; working-tree reports preflight and never "satisfied"; push fixtures for squash, merge-commit, rebase, multi-commit, and all-zero `before` |
| FR-010 | unit with a mocked API: obsolete head, metadata changed between fetches, empty or missing body, old-event re-run evaluates current; live T031 on OLD settings |
| FR-011 incident rule | operational (agent-enforced). The documented merge-owner and Hermes steps are verified in T034: `gh issue list` before merging; `--disable-auto` on incident. Not a required-check test. |
| FR-012 | template items present (T022); reviewer checklist item; enforced through review, not the script |
| FR-013 | unit: both health endpoints return `revision`; the monitor's semantic check (revision present/null, malformed JSON, `status != ok`); `post_deploy_verify.py` with a mocked compare API (identical, ahead, a superseding descendant missing locally, a one-project null or older revision, an unrelated-branch SHA, a compare API error → `unknown`, an older revision with unchanged watched inputs → `unchanged` (a watched change → `no`, a truncated diff → `unknown`), timeout → issue, issue-creation failure → red). Live on the T034 acceptance merge. |
| Risky helpers | classifier: modify, delete, or rename of any `.github/scripts/**` file, including `sdlc_github.py`, `post_deploy_verify.py`, `protection_projection.py`, and the git test file, is risky |
| Settings projection | unit fixtures: a GET response and a successful PUT response project equal to the intent; app `null`/`-1` both map to `any`; a real drift is detected |
| FR-014–FR-016, NFR-003 | T020/T021 sweep evidence; CI greps |
| Protection behavior (failing or pending check, stale branch, unresolved conversation, no approval needed) | T033 read-back equality (GitHub enforces the settings), plus the T034 positive merge. Negative protection cases are not re-tested live; GitHub is the enforcer, and the read-back proves the configuration. |

## Rollout And Rollback

1. Spec PR #82: Codex approve, then merge under PO-6 bootstrap.
2. Implementation PR: Codex approve at the exact head, then merge under PO-6 bootstrap; verify `main`
   CI and the new `sdlc-policy.yml`.
3. **T030** bypass inventory: any unresolved caller blocks.
4. **T031** live check on OLD settings: a harmless PR whose body carries a `required: yes` record,
   so FR-006 fully validates it. It stays unmerged during the negative steps.
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

## Implementation Notes (2026-09-27)

- **Gate:** `check-sdlc-policy.py` keeps the risk-pattern table, with the SDLC family now
  `.github/scripts/**`.
  - Adds status-aware `--raw -z` diff parsing (`Entry`), the strict fence-aware `## Review Record`
    parser, family normalization, independence/scope/freshness checks, and four modes: PR (API
    re-fetch, obsolete/metadata-changed), push (diagnostics only), `--base/--head` (reads head
    content), `--working-tree` (preflight).
  - `sdlc_github.py` is the stdlib API client.
- **Tests:**
  - `test_check_sdlc_policy.py`: 29 unit tests (grammar fixtures from §Grammar Examples, modes with a
    mocked API);
  - `test_check_sdlc_policy_git.py`: 12 tests against real temporary repos;
  - `test_post_deploy_verify.py`: 9 tests;
  - `test_protection_projection.py`: 5 tests, using the real 2026-09-27 before/after read-backs as
    fixtures (URLs redacted). They prove the live settings project equal to the intended PUT, and the
    `app_id: -1` restore equal to the original snapshot.
- **Health checks:** the monitor and post-deploy verification share `post_deploy_verify.py`'s parsers.
  The monitor now checks out the repo and calls `post_deploy_verify.py health|list-services`.
- **Vercel prerequisites** (verified via the project API, 2026-09-27): both `cluexp-intake` and
  `cluexp-mcp-server` have `autoExposeSystemEnvs: true` (so `VERCEL_GIT_COMMIT_SHA` is available) and
  production branch `main`. Amended 2026-09-28 (incident #84): all six projects set
  `commandForIgnoringBuildStep` to `bash ../../scripts/vercel-ignore-build.sh <paths>`: intake and the
  four consoles watch `. ../../packages ../../package.json ../../package-lock.json ../../.vercelignore`;
  MCP watches `. ../../.vercelignore`. `.vercelignore` no longer strips `.git`, which the step needs.
- **Templates:** the PR and checklist templates carry the Review Record as a fenced, commented
  example, so an unfilled template never fails grammar validation.
- **Canonical sweep (T021):** active policy updated in `SYSTEM-DESIGN.md` (trunk-based bullet).
  Historical "applied after explicit Human authorization" records are left unchanged.
- **Observed risk:** Vercel preview builds on PR #82 failed with a plan build rate limit. If production
  builds are rate-limited, `post-deploy-verify` reports "not attributed" and opens a
  `deploy-incident`, by design.
