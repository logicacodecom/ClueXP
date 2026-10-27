# Feature Specification: Provider Subscription Entitlements

**Feature Branch**: `logicacodecom/feat-006-provider-subscription-entitlements`  
**Spec Directory**: `specs/006-provider-subscription-entitlements`  
**Created**: `2026-10-26`  
**Owner**: `Codex`  
**Status**: `clarified`

## Summary

ClueXP provider organizations can start and manage a paid ClueXP subscription through Stripe-hosted Checkout and Customer Portal. Subscription state is synchronized by verified Stripe webhooks and is kept separate from organization trust/compliance status. When enforcement is later activated, an organization without an active, trialing, or grace-period entitlement cannot receive new ClueXP business or create new intake value, but its users can sign in, manage billing, inspect history, and safely finish work already in progress.

The approved launch offer is **ClueXP Provider Access at $419 USD per month**, with a **30-day trial** and a **7-day failed-payment grace period**. The price includes anticipated processor costs. Applicable tax is intended to be exclusive, but tax calculation and collection remain disabled until Logicacode confirms its registrations and separately authorizes production tax activation.

## Scope

### In Scope

- Stripe Billing subscription Checkout for provider administrators.
- Stripe Customer Portal sessions for payment-method, invoice, and cancellation management.
- Verified, idempotent Stripe webhook processing for Checkout, subscription, and invoice lifecycle events.
- Organization-scoped billing state and a centralized entitlement decision.
- Provider-console billing status, hosted-billing actions, and delinquency guidance.
- Server-side enforcement for new provider intake and network/discovery eligibility when the enforcement flag is enabled.
- Continued access to authentication, billing management, historical records, and in-progress job completion while blocked.
- Additive database migration and test/sandbox configuration documentation.

### Out Of Scope

- Production migration execution, production environment variables, live-mode Stripe activation, or real charges.
- Stripe Tax registrations, tax-code selection, automatic tax, filing, or legal/tax advice.
- Stripe Connect and provider-owned customer job payments.
- Usage-based, seat-based, annual, coupon, promotion, or multi-plan billing.
- Automatic refunds, disputes, credits, or manual subscription administration from ClueXP.
- Passing a separate card surcharge to the subscriber.

## Users And Scenarios

### Primary Scenario

1. Given an active provider organization whose administrator has no paid entitlement
2. When the administrator starts Checkout from the Billing page
3. Then ClueXP creates or reuses an organization-owned Stripe Customer and redirects to Stripe-hosted subscription Checkout for the configured $419 monthly Price with a 30-day trial
4. And ClueXP grants entitlement only after a verified Stripe webhook records `trialing` or `active` state.

### Billing Management Scenario

1. Given a provider organization with a Stripe Customer
2. When a provider administrator opens the Customer Portal
3. Then Stripe hosts payment-method updates, invoice history/downloads, and end-of-period cancellation using an organization-scoped return URL.

### Delinquency Scenario

1. Given a subscription payment failure
2. When Stripe sends a verified lifecycle event
3. Then ClueXP records `past_due` and a seven-day grace deadline
4. And, after the grace deadline and only when enforcement is enabled, new-business actions are blocked while billing, history, and in-progress completion remain available.

### Edge And Failure Scenarios

- A missing or invalid webhook signature receives a non-success response and changes no state.
- Replayed or out-of-order events are idempotent and cannot roll state backward based on an older Stripe event timestamp.
- A Stripe event for an unknown Customer is recorded safely without cross-tenant assignment.
- A dispatcher cannot create Checkout or Portal sessions; those actions require `provider_admin`.
- A browser-supplied organization ID, Price ID, success URL, or return URL is ignored; all are server-derived.
- If billing is disabled or incompletely configured, billing mutations fail closed without affecting existing provider access.
- If enforcement is disabled, existing provider workflows behave exactly as before regardless of subscription state.
- Cancel-at-period-end remains entitled while Stripe reports `active` through the paid period.

## Requirements

### Functional Requirements

- **FR-001**: The server MUST create subscription-mode Stripe Checkout Sessions using the configured Price, a 30-day trial, the authenticated organization, and server-owned success/cancel URLs.
- **FR-002**: Checkout fulfillment and entitlement changes MUST be driven by verified webhooks, never by a success-page redirect.
- **FR-003**: The server MUST create Stripe Customer Portal Sessions only for the authenticated provider organization and only for a `provider_admin`.
- **FR-004**: Stripe secret/restricted keys and webhook secrets MUST be loaded only from server-side environment configuration and MUST never be returned, logged, or committed.
- **FR-005**: The system MUST persist Stripe Customer and Subscription references, normalized subscription status, Stripe event timestamp, current-period end, grace deadline, and cancel-at-period-end state per organization.
- **FR-006**: Webhook processing MUST verify signatures against the raw request body and MUST be idempotent by Stripe event ID.
- **FR-007**: Older Stripe events MUST NOT overwrite state produced by a newer event for the same organization.
- **FR-008**: Entitled states MUST include `active`, `trialing`, and `past_due` before the seven-day grace deadline.
- **FR-009**: `organization.status` MUST remain the trust/compliance lifecycle and MUST NOT be changed because of billing state.
- **FR-010**: With enforcement disabled, subscription state MUST NOT block any existing provider, dispatch, intake, public API, or MCP workflow.
- **FR-011**: With enforcement enabled, blocked organizations MUST be excluded from new provider discovery/network eligibility and MUST be refused when creating provider-owned intake or accepting new network business.
- **FR-012**: Billing management, authentication, historical reads, and actions needed to finish an already-started job MUST remain available to blocked organizations.
- **FR-013**: The provider session and Billing page MUST expose a safe normalized entitlement summary without exposing Stripe secrets or full payment details.
- **FR-014**: The implementation MUST use Stripe-hosted Checkout and Customer Portal; ClueXP MUST NOT collect raw payment-card data.
- **FR-015**: The configured Price MUST be verified as `$419.00 USD`, monthly, active, and tax behavior `exclusive` before any production tax or billing activation.
- **FR-016**: Automatic tax MUST remain disabled until Logicacode confirms active registrations and separately authorizes production tax activation.
- **FR-017**: Stripe Connect and customer job-payment flows MUST remain behaviorally separate from this Logicacode-to-provider SaaS subscription.

### Non-Functional Requirements

- **NFR-001**: Webhook acknowledgment and state updates MUST be observable through structured event IDs/types without logging payloads containing billing or customer data.
- **NFR-002**: Tenant ownership MUST be resolved through the stored Stripe Customer relationship; untrusted metadata may only be a guarded bootstrap fallback.
- **NFR-003**: Checkout and Portal creation MUST use Stripe's current SDK client pattern and a least-privilege restricted key where supported.
- **NFR-004**: Billing and enforcement flags MUST default to false in every environment.
- **NFR-005**: The merged application MUST start and serve existing traffic before the migration or Stripe environment variables are applied.

## Data, API, And Trust Boundaries

- **Data touched**: `organizations` billing columns; a Stripe webhook event ledger; provider session projection.
- **API contracts**: internal `/provider/billing`, `/provider/billing/checkout-session`, `/provider/billing/portal-session`, and `/webhooks/stripe`; provider-web BFF routes. No public `/v1` shape changes are required.
- **Trust-state/privacy rules**: Billing never promotes organization trust status and never reveals card details. Customer-visible technician/tracking rules are unchanged.
- **Tenant isolation**: Organization identity comes from the authenticated membership/session or the unique stored Stripe Customer reference, never from a browser-provided organization ID.
- **Dispatch state**: No job status transition is changed. Entitlement gates apply before new-business entry; completion transitions for existing jobs remain available.
- **Payments/closeout**: This feature charges providers for ClueXP SaaS access only. Existing job closeout/settlement records remain advisory and separate.
- **External side effects**: Sandbox Stripe Customer, Checkout Session, Portal Session, and subscription events only during verification. No live transaction is authorized.

## ClueXP-Specific Checks

- **Trust-state rule**: `organization.status` remains independent; `subscription_status` cannot make an unapproved organization active.
- **Provider-managed dispatch rule**: ClueXP does not become dispatcher or merchant of record for provider-customer jobs.
- **Public `/v1`/MCP rule**: Response contracts remain unchanged; when enforcement is enabled, the shared eligibility snapshot excludes non-entitled providers before public/MCP consumers receive matches.
- **Migration/RLS rule**: Additive migration `0063_provider_subscription_entitlements`; no RLS relaxation; webhook writes run through the backend service role/store boundary.
- **Generated artifacts**: OpenAPI drift is checked. Type changes are limited to internal provider session/billing contracts.

## Acceptance Criteria

- [ ] A provider administrator can create a sandbox Checkout Session for the configured monthly Price and 30-day trial.
- [ ] A provider administrator with a Stripe Customer can create a sandbox Customer Portal Session; a dispatcher cannot.
- [ ] Valid signed webhook fixtures update only the mapped organization, and invalid/replayed/stale events do not corrupt state.
- [ ] Active, trialing, grace, blocked, and disabled-enforcement decisions have deterministic tests.
- [ ] Enforcement tests prove new intake/network eligibility is blocked while history and in-progress completion remain reachable.
- [ ] Provider-web builds and presents billing state/actions without exposing secrets.
- [ ] API tests, provider build, migration checks, secret scan, and OpenAPI drift checks pass.
- [ ] A different-family secondary agent approves the implementation at the reviewed commit.

## Risks, Assumptions, And Human Decisions

- **Risks**: Incorrect webhook ordering could revoke valid access; broad route gating could strand active jobs; incorrect tax setup could silently collect no tax; missing migration/config could cause production failures if not guarded.
- **Assumptions**: Stripe Price `price_1UUxmtQiiIMhyzQxb3AieWB8` belongs to the ClueXP Development sandbox and represents $419 USD monthly. Its tax behavior is currently unverified/unspecified and will be set to `exclusive` through the sandbox API before tax testing.
- **Human decisions completed**: $419 USD monthly; processing costs included in price; tax exclusive; 30-day trial; 7-day grace; subscription required for new business; blocked providers retain billing/history/in-progress completion access.
- **Human decisions/authorizations still needed**: production migration execution; production Stripe restricted key and webhook secret; live Price verification/creation; live webhook registration; production billing activation; enforcement activation; tax registrations, product tax code, and automatic-tax activation.
