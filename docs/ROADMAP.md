# ClueXP Product Roadmap

> **Updated:** 2026-06-07
> **Product objective:** deliver a production-safe business cycle from urgent
> customer request through verified fulfillment, customer confirmation, review,
> operational resolution, and job closure.
>
> Durable product rules live in `SPEC.md` and `docs/adr/`. Current task status
> and acceptance gates live in `docs/EXECUTION-PLAN.md`. Historical UI build
> plans are implementation references, not status boards.

## Product Position

ClueXP is a neutral, multi-tenant dispatch network for urgent local services.
It routes demand to verified provider organizations and independent
technicians; it does not compete with providers as a service company.
Locksmith/access is the first vertical.

Every job preserves three independent business axes:

- **Origin:** who brought the request.
- **Customer owner:** who owns the customer relationship.
- **Fulfillment:** the organization and named technician performing the work.

Customer privacy is controlled by `trust_state`
(`INTAKE -> MATCHED -> FULFILLMENT`). Operational progress is controlled by the
job lifecycle. These fields must never be merged.

## Current Product Baseline

### Production-capable

- Multi-tenant customer intake, trusted intake-channel resolution, geocoding,
  job persistence, and private photo upload.
- First-party FastAPI/Postgres authentication for technicians, provider users,
  and ClueXP staff.
- Technician and provider registration, platform approval/rejection, teams,
  workspace management, compliance document upload/review, technician
  availability, and location updates.
- English and Spanish localization foundation across all four apps.
- Deterministic dispatch ranking, privacy-safe offers, offer expiry/re-dispatch,
  and atomic first-accept-wins.
- Authenticated technician offer delivery and acceptance.
- Read-only customer waiting/matched tracking with safe assignment data.
- Separate production deployments for intake, technician, provider, and ops.

### Partial or prototype

- The live intake flow still retains the legacy instant-match route; the real
  offer/accept path is not yet the default customer journey.
- Technician active-job, arrival, service, communication, completion, earnings,
  and history screens are substantially built but mostly mock-driven.
- Provider and ops operational consoles have production shells and some real
  onboarding/compliance functions, while job operations remain largely
  mock-driven.
- Maps render, but traffic-aware ETA, durable live movement, and arrival proof
  are not complete.

### Not production-complete

- Secure customer tracking capability token.
- Technician lifecycle mutations from en route through completion.
- Customer completion confirmation, ticket-scoped review, and dispute.
- Dispatcher dispute resolution and manual close.
- Automatic closure after the customer response window.
- Reliable SMS/email/push delivery and masked communications.
- Real payments, settlement, refunds, and invoicing.
- Full operational observability, retention, and disaster-recovery practice.

## Delivery Principles

1. Finish one real end-to-end cycle before broadening the feature surface.
2. Ship backend capabilities behind per-channel flags and pilot before widening.
3. Keep customer polling read-only; only dispatch services create offers.
4. A technician may report work complete, but only the customer, dispatcher, or
   timeout policy closes the customer-confirmation boundary.
5. Do not expose candidate identities, customer PII, internal scoring, or
   cross-tenant data.
6. Do not treat a polished mock screen as a functioning business capability.
7. Payments follow a stable fulfillment lifecycle; they do not define it.
8. API extraction is architectural work, not a prerequisite for closing the
   first production cycle unless the current deployment shape blocks delivery.

## Prioritized Release Sequence

### Release 1 - Fulfillment Cutover

**Outcome:** one pilot intake channel completes a real request-to-close cycle
without the legacy instant-match, demo finalize, or demo review path.

- Add tracking capability token and expanded lifecycle statuses/timestamps.
- Add channel-level cutover flag and emergency global kill switch.
- Add token-gated customer tracking, confirm, review, and dispute endpoints.
- Add assigned-technician-only forward status transitions.
- Add dispatcher resolution/manual-close endpoint.
- Add 72-hour automatic close to the scheduled sweep.
- Connect intake tracking and technician completion UI to those contracts.
- Pilot one channel, run the full acceptance matrix, then widen by channel.

This is the immediate product priority. Detailed contract:
`docs/SPRINT-2B-CUTOVER-PLAN.md`.

### Release 2 - Field Fulfillment Integrity

**Outcome:** customers and dispatchers can trust where the technician is and
whether arrival and service milestones actually occurred.

- Traffic-aware Routes API ETA.
- Active-job location pings and customer-safe live polling.
- Real technician active-job read model and status restoration.
- Mutual arrival verification with audited PIN/QR/dispatcher override.
- Cancellation and no-show rules.
- Production job timeline shared by customer, technician, provider, and ops.
- Remove remaining mock active-job transitions from the real path.

### Release 3 - Human Operations and Communications

**Outcome:** a dispatcher can observe, contact, reassign, escalate, resolve, and
audit any live or disputed job.

- Wire ops and provider queues, job detail, board, and timeline to real data.
- Real reassignment, cancellation, escalation, dispute resolution, and notes.
- Tenant-scoped provider operations and platform-wide ClueXP operations.
- Masked customer/technician messaging and call handoff.
- SMS/email delivery of the customer tracking link and critical status changes.
- Reliable technician offer notifications; retain polling fallback.

### Release 4 - Commercial Completion

**Outcome:** a completed job can be authorized, charged, settled, refunded, and
reconciled safely.

- Decide merchant-of-record and provider/independent settlement policy.
- Stripe payment method and authorization hold.
- Final-price approval when scope exceeds the estimate.
- Idempotent capture, cancellation/no-show fees, refunds, and disputes.
- Provider/technician settlement visibility and customer receipt.
- Replace demo earnings and payment surfaces with ledger-backed data.

### Release 5 - Trust, Compliance, and Scale

**Outcome:** dispatch eligibility, data handling, and operations are safe enough
for broader geographic and vertical expansion.

- Enforce required, valid, non-expired documents in dispatch eligibility.
- Jurisdiction-specific licensing and insurance rules.
- Customer phone verification and returning-customer history policy.
- PII/media retention, audit archival, backup restore drills, and incident runbook.
- Error tracking, API health checks, dispatch/payment alerts, and SLOs.
- Complete CI coverage for Python tests and all four app builds.
- Reconcile fulfillment-policy names across organization, channel, and job data.
- Extract the shared API when operational load or client needs justify it.

### Release 6 - Expansion

**Outcome:** ClueXP can add new urgent-service verticals and provider business
models without weakening the first production cycle.

- Service-vertical configuration and eligibility rules.
- Custom domains and expanded intake channels.
- Provider subscription and billing.
- Advanced organization-managed routing and capacity controls.
- Native technician app only where background GPS/push reliability requires it.
- Additional languages using the established locale framework.

## Business Readiness Gates

| Gate | Required evidence |
|---|---|
| Dispatch-ready | Real request creates offers; eligible technician accepts; no privacy leak; first-accept-wins proven |
| Fulfillment-ready | Assigned technician progresses through audited statuses; customer sees truthful state |
| Closure-ready | Customer confirms, reviews, or disputes through a secure token; timeout and dispatcher resolution work |
| Revenue-ready | Payment authorization/capture/refund and settlement are idempotent and reconciled |
| Scale-ready | Compliance blocks invalid supply; tenant isolation, monitoring, retention, backups, and incident response are tested |

The next release gate is **Closure-ready**, not more mock screen coverage.
