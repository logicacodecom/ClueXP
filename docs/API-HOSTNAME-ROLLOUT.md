# `api.cluexp.com` Rollout Gate

Status: DNS, domain attachment, and TLS are already active — verified 2026-08-24. `api.cluexp.com` is attached to the same `cluexp-intake` Vercel project as `intake.cluexp.com`; `https://api.cluexp.com/api/v1/services` already reaches the existing FastAPI app and returns `401 missing_api_key`; TLS is issued and valid via Vercel/Let's Encrypt; Cloudflare DNS is a `CNAME api -> ...vercel-dns...` record, DNS-only. **Only repository deployment/activation is pending** — the routing/gating code below exists in the repo but has not been deployed, and the production env vars it reads (`TRUSTED_HOSTS`, `ALLOWED_ORIGINS`, `API_ONLY_HOSTNAMES`) are not yet set.

This hostname is a narrow façade over the existing Platform deployment. It is not a new backend, a second Vercel project, or an external edge/gateway service — it must not contain copied coverage, routing, dispatch, authorization, or tracking logic.

## How the façade is implemented (repository-native, no new service)

Because `api.cluexp.com` and `intake.cluexp.com` are two domains on the **same** Vercel project, the façade is implemented entirely with `apps/intake-web/vercel.json` `rewrites` (host-conditioned via the `has: [{ "type": "host", ... }]` matcher) plus host-aware gating inside the existing FastAPI app (`apps/intake-web/api/main.py`):

- `rewrites` sends every request whose `Host` is `api.cluexp.com` to the same Python function (`/api/main`) that already serves `/api/*`, regardless of path (so `/`, `/api/*`, `/v1/*` all reach FastAPI instead of the Next.js app).
- `rewrites` also sends `/v1/*` to that function on every host, so `/v1/*` is reachable directly (not just under the legacy `/api/v1/*` prefix) everywhere, including local dev and `intake.cluexp.com`.
- Inside FastAPI, `config.API_ONLY_HOSTNAMES` (env `API_ONLY_HOSTNAMES`, default `api.cluexp.com`) drives a middleware (`restrict_api_only_hostnames` in `api/main.py`) that returns an opaque JSON `404` for any request to a facade hostname whose raw, un-normalized path is not exactly `/v1` or `/v1/...` (an exact-boundary check, so `/api/v1/*`, `/v10`, and `/v1evil` are also rejected). This is what actually hides the intake website, the legacy `/api/v1/*` alias, and internal `/api/*` routes behind `api.cluexp.com` — the Vercel rewrite alone would otherwise expose them.
- `config.TRUSTED_HOSTS` (env `TRUSTED_HOSTS`) drives a second middleware (`enforce_trusted_hosts`) that rejects requests with an unrecognized `Host` header with `400`. Unset it defaults to `["*"]` (allow all) so local dev, tests, and Vercel preview URLs are never broken by this; production sets it explicitly.
- `ALLOWED_ORIGINS` (CORS) fails closed in production: if unset/empty while `IS_PRODUCTION` is true, `ALLOWED_ORIGINS` resolves to `[]` (no origins), never a wildcard. Outside production it still defaults to `["*"]` for developer convenience.

No new proxy, edge worker, or DNS-level allowlist is required for path/host scoping — that logic lives once, in the existing FastAPI app, and applies identically to any host that gets routed to it.

### Vercel/ACME validation paths (verified, not speculative)

No repository exception is needed for TLS/domain validation. Per Vercel's own documentation
([Working with SSL Certificates](https://vercel.com/docs/domains/working-with-ssl),
[Troubleshooting domains](https://vercel.com/docs/domains/troubleshooting)): for a non-wildcard
custom domain like `api.cluexp.com`, Vercel uses the ACME **HTTP-01** challenge and its own
infrastructure intercepts the challenge request before it reaches project routing — "the request
can make it to Vercel, then our infrastructure will deal with it." `/.well-known/*` is a **reserved
path that cannot be redirected or rewritten** by project config, so the host-scoped catch-all
rewrite above cannot interfere with it even though it matches `/(.*)`. Domain ownership verification
(the TXT/CNAME check) and certificate issuance are both handled entirely at the Vercel platform
layer, out of band from `vercel.json`, Next.js, and the FastAPI app. No code change or rewrite
exception was made for this.

## What remains manual (Cloudflare/Vercel/env — not executed by this change)

- Set the production environment variables below on the `cluexp-intake` Vercel project (Production environment) — do this only after the repository semantics above are confirmed in a preview deploy:

  ```text
  TRUSTED_HOSTS=api.cluexp.com,intake.cluexp.com,cluexp-intake.vercel.app,*.vercel.app
  ALLOWED_ORIGINS=<explicit approved list, or leave unset/empty to keep CORS closed>
  API_ONLY_HOSTNAMES=api.cluexp.com
  CUSTOMER_INTAKE_BASE_URL=https://intake.cluexp.com
  ```

- Deploy the existing `cluexp-intake` Vercel project (this change is additive — no separate deploy target) only after explicit Human authorization.
- Verify the deployment against the release checks below before pointing any client (Website BFF, MCP config) at `https://api.cluexp.com`.
- Configure Vercel Firewall / WAF host-path rules as defense in depth once the above is live: start in log/observe mode, then move to deny after verification. This is a second, independent layer — the FastAPI-level gate above is already sufficient to prevent exposure, so WAF failing to be configured is not a blocking condition for correctness, only for abuse resistance.
- Establish edge rate-limit thresholds from observed traffic rather than inventing speculative limits.
- Preserve Cloudflare DNS-only mode (the existing `CNAME api -> ...vercel-dns...` record) during the initial rollout.

## Release checks

The hostname is ready only when all checks pass against the deployed preview/production URL:

```text
GET  https://api.cluexp.com/v1/services                  -> 401 missing_api_key
GET  https://api.cluexp.com/v1/services + valid key      -> 200 + X-Request-ID
POST https://api.cluexp.com/v1/coverage-checks            -> contract response
GET  https://api.cluexp.com/                              -> 404 {"error":"not_found",...}
GET  https://api.cluexp.com/api/healthz                   -> 404 {"error":"not_found",...}
GET  https://api.cluexp.com/ops/queue                     -> 404 {"error":"not_found",...}
GET  https://api.cluexp.com/openapi.json                  -> 404 {"error":"not_found",...}
```

Also confirm that request IDs and audit events reach the existing Platform observability/store, rate limits are shared with the origin path for the same external client, and no response contains a raw job UUID, internal roster, offer details, secret, or pre-match technician identity.

## Rollback

Routine rollback is a client-side change only: point the Website BFF (and any other client) back to the
approved legacy origin (`https://intake.cluexp.com/api/v1`) and stop sending traffic to
`https://api.cluexp.com`. No DNS, domain-attachment, TLS, or schema change is required or
recommended for a routine rollback — the façade is pure application routing/gating on the existing
deployment. Detaching the `api.cluexp.com` domain from the Vercel project is **not** a routine
rollback step; it is a separate, higher-impact action (removes TLS/domain state that took manual
setup to establish) and should only be done on explicit Human instruction, independent of this
rollout. This rollout adds no schema and no second service.
