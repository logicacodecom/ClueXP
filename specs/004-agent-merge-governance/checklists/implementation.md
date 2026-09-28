# Checklist: Spec 004 Implementation

**Artifact Reviewed**: `implementation (feat/004-agent-merge-governance)`
**Reviewer**: `Codex (independent; different family from Claude Code)`
**Date**: `2026-09-27`

The authoritative review verdict is the `## Review Record` in the PR body. The reviewer may copy it
here for local `--base/--head` checks.

## Author Evidence (Claude Code)

- [x] Gate unit tests: 29 pass; git-integration: 12 pass; post-deploy: 9 pass; projection: 5 pass.
- [x] MCP server suite and intake API suite pass with the `revision` health field.
- [x] Shared health/list_services checks run green against production (revision null until the next
  git deploy).
- [x] Vercel prerequisites verified (auto-exposed system env vars, no build-skip, production branch
  `main`).
- [x] Settings already switched (T033-early) and projected equal to intent via real fixtures.
- [ ] T031 live metadata check, T034 acceptance merge with post-deploy attribution, T035, T036
  (transition, after merge).

## Codex Implementation-Time Obligations (from the T003 approve)

- [x] Incident rule is operational, with the lookup/disarm steps documented (constitution, workflow
  doc); red runs are treated as incidents.
- [x] Health consumers: both endpoints, the ASGI exact-JSON tests, and the monitor changed together;
  the revision value is asserted explicitly.
- [x] Declared `required: yes` records are fully validated on non-material PRs (unit test).
- [x] Projection fixtures cover real responses, `-1`/null app, drift, ordering, bypass, and null reviews.
- [x] `.github/scripts/**` is risky, including helper-only changes (unit test).
- [x] Containment via the compare API, including "on main", with unknown never counting as success
  (unit tests).
- [x] Push diagnostics are read-only and fail closed on all-zero `before`.

## Review Record

Secondary-agent review required: yes
Author agents: Claude Code
Reviewer agent: Codex
Review scope: implementation
Reviewed head: df3db425f7ff4486a05a36b3c730b36090b7ecc9
Review result: approve
Merge owner: Claude Code

## T024 Reviewer Ownership And Findings

Codex owns this checklist for this user-assigned review. The checked author-evidence items above are author assertions; the current independent verdict and reproduced findings below control acceptance. No implementation files were edited.

# T024 — Independent implementation review of PR #83

Verdict: **changes-requested**

Reviewed head: `d0c04a7fd018deb9b85316fdb08021c1147c3a79`.
Reviewer: Codex. Author family: Claude Code. Date: 2026-09-27.
Scope: implementation of spec 004 T010–T023 and the seven implementation-time obligations approved at 404bc52. The revised PO decision withdrawing bootstrap approval is accepted. Read-only GitHub inspection confirms enforce_admins on, zero required approvals, code-owner review off, strict required checks bound to app 15368. I did not change settings or merge.

All four requested suites passed locally: policy 29, git integration 12, post-deploy 9, projection 5 (55 total). Targeted in-memory probes exposed the defects below. No implementation files were edited to run the probes.

1. **P1 — BLOCKING: a fenced approval can override the real unfenced changes-requested record.**
   Location: `.github/scripts/check-sdlc-policy.py:275` (`_record_blocks`), especially line 282.
   The scanner toggles one boolean on every line beginning with either three backticks or three tildes. Markdown requires closing a fence with the same character and sufficient length. Consequently a tilde line inside a backtick fence wrongly exits the fence, and the real closing backticks wrongly enter one. A valid rendered code example can be treated as the authoritative approval while the actual outside record is ignored.
   Reproduction: open a backtick text fence; place a line of three tildes inside it; include a complete approve record; then a level-2 Notes heading; close the original backtick fence; append a complete unfenced changes-requested record. With a risky auth diff and complete feature artifacts, `evaluate(entries, body, reviewed_head)` returns `errors=[]`. `parse_record(body)['result']` is approve. The sole real unfenced record requests changes, so the gate must fail.
   Fix: track fence character, opener length and valid closer syntax/indentation; ignore headings within the actual fence. Use the same block interpretation in has_record and parse_record. Add full evaluate regression tests for mixed delimiter types, shorter closers, longer fences containing triple-fence examples, and the approval-versus-revocation reproduction. A strict well-defined scanner is sufficient; no change to the approved review protocol is needed. [CommonMark fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks).

2. **P2 — BLOCKING: protection projection drops restriction identities and crashes on valid writable bypass arrays.**
   Location: `.github/scripts/protection_projection.py:24`, lines 31–35 and 47.
   `restrictions` is reduced to one boolean. Replacing a restricted user Alice with Mallory produces `diff(a,b) == {}` when both responses have a restrictions object; the membership drift is lost. Separately the bypass normalizer calls `.get()` on each item, but GitHub PUT requests use login/slug strings whereas responses use objects. A valid request containing `bypass_pull_request_allowances: {users: ["alice"]}` raises `AttributeError: 'str' object has no attribute 'get'`.
   Fix: normalize both request strings and response objects for users, teams and apps in restrictions and bypass allowances; preserve their actual identities in the projection, including the difference between unrestricted null and a restrictive empty object. Include any supported dismissal-restriction identities needed for full material-policy comparison. Add equivalence tests for nonempty request/response memberships and inequality tests for member substitution/removal. Current no-restrictions fixtures happen to pass, but the helper's promised material-drift protection does not. The current live settings are not claimed unsafe by this finding; it concerns the safety/recovery helper delivered by this PR. [GitHub branch-protection request and response schemas](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).

3. **P2 — BLOCKING: a release can be marked verified after its production attribution changes during smoke.**
   Location: `.github/scripts/post_deploy_verify.py:116`, especially lines 133 and 158–163.
   Both revisions are sampled before MCP smoke. After the smoke call succeeds, verify returns success without observing either revision again. A rollback or alias movement in between can leave production serving an older revision, while the summary claims the new release was verified. This was explicitly an implementation-time acceptance obligation: handle a deployment changing during polling/smoke consistently.
   Reproduction: mocked health responses report the pushed revision for both projects; the mocked MCP call changes the backing deployment state to an older revision but returns a valid service catalog. `verify()` returns True and logs the initial revisions. It never reads the changed state.
   Fix: bracket smoke with fresh observations/containment checks, or pin smoke to the attributed deployments and confirm alias state afterward. If observations change, retry within the existing deadline or report the change/unknown; do not claim verification based only on the pre-smoke sample. Add a deterministic regression for rollback/one-project movement between attribution and smoke, as well as a superseding valid revision. This does not require perfect atomic observation or a new platform API; it removes the avoidable stale-sample success. Also exercise the timeout-to-issue and issue-create-failure CLI paths, which the current nine tests do not execute.

Seven approved implementation-time obligations:

| Obligation | Review result |
| --- | --- |
| 1 — operational incident rule and permissions | Read-only PR gate/main diagnostics and main-only issue writing implemented. Agent-owned lookup/disarming model retained. Operational demonstration, failed-lookup handling and red-run acknowledgement remain T034/T036 evidence; not a new architectural blocker. |
| 2 — health consumers | Both endpoints, ASGI exact-response tests and the scheduled monitor updated coherently. Shared semantic health/list_services parsers tested. |
| 3 — declared review and current metadata | Required=yes on nonmaterial PRs, API refetch and obsolete-run checks implemented; finding 1 blocks approval. Body edit during this review exercises trigger and explicit changes-requested rejection, not all T031 scenarios. |
| 4 — protection projection/recovery | Current real before/after fixtures and unbound app normalization pass; finding 2 remains. No settings writes performed in this review. |
| 5 — helper risk coverage | .github/scripts/** is classified risky; old/new rename endpoints and deletion handling implemented. |
| 6 — deploy attribution | Compare direction and main membership, unknown-on-error, success summary and semantic smoke implemented; finding 3 remains. Vercel prerequisite inspection is author evidence, not independently repeated here. |
| 7 — push diagnostic boundary | Read-only full-range diagnostics and all-zero-before rejection implemented; no spurious PR-provenance claim from the diagnostic itself. |

Validation and limits:

- `python .github/scripts/test_check_sdlc_policy.py`: 29 passed.
- `python .github/scripts/test_check_sdlc_policy_git.py`: 12 passed.
- `python .github/scripts/test_post_deploy_verify.py`: 9 passed.
- `python .github/scripts/test_protection_projection.py`: 5 passed.
- Additional direct probes reproduced all three findings; these are not hypothetical test-coverage requests.
- At the reviewed code head, required api, web, mcp-server and secret-scan checks are green; sdlc-policy was red because no Review Record had yet been supplied. The review adds the required exact record with changes-requested, so the gate should remain red for the correct reason.
- Vercel preview checks currently report build-rate limiting for intake/MCP and several other projects. These are not among the five required branch checks; they do mean successful production deployment is not established. Do not describe the release as production-verified until the approved T034 evidence exists.
- The API/MCP full application suite results in the PR are author/CI evidence; I independently ran the four requested policy/release suites, not the entire application suite.
- T030/T031/T034–T036 remain separate transition evidence. T031 text referring to OLD settings should be reconciled with the PO-authorized early switch when those tasks are recorded; this is bookkeeping, not a demand to restore a human approval gate.

Requested next action: Claude fixes findings 1–3 and adds the regression cases, then requests review of the new full head. Keep the current review as changes-requested until re-review. Only reviewer evidence and the PR-body verdict were changed by Codex; no implementation, merge or GitHub settings change.

## T024 Re-review

Codex re-reviewed implementation head `df3db425f7ff4486a05a36b3c730b36090b7ecc9` and approves. The three prior findings are fixed and covered by regression tests: CommonMark fence matching, identity-preserving protection projection, and fresh attribution checks around smoke. The four requested suites pass: policy 34, git integration 12, post-deploy 14, and projection 9 (69 total). Remaining T031/T034–T036 transition evidence is post-review operational work and does not block this implementation approval.

## T038 Incident #84 fix review (option A: build only changed projects)

Pending independent review (Hermes or Codex) of T037. Scope: `scripts/vercel-ignore-build.sh`,
`.vercelignore`, `.github/scripts/post_deploy_verify.py`, `.github/scripts/sdlc_github.py`,
`.github/scripts/test_post_deploy_verify.py`, and the FR-013 amendment.
