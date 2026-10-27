# Implementation Plan: Provider Subscription Entitlements

**Spec**: `specs/007-provider-subscription-entitlements/spec.md`
**Branch**: `logicacodecom/feat-006-provider-subscription-entitlements`  
**Owner**: `Codex`  
**Review Mode**: `Claude review`

## Technical Approach

Add a small Stripe boundary module to the FastAPI service. The module owns Stripe client creation, hosted-session creation, webhook signature verification, event normalization, and the pure entitlement policy. It is lazy and configuration-gated so importing or starting the application never requires Stripe credentials.

Extend the existing organization billing columns additively and add a compact webhook ledger. Store methods own tenant-safe Stripe-customer mapping and transactional, idempotent event application. Session projection includes only normalized billing state.

Provider APIs expose status plus provider-admin-only Checkout and Portal creation. A centralized entitlement guard protects selected new-business mutations. The shared network eligibility snapshot treats a billing-blocked provider as ineligible only when enforcement is enabled, covering internal routing and public provider discovery without changing their response contracts.

Provider-web adds BFF routes and a Billing page. It shows trial/active/grace/blocked state, lets provider administrators open Stripe-hosted flows, and keeps navigation/history available. Server enforcement remains authoritative.

## Affected Surfaces

- **Frontend**: `apps/provider-web/src/app/frame.tsx`, new `billing/page.tsx`, new BFF billing routes, shared session types.
- **Backend/API**: `apps/intake-web/api/billing.py`, `config.py`, `main.py`, `store.py`, requirements, API tests.
- **Database/storage**: additive Alembic migration `0063_provider_subscription_entitlements.py`; no storage buckets or RLS policy relaxation.
- **Docs/operations**: feature spec/checklist; canonical architecture and execution-plan billing sections; environment variable/runbook notes.
- **CI/release**: existing API, web, secret-scan, SDLC, and OpenAPI checks. No workflow changes.

## Contracts And Invariants

- Checkout/Portal requests infer organization from the authenticated session and use server-owned URLs and Price configuration.
- `provider_admin` can mutate billing; `dispatcher` can read billing status only.
- Webhooks verify the signature over raw bytes before parsing or writing.
- Stripe Customer reference is unique per ClueXP organization when non-null.
- Event application is idempotent by Stripe event ID. Every relevant event triggers a current
  subscription read filtered by configured Price and test/live mode; delivery timestamps are audit
  data, not an ordering mechanism.
- Checkout validates the Price, refuses a non-terminal existing subscription, uses stable
  idempotency keys, and grants the trial only before the first subscription.
- The first `past_due` observation anchors grace; retries do not extend it, and recovery clears it.
- Entitlement states are `disabled`, `entitled`, `grace`, and `blocked`; Stripe's raw status is retained separately.
- Billing does not mutate organization trust/compliance state or job state.
- Enforcement applies only to new-business entry points and provider eligibility, not historical reads or existing-job wind-down.
- Public `/v1` and MCP response schemas remain backward compatible.
- No raw card data enters ClueXP and no payment fulfillment relies on the browser return page.

## Verification Plan

- **Unit/integration**: `pytest api/tests/test_billing.py api/tests/test_provider_matches.py api/tests/test_public_api_foundation.py` from `apps/intake-web`.
- **Type/build**: `npm run typecheck`; `npm run build:provider`; API import/startup test with billing disabled and no Stripe secrets.
- **Migration/data**: compile/import migration; inspect upgrade/downgrade SQL; optional Postgres test when `POSTGRES_TEST_URL` is available.
- **Tenant/RLS**: cross-organization Checkout/Portal attempts are impossible by contract; webhook unknown-customer and duplicate-event tests; existing Postgres security tests.
- **Public contract drift**: run OpenAPI export/drift test and verify no `/v1` schema changes.
- **Manual/browser**: sandbox Checkout redirect, 30-day trial, webhook update, Portal return, cancellation-at-period-end, payment failure/grace, and blocked-new-intake scenarios.
- **Security/privacy**: webhook signature failure, no secret logging, server-owned redirect URLs, role checks, and repository secret scan.

## Rollout And Rollback

- **Flags/config**: `PROVIDER_BILLING_ENABLED=false` and `PROVIDER_BILLING_ENFORCEMENT_ENABLED=false` by default. Server-only `STRIPE_BILLING_API_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_PROVIDER_PRICE_ID`, and provider base URL are required only when their feature is enabled.
- **Production approval needed**: `yes` for migration execution, secrets/webhook setup, billing activation, enforcement activation, and later tax activation.
- **Rollout**: merge inert code; authorize/apply migration; configure test/live resources separately; enable billing without enforcement; validate webhook convergence; onboard/grandfather providers; authorize and enable enforcement; handle tax as a later explicit phase.
- **Rollback path**: disable enforcement immediately, then disable billing session creation; webhook synchronization may continue safely. Revert application through a PR if needed. Do not drop billing data during emergency rollback.

## Open Questions

- Which tax jurisdictions and SaaS product tax code apply to Logicacode? This is intentionally deferred to Logicacode's tax advisor and a separate Product Owner authorization.
- What exact date/cohort ends grandfathered access before enforcement is enabled? The initial implementation uses a global off-by-default enforcement flag; cohort rollout can be specified later.
