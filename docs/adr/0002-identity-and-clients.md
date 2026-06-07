# ADR 0002 — Identity, access, and client apps

- **Status:** Superseded in part (2026-06-06)
- **Context:** Sprints 2+ add logged-in actors (technicians, provider-org admins,
  ClueXP staff) and a technician mobile app. ADR 0001 deferred backend extraction
  and said nothing about auth. We need identity + authorization, and we want to
  stay portable. This ADR originally selected Clerk, but the product owner later
  selected ClueXP-owned FastAPI/Postgres authentication for production. Sections
  describing Clerk are retained as decision history and are superseded by the
  amendment below. The shared-backend and separate-client decisions remain.

## 2026-06-06 Amendment - First-party authentication

ClueXP uses its own FastAPI/Postgres identity and authorization system. Logged-in
actors authenticate through FastAPI-issued signed JWTs; web applications bridge
those sessions through same-site httpOnly cookies. Local `users`, roles,
organization memberships, technician records and business permissions are
authoritative.

Do not add Clerk SDKs, Clerk organizations, Clerk external-reference columns, or
another proprietary identity dependency unless a future ADR explicitly replaces
this decision.

## Decisions

### 1. Historical decision: Clerk

> **Superseded by the 2026-06-06 amendment above.**

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
Use ClueXP organization memberships for provider-company membership and
org-level roles such as `provider_admin` and `dispatcher`. Platform-wide roles such as
`platform_admin` remain app-level authority and must be checked by the backend.
Technicians are users too, but their dispatch eligibility still comes from
ClueXP's `technicians`, `organization_technicians`, compliance, and availability
tables.

Authorization remains **API-enforced**, not UI-only. The FastAPI backend verifies
its issued tokens, resolves user and organization context from ClueXP records,
and scopes every query/action by the resulting authority.

### 3. Clients and API deployment

Customer intake stays mobile web/PWA with no forced install. Technician,
provider and ops are separate authenticated clients. The technician channel is a
PWA today; a native client remains an option when background GPS or push
reliability requires it.

The backend remains one logical FastAPI service. Physical extraction to a
standalone `cluexp-api` is no longer tied to E2: the deployed clients currently
consume the co-located service successfully. Extract it when client, reliability,
security or scaling evidence justifies the migration.

## Consequences

- **Authorization is in the API layer, not RLS.** Every query is scoped by the
  backend (e.g. `WHERE org_id = <caller>`); the deny-by-default RLS from `0002`
  stays only as a backstop against the public anon key, not the primary mechanism.
- **`users` table** is the application identity source of truth. It stores
  credential/session-related data plus app-specific status, audit, and relationships;
  `provider_documents.verified_by` / `media.uploaded_by` point to this local row.
- **Vendor swap-points to watch** (not blockers): Supabase **Storage** (signed
  URLs) and the **pooler** connection string. All
  dispatch/business data remains portable Postgres data.
- **No Clerk migration task remains.** Authentication hardening continues inside
  the first-party system.
- **Customer phone verification** remains a future light identity check; it layers on
  the customer phone model rather than forcing a customer account.
