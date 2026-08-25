# W1 — Website ↔ Platform Integration Contract (FROZEN)

Status: **Canonical / frozen.** This document is a restatement of the existing
`/v1` public API as implemented in `apps/intake-web/api/main.py` and documented
in `docs/PUBLIC-API-DEVELOPER-GUIDE.md`. It introduces **no new endpoints, no
new fields, and no architecture changes** — it exists to give the Website
integration a single point-in-time reference to build against. If the Website
needs something not in this document, that is a change request back to
Codex/Platform, not a Website-side workaround.

Source of truth for exact field types: `docs/openapi-v1-snapshot.json`
(machine-generated from the live FastAPI app, kept in sync by
`test_openapi_export.py`). This document is the prose companion, not a
replacement.

All endpoints are relative to the `/v1` API base (see
`docs/API-HOSTNAME-ROLLOUT.md` for hostname/base-URL resolution).

---

## 1. Coverage request

```
POST /v1/coverage-checks
Authorization: Bearer <api-key>      (scope: coverage:check)
Idempotency-Key: <uuid>              (optional, supported)
Content-Type: application/json

{
  "lat": 37.7749,
  "lng": -122.4194,
  "service_skill": "locksmith.residential_lockout"
}
```

Ref: `PUBLIC-API-DEVELOPER-GUIDE.md:93-101`, `main.py:4435-4436`.

## 2. Coverage response

```
200 OK
{
  "data": {
    "covered": true,
    "service_skill": "locksmith.residential_lockout"
  },
  "meta": { "request_id": "..." }
}
```

`covered: false` is a **stable, non-error state** — it means "no coverage
here," not a failure. Do not treat it as an exception path.

Ref: `PUBLIC-API-DEVELOPER-GUIDE.md:104-109, 230`.

## 3. Create request (job creation)

```
POST /v1/service-requests
Authorization: Bearer <api-key>      (scope: service_requests:write)
Idempotency-Key: <uuid>              (REQUIRED)
Content-Type: application/json

{
  "dispatch_scope": "network" | "private_partner",
  "service_skill": "locksmith.residential_lockout",
  "location": { "lat": ..., "lng": ..., "raw_text": "..." },
  "consent": { "terms_accepted": true, "policy_version": "..." },
  "situation": "...",
  "urgency": "...",
  "customer": { "name": "...", "phone": "..." },
  "notes": "..."
}
```

Response:

```
200 OK   (including idempotent replay)
{
  "data": {
    "request_reference": "SR-...",
    "dispatch_scope": "network",
    "status": "received"
  },
  "meta": { "request_id": "..." }
}
```

Notes:
- The platform API treats `Idempotency-Key` as optional at the HTTP boundary,
  but the Website integration contract makes it required for this call so
  Website retries cannot create duplicate requests.
- `dispatch_scope: "private_partner"` requires the API client to be bound to
  a partner org, else `422 dispatch_scope_requires_partner_client`.
- `request_reference` (`SR-...`) is the only identifier the Website should
  hold or pass forward. Never request or persist a raw job UUID.

Ref: `PUBLIC-API-DEVELOPER-GUIDE.md:111-144`, model `main.py:406-470` (ADR-6),
handler `main.py:4529`, rejection `main.py:4553-4557`.

## 4. Dispatch authorization schema

```
POST /v1/service-requests/{request_reference}/dispatch-authorizations
Authorization: Bearer <api-key>      (scope: service_requests:authorize)
Content-Type: application/json

{
  "channel": "first_party_website",
  "evidence_reference": "...",
  "terms_version": "..."
}
```

Response:

```
200 OK
{
  "data": {
    "request_reference": "SR-...",
    "dispatch_scope": "network",
    "status": "authorized",
    "routing_outcome": "offer_sent" | "no_eligible_provider" | null
  },
  "meta": { "request_id": "..." }
}
```

`routing_outcome` is populated only for `dispatch_scope: network`; it is
`null` for `private_partner`. This call is idempotent by construction — at
most one authorization exists per request; do not send an `Idempotency-Key`
expecting header-based replay semantics here (see §8).

Ref: `PUBLIC-API-DEVELOPER-GUIDE.md:148-176`, `main.py:4641-4807` (ADR-6/ADR-7).

## 5. Tracking schema

```
GET /v1/service-requests/{request_reference}/tracking
Authorization: Bearer <api-key>      (scope: service_requests:read)
```

Response (`main.py:4900-4930`, backing shape from
`store.get_dispatch_status`, `store.py:3245-3306`):

```
200 OK
{
  "data": {
    "state": "matched" | "waiting" | "expired_retry" | "no_eligible" | "error",
    "terminal": bool,
    "status": "<internal job status string>",
    "closed": bool,
    "customer_actions": [...],
    "assignment": {
      "technician_display_name": "...",
      "technician_photo_url": "..." | null,
      "role": "Verified Technician",
      "rating": null,
      "eta_min": null, "eta_max": null, "eta_is_estimate": true,
      "job_status": "...",
      "live_lat": number | null,
      "live_lng": number | null,
      "location_updated_at": "..." | null
    } | null,
    "destination": { "lat": ..., "lng": ... } | null,
    "payment": { "amount": ..., "currency": "USD", "method": "..." } | null,
    "closeout": {...} | null,
    "service_appointment": {...} | null
  },
  "meta": { "request_id": "...", "api_version": "v1" }
}
```

Privacy rules baked into this response, not to be re-derived client-side:
- Technician identity (`assignment`) is populated only once `state: matched`
  — never earlier, by construction (single shared state function).
- `live_lat`/`live_lng` are populated only when tracking is currently
  eligible to be shown (`may_show_live_tracking`) **and** the technician's
  last location ping is fresh (`LOCATION_ONLINE_THRESHOLD_MINUTES`). Absence
  of live coordinates is expected/normal, not an error.
- `service_appointment` has `reserved_technician_id`/`reservation_id`
  stripped and `technician_reserved` remapped to `confirmed_unassigned`
  before it ever reaches this response (`_mask_customer_service_appointment`,
  `main.py:4012-4018`).
- No raw job UUID, no full customer/technician contact info is present.

## 6. Cancellation schema

```
POST /v1/service-requests/{request_reference}/cancellations
Authorization: Bearer <api-key>      (scope: service_requests:cancel)
Content-Type: application/json

{ "reason": "at least 3 characters" }
```

Response:

```
200 OK
{
  "data": { "request_reference": "SR-...", "status": "cancelled" },
  "meta": { "request_id": "..." }
}
```

Rejected (not idempotent-safe to force) once fulfillment has progressed past
a cancellable stage (technician en route/on-site). Re-cancelling an already
cancelled request returns the existing cancelled state, not an error.

Ref: `PUBLIC-API-DEVELOPER-GUIDE.md:208-218`, `main.py:4933-4958+`.

## 7. Bearer authentication

```
Authorization: Bearer <api-key>
```

`X-Api-Key: <api-key>` is accepted as an equivalent alternative header.

- Missing key → `401 missing_api_key`
- Invalid key → `401 invalid_api_key`
- Valid key, wrong scope for the endpoint → `403 insufficient_scope`

Each endpoint requires exactly one scope from the table in
`PUBLIC-API-DEVELOPER-GUIDE.md:29-36`: `coverage:check`,
`service_requests:write`, `service_requests:authorize`,
`service_requests:read`, `service_requests:cancel`.

## 8. Idempotency

Header: `Idempotency-Key: <opaque string, client-generated, e.g. UUID>`

Supported on exactly two endpoints:
- `POST /v1/coverage-checks`
- `POST /v1/service-requests` (**required by the Website integration contract**;
  supported but not hard-required by the platform API boundary)

Behavior:
- Same key + same body → replays the original response (safe retry).
- Same key + different body → `409` "Idempotency-Key was already used with a
  different request body."
- Same key, original request still in flight → `409` "still being processed."

`dispatch-authorizations` and `cancellations` do **not** use header-based
idempotency — they are idempotent by state (at most one authorization per
request; re-cancel returns existing cancelled state). Do not send an
`Idempotency-Key` on those two expecting replay semantics.

Ref: `PUBLIC-API-DEVELOPER-GUIDE.md:56-60`, `main.py:4300, 4396, 4453-4477, 4548-4575`.

## 9. Correlation IDs

Header: `X-Request-ID`

- Website may send it inbound to correlate its own logs with Platform logs.
- Platform always echoes it back as a response header, and also inside the
  response body — `meta.request_id` on success, `request_id` on error bodies.
- If not supplied, Platform generates one server-side (`secrets.token_hex(12)`,
  capped at 128 chars).

Every `/v1` route sets this header on the response
(`main.py:197, 4273, 4300, 4389, 4451, 4545, 4712, 4882, 4912, 4975`).

## 10. Retry rules

- Rate limiting: `429 rate_limited`, no burst tolerance. On `429`, back off —
  do not hot-loop retries.
- Safe retries on writes are achieved via `Idempotency-Key` (§8), not via a
  generic HTTP retry policy.
- **No documented exponential-backoff schedule or max-attempt count exists
  in the current contract.** Do not invent one and present it as canonical —
  this is an open item, not something to silently fill in. If the Website
  needs a specific retry/backoff policy, raise it as a change request.

Ref: `PUBLIC-API-DEVELOPER-GUIDE.md:64`.

## 11. Tracking token / session relationship

These are two separate mechanisms — do not conflate them:

1. **`/v1` public API tracking (this contract, §5)** — authenticated via
   Bearer/API-key + scoped to the opaque `request_reference`. This is what
   the Website integration uses.
2. **Legacy/cutover `tracking_token`** (`jobs.tracking_token`, unauthenticated
   opaque token) → `GET /api/t/{token}` and public page `/t/{token}`. This is
   a separate, token-only mechanism, not a session, and is not part of this
   `/v1` contract.
3. **Authenticated staff/provider/technician session** — httpOnly cookie
   `cluexp_access_token`, resolved via `GET /auth/me`. Unrelated to both of
   the above; internal console auth only.

The Website integration uses mechanism (1) exclusively. It must never
request, store, or forward a raw job UUID or a `tracking_token` — only
`request_reference`.

## 12. Residential service identifier

Canonical skill code for this release:

```
locksmith.residential_lockout
```

This is the only skill in scope for the first Website transaction profile.
Do not submit or discover any other skill code in this integration phase.

Ref: `PUBLIC-API-DEVELOPER-GUIDE.md:229`, bucketing logic `main.py:4518-4520`,
skill-code validation `main.py:620`.

## 13. Test fixture

Reference test suite (existing, not new): `apps/intake-web/api/tests/test_public_api_foundation.py`.
Use it as the executable fixture for contract conformance — it exercises the
`/v1` request/response shapes above end-to-end against the real FastAPI app.
There is no separate fixtures directory; test data is inline in that module.

## 14. OpenAPI

Machine-readable source of truth: `docs/openapi-v1-snapshot.json`, generated
by `scripts/export_openapi_v1.py` and kept fresh by
`apps/intake-web/api/tests/test_openapi_export.py`. No changes to this file
are part of freezing this contract — it already reflects the schemas above.
If the Website integration needs a field this snapshot doesn't expose (e.g.
a fully typed tracking response instead of `additionalProperties: true`),
that is a Platform-side change request, not something to assume.

---

## Explicitly out of scope for this document

- No new endpoints, fields, headers, or status codes.
- No retry/backoff schedule (§10) — flagged as open, not resolved here.
- No change to the tracking response's `additionalProperties: true` typing
  in the OpenAPI snapshot (§14) — flagged as open, not resolved here.
