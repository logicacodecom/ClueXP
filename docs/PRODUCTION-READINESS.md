# Production Readiness Checklist

Use this after merging workflow changes to `main` and before enabling or widening a provider pilot.

## Required verification

Run locally from the repository root unless noted:

```powershell
python -m pytest api/tests/test_dispatch.py -q
npm run typecheck
npm run build --workspace @cluexp/intake-web
npm run build --workspace @cluexp/provider-web
npm run build --workspace @cluexp/technician-web
npm run build --workspace @cluexp/ops-web
npm run build --workspace @cluexp/console-web
```

> ⚠️ There are **five** deployed web apps, not four. `console-web` (Vercel project
> `cluexp-console`) shares the same Next.js dependency as the other four but is **not built by
> `.github/workflows/ci.yml`**, so a green CI run does not prove it compiles. Build it locally as
> part of this checklist, and treat it as in scope for any dependency upgrade or auth/tenant
> regression pass, until CI covers it (`npm run build:console`).

## Production environment

- `DATABASE_URL` set for all server-side API projects that need live persistence.
- `AUTH_SECRET`, `ARRIVAL_PIN_SECRET`, and `CRON_SECRET` set to independent high-entropy values of
  at least 32 characters. Production startup rejects missing, short, and known-placeholder values.
- `CUSTOMER_INTAKE_BASE_URL` or `NEXT_PUBLIC_INTAKE_BASE_URL` set to `https://intake.cluexp.com`.
- `NEXT_PUBLIC_CLUEXP_API_BASE_URL` set consistently for provider, technician, and ops web proxies.
- Google Maps server key configured only where geocoding/reverse-geocoding is expected.
- Supabase storage URL/service key configured only server-side.
- Twilio communications, if enabled:
  - `COMMUNICATIONS_PROVIDER=twilio`; rollback is `COMMUNICATIONS_PROVIDER=noop`.
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_DEFAULT_FROM_NUMBER`, and
    `TWILIO_WEBHOOK_BASE_URL` set only server-side.
  - Provider-web Settings assigns an already-purchased Twilio number plus
    primary/backup forwarding numbers in E.164 format.
  - Twilio voice webhooks point to `/api/twilio/voice/incoming` and
    `/api/twilio/voice/status`.
  - Twilio messaging webhooks point to `/api/twilio/sms/incoming` and
    `/api/twilio/sms/status`.
  - Transactional SMS is enabled only after A2P 10DLC registration is approved.
  - Call recording remains disabled until consent and jurisdiction policy exist.

## Database and runtime settings

- Alembic head applied for the target environment.
- `global_settings.dispatch_cutover_global_off` intentionally set for the pilot state.
- Provider-specific settings reviewed:
  - Intake estimate shown/hidden as intended.
  - Dispatch distance unit set to `mi` or `km`.
  - Dispatch acknowledgement/stalled thresholds reviewed.
  - Financial closeout defaults reviewed.
  - Company service capabilities use canonical skill codes.

## Operational readiness

- Primary and backup dispatchers identified for the coverage window.
- Technician roster verified by login, affiliation, active/verified status, skill codes, and fresh location.
- Customer-care phone in provider profile is correct.
- Recovery owners know how to cancel, release, no-show, recall, and resolve jobs.
- Rollback owner has Vercel and database access.

## MCP endpoint (`mcp.cluexp.com`)

Before treating the MCP server as publicly launched/listed in any assistant platform:

- Confirm `https://mcp.cluexp.com/healthz` returns `200 {"status":"ok"}`.
- Confirm `POST https://mcp.cluexp.com/mcp` without a bearer token and with a wrong bearer token both
  return `401`. **The body depends on which auth mode the deployment is in, so assert against the
  mode you are actually running:**
  - Compatibility (bearer) mode — `CLUEXP_MCP_BEARER_TOKEN` set, OAuth not configured:
    `{"error":"invalid_mcp_token"}` (`mcp_server/asgi.py`, `MCPBearerAuthMiddleware`).
  - OAuth mode — when OAuth is configured, `MCPBearerAuthMiddleware` short-circuits
    (`if oauth_enabled: return await call_next(request)`) and the MCP app's own OAuth layer
    answers, emitting the OAuth-style `{"error":"invalid_token","error_description":...}`.
  Record which mode production is in as part of preflight. A change of auth mode that nobody
  records will silently invalidate whatever the health monitor asserts.
- Confirm the scheduled GitHub Actions workflow `mcp-production-health` is enabled on `main` **and
  green**; it runs every 30 minutes and checks only public health plus negative auth-boundary
  behavior, so it does not require storing the production MCP bearer token in GitHub. A persistently
  red monitor means the auth boundary is unverified, not that the check is noisy — the workflow's
  expected error body must match the deployment's current auth mode (see above).
- **The MCP server exposes mutating tools** (`create_service_request`, `authorize_dispatch`,
  `cancel_service_request` in `mcp_server/server.py`). Their `confirm=true` argument is a
  caller-supplied agent-UX convention, **not** an authorization control. Before any pilot, confirm
  the production external client's organization binding and scopes, and prove it cannot reach the
  pilot tenant — or disable the mutating tools for the window. Note also that the server calls the
  API with a single shared `CLUEXP_API_KEY`, so every MCP caller shares one audit identity.
- Keep `CLUEXP_MCP_BEARER_TOKEN` and `CLUEXP_API_KEY` only in Vercel's environment store unless a
  reviewed platform/reviewer credential plan exists.
- For OpenAI plugin submission, set `OPENAI_APPS_CHALLENGE_TOKEN` only after the submission portal
  provides the exact token, redeploy, and verify
  `https://mcp.cluexp.com/.well-known/openai-apps-challenge` returns only that token as `text/plain`.
- Do not run `confirm=true` MCP dispatch/cancel smoke against production unless the Human explicitly
  authorizes a scoped live proof run.

## Alerting (migration 0054)

Before enabling real customer traffic for a company whose dispatcher relies on the alert inbox
(`GET /provider/alerts`) instead of manual polling, confirm:

- Real Twilio number set on `organization_phone_settings.twilio_number` for the org — a
  demo/fake fallback number must never be active for an org taking real traffic.
- A2P registration gate: `a2p_registered = true` before `sms_enabled = true`; sending on an
  unregistered number risks carrier filtering, which would show up as false `delivery_failure`
  alert noise rather than a real product signal.
- `sms_enabled` correctness matches what the org actually pays for/has agreed to.
- Opt-out behavior verified: a `STOP` reply is honored (`communication_opt_outs`) and does not
  itself generate a `delivery_failure` alert (it is a deliberate customer choice, not a failure).
- ⚠️ **`staffed_fallback_phone` is an unimplemented column — do not treat it as a gate.** Migration
  `0054` adds it to `organization_phone_settings`, but **no application code reads or writes it**
  (the only repository references are that migration and documentation). Provisioning a value
  satisfies a checkbox and delivers nothing. Until a consumer exists, the escalation destination for
  `critical`-severity alerts (currently `safety_flag`) must be named in the pilot runbook as a
  **specific human and phone number**, not a database column.
- Cron wired with correct secret handling: `apps/intake-web/vercel.json` declares
  `{ "path": "/api/cron/dispatch-sweep", "schedule": "0 8 * * *" }`, and `CRON_SECRET` is set
  in the Vercel project's Production environment variables. Vercel automatically sends
  `Authorization: Bearer $CRON_SECRET` on cron-triggered invocations of a route when an env var
  named exactly `CRON_SECRET` exists in the project — which is what `/cron/dispatch-sweep`
  already checks via `hmac.compare_digest`. Outside production, an unset `CRON_SECRET` leaves the sweep at `503`;
  production refuses to start without a valid value. Confirm a real cron invocation returns `200`
  with an `"alerts"` count in the response body, don't just trust the cron entry exists.
- ⚠️ **The cron runs once per day (`0 8 * * *`), and lazy cleanup does not cover most of what it
  does.** The current Vercel plan supports daily cron, not the earlier five-minute schedule.
  `GET /ops/queue` and `GET /provider/queue` call only `expire_stale_offers` and
  `auto_close_pending` inline. Everything else in `/cron/dispatch-sweep` has the cron as its **only**
  caller, so each runs at most once per 24h:
  - `_evaluate_dispatch_alerts` — `stalled_job` and `stuck_offer` alert rows are not created
    intraday. **The alert inbox is not a live monitoring surface during a staffed window; poll the
    queue endpoints instead.**
  - `activate_due_scheduled_jobs` — a confirmed scheduled appointment is not auto-dispatched until
    the next 08:00 UTC run (up to ~24h late). Dispatchers must activate due appointments manually
    via `POST /provider/queue/{job_id}/activate-schedule`; such jobs are visible in the provider
    queue. See `PILOT-OPERATIONS.md` for the required polling cadence.
  - `reap_stale_technicians` — a technician whose heartbeat died stays offerable for up to 24h.
  - `poll_push_receipts` — push delivery state resolves at most daily.
- No demo/fake number fallback for any org taking real traffic — `TWILIO_DEFAULT_FROM_NUMBER`
  should only ever be hit for orgs that are explicitly still in the internal/synthetic pilot.

## Release gate

Do not enable real customer traffic until:

- The E2E smoke test passes with synthetic data.
- No real customer PII appears in logs/docs/screenshots.
- The provider understands that ClueXP records collection details but does not process payment.
- Any known deferred items are explicitly accepted for the pilot.
