# ClueXP Public API (`/v1`) — Developer Guide

Status: frozen Website transaction contract. API keys are issued by ClueXP staff via internal admin endpoints; there is no partner self-service.

Canonical base URL: `https://api.cluexp.com/v1`. During the controlled transition, `https://intake.cluexp.com/api/v1` remains available as the legacy origin. All public endpoints are under `/v1/`. Everything outside `/v1/` (`/ops`, `/provider`, technician routes, admin routes, tracking-token routes) is internal and must not be reachable through the canonical hostname; requests to `api.cluexp.com` for any non-`/v1` path get an opaque JSON `404`, never the intake website or an internal route.

Website integrations must call this API from a server-side/BFF boundary. Never put an external API key in browser JavaScript, HTML, analytics, URLs, or client logs.

## Authentication

Every `/v1` request requires an API key, presented either as:

```
Authorization: Bearer <key>
```

or:

```
X-Api-Key: <key>
```

Keys are issued per external client with a fixed set of scopes (below). A missing key returns `401 missing_api_key`; an invalid key returns `401 invalid_api_key`.

## Scopes

Each endpoint requires exactly one scope. A key without the required scope gets `403 insufficient_scope`.

| Scope | Grants |
|---|---|
| `services:read` | `GET /v1/services` |
| `coverage:check` | `POST /v1/coverage-checks` |
| `service_requests:write` | `POST /v1/service-requests` |
| `service_requests:authorize` | `POST /v1/service-requests/{id}/dispatch-authorizations` |
| `service_requests:read` | `GET /v1/service-requests/{id}`, `GET /v1/service-requests/{id}/tracking` |
| `service_requests:cancel` | `POST /v1/service-requests/{id}/cancellations` |

## Request IDs

Every response includes an `X-Request-ID` header and echoes the same value in `meta.request_id` (success) or `request_id` (error). Pass your own `X-Request-ID` header on the way in if you want to correlate a request end-to-end; otherwise one is generated for you.

## Error envelope

Every `/v1` error, regardless of cause, has this shape:

```json
{
  "error": "invalid_request",
  "request_id": "a1b2c3d4e5f6",
  "detail": "location.lat: field required"
}
```

`detail` is present for validation errors, omitted for others. Common `error` values: `missing_api_key`, `invalid_api_key`, `insufficient_scope`, `rate_limited`, `invalid_request`, `service_request_not_found`.

## Idempotency

`POST /v1/coverage-checks` and `POST /v1/service-requests` support `Idempotency-Key` replay/conflict handling. Reuse the same key when retrying a request that may or may not have succeeded (e.g. after a timeout) — the server returns the original result instead of creating a duplicate. Use a new key for a genuinely new request.

`POST /v1/service-requests/{request_reference}/dispatch-authorizations` is idempotent by construction: at most one authorization can ever exist per service request, regardless of header reuse. `POST /v1/service-requests/{request_reference}/cancellations` is idempotent by request state when a request is already cancelled. Do not depend on header-based replay/conflict behavior for those downstream endpoints.

## Rate limits

Enforced per external client, per scope, per minute (`external_clients.rate_limit_per_minute`, default 60/min). Multiple keys for one client share the same budget. Exceeding it returns `429 rate_limited`. There is no burst-tolerant retry built into the API — back off and retry later; do not hot-loop.

## Service catalog

```
GET /v1/services
Authorization: Bearer <key>
```

```json
{
  "data": [
    {
      "code": "plumbing",
      "label": "Plumbing",
      "skills": [
        { "code": "plumbing.leak_repair", "label": "Leak repair", "requires_verification": false }
      ]
    }
  ],
  "meta": { "request_id": "..." }
}
```

## Coverage checks

Read-only — checks whether a service skill is coverable at a location. No side effects.

```
POST /v1/coverage-checks
Authorization: Bearer <key>
Content-Type: application/json

{
  "lat": 40.7128,
  "lng": -74.0060,
  "service_skill": "plumbing.leak_repair"
}
```

```json
{
  "data": { "covered": true, "service_skill": "plumbing.leak_repair" },
  "meta": { "request_id": "..." }
}
```

## Creating a service request

Creation only. This never dispatches or notifies anyone — it just records the request. Dispatch is a separate, explicit step (below).

```
POST /v1/service-requests
Authorization: Bearer <key>
Idempotency-Key: <unique-per-logical-request>
Content-Type: application/json

{
  "dispatch_scope": "private_partner",
  "service_skill": "plumbing.leak_repair",
  "location": { "lat": 40.7128, "lng": -74.0060, "raw_text": "123 Main St" },
  "consent": { "terms_accepted": true, "policy_version": "2026-01" },
  "situation": "Kitchen sink leaking",
  "urgency": "same_day",
  "customer": { "name": "Jane Doe", "phone": "+15551234567" },
  "notes": "Gate code 1234"
}
```

`dispatch_scope` is the only public-facing routing choice:
- `private_partner` — the request stays within the calling client's own private technician pool.
- `network` — the request may route to ClueXP's broader technician network (see below).

`consent.terms_accepted` must be `true` at creation time — there is no deferred consent step.

```json
{
  "data": { "request_reference": "SR-...", "dispatch_scope": "private_partner", "status": "received" },
  "meta": { "request_id": "..." }
}
```

`request_reference` is an opaque external identifier — never the internal database id. Use it for every subsequent call.

## Authorizing dispatch

A separate, explicit step. This is the call that can actually notify a technician — never fire it automatically as a continuation of creation.

```
POST /v1/service-requests/{request_reference}/dispatch-authorizations
Authorization: Bearer <key>
Content-Type: application/json

{
  "channel": "first_party_website",
  "evidence_reference": "website-consent-event-id",
  "terms_version": "2026-08-01"
}
```

```json
{
  "data": {
    "request_reference": "SR-...",
    "dispatch_scope": "network",
    "status": "authorized",
    "routing_outcome": "offer_sent"
  },
  "meta": { "request_id": "..." }
}
```

`routing_outcome` is only populated for `dispatch_scope: "network"` requests. Possible values include `offer_sent` and `no_eligible_provider`. There is currently no automatic re-offer and no overflow from `private_partner` into the network — if no eligible provider is found, the request stays unfulfilled until handled through other (internal) means.

## Reading a service request

```
GET /v1/service-requests/{request_reference}
Authorization: Bearer <key>
```

```json
{
  "data": {
    "request_reference": "SR-...",
    "dispatch_scope": "private_partner",
    "status": "authorized",
    "created_at": "2026-08-24T12:00:00+00:00"
  },
  "meta": { "request_id": "..." }
}
```

`status` is one of `received`, `authorized`, `completed`, `cancelled` — a simplified public view of the internal fulfillment state.

## Tracking

```
GET /v1/service-requests/{request_reference}/tracking
Authorization: Bearer <key>
```

Returns the same privacy-minimized dispatch state shown to customers on the tracking page — no raw technician identity or contact details, no exact live coordinates beyond what that page already discloses.

## Cancelling

```
POST /v1/service-requests/{request_reference}/cancellations
Authorization: Bearer <key>
Content-Type: application/json

{ "reason": "Customer rescheduled" }
```

Cancellation is gated by fulfillment stage — a request too far into fulfillment (e.g. technician already en route/on site, per the same rule customer-facing cancellation uses) is rejected rather than silently accepted. Cancelling an already-cancelled request is idempotent and returns the existing cancelled state rather than an error.

## Ownership and visibility

For a `network` request, only its creating client (or an internal Platform client) may authorize dispatch. Read and cancellation remain available to the originating/authorizing client or an internal Platform client. `private_partner` requests remain organization-bound. An unrelated client receives `404 service_request_not_found`, so it cannot distinguish "not yours" from "doesn't exist."

## First Website transaction profile

The first approved Website flow is deliberately narrow:

1. Provision one first-party Website server client with `services:read`, `coverage:check`, `service_requests:write`, `service_requests:authorize`, and `service_requests:read`. Do not grant provider, ops, admin, or cancellation access unless separately required.
2. Discover and submit only the active canonical skill `locksmith.residential_lockout` for this release.
3. Call `POST /v1/coverage-checks`. `covered: false` is the stable unsupported/unavailable state; do not fabricate coverage or disclose provider/technician counts.
4. Create with `dispatch_scope: "network"`, explicit terms consent, and a unique `Idempotency-Key` retained for retries.
5. Present a final dispatch summary and collect an explicit customer choice before calling dispatch authorization with `channel: "first_party_website"` and a durable consent-event reference.
6. Poll the request and tracking endpoints using the opaque `request_reference`. Never use or request a raw job UUID.

Coverage and authorization both use the Network Router's provider eligibility rules (active provider, residential-lockout capability, and existing technician availability/skill/radius rules). A positive coverage result is a point-in-time answer, not a reservation; authorization can still return `no_eligible_provider` if eligibility changes.

## What this API does not do (current limitations)

- No partner self-service key provisioning — keys are issued manually by ClueXP staff.
- No payments capability.
- No private-to-network overflow or automatic re-offer.
- No provider ranking/bidding control exposed to callers — ranking is internal and deterministic.
- No public marketplace/agent-platform listing yet. An internal MCP preview exists, but it is not published, listed, or connected to production by default.
- No bulk/list endpoints — every read is by `request_reference`.

Do not build integrations assuming any of the above will ship on a specific date; treat this guide as the current contract only.
