# ClueXP Platform Product Roadmap

**Status:** Authoritative Product Owner direction  
**Repository:** ClueXP Platform  
**Last updated:** 2026-08-24

## 1. Governing architecture

> **One authoritative fulfillment platform. One controlled public API. Many independent demand channels.**

ClueXP is the orchestration and fulfillment infrastructure for urgent local-service demand. Independent participating providers perform physical service through technicians. ClueXP itself must not be modeled as a fake service-provider organization merely to fit network demand into tenancy.

```text
www.cluexp.com ───────────┐
intake.cluexp.com ────────┤
Provider applications ────┤
Technician applications ──┤
Partner websites/systems ─┼──► api.cluexp.com/v1
ChatGPT / MCP ─────────────┤             │
Other AI adapters ─────────┤             ▼
Enterprise clients ────────┘      CLUEXP PLATFORM
                                        │
                             private_partner | network
                                        │
                                  Network Router
                                        │
                              Existing Dispatch Engine
                                        │
                            Offer → Accept → Track → Close
```

Website, human apps, partners, and AI adapters are peer clients/channels. AI, partner, and enterprise transactions must never depend on `www.cluexp.com` being available.

## 2. Domain responsibilities

### `www.cluexp.com`
Public discovery/acquisition for three first-class audiences: Customers, independent Provider companies, and Technicians. It owns canonical public brand, trust, SEO/GEO/AEO, service/location discovery, and entry CTAs. It does not own dispatch truth.

### `intake.cluexp.com`
Human transactional customer UX: request capture, authorization, matching, tracking, and related transaction screens. It should not become a competing marketing/SEO site.

### `api.cluexp.com`
Canonical public machine interface. This is a stable hostname/façade over the Platform's versioned `/v1` contract, not a second backend. The current `/v1` implementation may remain on the existing Platform deployment behind DNS/gateway/proxy routing during transition. Do not fork business logic to create the hostname.

### MCP / AI adapters
Agent-friendly adapters over canonical Platform capabilities. They translate tool schemas/conversation context and safe presentation; they do not own coverage, pricing, eligibility, routing, consent, dispatch, cancellation, or tracking rules.

### Provider applications
Business operations, private queues, workforce, dispatch controls, communications, closeout, and network participation settings.

### Technician applications
Technician identity/profile, affiliation, availability, offers, acceptance, field lifecycle, location, evidence, and completion.

## 3. Preserve and extend

Preserve organizations/memberships, global technician identity and affiliations, origin/customer-owner/fulfillment separation, offer TTL, single-offer and atomic acceptance/capacity invariants, lifecycle, arrival verification, tracking privacy, scheduling, communications, closeout, settlements, reviews, governance history, deterministic dispatch calculations, and Alembic schema authority.

Extend the canonical request/origin/authorization/attribution facts, provider-level Network Router, `/v1` Public Platform API, scoped machine clients, idempotency, durable rate limits, audit/observability, and later trust/payment facts.

Do not rebuild the existing dispatch offer/accept engine, provider operations, technician applications, or tracking lifecycle merely to support Website or AI channels.

## 4. Dispatch scope

```text
dispatch_scope = private_partner | network
```

- `private_partner` is fail-closed/default for partner-originated demand.
- Private demand may only be fulfilled through that partner's eligible resources.
- Timeout, failure, operator convenience, Website code, or adapter behavior must never silently widen private demand to network.
- `network` is used only for demand intentionally authorized for the ClueXP network.
- Private-to-network overflow is a separate future opt-in policy requiring Product Owner approval, recorded consent/configuration, migration, and tests.
- Map this public semantic contract onto existing internal fields where possible; avoid redundant schema without an ADR.

## 5. Origin, ownership, and fulfillment

Record independently: `origin_type`, authenticated `origin_client_id`, `origin_org_id` when provider-originated, `customer_owner_org_id` where applicable, nullable `fulfillment_org_id` before network selection, and `fulfillment_technician_id` through existing offer/accept behavior.

Do not create a fake ClueXP Provider organization for neutral demand.

Customer relationship rights, marketing consent, fulfillment responsibility, merchant-of-record responsibility, and support responsibility are distinct business concepts and must not be collapsed into one ownership field.

## 6. Consent and authorization

Request creation may precede dispatch authorization. Platform records authoritative evidence for terms/privacy versions, dispatch authorization, material price/scope changes, paid cancellation/no-show terms, payment authorization, and channel/AI disclosure where required. Website/AI may collect the user's explicit choice; Platform validates, stores, and enforces it.

## 7. Attribution

Capture immutable acquisition context and connect it through outcome/revenue:

```text
acquisition → request → authorization → routing → offer → acceptance → completion/cancellation → revenue
```

Support controlled source/medium/campaign/referrer/landing-page/click-ID/partner/client/channel facts and first/last touch as appropriate. This foundation precedes Google Ads closed-loop integration and savings/ROAS claims.

## 8. Public Platform API — `api.cluexp.com/v1`

Core capability family:

```text
GET  /v1/services
POST /v1/coverage-checks
POST /v1/availability-checks       # when production-ready
POST /v1/estimates                 # when production-ready
POST /v1/service-requests
PATCH /v1/service-requests/{id}    # only where contract requires
POST /v1/service-requests/{id}/dispatch-authorizations
GET  /v1/service-requests/{id}
GET  /v1/service-requests/{id}/tracking
POST /v1/service-requests/{id}/cancellations
```

Requirements: authenticated clients/least-privilege scopes, request-level ownership, idempotency for consequential writes, durable rate limits, strict versioned schemas, safe errors/trace IDs, immutable audit, privacy-minimized responses, explicit consequential authorization, no direct DB/PostgREST access, and no exposure of internal rosters/offers/ops/console routes.

## 9. `api.cluexp.com` rollout

1. Freeze the minimum existing `/v1` contract required by Website and approved clients.
2. Publish/review OpenAPI and compatibility policy.
3. Configure `api.cluexp.com` as the stable public hostname through the selected DNS/edge/gateway/proxy to the existing Platform origin.
4. Apply API-specific TLS/auth/rate-limit/WAF-abuse/observability/request-size controls as appropriate.
5. Keep approved old origin paths compatible during controlled transition.
6. Move clients to canonical hostname.
7. Never fork business logic solely because the hostname changed.

## 10. Network Router

```text
Authorized network request
  → provider eligibility
  → versioned routing decision + reasons
  → existing technician candidate/ranking
  → existing offer / accept / TTL
  → tracking / completion / outcome
```

Eligibility includes subscription/status, canonical capability, geographic coverage, required compliance, capacity, and policy compatibility. Router records inclusion/exclusion/selection facts. Fairness weights, retry policy, provider acceptance, and automatic re-offer require explicit Product Owner decisions.

## 11. Current checkpoint

The Platform has advanced beyond the original assessment: security/canonical-boundary hardening, `/v1` foundation, canonical service-request lifecycle, client ownership/scoping, network-routing proof through the existing offer engine, newer production migrations, controlled internal MCP preview, and technical/AI discovery assets.

Therefore the immediate Platform role is now **supporting and stabilizing the first real public transaction**, not broad horizontal feature expansion. Codex must verify current head, migrations, tests, deployed configuration, and endpoint behavior rather than relying on this summary alone.

## 12. Immediate coordinated release

### Platform — supporting workstream

1. Re-verify security/RLS/raw-ID/secret/error/rate-limit findings against current head/deployment.
2. Freeze minimum Website `/v1` schemas for service discovery, coverage, request creation, dispatch authorization, status, and tracking.
3. Verify scopes, ownership, idempotency, privacy-minimized responses, and private/network invariants.
4. Publish/update OpenAPI/contract documentation.
5. Prepare `api.cluexp.com` hostname/gateway/proxy configuration without duplicating services.
6. Ensure residential-lockout taxonomy and coverage behavior are authoritative/testable.
7. Provide stable unsupported/unavailable states for Website.
8. Keep canonical public SEO/service/location content primarily on `www`; Platform may retain technical/API/AI discovery assets.
9. Preserve regressions and add contract tests for the first vertical slice.

### Website — primary workstream

The separate Website rebuild plan governs a from-scratch Customer + Provider + Technician acquisition site and first real Platform-backed residential-lockout journey.

## 13. First real transaction release gate

```text
REAL CUSTOMER
  → www.cluexp.com
  → Get Help Now
  → House / Residential Lockout
  → api.cluexp.com/v1 coverage check
  → canonical service request
  → explicit dispatch authorization
  → dispatch_scope=network
  → Network Router
  → participating independent provider
  → technician
  → scoped tracking
```

This must use actual Platform state. Fake coverage, sample providers/technicians, or Website-owned routing logic do not satisfy the gate.

## 14. AI/MCP proof after Website proof

After Website vertical slice stability, prove the same canonical transaction through an approved AI/MCP client using `api.cluexp.com/v1`, the same authorization rules, Router, fulfillment, and safe tracking. Website is absent from this runtime path. Keep consequential MCP tools constrained until authorization/cancellation/payment semantics are production-approved.

## 15. Provider and technician acquisition support

Provider onboarding remains organization-centric and qualification/network-policy controlled.

Technician acquisition maps to global technician identity and affiliations. A technician joining ClueXP does **not** automatically become an independent provider or gain network-routing eligibility. Dedicated technician onboarding/application boundaries should be exposed/linked when production-ready rather than reusing provider-company registration.

## 16. Security remains non-negotiable

Any unresolved original P0 finding remains a release blocker: database/RLS/grant posture, raw public capability leakage, fail-secure secrets, opaque errors, migration/schema authority, durable external limiting, verification approval semantics, and real Postgres cross-tenant/race/security tests. Codex must verify each at current head.

## 17. Subsequent phases

- **P1 — Website + Platform vertical slice:** real residential lockout through Website → API → Router → existing dispatch → tracking.
- **P2 — Provider + Technician acquisition integration:** distinct authoritative onboarding boundaries plus attribution.
- **P3 — Partner distribution:** hosted partner flow first, then widget/SDK/API; partner requests remain private unless future explicit overflow policy.
- **P4 — Public API hardening:** credentials/scopes, quotas, key rotation, monitoring/SLOs, webhooks as needed, support, retention, deprecation.
- **P5 — Vendor-neutral AI pilot:** promote controlled MCP/agent path after canonical API/consequential authorization readiness; adapters contain no fulfillment logic.
- **P6 — Payments/pricing:** processor-backed authorization/capture/refund/webhooks, versioned quotes, price-change authorization, cancellation/no-show enforcement, reconciliation.
- **P7 — Attribution economics/ad spend:** only after immutable attribution and reliable completion/revenue; calculate request/accepted/completed CAC, ROAS, average ticket, cancellation, repeat, blended CAC.
- **P8 — Trust intelligence:** aggregate verification, reliability, ETA accuracy, price integrity, complaints/disputes, cancellations/no-shows, outcomes; no composite Trust Score until explainability/appeals/data-quality/anti-gaming policy.
- **P9 — Multi-vertical:** only after canonical taxonomy/routing/compliance supports a second vertical cleanly.

## 18. Frozen Product Owner decisions

- Platform is authoritative system of record/fulfillment engine.
- `api.cluexp.com/v1` is canonical public machine interface and a façade over Platform, not duplicate backend.
- `www.cluexp.com` is public discovery/acquisition for Customer + Provider + Technician.
- `intake.cluexp.com` is transactional UX, not canonical marketing site.
- Website, partners, enterprise clients, and AI agents are peer channels.
- AI/partner integrations do not depend on `www`.
- Public dispatch scope is `private_partner | network`; partner-private is fail-closed/default.
- Private jobs never silently leak to network; overflow is separate future opt-in.
- Neutral network demand requires no fake ClueXP provider.
- Existing offer/accept/tracking is reused beneath Network Router.
- Technician identity is distinct from provider-company identity; technician acquisition does not grant provider status.
- Public SEO/service/location authority primarily belongs on `www`; operational truth belongs to Platform.
- AI adapters/MCP wrap canonical Platform operations and own no business logic.
- Attribution precedes ad-spend integration/savings claims.
- Alembic remains schema authority.

## 19. Product decisions still required

Record ADR/product decisions before affected implementation for: network customer relationship/marketing rights; provider-selection vs provider-accept-then-technician; ranking/fairness/retry; private-to-network overflow; exact meaning of verification; technician direct-join/affiliation marketplace policy; network pricing envelope; cancellation/no-show fees; processor/merchant-of-record mechanics; support/complaints; trust visibility/appeals; network fee model.

Technical code must not silently settle business-model decisions.

## 20. Do not build yet

Unless separately approved, do not prioritize multiple AI-vendor adapters, public Trust Score, sophisticated ML ranking replacing explainable rules, ad-spend integration before attribution/revenue reliability, multi-vertical expansion, a Website-specific dispatch engine, a separate API backend merely for `api.cluexp.com`, mass public provider directories with unverified data, duplicate Website/Platform SEO catalogs, or broad payment marketing before real processor integration.

## 21. Current-stage acceptance

Success means a real customer can originate on `www`, use actual Platform coverage, create a canonical network request, explicitly authorize dispatch, route through Network Router, reach an eligible independent provider/technician, and track the job; Website duplicates no routing/coverage/pricing logic; `api.cluexp.com` is the stable machine boundary without forking logic; private demand remains isolated; Customer/Provider/Technician acquisition map to distinct Platform concepts; the same transaction can later run through MCP/AI without Website dependency; and security/audit/idempotency/privacy remain regression-tested.

## 22. Immediate Platform Codex instruction

Treat this roadmap as Product Owner authority. Inspect current head and reconcile implementation against it. Focus the next sprint on the minimum Platform work required for the real Website residential-lockout vertical slice and `api.cluexp.com` boundary. Preserve proven dispatch/operations behavior. Do not expand marketing/SEO surfaces under intake when they belong on `www`. Surface missing Product Owner decisions instead of inventing them. Keep MCP/AI direct to Platform and constrained around consequential actions. Report exact changed files, migrations, tests, deployment dependencies, and acceptance evidence before requesting the next phase.