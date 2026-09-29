# Demo Access

This document is the quick reference for demo-only console, provider, and technician
accounts seeded by the local/demo data setup.

Do not use these credentials for production operators. The shared password is intentionally
simple for demos and comes from `DEMO_SEED_PASSWORD`, which defaults to `123456`.

## App URLs

| App | URL | Notes |
|---|---|---|
| Ops console | `https://ops.cluexp.com` | Platform admin oversight console. |
| Provider console | `https://partners.cluexp.com` | Provider dispatch, recovery, workforce, and company admin. |
| Technician PWA | `https://tech.cluexp.com` | Technician field app. |
| Metro Key branded intake | `https://intake.cluexp.com/o/metro-key` | Customer intake for the Metro Key demo channel. |
| Florida Locksmith branded intake | `https://intake.cluexp.com/o/florida-locksmith` | Customer intake for the Florida Locksmith demo channel. |

## Shared Demo Password

| Setting | Value |
|---|---|
| Default password | `123456` |
| Override env var | `DEMO_SEED_PASSWORD` |
| Password source | `apps/intake-web/api/store.py` |

## Demo Users

All accounts below use the shared demo password unless `DEMO_SEED_PASSWORD` was changed before
the database was seeded.

| Company | Name | Email | Roles | Primary app |
|---|---|---|---|---|
| ClueXP | Avery Knox | `avery@cluexp.com` | `platform_admin` | Ops console |
| Metro Key Partners | Nadia Reyes | `dispatch@metrokey.example` | `provider_admin`, `dispatcher` | Provider console |
| Metro Key Partners | Jordan Lee | `jordan@cluexp.example` | `technician` | Technician PWA |
| Metro Key Partners | Marcus Reyes | `marcus@metrokey.example` | `technician` | Technician PWA |
| Metro Key Partners | Lena Ortiz | `lena@metrokey.example` | `technician` | Technician PWA |
| Florida Locksmith | Tampa Dispatch | `dispatch@florida-locksmith.demo` | `provider_admin`, `dispatcher` | Provider console |
| Florida Locksmith | Carlos Rivera | `carlos.rivera@florida-locksmith.demo` | `technician` | Technician PWA |
| Florida Locksmith | Maya Thompson | `maya.thompson@florida-locksmith.demo` | `technician` | Technician PWA |
| Florida Locksmith | Andre Wilson | `andre.wilson@florida-locksmith.demo` | `technician` | Technician PWA |

## Current Demo Companies

| Company | Slug | Region | Demo state | Seeded dispatcher | Seeded technicians |
|---|---|---|---|---|---|
| Metro Key Partners | `metro-key` | NYC area | Pilot/demo company preserved by reset scripts; branded intake is the pilot channel. | `dispatch@metrokey.example` | Jordan Lee, Marcus Reyes, Lena Ortiz |
| Florida Locksmith | `florida-locksmith` | Tampa, FL | Demo provider reseeded by `npm run demo:reset` or `npm run seed:demo:florida-locksmith`. | `dispatch@florida-locksmith.demo` | Carlos Rivera, Maya Thompson, Andre Wilson |

## AI/MCP Live Rehearsal Demo

This is the preferred live business demo for assistant-led local-service discovery. The customer does
not need to know ClueXP before the request. They ask Claude or ChatGPT for help the same way they would
use a search engine. The assistant talks to the ClueXP MCP connector, ClueXP returns registered provider
companies that are eligible right now, and the customer continues on the selected provider's branded
ClueXP intake page.

Pitch line:

> Customers ask Claude or ChatGPT for urgent help. ClueXP gives the assistant a trusted registered
> provider network with live eligibility, then hands the customer into the provider's own branded intake
> and dispatch workflow.

### Boundaries

- Search is limited to registered ClueXP provider companies. Do not use open-web provider search for
  this rehearsal.
- The MCP connector exposes discovery only: `list_services` and `find_providers`.
- The assistant does not create, book, dispatch, cancel, price, track, or pay for a request.
- The customer creates the request only after opening the provider-branded intake link and taking an
  explicit action on the web page.
- A company appears in assistant search only when its intake channel is active, opted in to assistant
  listing, tied to an active organization, and has at least one available eligible technician in range.
- Phase 2 assistant-prepared drafts are not live yet; do not demo Claude or ChatGPT creating a request
  directly.

### Rehearsal Companies

The two companies below have registered, opted-in channels. Opt-in alone does not guarantee that a
company will appear for a specific request: the selected service, technician availability, and live
service-area eligibility must also match. Use another provider only when the same conditions are
verified before the rehearsal.

| Company | Branded intake | Demo use |
|---|---|---|
| Metro Key Partners | `https://intake.cluexp.com/o/metro-key` | Use at an address where the live preflight returns Metro Key. Repository demo seeding places its technicians in the NYC area; deployed data may differ. |
| Florida Locksmith | `https://intake.cluexp.com/o/florida-locksmith` | Use for the Tampa rehearsal after a live preflight confirms eligibility. Repository demo seeding places its technicians around Tampa. |

Providers without an active branded intake page, such as placeholder/demo organizations, cannot show in
assistant search and should not be named in the audience-facing demo.

### Authorization Gate

This runbook authorizes no production mutation, deployment, provider configuration change, feature-flag
change, SMS activation, or other live send. Before anyone changes production state or continues past the
read-only handoff preview, the Product Owner must explicitly approve the exact target and scope for:

- live test request creation and its cleanup or resolution;
- which customer, provider dispatcher/admin, and technician accounts may receive SMS, email, push, or
  in-app alerts;
- which named technicians may be placed on duty or have their location, skill, service radius, or
  availability changed;
- hiding, disabling, deleting, or otherwise changing provider or technician identities; and
- the selected channel's exact customer action that creates the ticket, based on its current dispatch
  cutover, phone-verification, and communication settings.

Without those approvals, production rehearsal is limited to the read-only assistant query and opening the
returned intake link. Do not change technician state. After opening the link, stop before any intake button,
tap, or form action: with dispatch cutover on and phone verification off, the first customer action creates
a `pending_dispatch` ticket and alerts the provider. No non-production intake or MCP environment is defined
in this document; do not assume one exists.

### Pre-demo Setup

1. Choose the company and scenario to demonstrate. For the Tampa rehearsal, use a precise Tampa address
   such as `401 N Tampa St, Tampa, FL` and expect Florida Locksmith only unless preflight proves another
   company is currently eligible there.
2. Put at least one technician from every company you intend to show on duty with the selected skill,
   current location, and service radius covering the test address. For a vehicle lockout demo, use a
   vehicle-capable technician.
3. Run the exact `find_providers` request through the connected assistant before the rehearsal. Confirm
   every company you plan to name is returned. To show two companies, use an address where that preflight
   returns both; otherwise present the valid single-company result.
4. Confirm the provider board is already audience-safe. If it is not, obtain the approval above before
   hiding, disabling, deleting, or changing any identity.
5. If reseeding the Florida demo data is needed, use an explicitly supplied non-production database URL.
   Preview the reset first from the repo root:

   ```sh
   npm run demo:reset --workspace @cluexp/intake-web -- --dry-run --db "REPLACE_WITH_NON_PRODUCTION_DATABASE_URL"
   ```

   After reviewing the preview, omit `--dry-run` to apply it to that same non-production database. Never
   run this reset against production without a separately reviewed procedure and fresh Product Owner
   authorization. The reset preserves the Metro Key company and technician identities but cleans its
   demo-marked jobs and dependent rows. It also upserts Florida Locksmith and its channel, forces both
   active with dispatch cutover on, resets the seeded Florida dispatcher and technician passwords to the
   configured shared demo password, restores their roles and memberships, marks the technicians verified
   and available at fixed Tampa locations, and deletes and recreates Florida demo-marked jobs.

### Run Of Show

| Step | Screen | What the audience sees |
|---|---|---|
| 0 | Technician phone(s) | A technician from each company intended for the scenario goes on duty. Explain that live technician eligibility is what makes a provider discoverable. |
| 1 | Claude or ChatGPT | The customer asks for help without knowing ClueXP: `I'm locked out of my car at 401 N Tampa St, Tampa, FL. Who can help?` |
| 2 | Claude or ChatGPT | The assistant calls ClueXP MCP, finds the matching service, and lists registered provider companies only. One provider may be marked recommended. |
| 3 | Customer browser/phone | The customer opens the recommended provider's intake link. Service and location are already filled in. |
| 4 | Customer intake + provider dispatcher board | After approval, the customer takes the confirmed ticket-creation action. On a cutover channel with verification off, the first customer action creates a `pending_dispatch` ticket and alerts the provider; it then appears in that provider's queue. |
| 5 | Technician phone + customer page | The dispatcher sends/assigns the job, the technician accepts, and the customer status updates live. |

Expected assistant wording:

> I found Florida Locksmith through ClueXP for this location. You can start the request on its ClueXP
> intake page here: `<provider intake link>`.

If the preflight returns more than one company, name only those returned and preserve the result order and
recommended marker. Never reuse a provider list from a different address or an earlier availability state.

Avoid saying that ClueXP or the assistant booked the job. Correct wording is that the assistant found
registered providers through ClueXP and the customer starts the request on the provider's branded intake.

### Acceptance Checklist

- [ ] The Authorization Gate is satisfied for every production mutation and possible recipient.
- [ ] `list_services` returns the locksmith service catalog.
- [ ] `find_providers` returns only registered, opted-in ClueXP companies.
- [ ] At least one eligible technician per shown company is on duty for the chosen skill.
- [ ] The assistant result includes provider names and branded intake links only; no technician identity,
      ETA, price, rating, or internal IDs.
- [ ] Opening the intake link pre-fills service and location.
- [ ] Merely opening the link does not create a ticket.
- [ ] The ticket appears only after the customer acts on the intake page.
- [ ] Provider dispatch remains under the provider's console/control.
- [ ] Technician acceptance and customer status update are visible.
- [ ] Demo-created jobs are cleaned up or resolved according to the approved cleanup plan.

## Source Of Truth

| Source | What it defines |
|---|---|
| `apps/intake-web/api/store.py` | Default demo password, Metro Key users, platform admin, and boot-time demo seeding. |
| `apps/intake-web/api/demo_seed.py` | Florida Locksmith company, dispatcher, technician roster, and reset-time demo jobs. |
| `packages/api-client/src/mock-data.ts` | Frontend mock identities for the console surfaces. |
| `docs/PILOT-OPERATIONS.md` | Pilot runbook and Metro Key production demo flow. |
