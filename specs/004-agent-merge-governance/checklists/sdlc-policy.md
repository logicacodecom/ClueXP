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
Reviewed head: 8d2269fed1a11aba5ac2ca1cc87b46da60eddfa8
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
- [x] Codex review attempt completed (T003): changes-requested; implementation remains blocked pending revisions and approval.

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
