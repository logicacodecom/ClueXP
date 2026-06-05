# ADR 0002 — Identity, access, and client apps

- **Status:** Accepted (2026-06-01), amended (2026-06-05)
- **Context:** Sprints 2+ add logged-in actors (technicians, provider-org admins,
  ClueXP staff) and a technician mobile app. ADR 0001 deferred backend extraction
  and said nothing about auth. We need identity + authorization, and we want to
  stay portable. The first demo implementation used simple self-owned JWT auth;
  after the Sprint 2 auth discussion, the planned production direction is Clerk
  for identity, sessions, organizations, and invitations while ClueXP keeps the
  business domain model in Postgres. This ADR revises 0001 §2 (extraction timing)
  and adds the auth/roles/clients decisions.

## Decisions

### 1. Production auth direction: Clerk, with Postgres as domain source of truth
Use **Clerk** as the planned production identity provider for logged-in actors:
provider admins, dispatchers, technicians, and ClueXP staff. Clerk should own
sign-in, sessions, invitations, user profile basics, organization membership UI,
and org-scoped roles/permissions.

ClueXP still owns the business model in Postgres. Store Clerk identifiers as
external refs on our domain records, for example `users.clerk_user_id` and
`organizations.clerk_organization_id`, while keeping `organizations`,
`technicians`, `organization_technicians`, `jobs`, `reviews`, compliance status,
and dispatch permissions authoritative in ClueXP tables.

The current custom FastAPI `/auth/login` + signed-token flow is a **demo bridge**,
not the long-term auth architecture. Replace it in a future Clerk migration
slice. Supabase Auth (GoTrue, `auth` schema, `auth.uid()` RLS) remains rejected as
the primary auth layer because it couples identity tightly to the DB provider.

### 2. Roles and tenant scope
Use Clerk organizations for provider-company membership and org-level roles such
as `provider_admin` and `dispatcher`. Platform-wide roles such as
`platform_admin` remain app-level authority and must be checked by the backend.
Technicians are users too, but their dispatch eligibility still comes from
ClueXP's `technicians`, `organization_technicians`, compliance, and availability
tables.

Authorization remains **API-enforced**, not UI-only. The FastAPI backend verifies
Clerk-issued tokens, maps Clerk user/org context to ClueXP domain records, and
scopes every query/action by the resulting authority.

### 3. Clients + API extraction pulled forward to E2
The technician channel is a **PWA now → React Native (Expo) near-term**. A native
app cannot co-locate inside the Next.js deployment, so the standalone
**`cluexp-api`** extraction that ADR 0001 §2 deferred is **pulled forward to E2**
(the first non-intake client). Customer intake stays a PWA (SPEC §2.5, no forced
install); all other actors log in.

## Consequences

- **Authorization is in the API layer, not RLS.** Every query is scoped by the
  backend (e.g. `WHERE org_id = <caller>`); the deny-by-default RLS from `0002`
  stays only as a backstop against the public anon key, not the primary mechanism.
- **`users` table** remains a domain mirror/link table, not the identity source of
  truth. It stores Clerk refs plus app-specific status, audit, and relationships;
  `provider_documents.verified_by` / `media.uploaded_by` point to this local row.
- **Vendor swap-points to watch** (not blockers): Clerk identity/org IDs,
  Supabase **Storage** (signed URLs), and the **pooler** connection string. All
  dispatch/business data remains portable Postgres data.
- **Future migration task:** add Clerk SDKs to the Next.js console/technician
  apps, add Clerk token verification to FastAPI, add Clerk external-ref columns,
  and retire custom `/auth/login` once live auth is verified.
- **OTP (Sprint 4 / E6)** remains the customer's light identity check; it layers on
  the customer phone model rather than forcing a customer account.
