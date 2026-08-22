# ClueXP Platform Product Roadmap

**Status:** Authoritative Product Owner direction  
**Repository:** ClueXP Platform (`C:\__CODE__\ClueXP\intake`)  
**Last updated:** 2026-08-22  
**Implementation authority:** This document authorizes planning and phased implementation only after each phase's prerequisites are satisfied. It does not authorize an unbounded rewrite.

## 1. Purpose and authority

This is the implementation source of truth for evolving the existing ClueXP Platform into a secure, partner-neutral orchestration and fulfillment platform for urgent local services. It supersedes the combined platform-and-website roadmap for Platform work. The separate cluexp.com repository is governed by `CLUEXP-WEBSITE-REBUILD-PLAN.md`.

Use the code and migrations as the authority for what exists today. Use this roadmap as the authority for the approved target state and sequencing. Preserve working behavior unless a phase explicitly changes it.

The governing product principle is:

> **One authoritative fulfillment platform. One controlled public API. Many independent demand channels.**

ClueXP is not a locksmith company and does not directly perform locksmith services. ClueXP provides request intake, orchestration, dispatch, tracking, trust infrastructure, and network intelligence. Independent participating providers perform the physical service through their technicians.

## 2. As-is assessment: what must be preserved and what must change

The repository assessment in `docs/PLATFORM-GAP-ASSESSMENT.md`, supported by `docs/SYSTEM-DESIGN.md`, `docs/SUPABASE-RLS-AUDIT.md`, and the implementation, establishes the following baseline.

### Preserve

- The three-axis job ownership model introduced by ADR-4: `origin_org_id`, `customer_owner_org_id`, and `fulfillment_org_id`.
- Nullable organization ownership on `intake_channels`, which already permits a ClueXP/platform-originated channel.
- The existing `fulfillment_policy` behavior for private and network-capable demand.
- The tested eligibility, technician ranking, offer, accept/decline, offer TTL, state transition, tracking, and completion machinery.
- Customer capability-token tracking and the principle that public customers do not access jobs by raw UUID.
- Existing events/governance-event patterns, service taxonomy, organization capabilities, reviews, arrival verification, and settlement records as foundations to extend.
- Alembic migrations as the schema authority.

### Extend

- Add a provider-level Network Router above the existing technician candidate and offer engine.
- Add a versioned Public Platform API that invokes application services and existing domain behavior.
- Add explicit request origin, external client, consent, dispatch authorization, and acquisition attribution.
- Add complete routing-decision and external-action audit trails.
- Add scoped authentication, distributed rate limits, consistent idempotency, and privacy-minimized responses at the public boundary.
- Add real Postgres-backed integration/security tests before materially changing network dispatch.

### Refactor only where required

- Decompose the large FastAPI entrypoint into domain routers/application services before adding a substantial public surface. Internal route reorganization must preserve behavior.
- Replace in-process-only rate limiting at the external boundary with a distributed mechanism.
- Close the current RLS and tenant-isolation gaps before exposing any new external client.

### Do not rebuild

- Do not replace the existing offer/accept engine, tracking lifecycle, technician applications, provider onboarding, or settlement ledger merely to fit new terminology.
- Do not create a fake "ClueXP provider organization" to own network requests.
- Do not create a second dispatch engine for the website, partners, or AI agents.
- Do not expose the existing internal FastAPI routes as the public contract.

## 3. Approved target architecture

```text
www.cluexp.com ───────────┐
app.cluexp.com ───────────┤
Partner Websites ─────────┤
ChatGPT Adapter ──────────┤
Claude Adapter ───────────┼──► api.cluexp.com/v1
Gemini Adapter ───────────┤             │
Apple/Siri Adapter ───────┤             ▼
Enterprise Partners ──────┘      CLUEXP PLATFORM
                                        │
                             private_partner | network
                                        │
                                  Network Router
                                        │
                              Existing Dispatch Engine
                                        │
                            Offer → Accept → Track → Close
```

The website, human applications, partner systems, and AI adapters are peer clients. AI integrations must not depend on `www.cluexp.com` being deployed or available. Channel adapters translate their channel's protocol and interaction model; they do not own coverage, pricing, eligibility, consent, dispatch, or tracking business logic.

Conceptual domains may be separated as follows even if deployment details evolve:

- `www.cluexp.com`: discovery, acquisition, public content, and entry journeys.
- `app.cluexp.com`: authenticated and human transactional applications.
- `api.cluexp.com`: controlled machine-accessible Platform interface.

## 4. Canonical service request model

Every demand channel must create or operate on the same canonical service request. Names may be adapted to the existing schema, but the semantics below are mandatory.

### Identity and lifecycle

- Platform-generated request ID and safe external reference.
- Service category and subtype from the canonical taxonomy.
- Urgency, structured location, contact method, notes, and approved media references.
- Platform-owned lifecycle state, timestamps, cancellation state, and fulfillment outcome.
- Idempotency key and external client request ID where applicable.

### Dispatch scope

The public/product contract is:

```text
dispatch_scope = private_partner | network
```

- `private_partner` is the default for partner-originated demand. Only that partner's eligible resources may fulfill it.
- `network` is used only for demand intentionally authorized for the ClueXP network.
- A private partner request must never become network-visible or network-routable through timeout, failure, operator convenience, or adapter behavior.
- Private-to-network overflow is a separate, future, explicit opt-in policy. It must not be inferred from `network` and must not be enabled by default.

The current internal `fulfillment_policy` values are a working implementation foundation. The public two-value contract should map to existing behavior rather than introduce a duplicate column without an ADR:

- `private_partner` maps to the existing private policy.
- `network` maps to the existing network-open behavior.
- Existing network-overflow semantics remain disabled for private demand unless a future Product Owner decision, partner consent model, migration, and tests explicitly authorize them.

### Origin and ownership

Record origin independently from ownership and fulfillment:

- `origin_type`: first-party website, human app, partner website/widget/API, AI/agent adapter, enterprise partner, or internal operations.
- `origin_client_id`: the authenticated public-API client/application.
- `origin_org_id`: the originating provider organization when one exists; nullable for neutral ClueXP/network demand.
- `customer_owner_org_id`: the organization that owns the customer relationship, when applicable.
- `fulfillment_org_id`: null before network selection and set only when fulfillment is assigned/accepted.
- `fulfillment_technician_id`: set through the existing offer/accept lifecycle.

No provider organization should be fabricated to make nullable network ownership fit a tenant model. Network demand is Platform-governed before provider selection, while provider-private demand remains tenant-owned.

### Consent and authorization

Consent is a first-class, auditable boundary, not a conversational assumption.

- Record terms/privacy consent and the policy versions shown.
- Record location, contact, media, and third-party/AI disclosure consent separately where legally or operationally required.
- Request creation may precede dispatch authorization.
- `authorize_dispatch` must record who or what obtained authorization, when, through which channel, what price/estimate and material terms were presented, and the authorization evidence/reference.
- Consequential changes, including material price changes or scope expansion, require reauthorization according to an approved policy.
- An AI adapter may convey and capture a user's explicit choice, but the Platform validates and stores the authorization.

### Attribution

Attribution must be captured at request creation and preserved through fulfillment:

- channel, source, medium, campaign, content, term, referrer, landing page, click identifiers, partner/client ID, and first-touch/last-touch timestamps as applicable;
- privacy-safe raw payload retention only when justified;
- immutable original attribution plus auditable corrections/enrichment;
- links from acquisition → request → authorization → dispatch → acceptance → completion → revenue.

This data foundation precedes Google Ads or other ad-platform integrations.

## 5. Public Platform API (`api.cluexp.com/v1`)

`/v1` is a controlled façade over Platform application services. Internal `/ops/*`, `/provider/*`, technician, admin, raw tracking-token, or current monolithic routes are not the public API.

The minimum proposed capability set is:

```text
GET  /v1/services
POST /v1/coverage-checks
POST /v1/availability-checks
POST /v1/estimates
POST /v1/service-requests
PATCH /v1/service-requests/{request_id}
POST /v1/service-requests/{request_id}/dispatch-authorizations
GET  /v1/service-requests/{request_id}
GET  /v1/service-requests/{request_id}/tracking
POST /v1/service-requests/{request_id}/cancellations
```

Exact resource shapes require an OpenAPI/ADR review, but every public operation must provide:

- client authentication and least-privilege scopes;
- tenant and request-level authorization;
- explicit channel/client identity;
- strict request/response schemas and privacy-minimized fields;
- idempotency for all create/consequential operations;
- distributed rate limiting and abuse controls;
- versioning and backward-compatibility policy;
- structured errors safe for external callers;
- trace/correlation IDs and immutable audit events;
- consent and dispatch-authorization enforcement;
- no direct database or Supabase PostgREST access by external clients.

The first-party website may use a same-origin backend-for-frontend for secrets, cookies, anti-abuse controls, or response shaping, but the Platform remains authoritative.

## 6. Network Router above existing dispatch

The Network Router is additive and sits above the current technician-level selection and offer lifecycle.

```text
Authorized network request
        ↓
Provider eligibility
  subscription/status
  service capability
  geographic coverage
  policy/compliance
  availability constraints
        ↓
Routing decision + audit
        ↓
Existing technician ranking
        ↓
Existing offer / accept / TTL
        ↓
Tracking / completion / outcome
```

The router must explain which providers were considered, excluded, and selected, using versioned rules. It must preserve private-partner isolation, prevent cross-tenant visibility, and set fulfillment ownership only through the approved assignment/acceptance lifecycle. Provider ranking, fairness, retries, and automatic redispatch require explicit policies and must not be silently invented.

## 7. Sprint 0 — security and test foundation (release blocker)

No Public Platform API, new network-demand surface, partner widget, or AI adapter may ship until Sprint 0 acceptance is met.

### Required work

1. Enable RLS/default-deny protection on every exposed application table, starting with the zero-policy stopgap described in `docs/SUPABASE-RLS-AUDIT.md`.
2. Verify anon/authenticated PostgREST roles cannot read or mutate protected tables; document any intentional service-role bypass.
3. Make production authentication secrets fail closed; remove reliance on a known development fallback and verify deployed secret configuration.
4. Add systematic organization-isolation, private-vs-network visibility, technician authorization, and tracking-token tests.
5. Add a real Postgres-backed integration tier so production SQL and migrations are executed in CI.
6. Add a schema/RLS regression guard for every new table.
7. Review logs, signed media URLs, customer PII, technician locations, and support/admin access against `docs/PRIVACY-SECURITY-REVIEW.md`.

### Sprint 0 acceptance criteria

- A fresh database at head migration has no unintentionally unprotected application table.
- Anonymous and ordinary authenticated PostgREST probes are denied unless an explicit, tested policy permits them.
- Cross-organization reads and mutations fail across API and database tests.
- A `private_partner` request is invisible and ineligible outside its owner organization.
- Technician and customer tracking access is self-/token-scoped and non-enumerable.
- Production refuses to start with placeholder signing or dispatch secrets.
- CI executes representative `PostgresStore`, migration, RLS, dispatch, and isolation paths.

## 8. Phased implementation

### Phase 1 — Canonical foundation and contract

Freeze ADRs for the ownership model, public `dispatch_scope`, origin vocabulary, consent/authorization, attribution, API versioning, and error/idempotency rules. Add attribution capture and any missing canonical request fields. Extract application services and domain routers without changing behavior. Publish a reviewed `/v1` OpenAPI contract and threat model.

**Exit:** the same canonical request can be represented for partner-private, ClueXP-network, website, and agent-originated demand; contract tests exist; no duplicate business logic is introduced.

### Phase 2 — Network Demand MVP

Implement provider eligibility and audited network routing above the existing dispatch engine. Prove one vertical slice for a residential house lockout in one supported market.

```text
Website or approved test client
  → coverage check
  → service request
  → explicit dispatch authorization
  → dispatch_scope=network
  → Network Router
  → existing offer/accept
  → tracking
  → completion
```

**Exit:** only eligible providers enter ranking; decisions are explainable; existing offer/accept/tracking tests remain green; private jobs cannot leak into the flow.

### Phase 3 — Website and partner distribution

Release the website's real consumer entry journey against `/v1`. Define a partner BFF/widget/API pattern for `private_partner` requests with authenticated organization binding, attribution, branding boundaries, and no network overflow.

**Exit:** website and one partner integration create equivalent canonical requests with different authorized scopes and correct ownership.

### Phase 4 — Public API production hardening

Operationalize client credentials/scopes, quotas, distributed rate limits, idempotency storage, key rotation, webhook signing if needed, audit/support tools, SLOs, monitoring, incident procedures, data retention, and version/deprecation policy.

**Exit:** the API meets the security, reliability, observability, and support bar for an external client.

### Phase 5 — Vendor-neutral agent pilot

Build one adapter only after `/v1` is production-ready. The adapter maps conversational tools to canonical operations and requires explicit confirmation for dispatch/cancellation/payment consequences. It contains no coverage, pricing, routing, or fulfillment logic.

**Exit:** an approved agent test client completes the same house-lockout workflow used by the website, including consent, authorization, attribution, audit, safe status, and cancellation behavior.

### Phase 6 — Payments and pricing controls

Choose a processor and PCI-minimizing approach; implement authorization/capture/refund, price-change audit and reauthorization, cancellation/no-show enforcement, reconciliation, and failure handling without conflating customer payment capture with the existing settlement ledger.

### Phase 7 — Attribution and commercial analytics

Connect ad/partner cost data only after end-to-end attribution is reliable. Produce cost per request/accepted/completed job, CAC, ROAS, average ticket, cancellation, repeat rate, and blended CAC with documented definitions.

### Phase 8 — Trust and dispatch intelligence

Aggregate verified operational signals already captured. Add missing dispute/complaint and predicted-vs-actual ETA data. Do not publish a composite Trust Score until data quality, explainability, appeals, and anti-gaming policies are approved.

### Phase 9 — Multi-vertical expansion

Expand beyond locksmith only after the canonical taxonomy, policy, routing, provider qualification, pricing, and compliance model can support a second vertical without locksmith-specific branching throughout the core.

## 9. Frozen decisions

- ClueXP Platform is the system of record for requests, consent, dispatch, fulfillment, tracking, and outcomes.
- `/v1` is the controlled public interface; internal routes are not public contracts.
- Website, partner systems, AI agents, and enterprise systems are peer Platform clients.
- `dispatch_scope` has the public meanings `private_partner | network`; partner-private is the safe default.
- Partner-originated jobs never leak into the network.
- Overflow is a separate future opt-in policy.
- Network requests do not require a fake ClueXP provider organization.
- Network routing sits above and reuses existing offer/accept/tracking machinery.
- Adapters contain protocol and presentation translation, not Platform business logic.
- Vendor-specific AI work follows, rather than precedes, a secure canonical `/v1`.
- Alembic remains schema authority.

## 10. Product decisions still required

- Manual re-queue versus automatic re-offer after offer expiry, including fairness and starvation rules.
- Provider eligibility/ranking, network economics, and audit visibility.
- The formal boundary between `ops-web` and `console-web` for network operations.
- Payment processor, merchant-of-record responsibilities, PCI approach, refunds, cancellations, and no-show policy.
- Private-to-network overflow terms, consent, timing, and partner controls before any implementation.
- Customer-relationship and support responsibilities for ClueXP/network-originated demand after assignment.
- Trust metric visibility, dispute/appeal rights, and data retention.

Unresolved decisions must be captured in ADRs/product decision records before implementation. Technical code must not bury a business-model decision.

## 11. Platform-wide acceptance criteria

The roadmap is successful when:

- one canonical request and lifecycle serves website, partner, human-app, and agent channels;
- ClueXP can accept neutral demand without pre-assigning a provider organization;
- `private_partner` isolation is enforced in schema, queries, routing, API responses, and tests;
- network routing selects only eligible providers and records an explainable decision;
- dispatch requires explicit recorded authorization;
- origin and attribution survive through completion and revenue reporting;
- external clients receive only scoped, privacy-minimized data;
- website or adapter outages do not break other clients or the Platform core;
- the existing offer/accept/tracking machinery remains protected by regression tests;
- security, migration, and real-database CI gates block regressions.

## 12. Do not build yet

Until their prerequisites and Product Owner decisions are met, do not build:

- multiple AI-vendor adapters, MCP as the core architecture, or vendor-specific business logic;
- an AI path that bypasses explicit dispatch/payment confirmation;
- public access to internal FastAPI, ops, provider, admin, or raw database interfaces;
- private-queue overflow to the network;
- sophisticated ML ranking, dynamic pricing, or automated fairness policy;
- a public Trust Score;
- Google Ads or other ad-platform integrations before canonical attribution is reliable;
- multi-vertical expansion;
- elaborate provider economics, bidding, or a lead marketplace;
- a replacement dispatch engine;
- a full payment architecture before merchant/processor/cancellation decisions are approved.

The next product milestone is intentionally narrow:

> **Prove that ClueXP can accept urgent demand independently of where it originates, safely route authorized network demand, and fulfill it through the existing provider/technician infrastructure without compromising partner-private demand.**
