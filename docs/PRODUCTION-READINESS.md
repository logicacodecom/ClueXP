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
```

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
- `staffed_fallback_phone` (added on `organization_phone_settings` in `0054`) is configured for
  the org if `critical`-severity alerts (currently `safety_flag`) are expected to reach a human
  outside the dispatcher inbox — provisioning the actual number is an operational task per org,
  not something migration `0054` or this code does for you.
- Cron wired with correct secret handling: `apps/intake-web/vercel.json` declares
  `{ "path": "/api/cron/dispatch-sweep", "schedule": "0 8 * * *" }`, and `CRON_SECRET` is set
  in the Vercel project's Production environment variables. Vercel automatically sends
  `Authorization: Bearer $CRON_SECRET` on cron-triggered invocations of a route when an env var
  named exactly `CRON_SECRET` exists in the project — which is what `/cron/dispatch-sweep`
  already checks via `hmac.compare_digest`. Outside production, an unset `CRON_SECRET` leaves the sweep at `503`;
  production refuses to start without a valid value. The current Vercel plan supports daily cron,
  not the earlier five-minute schedule; provider/ops queue reads still perform lazy cleanup, so
  the daily cron is a safety net. Confirm a real cron invocation returns `200` with an `"alerts"`
  count in the response body, don't just trust the cron entry exists.
- No demo/fake number fallback for any org taking real traffic — `TWILIO_DEFAULT_FROM_NUMBER`
  should only ever be hit for orgs that are explicitly still in the internal/synthetic pilot.

## Release gate

Do not enable real customer traffic until:

- The E2E smoke test passes with synthetic data.
- No real customer PII appears in logs/docs/screenshots.
- The provider understands that ClueXP records collection details but does not process payment.
- Any known deferred items are explicitly accepted for the pilot.
