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
- `ARRIVAL_PIN_SECRET` set to a high-entropy secret.
- `CRON_SECRET` set if scheduled sweeps are enabled.
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

## Release gate

Do not enable real customer traffic until:

- The E2E smoke test passes with synthetic data.
- No real customer PII appears in logs/docs/screenshots.
- The provider understands that ClueXP records collection details but does not process payment.
- Any known deferred items are explicitly accepted for the pilot.
