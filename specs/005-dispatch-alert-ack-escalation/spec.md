# Feature Specification: Dispatcher Alert Acknowledgement And Escalation

**Feature Branch**: `feat/005-dispatch-alert-ack-escalation`
**Spec Directory**: `specs/005-dispatch-alert-ack-escalation`
**Created**: `2026-09-27`
**Owner**: `Codex lead with Claude secondary review and Human SLA decisions`
**Status**: `implemented for review with escalation default-off; production migration and activation remain unauthorized`

## Summary

Provider dispatchers need a durable, tenant-scoped acknowledgement and escalation marker for operational alerts. This pilot records backend-generated alerts, provider acknowledgement/resolution, and a durable SLA-breach timestamp while preserving ClueXP Ops as read-only oversight. It does not implement staffed schedules, role-targeted delivery, or after-hours routing.

The current repo already includes an `alerts` table, provider list/ack/resolve endpoints, read-only platform `/admin/alerts`, alert creation hooks, provider inbox UI, and sweep-driven stalled/stuck-offer evaluation. This slice adds the durable pilot behavior and records the production routing decisions that remain deferred.

## Human Decisions Recorded

- **Acknowledgement target**: 5 minutes for all operational alerts during staffed hours.
- **Stalled-job threshold**: 30 minutes.
- **Future coverage model**: provider-configured staffed schedule; storage/UI and any temporary default remain deferred.
- **Future recipient model**: all dispatchers first-line and provider admins as backup; this pilot records that intended policy as audit metadata but does not perform role-targeted delivery.
- **Delivery authorization for this phase**: browser notifications plus durable provider inbox are authorized for implementation/testing; email/SMS fallback may be implemented but must remain disabled until separate production authorization. No live production sends are authorized by this spec.
- **Schema decision**: use the existing `alerts.escalated_at` plus structured `alerts.payload.escalation` for the pilot audit trail; prepare migration `0062_dispatch_alert_sla_defaults` to align the DB-backed `dispatch_stalled_minutes` default with the approved 30-minute threshold only when production DDL is separately authorized.
- **Cron cadence decision**: this local pilot does not change the existing `/api/cron/dispatch-sweep` cadence because that cron also drives scheduled dispatch/offer/customer-message side effects and the current documented Vercel deployment may reject `*/5` schedules. Meeting the 5-minute acknowledgement SLA in production requires a separate Human-approved scheduler decision or a split alert-only sweep route.

## Scope

### In Scope

- Resolve the organization-scoped acknowledgement target from existing settings and prepare the separately gated 30-minute stalled-threshold migration.
- Make alert acknowledgement auditable and explicit enough for operations: who acknowledged, when, what alert/job, current status, escalation state, and resolution.
- Mark eligible open, unacknowledged alerts escalated exactly once after the configured SLA and record intended future delivery policy without claiming delivery.
- Preserve existing tenant-scoped provider alert inbox and add missing UX/API fields needed to show acknowledgement/escalation state.
- Maintain ClueXP Ops as read-only oversight across organizations.
- Verify background generation for `new_job`, `stalled_job`, `stuck_offer`, `safety_flag`, `delivery_failure`, and `customer_help_request` without triggering live production communications.
- Document the pilot boundary and the scheduler, staffed-hours, and recipient-routing work required before production activation.

### Out Of Scope

- Production deployment, production migrations, production alert activation, or live external notification sends.
- Giving ClueXP Ops the ability to acknowledge, resolve, assign, cancel, recover, or dispatch provider jobs.
- General customer-technician chat, provider call-center automation, masked calling, payments, or public `/v1`/MCP contract changes.
- Final implementation of a new notification provider if existing noop/Twilio/push seams are insufficient; this spec may identify a future provider-specific slice.
- Provider-configured staffed schedule storage/UI, role-targeted dispatcher/provider-admin delivery, and after-hours fallback execution.
- Changing customer-visible technician identity, ETA, tracking, price, fee, or final charge display.

## Local Implementation Notes And Deferred Scope

- Implemented now: durable provider alert acknowledgement/resolution; idempotent open-alert escalation when the sweep runs and an alert exceeds the configured 5-minute acknowledgement SLA; default-off server gate `DISPATCH_ALERT_ESCALATION_ENABLED`; a production-gated migration for the approved 30-minute stalled-job platform default; provider Messages UI for open/acknowledged/resolved/escalated states; browser notifications as local console-only adjuncts; audit payload records intended delivery policy separately from actual delivery attempts. The code fallback remains 15 minutes until the migration or an environment/organization override is explicitly applied.
- Deferred/open for a later Human decision and slice: production scheduler/cadence for the 5-minute SLA, provider-configured staffed schedule storage/UI, exact temporary staffed-hours default beyond the existing source cron cadence, exact after-hours fallback behavior, normalized alert delivery-events table, and real provider-admin/email/SMS routing.
- Until an external/server-observable delivery provider is authorized, `payload.escalation.delivery_attempts` remains empty and browser notifications must not be treated as proof of delivery.

## Users And Scenarios

### Primary Scenario

1. Given a provider-owned job creates a backend alert
2. When no authorized provider user acknowledges the alert within the configured SLA and the default-off escalation gate is enabled
3. Then the alert remains tenant-scoped, records one durable SLA-breach timestamp plus intended future delivery-policy metadata, and remains visible to provider operations until acknowledged/resolved.

### Edge And Failure Scenarios

- A dispatcher from another organization cannot see, acknowledge, resolve, or infer the alert; foreign alert mutations return not-found semantics.
- A platform admin can list open/acknowledged/resolved alerts across organizations for oversight but cannot acknowledge or resolve them.
- Duplicate sweep runs do not create duplicate open alerts for the same `(organization, job, alert_type)`.
- After-hours alerts remain in the durable provider inbox; no staffed-console or fallback-delivery claim is made in this pilot.
- Missing schedule/routing configuration cannot select a recipient or trigger a cross-tenant fallback because external routing is not implemented.
- No notification-provider attempt is recorded; browser notifications remain local to an authorized user viewing the provider inbox.
- Acknowledgement does not resolve the underlying job condition; resolution remains a separate explicit action.

## Requirements

### Functional Requirements

- **FR-001**: The system must derive the organization-scoped acknowledgement target from existing settings and prepare, without applying, the separately authorized 30-minute stalled-threshold migration.
- **FR-002**: Provider dispatchers and provider admins may list, acknowledge, and resolve only alerts belonging to their active organization.
- **FR-003**: Platform admins may list alerts across organizations for oversight only; no platform-admin alert acknowledgement or resolution route may be added in this slice.
- **FR-004**: Acknowledging an alert must record the actor and timestamp and must not imply job assignment, dispatch, cancellation, customer confirmation, or payment state.
- **FR-005**: Resolving an alert must be separate from acknowledgement and must preserve acknowledgement/escalation audit fields.
- **FR-006**: When the default-off escalation gate is enabled, eligible open alerts that exceed the configured acknowledgement SLA must be marked escalated exactly once and must record enough evidence to audit when/why escalation occurred.
- **FR-007**: The pilot may record intended future recipient roles (`dispatchers`, then `provider_admins`) as audit metadata, but must not perform role-targeted or external delivery. Browser notifications are limited to an already-authorized provider user viewing that organization's inbox; ClueXP Ops never acts as dispatcher.
- **FR-008**: The provider UI must distinguish open, acknowledged, resolved, escalated/SLA-breached states and the existing `delivery_failure` alert type.
- **FR-009**: Background evaluation must cover threshold-driven `stalled_job` and `stuck_offer` alerts, and the plan must preserve existing inline alert creation for `new_job`, `safety_flag`, `delivery_failure`, and `customer_help_request`.
- **FR-010**: Browser notifications plus the durable provider inbox may be implemented and locally tested. Email/SMS fallback may be implemented only behind disabled gates/noop tests until the Human explicitly authorizes the exact production target/channel.
- **FR-011**: Alert APIs must keep existence-hiding behavior for foreign/missing alerts.
- **FR-012**: If database schema changes are required, they must include migration/RLS review and offline Alembic validation before implementation is accepted.

### Non-Functional Requirements

- **NFR-001**: Tenant isolation and provider-managed dispatch boundaries are release blockers.
- **NFR-002**: Alert state must be durable across browser restarts; an open provider console is not a delivery guarantee.
- **NFR-003**: The workflow must be idempotent under repeated cron/sweep execution and concurrent alert creation.
- **NFR-004**: Alert audit data must avoid raw secrets, raw tokens, and unnecessary customer PII.
- **NFR-005**: Local verification must include API tests for auth/tenant behavior and frontend build/typecheck coverage for touched workspaces.
- **NFR-006**: Alert delivery monitoring must distinguish sent, delivered/acknowledged, failed, escalated, and resolved states where the provider/channel can supply that evidence.

## Data, API, And Trust Boundaries

- **Data touched**: Existing `alerts` table from migration `0054_alert_escalation`, `global_settings.dispatch_stalled_minutes`, existing organization overrides, `alerts.escalated_at`, and structured `alerts.payload.escalation`. Migration `0062` adds unresolved-alert uniqueness indexes; no owner assignment or delivery-events table is added.
- **API contracts**: Existing private `/provider/alerts`, `/provider/alerts/{alert_id}/ack`, `/provider/alerts/{alert_id}/resolve`, and `/admin/alerts`; possible private provider/admin configuration endpoints only if needed. No public `/v1` change is expected.
- **Trust-state/privacy rules**: Alert UI must not invent technician identity, ETA, live tracking, price, fee, payment, or dispatch acceptance. Customer-visible state remains backend-derived.
- **Tenant isolation**: All provider mutations are scoped by `session.active_organization_id`; platform admin views are read-only; foreign alert access returns 404/not-found style responses.
- **Dispatch state**: This workflow observes and escalates operational alert state only. It must not create offers, assign technicians, recover jobs, cancel jobs, or transition `jobs.status`.
- **Payments/closeout**: Not applicable.
- **External side effects**: Browser notifications are authorized for implementation/testing as a provider-console adjunct to durable inbox state. Email/SMS fallback may be implemented behind disabled gates and fake/noop tests. Real SMS/voice/push/email production sends require separate Human authorization naming the channel, target, and environment.

## ClueXP-Specific Checks

- **Trust-state rule**: Backend alert state can tell dispatchers that a job needs attention; it cannot expose unverified customer-facing claims or cause the UI to make up technician/ETA/tracking/payment values.
- **Provider-managed dispatch rule**: The owning provider acknowledges and resolves its own alerts. ClueXP Ops remains read-only oversight and does not dispatch.
- **Public `/v1`/MCP rule**: Not applicable unless implementation later exposes alert status through public clients or MCP; that would require a separate contract review.
- **Migration/RLS rule**: Any schema addition touching alerts, organization settings, or notification evidence requires migration/RLS review, default-deny consideration, and secondary-agent approval.
- **Generated artifacts**: Update generated TypeScript/OpenAPI only if the canonical Pydantic schema or public contract changes; expected to be not applicable for the initial private provider/admin route slice.

## Acceptance Criteria

- [x] The pilot implements the 5-minute acknowledgement marker and separately gated 30-minute stalled-threshold migration while explicitly deferring staffed schedules, role-targeted delivery, and after-hours fallback execution.
- [x] Provider alert UI shows open/acknowledged/resolved/escalated states from backend data, not local browser-only timers. SLA-breached is represented by durable `escalated_at` in this pilot.
- [x] API tests prove owning provider can list/ack/resolve, foreign provider cannot infer/mutate, technician/customer actors cannot access, and platform ops remains read-only.
- [x] Background sweep tests prove open alert creation/escalation is idempotent and threshold-driven.
- [x] Delivery/notification tests use durable provider inbox/browser-only local behavior and do not send production SMS/voice/push/email; actual delivery attempts remain empty until a server-observable provider is authorized.
- [x] Migration/offline Alembic checks pass for the added default migration; local Postgres/RLS execution remains a CI/production gate when database credentials are available.
- [ ] The exact final commit must receive an independent different-family implementation review recorded in the pull request before merge.
- [x] Production escalation activation remains disabled by default via `DISPATCH_ALERT_ESCALATION_ENABLED` until the Human separately authorizes rollout; any live communication target still requires separate authorization.

## Risks, Assumptions, And Human Decisions

- **Risks**: Treating browser notification permission as durable delivery; duplicate cron escalation; leaking cross-tenant alert existence; conflating acknowledgement with job recovery; prematurely enabling live email/SMS fallback; schema drift around alert payloads; local Node is currently below the documented Node 24 requirement. A transaction-scoped advisory lock serializes each logical alert key before migration `0062`; the migration adds unresolved-alert unique indexes and will fail safely if historical duplicate unresolved rows need operator cleanup. The 15-to-30-minute stalled threshold changes only when migration `0062` is explicitly applied or an environment/organization override is configured.
- **Assumptions**: Existing `0054_alert_escalation` schema and provider alert endpoints are the starting point; `docs/EXECUTION-PLAN.md` Sprint 5 is canonical; ClueXP Ops observes but does not act on provider dispatch.
- **Human decisions needed**: Authorize the production scheduler/cadence for the 5-minute SLA without unintentionally changing scheduled dispatch side effects; define the temporary pilot staffed schedule default; decide exact after-hours fallback behavior within the approved provider-configured schedule model; authorize production migration/deployment; separately authorize any live email/SMS fallback target/channel.
