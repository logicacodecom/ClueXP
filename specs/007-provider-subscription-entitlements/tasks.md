# Tasks: Provider Subscription Entitlements

**Spec**: `specs/007-provider-subscription-entitlements/spec.md`
**Plan**: `specs/007-provider-subscription-entitlements/plan.md`
**Owner**: `Codex lead; Claude Code independent reviewer`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means the task requires Human input or authorization before execution.
- `[R]` means independent secondary review by a different agent family is required before merge.

## Ownership

- Codex owns all implementation and spec files in this worktree until the review handoff.
- Claude Code will receive a read/review-only worktree at the committed implementation head and will not edit Codex-owned surfaces during implementation.

## Tasks

- [x] T001 [Codex] Create/clarify Spec Kit artifacts and record Product Owner billing decisions.
- [x] T002 [Codex] Add the additive billing-state/webhook-ledger migration and store contracts.
- [x] T003 [Codex] Add Stripe configuration, gateway, entitlement policy, and verified event normalization.
- [x] T004 [Codex] Add provider billing status, Checkout, Portal, and webhook API routes.
- [x] T005 [Codex] Apply centralized enforcement to new provider intake and shared network/discovery eligibility while preserving wind-down actions.
- [x] T006 [Codex] Add provider-web session fields, Billing page, BFF routes, navigation, and blocked/grace messaging.
- [x] T007 [Codex] Add unit/integration, tenant-isolation, idempotency, stale-event, role, and enforcement tests.
- [x] T008 [Codex] Update canonical architecture/execution docs and configuration/runbook guidance.
- [ ] T009 [Codex] Verify the sandbox Price through Stripe API and set `tax_behavior=exclusive` only in sandbox, subject to connected-account confirmation.
- [x] T010 [Codex] Run focused and broad API tests, typecheck, provider build, migration checks, OpenAPI drift, and secret scan.
- [ ] T011 [R] Claude Code independent review: verify implementation, specs, migration, auth/tenant boundaries, Stripe semantics, UI behavior, tests, and unresolved risks at the exact committed head.
- [ ] T012 [Codex] Resolve review findings, rerun verification, and obtain final different-family approval at the updated head.
- [ ] T013 [Codex] Open a PR with the Spec Kit links and exact machine-readable Review Record; verify no open deploy incident before any merge action.
- [ ] T014 [H] [Product Owner] Authorize exact production migration execution target and timing.
- [ ] T015 [H] [Product Owner] Authorize production Stripe secrets/webhook endpoint and `PROVIDER_BILLING_ENABLED=true` activation.
- [ ] T016 [H] [Product Owner] Authorize `PROVIDER_BILLING_ENFORCEMENT_ENABLED=true` after onboarding/grandfathering readiness.
- [ ] T017 [H] [Product Owner] Confirm tax registrations/product tax code and authorize automatic-tax activation in a separate change.

## Verification

- [x] Billing-disabled startup and existing provider behavior pass without Stripe configuration or the new migration applied.
- [x] Signed webhook, duplicate, stale-event, unknown-customer, and cross-tenant tests pass.
- [x] Checkout/Portal role and server-owned URL/Price tests pass.
- [x] New-business enforcement and in-progress wind-down tests pass.
- [x] Provider-web type/build checks pass.
- [x] API suite, Postgres security checks when available, and OpenAPI drift checks pass.
- [x] Secret scan finds no Stripe credentials or webhook secrets.
- [ ] Independent reviewer records `approve` at the current 40-character head.
