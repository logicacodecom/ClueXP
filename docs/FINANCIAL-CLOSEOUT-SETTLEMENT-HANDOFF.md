# Financial Closeout, Provider Fees, and Technician Settlement Handoff

Date: 2026-07-16

Audience: Codex / Claude implementation agents.

Status: Product discussion completed and first production-record implementation landed. Do not treat the operational closeout/settlement records as payment infrastructure: ClueXP still does not authorize, capture, refund, transfer, or payroll funds. This document now captures both the implemented scope and the remaining gates.

## Current repo state to verify before implementing

As of 2026-07-16, the repo supports operational financial records:

- `/jobs/{job_id}/collection` accepts itemized closeout payloads and the server calculates subtotal, tax, tip, card fee, and total.
- Provider financial defaults are configurable with platform fallback settings.
- Platform admins manage the closeout item type catalog.
- Provider admins manage provider-tech agreement rules scoped to the affiliation/company, not the global technician profile.
- Settlement rows calculate technician payout, reimbursement, and provider retained amount while excluding parts/items from commission.
- Settlement periods snapshot rows and move through `draft → locked → paid`.
- Provider reports export live settlement rows and settlement-period snapshots to CSV.
- Technician app exposes own earnings/settlement status through a technician-scoped endpoint.

Still unbuilt: processor-backed payment authorization/capture/refund, provider bank onboarding, payroll/payout execution, and processor reconciliation. UI copy must continue to state that "paid" means the provider marked external payment complete.

Implementation agents must verify current code before editing because financial state has moved quickly. Do not redo closeout/settlement records unless a later human instruction explicitly asks for redesign.

## Product goal

Build a production-grade financial closeout and settlement system that separates three linked concepts:

```text
Customer closeout = what the customer paid
Provider accounting = what the company collected, retained, owes, and reconciles
Technician settlement = what the technician earns
```

Do not collapse these into one total. The system must be auditable, reportable, exportable, and safe against silent recalculation after agreement changes.

## Customer closeout model

The technician should not enter only one total. The technician submits a receipt-like breakdown, and the server calculates all totals.

Closeout should include:

- line items
- subtotal
- tax
- tip
- card fee
- grand total
- payment method
- optional notes/receipts where required

### Line item fields

Each closeout line item should capture:

- description
- item type
- quantity
- unit price
- taxable flag, normally defaulted by item type/provider policy
- provided by:
  - company
  - technician
  - customer
  - third party
- optional note
- optional receipt/document reference for reimbursable or pass-through items

### Item type catalog

Use a managed item type catalog rather than free text only. Start with a production-ready but understandable set:

- service_fee
- labor
- diagnostic
- emergency_fee
- trip_fee
- physical_part
- hardware
- key_blank
- remote_fob
- key_code_purchase
- programming_token
- software_license
- consumable
- permit_fee
- third_party_service
- discount
- other

The catalog should support:

- code
- label
- status
- default taxable
- default compensation eligible
- default reimbursement eligible
- requires provided_by
- requires note
- requires receipt/document
- sort order

Provider overrides may later tune defaults, but the platform catalog should provide the base production taxonomy.

### Tech UX expectation

Do not expose accounting complexity directly to the technician.

The tech-facing closeout flow should feel like:

1. Add service/labor.
2. Add parts/items or key code/digital purchase if any.
3. Add discount if any.
4. Add tip if any.
5. Select payment method.
6. Review receipt total.
7. Submit to customer for confirmation.

Use progressive disclosure:

- Service rows need simple description/amount/quantity.
- Part/item/digital purchase rows ask who provided/paid for it.
- Advanced notes/receipt fields appear only when needed.

Do not show "compensation eligible" as a main tech control. That should be derived from item type, provider settings, and compensation policy.

## Tax rules

Tax rate must come from settings, not tech assumption.

- Tech cannot edit the tax rate.
- Platform provides default/fallback tax rate.
- Provider admin can override tax rate.
- Store tax rate as basis points:
  - `0` = 0%
  - `725` = 7.25%
  - `850` = 8.5%
- Tax applies only to taxable line items.
- Tip is not taxable.
- Server calculates tax.

If effective tax rate is `0`, allow no-tax closeout but make the UI truthful. If taxable items exist and no tax is collected, require a "no tax collected / tax exempt" reason or equivalent audit note.

## Tip rules

Tip is included in closeout but separate from line items and tax.

- Optional.
- Defaults to `0`.
- Free non-negative amount.
- No cap.
- Not taxable.
- Goes 100% to technician by default.
- Customer sees tip separately before confirmation.
- Server validates numeric currency precision and non-negative value.

## Credit/debit card fee rules

Credit card fee should be configurable and default to zero.

Platform defaults/fallbacks:

- card fee percent basis points, default `0`
- card fixed fee cents, default `0`

Provider admin can override both.

Recommended calculation:

```text
card fee base = subtotal + tax + tip
card fee = percentage fee + fixed fee
```

Apply card fee only for card-like payment methods. Cash, check, Zelle, and similar non-card methods should produce `0` card fee unless future policy says otherwise.

Customer receipt must show "Card processing fee" as a separate line when applicable.

## Financial settings hierarchy

Use platform defaults/fallbacks plus provider overrides.

Platform settings:

- closeout max line items, default `20`
- default tax rate basis points, default `0`
- card fee basis points, default `0`
- card fixed fee cents, default `0`

Provider admin overrides:

- max line items
- tax rate basis points
- card fee basis points
- card fixed fee cents

Suggested validation:

- max line items: `1..100`
- tax rate basis points: `0..2500`
- card fee basis points: reasonable bounded range, e.g. `0..2500`
- card fixed fee cents: non-negative bounded range

Tech uses the effective provider settings and cannot override them per job.

## Technician compensation and cuts

Technician compensation must be calculated from a settlement base, not from the full customer total.

Excluded from percentage cut by default:

- tax
- card processing fee
- tip
- physical parts
- hardware
- key blanks
- remote/fob
- key code purchase
- programming token
- software/license fee
- permits
- third-party pass-through costs
- company-provided items
- customer-provided items

Included by default:

- service fee
- labor
- diagnostic fee
- emergency fee
- trip fee if provider config says it is eligible

### Core settlement formula

```text
eligible_base =
  eligible service/labor lines
  - eligible discounts

tech_service_cut =
  compensation rule applied to eligible_base

tech_total_payable =
  tech_service_cut
  + tip
  + approved tech-provided item reimbursements
  + bonuses
  - deductions/chargebacks
```

### Tech-provided items

Tech-provided parts/items/digital purchases are not percentage-commissioned by default.

Examples:

- tech bought key code
- tech supplied key blank
- tech supplied hardware
- tech bought programming token

These should be tracked as reimbursement, not as service commission, unless an explicit provider agreement rule says otherwise.

### Company-provided items

Company-provided items are excluded from tech cut and not reimbursed to the tech. They remain provider/company cost or pass-through revenue.

### Customer-provided items

Customer-provided items do not create item revenue. Tech earns only eligible service/labor.

## Compensation agreement implementation

Implement technician cuts as versioned compensation agreements attached to the provider-technician affiliation.

Active agreements must not be edited in place for financial terms. Changes create a new version with effective dates. Old jobs keep their original agreement snapshot.

Compensation must never be keyed by technician alone. A technician can work for multiple companies, and each company may have different service permissions, territories, schedules, cuts, reimbursements, bonuses, and settlement history.

Correct scope:

```text
global technician profile
  -> provider-technician affiliation
      -> service area and service hours for that provider relationship
      -> compensation agreement versions for that provider relationship
      -> settlements for jobs fulfilled under that provider relationship
```

Unsafe scope:

```text
technician_id -> one global cut or one global territory
```

Provider A must never see or edit Provider B's agreement, territory, earnings, or settlement history for the same technician. Provider APIs and reports must always include/derive `organization_id`, `technician_id`, and preferably `affiliation_id`.

### Agreement table

Suggested table: `provider_technician_compensation_agreements`

Fields:

- id
- organization_id
- technician_id
- affiliation_id
- status: draft, active, scheduled, archived, terminated
- effective_from
- effective_until
- currency
- default rule
- tip policy
- reimbursement policy
- tax/card fee exclusion policy
- approval metadata
- signed/acknowledged metadata if required
- notes
- created_by
- created_at
- updated_at

## Provider-tech service area and service hours

Service area and service hours belong to the provider-technician affiliation / dispatch eligibility layer, not the global technician profile and not only the compensation agreement.

Plain rule:

- "Who is this technician?" = global technician profile.
- "Where and when can this technician work for this provider?" = provider-tech affiliation dispatch eligibility.
- "How is this technician paid?" = compensation agreement.
- "Do after-hours/outside-zone/emergency jobs pay extra?" = compensation premiums that reference affiliation area/hours and job context.

### Affiliation service area

Support provider-specific service area rules such as:

- counties
- ZIP/postal codes
- radius and center point where useful
- excluded ZIPs/counties
- priority zones
- travel surcharge zones
- outside-zone override policy

The same technician may have different service areas with different companies.

Example:

```text
Jordan Lee
  Metro Key affiliation:
    ZIPs: 33101, 33130, 33131
    Counties: Miami-Dade

  Rapid Locksmith affiliation:
    ZIPs: 33301, 33304
    Counties: Broward
```

### Affiliation service hours

Support provider-specific service hours such as:

- weekly schedule
- timezone
- after-hours availability
- emergency availability
- weekend availability
- holiday availability
- blackout dates / days off
- temporary unavailable windows

Dispatch eligibility should use these fields:

- Is the job inside this tech's provider-specific service area?
- Is the job inside this tech's provider-specific service hours?
- Is emergency or after-hours dispatch allowed?
- If outside area/hours, is dispatcher override allowed and is a reason required?

### Compensation premiums referencing area/hours

Compensation rules may reference affiliation area/hours and job context:

- after-hours premium
- weekend premium
- holiday premium
- emergency premium
- outside-zone premium
- travel surcharge sharing
- long-distance premium

Example:

```text
Affiliation:
  Metro Key + Jordan
  Service ZIPs: 33101, 33130, 33131
  Hours: Mon-Fri 8am-6pm
  Emergency after-hours: yes

Compensation:
  Default: 60% eligible base
  After-hours premium: +10%
  Outside assigned ZIP: +$25
  Emergency job: +$40
```

UI placement:

- Provider app -> Technician detail -> Service area & hours tab: edit dispatch eligibility.
- Provider app -> Technician detail -> Compensation tab: edit pay rules and premiums.
- Technician app -> Profile/Earnings: read-only company-specific service area/hours and agreement summaries.
- Console: audit/read provider-specific service area, hours, agreements, and settlements.

### Rule table

Suggested table: `compensation_agreement_rules`

Fields:

- id
- agreement_id
- scope:
  - default
  - service category
  - service skill
  - item type
  - urgency/time premium
  - bonus
  - deduction
  - reimbursement
- service_category_code
- service_skill_code
- item_type_code
- rule_type:
  - percentage_of_eligible_base
  - flat_per_job
  - flat_plus_percentage
  - hourly_labor
  - tiered_percentage
  - premium_percentage
  - premium_flat
  - reimbursement
  - bonus
  - deduction
- percentage_basis_points
- flat_cents
- min_cents
- max_cents if provider explicitly configures one
- priority
- conditions jsonb
- status

### Required production rule types

Support:

- percentage of eligible base
- flat per job
- flat plus percentage
- hourly labor
- tiered percentage
- per-skill override
- per-category override
- after-hours/weekend/emergency premium
- minimum payout
- optional maximum payout if provider configures it
- bonus rules
- deduction/chargeback rules
- reimbursement rules

Rule priority:

1. exact service skill override
2. service category override
3. item/reimbursement rule
4. time/urgency premium
5. default agreement rule
6. bonus/deduction policies

## Job settlement snapshots

When a job closes, create immutable settlement records.

Suggested table: `job_settlements`

Fields:

- id
- job_id
- organization_id
- technician_id
- agreement_id
- agreement_snapshot jsonb
- closeout_snapshot jsonb
- rule_trace jsonb
- eligible_base_cents
- tech_service_cut_cents
- tip_cents
- reimbursement_cents
- bonuses_cents
- deductions_cents
- tech_total_payable_cents
- provider_retained_cents
- status:
  - calculated
  - pending_review
  - approved
  - scheduled_for_payment
  - paid
  - disputed
  - adjusted
  - voided
- calculated_at
- approved_by
- approved_at
- paid_at

Never silently recalculate old jobs after agreement/settings changes. If a correction is needed, create an adjustment.

## Settlement adjustments

Production must support adjustments.

Suggested table: `job_settlement_adjustments`

Adjustment types:

- manual adjustment
- reimbursement correction
- dispute hold
- refund impact
- chargeback impact
- bonus addition
- deduction
- closeout correction

Every adjustment requires:

- reason
- actor
- timestamp
- before/after values
- audit event

## Approval and payout workflow

Suggested lifecycle:

```text
Tech submits closeout
Customer confirms or job is closed by authorized recovery flow
Settlement is calculated
Provider reviews/approves settlement
Settlement enters a batch
Provider marks batch scheduled/paid
Tech sees pending/approved/paid status
```

Provider admin can approve batches and exports. Dispatcher may view but not edit/approve. Technician can view own agreement and earnings and dispute a settlement. Platform admin can audit and support.

## Settlement batches

Production reporting and payment workflow should support batches.

Suggested tables:

- settlement_batches
- settlement_batch_items
- settlement_exports

Batch fields:

- organization_id
- period_start
- period_end
- status:
  - draft
  - approved
  - exported
  - paid
  - voided
- totals
- created_by
- approved_by
- paid_at

## Reports and exports

Build reports from settlement snapshots, not live recalculation.

### Technician earnings report

For each tech:

- completed jobs
- eligible service/labor base
- tech cut
- tips
- tech-provided reimbursements
- bonuses
- deductions/chargebacks
- total payable
- status: pending, approved, paid, disputed

### Company settlement report

For provider/company:

- customer gross total
- subtotal
- tax collected
- card fees collected
- tips
- company-provided pass-through items
- tech-provided reimbursements
- tech compensation
- provider retained amount
- unpaid/pending customer confirmations
- disputed jobs
- paid/settled jobs

### Job financial detail

For each job:

- closeout receipt
- item breakdown
- customer-confirmed total
- compensation calculation
- tech agreement used
- provider settings used
- calculation trace
- timestamps/audit trail

### Export requirements

Company should export to spreadsheet.

Start with CSV exports:

- Completed jobs
- Technician settlement
- Company settlement summary
- Line-item detail
- Adjustments

Later add XLSX with tabs:

- Summary
- Jobs
- Line Items
- Technician Earnings
- Exceptions

Exports must include stable IDs:

- job id
- technician id/name
- organization id/name
- date range
- service category/skill
- item type
- provided by
- subtotal/tax/tip/card fee/grand total
- eligible base
- tech cut
- reimbursement
- provider retained
- settlement status

## Permissions

Platform admin:

- manage platform financial defaults
- manage item type catalog
- audit all closeouts/settlements
- support overrides only if explicitly allowed

Provider admin:

- manage provider financial settings
- manage compensation agreements
- manage item type/provider overrides if implemented
- approve settlements
- create/export settlement batches

Dispatcher:

- view job financials and settlement status
- no agreement editing
- no settlement approval unless explicitly granted later

Technician:

- submit closeout
- view own agreement
- view own earnings/settlement statuses
- dispute settlement
- cannot edit financial settings
- cannot edit tax/card fee/compensation eligibility

Customer:

- view receipt
- confirm/dispute closeout
- cannot view technician settlement calculations

## API task breakdown

### Platform/admin APIs

- list/update global financial settings
- list/update item type catalog
- audit closeout/settlement detail
- optionally platform-support adjustment APIs

### Provider APIs

- `GET /provider/settings/financial`
- `PATCH /provider/settings/financial`
- manage compensation agreements
- activate/schedule/archive agreements
- list calculated settlements
- approve settlement
- create/export settlement batches
- view job financial detail

### Technician APIs

- submit job closeout
- read effective closeout settings for active job
- view own active compensation agreement
- view own earnings/settlements
- dispute settlement

### Customer tracking APIs

- read closeout receipt
- confirm closeout
- dispute closeout

## UI task breakdown

### Technician app

- replace single amount/method collection with closeout builder
- quick-add buttons:
  - service/labor
  - part/item
  - key code/digital purchase
  - discount
  - other
- progressive fields for provided_by and notes
- tip field
- payment method field
- server-calculated preview
- receipt submit state

### Customer tracking

- receipt-style closeout confirmation:
  - line items
  - subtotal
  - tax
  - tip
  - card fee
  - grand total
  - payment method
- confirm/dispute actions

### Provider app

- financial settings card
- technician compensation tab in technician detail
- agreement editor/version scheduler
- settlement dashboard
- settlement batch approval
- export controls
- job financial detail

### Console

- platform financial defaults
- item type catalog management
- cross-tenant audit/support view

## Testing requirements

Add backend tests for:

- platform fallback settings work
- provider overrides work
- tech cannot exceed effective max line items
- tech cannot edit tax/card fee
- server calculates subtotal/tax/tip/card fee/grand total
- tip has no cap but cannot be negative
- card fee only applies to card-like payment methods
- tax applies only to taxable lines
- provided_by is required for non-service/pass-through items
- parts/items are excluded from tech percentage cut by default
- tech-provided item reimbursement is separate from commission
- company-provided item is not reimbursed to tech
- active agreement selection by effective date
- skill/category override priority
- settlement snapshot is stable after agreement change
- adjustments require reason and audit
- provider tenant scoping
- technician can only see own earnings
- customer can see receipt but not settlement

Add frontend/type/build verification for all touched apps.

## Implementation sequencing recommendation

Production scope is large. Implement in controlled vertical slices, but keep the production model from the start.

Completed in the first implementation slice:

1. Data model and settings foundation.
2. Item type catalog.
3. Structured closeout create/read and server calculations.
4. Technician closeout UI.
5. Compensation agreements and rules, including service area and service hours.
6. Settlement calculation snapshots.
7. Provider settlement approval/reporting.
8. CSV exports.
9. Provider-side adjustments before lock.
10. Technician earnings/settlement-status view.

Remaining production gates:

1. Customer-facing receipt confirmation polish for the itemized receipt.
2. Formal settlement dispute workflow.
3. Console audit/support surfaces for closeout, agreements, settlement periods, and adjustments.
4. Production deployment/migration/click-through QA for the financial workflow.
5. Optional later payment/payroll integration if ClueXP will move money.

Do not ship UI copy that implies real Stripe capture, provider payouts, or payroll movement until processor-backed flows exist. Until payment processor integration is implemented, label money movement as closeout/settlement records or payable estimates, not completed payouts.
