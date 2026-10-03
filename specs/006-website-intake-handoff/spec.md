# Feature Specification: Website → Provider Intake Handoff

**Feature Branch**: `feat/006-website-intake-handoff`
**Spec Directory**: `specs/006-website-intake-handoff`
**Created**: `2026-10-03`
**Owner**: `Claude implementer; secondary review by a non-Claude agent`
**Status**: `implemented for review; no migration, config, or production activation`

## Summary

The ClueXP Website (`www.cluexp.com`) checks service + ZIP availability, calls `/v1/provider-matches`, lets
the customer choose one provider, then links to that provider's branded intake `/o/{slug}`. Until now the
intake only consumed `src=ai_assistant` fragments (specs/003 FR-010). This feature generalizes the fragment
parser into a multi-source handoff so the Website link is consumed, and keeps source attribution separate
from location trust.

Provider = partner. The created request belongs to the provider/partner org resolved server-side from
`{slug}` and appears in that provider's dispatch queue (provider app, `partners.cluexp.com`), not the
ClueXP admin console (`console.cluexp.com`).

## Link Shape

`/o/{slug}#src=cluexp_website&skill=<catalog skill>&zip=<zip>&address=<text>&notes=<text>`

Legacy `src=website` is accepted and normalized to `cluexp_website`.

## Requirements

- **FR-001**: The intake recognizes `src=cluexp_website` and `src=website`; both are attributed as
  `cluexp_website`. Unknown `src` values open a normal blank intake (fail closed, no error).
- **FR-002**: `skill` pre-highlights the access type (same bucketing as `_access_type_for_skill`) and, where
  one fits, the situation chip. The customer still taps to confirm.
- **FR-003**: `address` (≤300 chars) prefills the address field as unconfirmed customer text. It is never
  sent as a ticket location and never sent to autocomplete/geocode until the customer edits it, presses
  "Find this address", or shares GPS. The safety step refuses to proceed on an unconfirmed handoff address.
- **FR-004**: `zip` is a display hint only. It never becomes a location; no coordinates are inferred from it.
  `lat`/`lng` on Website links are ignored. Only coordinate-trusted sources (`ai_assistant`) supply a location.
- **FR-005**: `notes` (≤500 chars) prefills additional details; sent only when the customer continues that step.
- **FR-006**: Opening the link creates nothing and fetches nothing with fragment values (specs/003 FR-011).
  The fragment is stripped from the address bar on read.
- **FR-007**: The normal intake flow is required before request creation and commit: address confirmation,
  contact details, phone verification where required, consent/terms, explicit submission.
- **FR-008**: Ownership comes only from server-side slug resolution (`resolve_intake_channel`); org IDs in the
  fragment or body are ignored.
- **FR-009**: `POST /tickets` records `intake_source` in `jobs.origin_channel` only when it is in the server
  allow-list (`ai_assistant`, `cluexp_website`). Attribution is analytics only, never authorization or routing.

## Extensibility

Future sources (`provider_website`, `google_business_profile`, `partner_widget`, `partner_api`, `manual_link`)
are added by mapping their `src` in `SOURCES` (`src/app/intake-handoff.ts`), allow-listing them in
`INTAKE_SOURCES` (`api/main.py`), and adding them to `COORDINATE_SOURCES` only if their coordinates are trusted.
They are deliberately not pre-registered so unimplemented sources fail closed.

## Out Of Scope

- Website-side link generation; `/v1/provider-matches` response shape (its `intake_url` still carries
  `src=ai_assistant` + coordinates).
- FR-013 commit-step provider re-check for Website intakes (stays `ai_assistant`-only).
- Migrations (`jobs.origin_channel` is free text), production config, deployment, live dispatch.
