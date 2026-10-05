# Tasks: Website → Provider Intake Handoff

**Spec**: `specs/006-website-intake-handoff/spec.md`
**Plan**: `specs/006-website-intake-handoff/plan.md`

- [x] T001 Claude: inspect intake flow, attribution (`jobs.origin_channel`), slug → org resolution, provider queue, tests.
- [x] T002 Claude: generalized parser `intake-handoff.ts` + unit tests.
- [x] T003 Claude: intake page wiring (unconfirmed address, notes, situation, source attribution).
- [x] T004 Claude: API `INTAKE_SOURCES` allow-list + attribution and ownership/queue tests.
- [x] T005 [R] Codex: secondary review of the PR (different agent family than Claude). First pass on `6121ce9`:
  changes-requested (P1: address guard blocked safety escalation). Fixed in T008; re-review approved
  `4af235e`. PR #90 merged as `603361b` (2026-10-03); post-deploy-verify passed.
- [x] T008 Claude: let safety concerns bypass the address-confirmation guard without sending the unconfirmed address.
- [ ] T006 Human/Codex: browser QA of `/o/<slug>#src=cluexp_website&...` against a preview with a real channel.
- [x] T007 Website owner: confirm the Website emits `src=cluexp_website` (not the `/v1` `intake_url`). Confirmed by the Product Owner 2026-10-04.
