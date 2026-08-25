# ClueXP Product & Public Website Build Plan

> **Status note, 2026-08-22:** This is the older combined platform-and-website planning
> document. For platform implementation, `../CLUEXP-PLATFORM-PRODUCT-ROADMAP.md` is the newer
> Product Owner direction. This file is retained as source context and for website-related scope.

**Status:** Working implementation roadmap\
**Scope:** ClueXP platform, partner experience, network demand,
Agent/Partner Gateway, attribution, and cluexp.com\
**Initial vertical:** Locksmith\
**Architecture principle:** ClueXP owns orchestration, trust, dispatch
intelligence, and network infrastructure. Partners own their businesses,
brands, technicians, and partner-originated customer relationships.

------------------------------------------------------------------------

## 1. Product North Star

ClueXP is not a direct service provider and should not be implemented as
one.

ClueXP is the **trusted orchestration and dispatch infrastructure for
urgent local services**. It connects demand from partner websites,
ClueXP, AI agents, and future third-party channels to eligible
subscribed service providers and their technicians.

The platform must support three demand paths without mixing their
ownership rules:

1.  **Partner-originated demand**\
    Customer → Partner channel → ClueXP → Partner private queue →
    Partner technician.

2.  **ClueXP-originated demand**\
    Customer → ClueXP → Network dispatch → Eligible subscribed provider
    → Technician.

3.  **AI/third-party-originated demand**\
    AI/partner channel → ClueXP Agent Gateway → Network dispatch →
    Eligible subscribed provider → Technician.

**Non-negotiable:** A partner-originated request must not be rerouted to
a competitor unless the originating partner explicitly enables a future
overflow/network option.

------------------------------------------------------------------------

## 2. Build Principles

-   Keep dispatch business logic centralized in ClueXP.
-   Do not build separate dispatch implementations for ChatGPT, Claude,
    Siri, partner websites, or other channels.
-   Expose a stable canonical service API and add channel-specific
    adapters around it.
-   Keep tenant isolation explicit and enforce it in database policies
    and application authorization.
-   Preserve the existing no-bidding model.
-   Separate external reputation from first-party ClueXP operational
    trust.
-   Require explicit customer authorization before consequential actions
    such as dispatch or payment.
-   Store acquisition source and attribution data from the moment a
    request is created.
-   Make every network decision auditable.
-   Treat locksmith as the first service taxonomy, not as a hard-coded
    platform assumption.

------------------------------------------------------------------------

# PART I --- CORE PRODUCT

## 3. Canonical Service Request Model

Create/refine one canonical request/job model used by every acquisition
channel.

Minimum fields:

-   request_id
-   organization/tenant context
-   channel
-   acquisition_source
-   acquisition_campaign identifiers
-   partner_origin_id, when applicable
-   customer identity/contact
-   authorized service location
-   service category
-   service subtype
-   urgency
-   structured intake answers
-   free-text notes
-   uploaded photos/files
-   pricing/estimate data
-   consent records
-   dispatch mode: `private_partner` or `network`
-   lifecycle status
-   assigned provider
-   assigned technician
-   timestamps for each lifecycle event
-   tracking token
-   payment state
-   completion outcome
-   cancellation/no-show reason and fees where applicable

Acquisition and originating-channel fields should be immutable or
maintained through an auditable attribution history.

------------------------------------------------------------------------

## 4. Service Taxonomy & Intent Layer

Implement a service taxonomy independent of UI wording.

Initial locksmith examples:

-   residential_lockout
-   automotive_lockout
-   commercial_lockout
-   rekey
-   lock_repair
-   lock_replacement
-   car_key_replacement
-   key_duplication
-   ignition/key-related services as supported

Create a normalization layer that maps website selections, partner
inputs, free text, AI-agent tool calls, and future channels into the
same canonical service types.

The system should support deterministic intake first and selectively use
AI where it improves ambiguity resolution without making dispatch
decisions opaque.

------------------------------------------------------------------------

## 5. Partner Private Dispatch

Maintain and strengthen the private partner queue.

Requirements:

-   Partner website requests resolve to the originating organization.
-   Only eligible technicians belonging to/authorized for that
    organization receive offers.
-   Existing offer → accept → TTL → redispatch behavior remains
    centralized.
-   Service-area, skill, availability, compliance, and status
    eligibility are evaluated before offer creation.
-   Partner-specific pricing and policies can apply.
-   Customer sees partner branding where the request originated with
    that partner.
-   ClueXP records operational metrics regardless of branding.

Add an explicit `dispatch_scope` contract so private and network jobs
cannot be accidentally mixed.

------------------------------------------------------------------------

## 6. ClueXP Network Dispatch

Build a separate network-routing layer above the existing technician
dispatch engine.

Network eligibility should evaluate:

-   subscribed/eligible provider
-   service capability
-   geographic coverage
-   currently available technicians
-   licensing/credential requirements
-   network standing
-   pricing policy compliance
-   recent reliability
-   capacity
-   predicted ETA
-   partner/network rules

The first production ranking model should be transparent and rules/score
based. Avoid premature black-box ML.

Network routing must produce an audit record explaining why a
provider/technician was eligible, excluded, ranked, offered, accepted,
expired, or reassigned.

------------------------------------------------------------------------

## 7. ClueXP Trust Layer

Create first-party operational trust independently from public review
platforms.

### Initial signals

-   identity/business verification
-   applicable license/credential status
-   service eligibility
-   completed ClueXP jobs
-   acceptance reliability
-   cancellation rate
-   no-show rate
-   predicted vs. actual arrival
-   completion rate
-   customer satisfaction from verified transactions
-   complaint/dispute rate
-   quoted vs. final charge
-   price integrity
-   repeat-customer outcomes

### Implementation approach

**Phase A:** Store raw trust metrics and show them internally.\
**Phase B:** Use selected metrics in network eligibility/routing.\
**Phase C:** Develop a documented ClueXP Trust Score after sufficient
real-world data exists.

Do not expose a synthetic score publicly until its methodology and data
volume are defensible.

------------------------------------------------------------------------

## 8. ETA & Fulfillment Intelligence

Capture:

-   technician location when permitted
-   dispatch timestamp
-   offer timestamp
-   acceptance timestamp
-   predicted ETA at acceptance
-   technician departure/in-route event
-   arrival timestamp
-   service-start timestamp
-   completion timestamp

Use this data to calculate:

-   acceptance time
-   dispatch-to-arrival
-   ETA error
-   service duration
-   provider/technician reliability by geography/service/time

This becomes part of the future network moat.

------------------------------------------------------------------------

## 9. Pricing & Price Integrity

Separate:

-   service-call fee
-   estimated range
-   fixed-price service where applicable
-   authorized additions
-   final invoice
-   cancellation/no-show fee
-   refund/adjustment

Record every price transition.

For jobs with estimates, require explicit customer approval when the
final scope materially changes before work proceeds.

Create price-integrity metrics comparing initial representation with
final charge, while accounting for legitimate scope changes.

------------------------------------------------------------------------

## 10. Payment & Cancellation Controls

Complete the payment lifecycle:

-   payment method capture/tokenization through payment provider
-   preauthorization where business rules require it
-   final charge
-   receipts
-   partner settlement/accounting model
-   refunds/adjustments
-   cancellation fees
-   customer no-show/unavailable-location rules
-   technician/provider cancellation reasons

Policies must be configurable and disclosed before authorization.

------------------------------------------------------------------------

# PART II --- AGENT & PARTNER GATEWAY

## 11. Canonical ClueXP API

Build an external-facing gateway over the core platform rather than
exposing internal dispatch implementation directly.

Initial capability contracts:

-   `list_services`
-   `check_coverage`
-   `check_availability`
-   `get_estimate`
-   `create_service_request`
-   `update_service_request`
-   `authorize_dispatch`
-   `get_request_status`
-   `get_tracking`
-   `cancel_request`

Later:

-   payment authorization
-   structured customer messaging
-   rescheduling
-   enterprise partner callbacks/webhooks

Every action must enforce tenant/channel authorization and idempotency.

------------------------------------------------------------------------

## 12. Agent Gateway

Build a vendor-neutral Agent Gateway.

Responsibilities:

-   authentication
-   agent/channel identity
-   permissions/scopes
-   consent enforcement
-   request normalization
-   rate limiting
-   abuse protection
-   idempotency
-   audit logging
-   API versioning
-   tool/action schemas
-   policy enforcement

### Adapter strategy

Canonical ClueXP API remains the source of truth.

Adapters may include:

-   MCP-compatible interface for ecosystems supporting it
-   ChatGPT-specific application integration where appropriate
-   Claude-compatible integration
-   Gemini/tool-calling adapter
-   Apple App Intents/iOS integration
-   future agent protocols

Do not couple core business logic to MCP or any single vendor.

------------------------------------------------------------------------

## 13. AI Safety / Transaction Boundary

AI agents may perform non-consequential discovery operations such as
coverage and estimate checks when authorized.

Require explicit customer confirmation before:

-   creating a binding dispatch
-   charging a payment method
-   accepting material price changes
-   cancellation that incurs a fee

Store the confirmation/consent event.

The design objective:

**AI handles conversation and intent. ClueXP owns fulfillment state and
transactional truth.**

------------------------------------------------------------------------

## 14. Partner Website Gateway

Provide subscribed partners with low-friction ways to use ClueXP on
their own sites.

Build in this order:

1.  Hosted branded request link.
2.  Embeddable "Get Help Now" widget.
3.  JavaScript SDK/configuration.
4.  REST API for advanced partners.
5.  Webhooks for partner systems.

Configuration should support:

-   partner logo/brand
-   supported services
-   service areas
-   pricing presentation
-   contact information
-   operating hours
-   policies
-   tracking experience
-   payment settings

All partner-originated jobs default to the partner's private dispatch
scope.

------------------------------------------------------------------------

# PART III --- ACQUISITION ATTRIBUTION & AD SPEND

## 15. Immutable Acquisition Attribution

Implement before scaling paid/network acquisition.

Capture at request creation:

-   source
-   medium
-   campaign
-   campaign/ad identifiers
-   referring domain/channel
-   landing page
-   partner
-   AI/agent channel
-   UTM parameters
-   click IDs where legally/technically appropriate
-   new vs. returning customer
-   first-touch attribution
-   last-touch attribution

Define controlled channel values such as:

-   google_ads
-   google_organic
-   cluexp_direct
-   cluexp_network
-   chatgpt
-   claude
-   gemini
-   partner_website
-   partner_ads
-   referral
-   repeat_customer
-   enterprise_partner
-   other

------------------------------------------------------------------------

## 16. Partner Ad Spend Integration

Future roadmap item already approved for implementation.

Connect/import partner advertising spend, beginning with Google Ads
where feasible.

Architecture:

**Ad platform spend → ClueXP attribution layer → ClueXP requests/jobs →
completion/payment/revenue**

Calculate per partner/channel:

-   spend
-   leads/service requests
-   accepted jobs
-   completed jobs
-   cost per request
-   cost per accepted job
-   cost per completed job
-   new-customer CAC
-   ROAS
-   average ticket
-   contribution margin where cost inputs exist
-   cancellation rate
-   repeat rate
-   blended CAC

The objective is to quantify whether ClueXP/network/AI demand reduces
partners' dependence on paid search and lowers blended acquisition cost.

Never promise a savings percentage without measured data.

------------------------------------------------------------------------

# PART IV --- ANALYTICS

## 17. Provider Dashboard

Add a provider-facing acquisition and operations scorecard.

### Operations

-   jobs requested
-   accepted/completed/cancelled
-   acceptance rate
-   average acceptance time
-   average arrival time
-   ETA accuracy
-   revenue
-   average ticket
-   technician utilization

### Acquisition

-   jobs by source
-   revenue by source
-   ad spend by source
-   cost per completed job
-   CAC
-   ROAS
-   repeat customers

### Network

-   ClueXP Network opportunities
-   network jobs accepted/completed
-   network revenue
-   network ranking/eligibility health
-   reasons opportunities were missed

Avoid exposing proprietary ranking weights in a way that encourages
gaming.

------------------------------------------------------------------------

## 18. ClueXP Network Operations Dashboard

Internal metrics:

-   demand by geography/service/time
-   provider coverage
-   technician supply
-   unfulfilled demand
-   offer acceptance
-   redispatch frequency
-   median time-to-match
-   ETA accuracy
-   completion rate
-   cancellation/no-show
-   complaints/disputes
-   price-integrity alerts
-   network-originated revenue
-   acquisition channel economics

This becomes the operational control plane for expansion.

------------------------------------------------------------------------

# PART V --- PUBLIC WEBSITE: CLUEXP.COM

## 19. Website Role

Do not redesign cluexp.com as though ClueXP directly performs locksmith
work.

The website has four jobs:

1.  Explain the network clearly.
2.  Convert consumers needing urgent help.
3.  Recruit and convert service-provider subscribers.
4.  Establish machine-readable authority for search engines and AI
    systems.

The public website is one demand channel into the platform, not the
platform itself.

------------------------------------------------------------------------

## 20. Homepage Messaging

The homepage must immediately distinguish ClueXP from a direct
locksmith.

Recommended messaging hierarchy:

**Category:** Trusted dispatch network for urgent services.

**Consumer value:** Tell us what happened. ClueXP connects you with an
eligible provider/technician in the network.

**Provider value:** Run dispatch, tracking, customer operations, and
become eligible for additional network demand.

Avoid wording such as:

-   "Our locksmiths" if technicians belong to independent partners.
-   "We provide locksmith services."
-   claims implying ClueXP itself holds provider licenses unless legally
    true.

Use accurate language such as:

-   "ClueXP network providers"
-   "subscribed/participating service providers"
-   "verified/eligible provider" only according to the actual
    verification policy
-   "powered by ClueXP"

------------------------------------------------------------------------

## 21. Recommended Information Architecture

``` text
/
├── get-help/
├── services/
│   └── locksmith/
│       ├── house-lockout/
│       ├── car-lockout/
│       ├── car-key-replacement/
│       ├── rekey/
│       └── [supported-services]/
├── locations/
│   ├── tampa/
│   ├── brandon/
│   └── [actual-covered-areas]/
├── how-it-works/
├── trust-and-safety/
├── pricing/
├── track/
├── providers/
│   ├── why-cluexp/
│   ├── features/
│   ├── network/
│   └── join/
├── partners/
├── about/
├── contact/
├── terms/
└── privacy/
```

Only publish service/location pages for genuinely supported
offerings/coverage. Avoid thin programmatic SEO pages.

------------------------------------------------------------------------

## 22. Consumer "Get Help Now" Flow

The public website should provide a low-friction urgent flow:

1.  What happened?
2.  Service subtype/structured questions.
3.  Location.
4.  Optional notes.
5.  Optional photos.
6.  Availability/coverage result.
7.  Pricing/estimate disclosure.
8.  Customer/contact information.
9.  Payment/authorization if required.
10. Explicit request confirmation.
11. Network dispatch.
12. Technician/provider assignment.
13. Live tracking.
14. Completion/payment.
15. Verified customer feedback.

The interface should prioritize speed on mobile.

------------------------------------------------------------------------

## 23. Provider Conversion Flow

Provider pages should explain two distinct values:

### Run the operation

-   intake
-   dispatch
-   technician management
-   tracking
-   SMS/customer communication
-   payments
-   analytics

### Join the network

Eligible subscribers may receive incremental demand generated through
ClueXP and approved network channels.

Do not guarantee job volume.

Explain private partner demand vs. network-originated demand clearly.

------------------------------------------------------------------------

## 24. AI/Search Discoverability

Audit and implement:

-   OAI-SearchBot accessibility where desired
-   standard search-engine crawlability
-   sitemap
-   robots.txt
-   canonical URLs
-   server-rendered metadata
-   semantic HTML
-   accessible ARIA labels
-   structured data/Schema.org appropriate to the actual entity and
    content
-   organization/business identity consistency
-   clear service taxonomy
-   clear geographic coverage
-   strong internal linking
-   fast mobile performance
-   indexable explanatory content
-   no WAF/CDN rules unintentionally blocking desired crawlers

Do not use structured data implying ClueXP is the direct local locksmith
if it is the network/platform.

------------------------------------------------------------------------

## 25. AI-Friendly Public Information

Publish factual, stable pages that an AI system can understand and cite:

-   What is ClueXP?
-   How does the network work?
-   Who actually provides the service?
-   How providers are evaluated/verified.
-   How pricing works.
-   How dispatch works.
-   What areas are covered.
-   What services are supported.
-   Cancellation/no-show policy.
-   Trust and safety.
-   Provider participation.
-   Customer support.

Keep claims synchronized with actual product behavior.

------------------------------------------------------------------------

# PART VI --- SECURITY, GOVERNANCE & MULTI-TENANCY

## 26. Tenant Isolation

Review all tables and APIs for:

-   organization ownership
-   RLS
-   FORCE RLS where appropriate
-   service-role boundaries
-   partner-private vs. network-visible data
-   technician access
-   customer tracking-token access
-   admin/support access
-   audit logging

Network routing must never accidentally expose one provider's private
customers or operational data to another.

------------------------------------------------------------------------

## 27. Privacy

Minimize disclosure to AI/third-party channels.

Do not expose customer exact location, phone, payment data, or
technician personal information until required and authorized.

Use scoped tokens and short-lived access for tracking.

Define retention policies for:

-   location histories
-   uploaded photos
-   AI conversations/intake
-   payment metadata
-   attribution identifiers

------------------------------------------------------------------------

## 28. Auditability

Create auditable events for:

-   request creation
-   attribution
-   consent
-   eligibility decision
-   dispatch decision
-   offer
-   acceptance/decline/expiration
-   assignment
-   pricing change
-   arrival/completion
-   payment
-   cancellation/no-show
-   complaint/dispute
-   network trust changes

This is necessary for operations, partner disputes, trust scoring, and
future enterprise integrations.

------------------------------------------------------------------------

# PART VII --- IMPLEMENTATION SEQUENCE

## Phase 0 --- Architecture Freeze & Gap Analysis

Before new implementation:

-   map current schema and endpoints
-   map existing dispatch engine
-   map current partner/private queue
-   map tracking
-   map payment status
-   map current public website routes
-   identify what already exists vs. gaps in this document
-   write Architecture Decision Records for dispatch scope, attribution,
    gateway, and trust data

**Deliverable:** updated system design + prioritized backlog.

------------------------------------------------------------------------

## Phase 1 --- Foundation

Priority:

1.  canonical acquisition/channel model
2.  explicit private vs. network dispatch scope
3.  service taxonomy
4.  complete lifecycle event logging
5.  tenant/security audit
6.  provider/technician eligibility model
7.  raw trust metrics
8.  website messaging correction where needed

**Exit criterion:** every job has known origin, ownership, dispatch
scope, and auditable lifecycle.

------------------------------------------------------------------------

## Phase 2 --- Network Demand MVP

Build:

-   ClueXP consumer network intake
-   provider network eligibility
-   transparent network routing
-   provider offer/accept flow
-   network tracking
-   completion/outcome capture
-   basic network operations dashboard

Pilot in the initial locksmith geography.

**Exit criterion:** ClueXP can originate and fulfill a network job
without pretending to be the direct service provider.

------------------------------------------------------------------------

## Phase 3 --- Partner Web Distribution

Build:

-   hosted partner intake
-   embeddable widget
-   partner configuration
-   private queue enforcement
-   attribution
-   partner dashboard enhancements

**Exit criterion:** a subscribed partner can add ClueXP-powered urgent
intake to its website without custom dispatch development.

------------------------------------------------------------------------

## Phase 4 --- Public Website AI/Search Upgrade

Implement:

-   information architecture
-   service pages
-   real coverage/location pages
-   how-it-works
-   trust/safety
-   provider proposition
-   crawlability
-   structured data
-   AI/search technical audit
-   performance/accessibility

**Exit criterion:** cluexp.com accurately represents the network and is
technically understandable to search/AI crawlers.

------------------------------------------------------------------------

## Phase 5 --- Agent Gateway MVP

Build:

-   canonical external API
-   authentication/scopes
-   consent boundary
-   availability/coverage/estimate tools
-   service request creation
-   dispatch authorization
-   status/tracking
-   cancellation
-   audit logs
-   one initial AI-agent adapter

Do not begin with every ecosystem simultaneously.

**Exit criterion:** an authorized external agent can safely discover
availability and, after explicit user confirmation, initiate and track a
ClueXP request.

------------------------------------------------------------------------

## Phase 6 --- Attribution & Partner Ad Spend

Build:

-   attribution reporting
-   Google Ads spend integration/import
-   campaign mapping
-   completed-job attribution
-   revenue linkage
-   CAC/ROAS dashboard
-   blended acquisition-cost comparison

**Exit criterion:** pilot partners can compare paid-search economics
with ClueXP/network/other channels using completed-job data.

------------------------------------------------------------------------

## Phase 7 --- Trust & Dispatch Intelligence

After sufficient real data:

-   ETA prediction improvements
-   provider reliability models
-   price-integrity scoring
-   service/geography-specific performance
-   network routing optimization
-   documented Trust Score evaluation
-   fraud/anomaly detection

Avoid claiming "AI-powered matching" merely because a scoring formula
exists.

------------------------------------------------------------------------

## Phase 8 --- Multi-Vertical Expansion

Only after locksmith workflow and economics are validated:

-   extract locksmith-specific assumptions
-   create vertical configuration framework
-   add one adjacent urgent-service vertical
-   validate licensing, pricing, intake, dispatch, and trust differences

The network architecture should remain common.

------------------------------------------------------------------------

# PART VIII --- KPI FRAMEWORK

## 29. Marketplace / Network KPIs

Track:

-   requests
-   coverage rate
-   match rate
-   time-to-first-offer
-   time-to-accept
-   arrival time
-   ETA accuracy
-   completion rate
-   cancellation/no-show
-   unfulfilled demand
-   provider/technician utilization
-   repeat usage
-   customer satisfaction
-   complaints/disputes

------------------------------------------------------------------------

## 30. Provider Economics KPIs

Track:

-   subscription revenue
-   network revenue/fees as model evolves
-   jobs per provider
-   revenue per provider
-   provider retention
-   network participation
-   Google Ads CAC
-   ClueXP Network CAC/effective acquisition cost
-   blended CAC
-   ROAS by channel
-   provider incremental revenue from network demand

------------------------------------------------------------------------

## 31. Strategic Validation Questions

Before scaling, ClueXP should be able to answer with data:

1.  Do providers receive operational value even without network leads?
2.  Does network demand increase provider revenue?
3.  Can ClueXP fill urgent requests faster/more reliably than customer
    self-search?
4.  Does first-party operational data improve dispatch decisions?
5.  Can ClueXP reduce partners' blended acquisition cost?
6.  Do providers remain subscribed because of both operations and
    distribution?
7.  Can a second acquisition channel use the same gateway without
    changing core dispatch?
8.  Can a second service vertical reuse the platform without rewriting
    it?

------------------------------------------------------------------------

# PART IX --- IMMEDIATE NEXT ACTIONS

When implementation resumes, do **not** immediately code this entire
roadmap.

Start with a repository + live-site gap analysis and classify every
item:

-   **Exists and production-ready**
-   **Exists but requires modification**
-   **Partially implemented**
-   **Not implemented**
-   **Future / do not build yet**

Then convert only the next phase into GitHub issues/milestones.

### Recommended first engineering review

1.  Current request/job schema.
2.  Current organization/tenant model.
3.  Existing private dispatch engine.
4.  Offer TTL/redispatch.
5.  technician eligibility.
6.  tracking implementation.
7.  payments.
8.  attribution fields.
9.  public website routing/content.
10. API boundaries.
11. RLS/security.
12. analytics/event history.

The immediate objective is **not feature volume**. It is to ensure the
existing ClueXP implementation can evolve cleanly into:

> **One trusted orchestration platform, many demand channels,
> independent subscribed providers, and one increasingly intelligent
> fulfillment network.**
