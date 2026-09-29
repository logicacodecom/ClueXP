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

Use only the two registered, opted-in companies below unless another provider has an active intake
channel, explicit assistant-listing opt-in, eligible technicians, and dispatch cutover configured.

| Company | Branded intake | Demo use |
|---|---|---|
| Metro Key Partners | `https://intake.cluexp.com/o/metro-key` | Registered provider option in assistant search and dispatch rehearsal. |
| Florida Locksmith | `https://intake.cluexp.com/o/florida-locksmith` | Registered provider option in assistant search and dispatch rehearsal. |

Providers without an active branded intake page, such as placeholder/demo organizations, cannot show in
assistant search and should not be named in the audience-facing demo.

### Pre-demo Setup

1. Pick a precise street address inside both demo providers' service areas. For the Tampa rehearsal,
   use a Tampa address such as `401 N Tampa St, Tampa, FL`.
2. Put at least one technician from each demo company on duty with the selected skill. For a vehicle
   lockout demo, use a vehicle-capable technician from each company.
3. Confirm the provider board is audience-safe. Hide or disable junk, rejected, duplicate, or obviously
   test-only technicians before showing the board. Do not hard-delete production identities unless they
   are confirmed synthetic/demo-only and cleanup is explicitly approved.
4. If reseeding the Florida demo data is needed in a non-production demo database, run from the repo
   root:

   ```sh
   npm run demo:reset --workspace @cluexp/intake-web
   ```

   Use `--dry-run` first when pointing at any shared database. The reset preserves the Metro Key company
   and technicians and only cleans demo-marked jobs.

### Run Of Show

| Step | Screen | What the audience sees |
|---|---|---|
| 0 | Technician phone(s) | A technician from each registered company goes on duty. Explain that live technician eligibility is what makes a provider discoverable. |
| 1 | Claude or ChatGPT | The customer asks for help without knowing ClueXP: `I'm locked out of my car at 401 N Tampa St, Tampa, FL. Who can help?` |
| 2 | Claude or ChatGPT | The assistant calls ClueXP MCP, finds the matching service, and lists registered provider companies only. One provider may be marked recommended. |
| 3 | Customer browser/phone | The customer opens the recommended provider's intake link. Service and location are already filled in. |
| 4 | Provider dispatcher board | After the customer submits the request, it appears in the provider's dispatch queue under that provider's control. |
| 5 | Technician phone + customer page | The dispatcher sends/assigns the job, the technician accepts, and the customer status updates live. |

Expected assistant wording:

> I found registered locksmith providers through ClueXP that can serve this location. Metro Key Partners
> is recommended, and Florida Locksmith is also available. You can start the request with Metro Key here:
> `<provider intake link>`.

Avoid saying that ClueXP or the assistant booked the job. Correct wording is that the assistant found
registered providers through ClueXP and the customer starts the request on the provider's branded intake.

### Live Production Approvals

This rehearsal can create real production jobs and may trigger real customer/provider/technician
communications depending on environment flags and provider configuration. Before running it against
production, the Product Owner must explicitly approve the exact target and scope for:

- live test request creation;
- which customer and technician phone numbers/accounts may receive messages or push notifications;
- which named technicians may be placed on duty;
- cleanup or resolution of the demo jobs after the rehearsal.

If real sends are not approved, run the rehearsal only in a safe demo environment or stop before the
step that triggers notifications.

### Acceptance Checklist

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
