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

## Source Of Truth

| Source | What it defines |
|---|---|
| `apps/intake-web/api/store.py` | Default demo password, Metro Key users, platform admin, and boot-time demo seeding. |
| `apps/intake-web/api/demo_seed.py` | Florida Locksmith company, dispatcher, technician roster, and reset-time demo jobs. |
| `packages/api-client/src/mock-data.ts` | Frontend mock identities for the console surfaces. |
| `docs/PILOT-OPERATIONS.md` | Pilot runbook and Metro Key production demo flow. |
