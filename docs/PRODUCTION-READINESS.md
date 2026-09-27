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
- Provider communications remain disabled with `COMMUNICATIONS_PROVIDER=noop`; do not configure
  provider-number assignment, voice callbacks, forwarding, or call-center operation.
- ClueXP digital verification SMS remains disabled until its separate rollout gate:
  `CLUEXP_SMS_PROVIDER=noop`, `CLUEXP_VERIFICATION_SMS_ENABLED=false`,
  `CLUEXP_SMS_STATUS_WEBHOOK_ENABLED=false`,
  `CLUEXP_A2P_REGISTERED=false`, and `CLUEXP_PHONE_VERIFICATION_REQUIRED=false`.
- Twilio credentials and the future `CLUEXP_VERIFICATION_FROM_NUMBER` remain server-side only.
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

The MCP server is public, read-only provider discovery (`specs/003`, phase 1): `list_services` and
`find_providers`, with no sign-in. **The phase 1 cutover is live as of 2026-09-27**; see `specs/003`
tasks T020/T023 for the executed record. The checklist below is kept as the cutover procedure; the
open items are T021 (first provider opt-in, with written consent), T022 (Auth0 dev-tenant
decommission), and the per-assistant UI runs in T018:

- Apply migration `0061_intake_channel_ai_listing` (additive, default off; listing nobody until a
  channel is flagged). Code deployed before the migration fails closed and lists nobody.
- Create one production external API client/key with only `services:read` and `providers:search`, and
  set it as `CLUEXP_API_KEY` in the Vercel project `cluexp-mcp-server`.
- Remove `CLUEXP_MCP_OAUTH_*` and `CLUEXP_MCP_BEARER_TOKEN` from that project's environment.
- Add a Vercel Firewall rate-limit rule on `/mcp` (per IP).
- Deploy the MCP server from a reviewed commit (git-connected), not from a local CLI working tree.
- `mcp-production-health` already handles both modes. Once `/mcp` is public it calls `list_services`
  and fails on an API error or empty catalog; while the sign-in build is live it checks the 401
  boundary. After cutover, confirm the run summary says "public discovery OK", then remove the
  transitional 401 branch.
- After deploy, confirm:
  - `https://mcp.cluexp.com/healthz` returns `200 {"status":"ok"}`;
  - an unauthenticated MCP `initialize` succeeds;
  - `find_providers` returns an empty list until the first opt-in;
  - `external_api_events` rows for `provider_matches.search` contain no address or coordinates.
- Flag the first provider channel (`intake_channels.ai_assistant_listed = true`) only on that
  provider's written request (HD-6).
- For OpenAI submission, set `OPENAI_APPS_CHALLENGE_TOKEN` only after the portal provides the exact
  token, redeploy, and verify `https://mcp.cluexp.com/.well-known/openai-apps-challenge` returns only
  that token as `text/plain`.
- Decommission the Auth0 dev-tenant API/client used by the removed OAuth path.

## Alerting (migration 0054)

### Digital verification SMS scope

ClueXP currently targets digital intake channels only. Providers operate their own phone lines and call centers; ClueXP does not provision or answer provider calls. The ClueXP platform number is reserved for phone verification and secure intake-link delivery and must not be assigned to an organization.

Before any verification SMS rollout:

- Keep `COMMUNICATIONS_PROVIDER=noop`; provider voice/SMS routes remain dormant.
- Apply migration `0060_intake_phone_verification` only after explicit production-DDL authorization.
- Verify the ClueXP A2P Brand and Campaign are complete.
- Deploy with `CLUEXP_SMS_PROVIDER=noop`, `CLUEXP_VERIFICATION_SMS_ENABLED=false`, `CLUEXP_A2P_REGISTERED=false`, `CLUEXP_PHONE_VERIFICATION_REQUIRED=false`, and `CLUEXP_SMS_STATUS_WEBHOOK_ENABLED=false` first.
- Activate delivery-status callbacks only after fresh explicit authorization; SMS enablement alone leaves them off.
- Separately authorize the exact platform sender and activation of `CLUEXP_SMS_PROVIDER=twilio` plus the verification/A2P flags.
- Never enable required verification before the sender path is healthy; doing so would block intake completion.
- Verify expiry, one-time consumption, resend limits, opt-out behavior, delivery callbacks, cross-device resume, and dispatch deferral with an explicitly authorized test target.
- Do not configure voice callbacks, provider-number assignment, marketing messages, or conversational SMS as part of this rollout.

### Provider communications foundations are deferred

The provider Twilio number, voice forwarding, masked calling, provider alert SMS, and staffed
fallback fields remain implemented foundations only. They are not current launch gates and must
remain dormant with `COMMUNICATIONS_PROVIDER=noop`. Do not assign the shared ClueXP number to an
organization or configure provider voice/SMS callbacks. A future product decision and separately
authorized production plan must define provider-owned numbers, A2P, consent, opt-out, staffing,
and monitoring before any of these paths can carry traffic.

For the in-product dispatcher alert inbox (`GET /provider/alerts`), confirm:

- ⚠️ **`staffed_fallback_phone` is a deferred, unconsumed column — do not treat it as a gate.**
  Migration `0054` adds it to `organization_phone_settings`, but no application code reads or writes
  it. The escalation destination for `critical`-severity alerts (currently `safety_flag`) must be
  named in the pilot runbook as a **specific human and phone number**, not a database column.
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

## Release gate

Do not enable real customer traffic until:

- The E2E smoke test passes with synthetic data.
- No real customer PII appears in logs/docs/screenshots.
- The provider understands that ClueXP records collection details but does not process payment.
- Any known deferred items are explicitly accepted for the pilot.
