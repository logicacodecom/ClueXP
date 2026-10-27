# Provider Subscription Payments And Security Checklist

**Feature**: `specs/006-provider-subscription-entitlements`  
**Owner**: `Claude Code reviewer`  
**Status**: `pending implementation review`

## Product Boundary

- [ ] `$419 USD/month`, 30-day trial, and seven-day grace match the Product Owner decision.
- [ ] Subscription billing is Logicacode-to-provider SaaS billing, not provider-to-customer job payment or Stripe Connect.
- [ ] Processing costs are included in the listed price; no card surcharge is added.
- [ ] Tax remains disabled until registrations and a product tax code are confirmed.

## Payment Integrity

- [ ] Checkout uses Stripe Billing/Checkout `subscription` mode and the configured Price.
- [ ] Entitlement is webhook-driven, not success-page-driven.
- [ ] Customer Portal is organization-scoped and provider-admin-only.
- [ ] Webhooks verify Stripe signatures against raw request bytes.
- [ ] Event IDs are idempotent and older events cannot overwrite newer state.
- [ ] Unknown Stripe Customers cannot be assigned through untrusted metadata.
- [ ] Cancellation-at-period-end remains entitled through the paid period.

## Security And Privacy

- [ ] No Stripe secret/restricted key or webhook secret is committed, logged, returned, or exposed client-side.
- [ ] Server derives organization, Price, and redirect URLs; browser values cannot redirect or cross tenants.
- [ ] Least-privilege restricted keys are documented for deployment.
- [ ] No raw card or bank data enters ClueXP.
- [ ] Billing state exposes no unnecessary payment/customer data.

## Entitlement Safety

- [ ] Organization trust/compliance status remains independent of billing status.
- [ ] Flags default off and existing production behavior is unchanged without configuration/migration.
- [ ] New-business gates are server-side and cover provider intake plus shared network/discovery eligibility.
- [ ] Sign-in, billing management, history, and in-progress completion remain available when blocked.
- [ ] Disabled/incomplete Stripe configuration fails closed for billing mutations without blocking existing traffic.

## Migration And Operations

- [ ] Migration is additive and does not execute at build/startup.
- [ ] Existing rows remain compatible and rollback does not destroy billing history during an incident.
- [ ] Production DDL, secrets, webhook registration, billing activation, enforcement activation, and tax activation remain explicit Product Owner gates.
- [ ] Observability records event ID/type/outcome without sensitive payloads.

## Review Evidence

- [ ] Author agents: Codex.
- [ ] Reviewer agent: Claude Code (different family).
- [ ] Reviewed head is a 40-character commit SHA.
- [ ] Review result is `approve`; all material findings are resolved.
