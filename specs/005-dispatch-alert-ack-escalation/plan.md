# Implementation Plan: Dispatcher Alert Acknowledgement And Escalation

**Spec**: `specs/005-dispatch-alert-ack-escalation/spec.md`
**Branch**: `feat/005-dispatch-alert-ack-escalation`
**Owner**: `Codex lead with bounded Claude implementation/review as assigned`
**Review Mode**: `final different-family implementation approval required because Codex and Claude authored changes`

## Technical Approach

Build on the existing alert foundation instead of replacing it:

- `packages/db/alembic/versions/0054_alert_escalation.py` already creates `alerts` with `status`, `acknowledged_by`, `acknowledged_at`, `resolved_at`, and `escalated_at`.
- `apps/intake-web/api/main.py` already exposes tenant-scoped provider list/ack/resolve routes and read-only platform `/admin/alerts`.
- `_evaluate_dispatch_alerts()` already creates threshold-driven `stalled_job`/`stuck_offer` alerts during `/cron/dispatch-sweep`.
- `apps/provider-web/src/app/messages/page.tsx` already loads open provider alerts and can acknowledge/resolve them from the provider UI.
- `apps/intake-web/api/tests/test_alerts.py` already covers base tenant/auth behavior and should be extended, not discarded.

The implementation makes the acknowledgement target explicit, adds durable escalation evaluation, and exposes the minimal UI/API evidence needed for provider users and ops to see acknowledgement/escalation truth. Browser notifications are a provider-console adjunct to durable inbox state. Staffed schedules, role-targeted delivery, after-hours fallback, email, and SMS remain deferred.

## Approved Policy Inputs

- **Acknowledgement target**: 5 minutes for all operational alerts during staffed hours.
- **Stalled-job threshold**: 30 minutes.
- **Future coverage model**: provider-configured staffed schedule; storage/UI and a temporary default remain deferred.
- **Future recipient model**: all active dispatchers first; provider admins as backup. This pilot records those role labels as intended policy only and does not deliver by role.
- **Delivery model**: durable provider inbox plus browser notifications are in scope for implementation/testing. Email/SMS fallback remains out of this implementation until separately authorized.

## Affected Surfaces

- **Frontend**: `apps/provider-web/src/app/messages/page.tsx`; possibly provider queue/dashboard surfaces if product chooses alert banner/counts outside Messages; shared console components only if needed for reusable alert badges.
- **Backend/API**: `apps/intake-web/api/main.py`, store methods for alert policy/escalation, alert serialization, dispatch sweep; possibly configuration/settings helpers.
- **Database/storage**: Existing `alerts` and `organization_settings` for per-org thresholds; migration `0062_dispatch_alert_sla_defaults` adds unresolved-alert uniqueness indexes and updates the untouched DB-backed `dispatch_stalled_minutes` platform default from 15 to 30 when separately authorized and applied. The code fallback stays at 15 so merging default-off code does not activate the threshold change. The pilot uses existing `alerts.escalated_at` plus `payload.escalation.delivery_policy`; actual `delivery_attempts` remain empty because no server-observable provider delivery is authorized. No normalized delivery-events table is introduced in this slice.
- **Docs/operations**: Update this spec/checklist as implementation decisions settle; possibly `docs/EXECUTION-PLAN.md`, `docs/PILOT-OPERATIONS.md`, or `docs/PRODUCTION-READINESS.md` after implementation acceptance.
- **CI/release**: Existing `api`, `web`, `sdlc-policy`, `secret-scan`, and `mcp-server` gates remain required. This slice is high-risk by policy because it touches dispatch/communications/production readiness.

## Contracts And Invariants

- Provider alert mutations are scoped to `session.active_organization_id` through `_require_dispatch_org` and `_require_org_alert`-style checks.
- Missing or foreign alerts return not-found semantics; no cross-tenant existence leak.
- Platform `/admin/alerts` remains read-only. ClueXP Ops does not acknowledge, resolve, assign, cancel, or recover provider jobs.
- Acknowledgement is not resolution. Resolution is not job-state transition. Neither creates dispatch offers or modifies customer-visible tracking.
- `alerts.status` remains the backend source of truth; UI timers can decorate but cannot invent durable SLA state.
- Escalation must be idempotent: repeated sweeps and concurrent creation do not duplicate unresolved alert rows or stamp the same escalation event twice.
- Public `/v1`, MCP, generated OpenAPI, and generated schema artifacts should remain unchanged unless a later implementation decision explicitly crosses that boundary.

## Proposed Implementation Phases

1. **Discovery and policy confirmation**
   - Translate the pilot values into code/config: 5-minute acknowledgement target and a separately gated 30-minute stalled-threshold migration.
   - Inspect existing store implementations for `create_alert`, `acknowledge_alert`, `resolve_alert`, `list_alerts`, and Postgres parity.
   - Record that existing `alerts.escalated_at` + `payload.escalation` hold required pilot audit evidence; a normalized delivery-events table is deferred until real external delivery evidence is authorized.

2. **Backend alert policy and escalation evaluation**
   - Add explicit policy resolution helper using per-org setting(s) with platform defaults.
   - Add escalation evaluator for open, unacknowledged alerts whose age exceeds policy.
   - Mark `escalated_at` and record the SLA calculation plus intended future delivery policy once, without recording an actual delivery attempt.
   - Record intended future recipient-role labels as metadata only; do not implement staffed-hours routing or external sends.

3. **Provider UI evidence**
   - Show alert SLA state, acknowledged timestamp/actor when available, escalated marker, and failure/delivery evidence if available.
   - Preserve existing ack/resolve actions and no cross-org data assumptions.
   - Add manual refresh/empty/error states as needed.

4. **Ops oversight**
   - Ensure `/admin/alerts` exposes enough read-only state to see missed acknowledgements and escalations.
   - Do not add admin mutation routes.

5. **Verification and review**
   - Extend API tests for SLA breach/escalation/idempotency and tenant/auth boundaries.
   - Run focused API tests, compile checks, frontend build/typecheck for touched workspaces, and SDLC policy gate.
   - Obtain independent secondary-agent review before merge.

## Verification Plan

- **Unit/integration**:
  - `cd apps/intake-web && uv run --with-requirements requirements.txt --with pytest pytest api/tests/test_alerts.py -q`
  - If alert code touches broader dispatch sweep behavior: `cd apps/intake-web && uv run --with-requirements requirements.txt --with pytest pytest api/tests -q --ignore=api/tests/test_postgres_security.py`
- **Type/build**:
  - `npm run typecheck`
  - `npm run build --workspace @cluexp/provider-web`
  - If shared console UI changes: `npm run test --workspace @cluexp/console-ui` and `npm run build:provider`
- **Migration/data**:
  - Migration added: `uv run --with alembic --with "sqlalchemy>=2" --with psycopg alembic -c packages/db/alembic.ini upgrade head --sql`
  - If migration added and local Postgres available: run the CI Postgres/RLS sequence before merge.
- **Tenant/RLS**:
  - Extend `api/tests/test_alerts.py` for foreign provider 404, technician/customer denial, platform read-only, and escalation idempotency; add Postgres concurrency coverage for unresolved-alert deduplication.
  - If DB schema changes: add/adjust Postgres security coverage for alert rows/settings.
- **Public contract drift**:
  - Expected not applicable. If any public schema/API changes occur, run `cd apps/intake-web && uv run --with-requirements requirements.txt python scripts/export_openapi_v1.py --check` and regenerate/check types as appropriate.
- **Manual/browser/mobile**:
  - Provider dispatcher sees alert card, SLA-breached marker, escalated marker, ack action, resolve action, and empty/error states.
  - Platform ops sees cross-org alert state read-only and cannot mutate.
  - No customer/technician-facing screen shows invented dispatch or ETA information.
- **Security/privacy**:
  - Verify no raw secrets/tokens/phone numbers are logged in alert payloads beyond already-approved redacted operational evidence.
  - Verify no live SMS/voice/push/email sends occur without explicit Human authorization. Browser notifications remain console-local/user-permission-bound and do not replace durable inbox state.

## Rollout And Rollback

- **Flags/config**:
  - Use per-org settings for SLA and thresholds where possible.
  - Keep email/SMS fallback delivery disabled/noop by default.
  - Do not rely on browser notification permission as the only durable delivery path.
- **Production approval needed**: `yes` for any production migration, deployment, environment/config mutation, or live notification channel.
- **Escalation activation gate**: `DISPATCH_ALERT_ESCALATION_ENABLED` defaults off. Production must not enable it without Human approval of rollout, scheduler cadence, and any live external notification channel.
- **Stalled-threshold activation gate**: merging the code does not change the 15-minute runtime fallback. Applying migration `0062`, setting `DISPATCH_STALLED_MINUTES`, or setting an organization override to 30 remains a separate production action.
- **Rollback path**:
  - Disable the escalation marker flag.
  - Revert UI to inbox-only display while keeping alert rows readable.
  - If a migration is added, document downgrade and safe data retention behavior before applying production DDL.

## Open Questions

- What temporary pilot staffed schedule default should be used until provider-specific hours are configured?
- What exact after-hours fallback behavior should apply under the provider-configured schedule model?
- Should `acknowledged` alerts remain visible until resolved, or should the provider inbox default to open-only with filters for acknowledged/resolved?
- A normalized `alert_delivery_events` table is deferred until real external delivery evidence is authorized; this slice records the intended delivery policy and durable escalation timestamp only, not claimed browser delivery.
- Production scheduler/cadence for the 5-minute acknowledgement SLA, provider-configured staffed schedule storage/UI, and exact after-hours fallback behavior remain open Human-decision items. The existing `/api/cron/dispatch-sweep` cadence is intentionally unchanged in this pilot because it also drives scheduled dispatch side effects.
- Which exact email/SMS fallback provider and production target should be authorized later, if any?
