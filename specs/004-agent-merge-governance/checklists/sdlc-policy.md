# Checklist: Agent-Owned Review And Merge Governance

**Artifact Reviewed**: `spec.md, plan.md, tasks.md`  
**Reviewer**: `Codex (independent; different family)`
**Date**: `2026-09-27`

## Review Record

Secondary-agent review required: yes
Secondary-agent review completed: yes
Author agents: Claude Code
Reviewer agent: Codex
Review scope: spec
Reviewed head: d217114f1d6362ba9d9a3275a0d21038f031183a
Review result: changes-requested
Merge owner: Claude Code

## Requirements Quality

- [x] Requirements are testable and observable (FR-001..FR-016 map to tests or acceptance checks).
- [x] Scope and non-goals are explicit.
- [x] Product Owner decisions PO-1..PO-9 are recorded; none are open.

## Governance Safety

- [x] PR-only `main` and the five required checks are preserved; `enforce_admins` is enabled with a
  defined recovery path (FR-015).
- [x] Risky-path Spec Kit artifact requirement is unchanged (FR-008).
- [x] Independent review for risky changes is preserved and strengthened (family independence,
  freshness, duplicate rejection).
- [x] Existing gate defects (deletions/renames, stale approvals, duplicate markers, body-edit reruns)
  are addressed with tests.
- [x] Merge = deploy has explicit safety rules (FR-012) and post-merge verification (FR-013).
- [x] Product Owner categories are explicit and cannot be stretched into a code-review gate (FR-014).
- [x] The shared-identity trust boundary is documented honestly (NFR-001).
- [x] The bootstrap exception is one-time and explicit (PO-6).

## Verification

- [x] Tests are listed in `plan.md` and mapped to tasks.
- [x] Settings snapshot, read-back, and rollback are defined.
- [x] Codex revision 2 re-review completed (T003): changes-requested; implementation remains blocked pending revisions and approval.

## T003 Review Ownership And Findings

Codex owns this checklist for this review by explicit user assignment. The requirements and governance checkboxes above are author assertions, not reviewer acceptance. This record reviews the three design documents, not this evidence commit or future implementation. The completed marker is retained for the current gate; R4 requests an explicit retirement/compatibility rule for the future schema.

# T003 — Independent review of spec 004

Verdict: **changes-requested**

Reviewer: Codex (different family from Claude Code). Date: 2026-09-27.
Reviewed PR #82 at `8d2269fed1a11aba5ac2ca1cc87b46da60eddfa8`, against main `912ce0460cc1cc64c779268aa4a0701b96c19d75`. Scope: specs/004-agent-merge-governance/{spec,plan,tasks}.md; supporting checklist, existing gate/workflows, live read-only protection settings, and official GitHub documentation. This is a spec review, not implementation approval. No policy implementation, merge, settings change, or production action is authorized or performed.

The design is implementable after the amendments below. PO defaults are settled: different-family review; author may merge after independent approval; bootstrap exception; PO-authorized Vercel rollback; Cidex means Codex. None of these needs reopening.

1. **P1 — FR-013 can certify the previous deployment as the new release.**
   References: spec FR-013; plan Affected Surfaces/CI; tasks T014/T031.
   A push-triggered delay followed by healthy production URLs does not establish that either Vercel project deployed the push SHA. Both old versions can stay healthy while a new build is queued, fails, or production-domain assignment is paused after rollback. The intake health endpoint currently returns only `{status: ok}`. A ten-minute poll can therefore succeed immediately without testing the release. Require per-project deployment ID, expected commit, successful deployment state, and confirmation that the production alias serves that deployment BEFORE accepting smoke results. Choose an implementable source (read-only Vercel deployment metadata with explicit credentials/permissions, or a deployment revision endpoint plus deployment-state evidence). Define handling of overlapping pushes, superseded releases, docs-only/ignored builds, one-project failure, and rollback-paused state. Record both project IDs/revisions and results; retain MCP semantic-error parsing. Specify alert destination/mechanism, Hermes acknowledgement/escalation, and when further merges/auto-merge stop. Merely failing an Actions job is not an incident response. Keep this separate from the five premerge checks.

2. **P1 — FR-010 does not ensure the newest body governs mergeability.**
   References: FR-010/FR-011, Risks/Assumptions; plan workflow and evidence-source design.
   Per-PR cancel-in-progress is useful, but the script reads an event snapshot. An old run retried after a newer edit can read old approval, and event/run ordering is not guaranteed. There is also a window between body mutation and the new check starting; auto-merge can act on an existing green result. Add current PR head/body retrieval and a check that the record being evaluated still matches current metadata before success; define obsolete-run behavior and a merge-owner revalidation immediately before merge or arming auto-merge. Re-fetch evidence before manually rerunning old events. State that metadata changes revoke/disarm queued merge intent until reevaluated and verified; acknowledge any residual race under the accepted declaration-based model instead of promising concurrency eliminates it. Move the live edited/revoked-approval/rerun verification BEFORE removing existing protection and enabling auto-merge. The separate workflow and unchanged job name are sound, provided exactly one workflow produces the required `sdlc-policy` name and existing policy-file assertions AND both unit/integration suites move into it. GitHub documents that concurrency ordering is not guaranteed: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency .

3. **P1 — FR-004 and FR-009 lack a coherent local freshness and content-source contract.**
   References: FR-004/FR-009; plan script steps 1, 4, 5; verification plan.
   Using `pull_request.head.sha` rather than the synthetic merge ref is correct. However local `--working-tree` has no required `--head`, and comparing reviewed commit to HEAD does not inspect uncommitted code changes. That permits old committed approval alongside new working-tree implementation. Define the effective target for every mode. For committed --base/--head checks, read checklist/artifact content from the specified head with git object reads, even when checkout differs. For working-tree mode, include index/worktree/untracked content in freshness; the simplest safe rule is to reject completed-review status whenever any non-evidence uncommitted change exists, while permitting a separately labelled preflight. Restrict post-review exceptions to regular Markdown evidence files in the relevant complete feature directory, or justify/test the broader all-features exception. Specify both rename endpoints, type/mode changes, symlinks, deleted review evidence, and which content inside the file may change. A path-only whitelist of every specs/*/checklists/*.md is broader than the scenario 'only the review record changed' and can exempt substantive acceptance/security-checklist edits. Use one defined policy in spec, plan and tests. Do not require a self-referential SHA for the reviewer evidence commit.

4. **P2 — FR-001's strict record still has no precise grammar or block boundary.**
   References: FR-001/FR-006; plan parse_review_record; existing checklist.
   `## Review Record` specifies a start but no end; specify termination at the next heading of level 1 or 2 (or EOF), exactly one block, handling of fenced examples/headings, and whether code fences/bullets/backticks around fields are permitted. Reject multiple blocks and duplicate recognized fields, and define required/unknown keys consistently: 'exact key set' and 'unknown keys ignored' currently disagree. Require review-required=yes when the classifier says risky, regardless of a supplied no. Define the non-risky/spec-only path: current classifier exits early for specs-only diffs, so say whether a declared required review on a spec PR must still be enforced. Define known aliases, valid other names/comma escaping or forbidden delimiters, full SHA validation, nonempty merge owner and allowed scope. The new schema drops `Secondary-agent review completed`; explicitly retire it in the new parser/templates and describe compatibility during bootstrap. Include complete valid/invalid PR and checklist examples, not only field placeholders. Existing PR #82/checklist need not already implement the future parser, but the spec must make its intended grammar reproducible.

5. **P2 — FR-009 push review skipping is reasonable, but its invariant is false during bootstrap and exceptions.**
   References: FR-009; FR-015; rollout steps 2–6.
   Do not reapply a PR reviewed-head SHA to a squash/rebase result; omitting review re-evaluation on main is a defensible deliberate replacement for the earlier fallback suggestion. But 'other paths impossible' is too strong: enforce_admins is still off when implementation merges, settings exceptions remain allowed, and admins can edit protection. Describe push checks as post-merge classification/artifact diagnostics, not proof of review. Define bootstrap and audited exception handling, PR association/audit evidence where applicable, and alerting on unaccounted pushes without claiming a post-push failure prevents deployment. Add squash, merge, rebase, multi-commit and all-zero-before fixtures. The proposed first-parent fallback for all-zero before silently abandons the full range; fail closed as an unexpected main creation, or define an explicit initial-branch policy. Artifacts and local evidence must use surviving destination paths; rename-away old paths count for risk but not as still-supplied artifacts.

6. **P1 — Transition lacks a safe, reviewable settings payload and protection rollback.**
   References: PO-6; plan Rollout And Rollback; T029–T032.
   The broad order is correct, but add a controlled no-merge window and validate workflow/body-revocation behavior under OLD settings first. T029's 'remove or record each' conflicts with acceptance requiring each bypass dependency removed: unresolved required callers must block transition, not merely be logged. Produce a canonical writable PUT request and restoration request from the snapshot; raw GET JSON is not a PUT payload (nested enabled objects, URL fields, and restrictions differ). Keep a NON-NULL required_pull_request_reviews object with count=0, code-owner=false, last-push-approval=false and no bypass allowances; null removes the PR-review protection object rather than expressing zero reviewers. Preserve all five checks and their app bindings, strict=true, conversation resolution and force/delete settings, plus unrelated existing protection. GitHub documents count=0 and check app_id support; do not leave these API shapes to trial during live transition: https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection . Snapshot/restore repository allow_auto_merge separately because it is not branch-protection JSON. Re-read for drift before PUT, validate the response, and stop on failure. Restoring old code-owner rules after CODEOWNERS deletion does not restore the old file; document the safe restoration/revert order. Finally PO-6 names only the implementation PR, while rollout first merges separate spec PR #82 under unchanged one-review rules. Explicitly apply the accepted bootstrap transition exception to both necessary PRs, using distinct author/approver accounts, without creating an ongoing human gate. Current PR author is logicacodecom, so ferrybarbarossa is a distinct bootstrap approver. Do not interpret this spec's authorization text as permission to execute settings during T003; the current user expressly forbids it.

7. **P2 — FR-012 states the right safety rules but omits the promised acceptance tests.**
   References: FR-012; plan Verification; tasks T013/T015.
   Reviewer prose about fail-closed behavior is insufficient to close prior finding 4. Require migration/config changes to supply runnable tests against the currently deployed schema and absent/new config with flags off, exercising startup and existing traffic, plus mixed previous/current intake/MCP versions where contracts change. Test that builds/startup do not migrate or send. Define the production-schema baseline source without exposing secrets, the rollout/activation prerequisites, and backward-compatible rollback horizon for expand/contract. Governance-only implementation need not invent unrelated migrations, but it must deliver the template/checklist requirements and enforceable review acceptance criteria for those future changes, mapped to tasks/tests. Do not call these coverage requirements fulfilled by policy-parser tests.

8. **P2 — The verification matrix and reconciliation work are still incomplete.**
   References: plan Verification/Affected Surfaces; T013/T015/T017/T032/T040.
   T032 claims failing/pending checks, stale branches and unresolved conversations are covered by T013, but T013's tests only cover the parser and git; they cannot prove GitHub protection behavior. Define separate fixtures/read-back assertions or a disposable protection test environment and map every acceptance criterion to evidence. Add the missing parser-boundary cases, unrelated-checklist approval, checkout-versus-head, working-tree stale review, deleted/moved evidence, old event retry, revoked body with queued auto-merge, explicit-implementation-versus-spec scope, and all merge strategies. Add an active canonical-doc/runbook search and reconciliation task (not only the enumerated policy files/spec 000) so old production/Codex gates cannot persist there; preserve historical records. T026/T017 annotations, T040 local-skill alignment, Hermes authority, multiple authors/different-family review, author-as-merge-owner and FR-014 PO categories are otherwise correctly addressed. Clarify that activating flags/config through a merge still requires the scoped authorization and that already-authorized ordinary customer workflows do not require per-transaction engineering approval.

Coverage of every prior P1/P2 finding:

| Prior finding | Result at reviewed head |
| --- | --- |
| 1 — current implementation evidence | Partial: reviewed head/scope added; R3/R4 still required. |
| 2 — deletes/renames | Substantially addressed by FR-007; surviving artifact semantics/tests clarified in R5/R8. |
| 3 — body changes/duplicates | Partial: separate edited workflow added; R2/R4 block completeness. |
| 4 — deployment safety | Partial: FR-012 correct direction; R1/R7 require release attribution and executable acceptance. |
| 5 — emergency path | Core FR-015 correct and PO-authorized rollback retained; R1/R6 complete operations/transition. |
| 6 — authority/T026/templates | Mostly addressed, including T040; active-doc sweep and coverage remain in R8. |
| 7 — independence/merge owner | Addressed by PO-7 and FR-001/002/011; grammar details remain R4. |
| 8 — authorization/exemptions | Substantially addressed by FR-008/014; R8 clarifies activation via merge and ordinary transactions. |
| 9 — CODEOWNERS/bootstrap/settings | Partial: removal appropriate, R6 required for executable transition. |
| 10 — tests/trust boundaries | Partial: integration suite planned and declaration risk explicit; R2/R3/R5/R8 close missing evidence. |

No P0 findings. Four P1 and four P2 findings. Implementation remains blocked on an approved spec revision; T003 has a completed review attempt with changes requested, not an approval. No application tests were run because this is a design review. Validation consisted of inspecting the exact git objects, current policy/CI code, health implementation, PR/protection API read-backs, and official GitHub API/concurrency documentation. The review checklist is the only repository surface owned/edited by Codex for this task; spec/plan/tasks remain Claude-owned.

## T003 Revision 2 Re-review

Codex retains exclusive ownership of this checklist for the user-assigned re-review. Earlier findings below/above are historical; this section and the top Review Record state the current result.

# T003 re-review — spec 004 revision 2

Verdict: **changes-requested**

Reviewed head: `d217114f1d6362ba9d9a3275a0d21038f031183a` (PR #82).
Reviewer: Codex, independent of Claude Code's spec authorship. Date: 2026-09-27.
Scope: spec.md, plan.md, tasks.md; supporting existing policy, CI, health consumers and read-only GitHub settings. No implementation, merge, or settings change.

Revision 2 substantially improves the design. The bounded Review Record, current-head/API reads, governing-feature A/M-only evidence exception, git-object reads for committed local targets, preflight-only working-tree mode, executable deployment compatibility requirements, canonical-doc sweep and two-PR bootstrap scope address the core of the prior review. Different-family independence, PO-authorized rollback and the Cidex correction remain settled. The following concrete integration gaps still prevent approval.

1. **P1 — Incident state does not invalidate existing green checks or queued auto-merges.**
   References: FR-010/011/013; plan Script Design step 6; T012/T014/T016.
   The gate checks open incidents only when one of its PR/push events runs. Opening/closing a deploy-incident does not trigger those events; adding/removing incident-fix is also absent from the trigger list. Thus a PR green before an incident stays green and can auto-merge during the incident, potentially much later than the acknowledged short body-edit race. Conversely an incident-fix label does not unblock a red run without an explicit rerun. Re-fetching PR.updated_at cannot detect an unrelated issue change.

   Amendment: define an executable invalidation/recheck and auto-merge-disarm mechanism for incident creation, closure/reopen, and exception-label changes; recheck incident state before gate success and immediately before manual merge/arming. Identify which trusted actor performs those actions and its minimum permissions, and define behavior on API/rate-limit/issue-creation failure. If the incident gate is instead an agent-enforced policy, say so explicitly and make Hermes/merge-owner monitoring and disarming operational rather than claiming required checks automatically freeze all PRs. Do not rely solely on an issues event from a workflow-created issue: GITHUB_TOKEN-generated issue events do not start another workflow. PR jobs should have read-only API access; limit issues:write to the trusted main diagnostic/release jobs, and specify post-deploy-verify permissions. Add tests for an already-green/auto-merge-armed PR when an incident opens, incident-fix label removal, recovery closure, and API failures. Source: [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

2. **P1 — Adding revision breaks the existing scheduled MCP health monitor.**
   References: FR-013; T015/T016; existing `.github/workflows/mcp-production-health.yml` health step.
   The scheduled monitor asserts the entire response equals `{"status":"ok"}`. Every successful response with the new revision field fails this assertion. The plan does not include updating that workflow, so the new release would deliberately break the current production alarm. This is a concrete consumer compatibility issue, not a hypothetical schema concern.

   Amendment: include the monitor in T015/T016 and change it to parse JSON and assert status semantically, with tests for revision present/null, malformed JSON and unhealthy responses. Preserve the separate list_services semantic check. Update the two MCP ASGI tests that also assert exact JSON (already broadly covered by T015, but name them in the acceptance evidence). The revision field is additive only for consumers that allow additional keys.

3. **P2 — T031's revoked-approval acceptance test contradicts FR-006.**
   References: FR-006, Acceptance Criteria, plan Rollout step 4, T031.
   FR-006 explicitly allows a non-risky PR with a well-formed changes-requested record because only grammar is checked. Therefore a conventional harmless/docs-only PR cannot demonstrate that revoking approval fails the gate. A well-formed spec review requesting changes also does not block under FR-006, even when its record says review required=yes; this needs to be deliberate and transparent.

   Amendment: use a harmless but CLASSIFIED-RISKY test PR (for example an innocuous policy comment plus the required complete artifacts and real independent review) for revoked/stale/old-event tests, and keep it unmerged during the negative steps. Alternatively require full semantic validation whenever a record declares review required=yes, including specs-only PRs. Choose one rule and align fixtures and acceptance text. Explicitly state the enforcement status of spec-only changes-requested, so a reviewer marker is not presented as an enforced block when it is advisory. This review's implementation-blocked verdict remains an engineering instruction regardless of today's path classifier.

4. **P1 — Settings response equality and the restore app_id are not executable as written.**
   References: plan Canonical Settings Payloads procedure steps 2–4, Restore PUT; T033.
   A successful protection GET/PUT response is not equal to the request payload: it contains URLs, derived contexts and nested objects such as enforce_admins.enabled. The literal equality required by the plan will report a mismatch even when the update succeeded, immediately invoking restoration. The restore request uses app_id:null, but the documented writable field is an integer; -1 is the documented value for accepting any app. Omitting it can instead auto-select the last app, which would not restore the current unbound policy.

   Amendment: define one canonical projection from API responses to policy values (strip URL fields, normalize enabled objects, sort check arrays, normalize unrestricted app bindings, compare explicit bypass/restriction fields). Compare preflight drift and post-update state using that projection; retain raw JSON for audit. Use app_id:-1 in the restore request for the currently unbound sdlc-policy and verify its normalized read-back. Set empty bypass allowances explicitly or assert they remain empty. Define restoration for partial failure, including repository auto-merge PATCH/read-back failure. Make the no-merge window remain active throughout recovery and distinguish emergency rule restoration from the later CODEOWNERS/code revert. Add request/response fixtures, including a successful API response that MUST NOT trigger rollback. The intended five bound checks and non-null zero-review object are otherwise appropriate. Source: [GitHub branch-protection REST schema](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).

5. **P1 — New enforcement helpers are outside the existing risky-path classifier.**
   References: plan Enforcement surfaces; T010/T012/T013.
   The current classifier names check-sdlc-policy.py and its existing unit-test file individually. It does not match the newly proposed `.github/scripts/sdlc_github.py` or `test_check_sdlc_policy_git.py`. A later helper-only change to PR metadata, incident queries or API failure handling would therefore skip mandatory artifacts and independent review. I evaluated the actual classifier from the reviewed git object in memory: both paths returned risky=False.

   Amendment: extend the risky policy family to every policy/incident/deploy-verification helper and its tests, preferably a deliberate directory/pattern convention rather than another incomplete filename list. Include classifier tests for helper-only modification/deletion/rename and any release decision script introduced by T016. Preserve the rule that enforcement changes cannot silently exempt themselves.

6. **P2 — Release ancestry polling still needs its runtime and skipped-build cases defined.**
   References: FR-013; plan Release and Verification Matrix; T016/T034.
   A production revision response is a reasonable lightweight attribution mechanism, and VERCEL_GIT_COMMIT_SHA is documented at runtime. But a newer descendant deployed after this workflow's checkout may not exist in its local git object database. merge-base then fails despite a valid superseding deployment. The plan also still omits docs-only/ignored builds: if either Vercel project skips the acceptance docs commit, its older healthy revision will create an incident after 20 minutes and block further work. Whether builds are skipped is not verified here.

   Amendment: specify full checkout plus bounded refreshing of origin/main as new reported revisions appear; validate SHA format and origin/main ancestry before interpreting it, and distinguish unavailable objects/API errors from a true non-descendant. State and verify the deployment prerequisite that both projects build every main commit, OR define an auditable skipped-build/unchanged-project exemption based on deployment metadata or affected build inputs. Record both observed revisions and smoke outcomes for successes too. Define cache handling and verify attribution remains valid around smoke requests. Tests must cover a descendant initially missing locally, one project skipped, one project older/null, unrelated branch SHA, and superseding merges. Confirm system-variable exposure in the actual Vercel projects during authorized execution; do not infer it solely from the variable name. Source: [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables).

7. **P2 — Nonempty commit-to-PR lookup does not prove the push was an authorized PR merge.**
   References: FR-009 push diagnostics; plan Script Design step 3.
   The plan treats any associated PR as accounting for the push, without requiring a merged PR targeting this repository's main or covering the full introduced range. A direct push associated with an open/unmerged PR, or a multi-commit push containing an extra unaccounted commit, must not become accounted solely because the tip has a PR association. The endpoint can return open as well as merged associations depending on commit state.

   Amendment: define merged/base-repository/base-ref checks and range accounting for supported squash, merge and rebase strategies; handle eventual-consistency/API failure with bounded retry and an explicit diagnostic result. Link bootstrap and PO-authorized exception evidence rather than silently treating those as ordinary merges. Add open-PR, wrong-base, partial-range and API-error fixtures. These remain post-push diagnostics, never prevention. Source: [GitHub commit-to-PR API](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit).

Prior R1–R8 disposition:

| Prior finding | Revision 2 result |
| --- | --- |
| R1 release attribution/incident handling | Revision field and failure issue address the central problem; findings 1, 2 and 6 remain. |
| R2 current metadata/merge intent | Core API re-fetch and head matching addressed; residual body race honestly retained. Incident invalidation is a new integration gap (finding 1); live proof must use finding 3's corrected fixture. |
| R3 local freshness/content source | Addressed at design level: committed target via git show, preflight-only working tree, governing-feature regular-file exception. Unrestricted checklist content is explicitly an accepted evidence-only trust boundary. |
| R4 grammar/boundaries | Addressed at design level; implement fence/boundary/unknown/duplicate tests. Deprecated-key removal remains a separate reviewed policy change, not a runtime check of whether T034 is ticked. |
| R5 push diagnostics | All-zero and diagnostic-only semantics addressed; association coverage needs finding 7. |
| R6 transition/restore | Bootstrap scope, freeze, inventory and old-settings test addressed; executable normalization/restore needs finding 4. |
| R7 deploy compatibility tests | Addressed in FR-012 and template/review requirements. No unrelated migrations are required for governance work. |
| R8 verification/reconciliation | Matrix and canonical sweep addressed; extend coverage for findings 1–7, especially helper-only risk and a classified-risky revocation fixture. |

No P0 findings. Four P1 and three P2 findings. The architecture is implementable; these are bounded corrections, not a request for a different identity model or a human review gate. T003 remains changes-requested and implementation must await approval of the amended spec.

Validation: fetched and reviewed exact d217114 git objects; inspected existing health consumers and classifier; ran in-memory classifier probes (two uncovered paths) and reproduced exact-response incompatibility; read-only protection API confirmed the response shape and current unbound sdlc-policy app; checked official platform docs. No application test suite was run because no implementation was changed. Only the reviewer-owned checklist and PR-body verdict are updated, plus the requested temporary report. Historical review text remains historical; the top Review Record is authoritative for this re-review.
