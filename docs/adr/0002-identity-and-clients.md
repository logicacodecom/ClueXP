# ADR 0002 — Identity, access, and client apps

- **Status:** Accepted (2026-06-01)
- **Context:** Sprints 2+ add logged-in actors (technicians, provider-org admins,
  ClueXP staff) and a technician mobile app. ADR 0001 deferred backend extraction
  and said nothing about auth. We need identity + authorization, and we want to
  stay portable (the human asked for a simple, non–vendor-locked auth so we can
  move Postgres providers later). This ADR revises 0001 §2 (extraction timing)
  and adds the auth/roles/clients decisions.

## Decisions

### 1. Self-owned auth (vendor-neutral) — not Supabase Auth
Identity lives in our **own `users` table** in Postgres; auth logic lives in our
FastAPI. Passwords hashed with bcrypt/argon2 (`passlib`); sessions are stateless
**JWTs** signed with a secret from env (`PyJWT`). Rationale: portability — a
provider move is `pg_dump | psql` + new `DATABASE_URL`, with nothing owned by the
DB vendor. Supabase Auth (GoTrue, `auth` schema, `auth.uid()` RLS) was rejected
because it couples identity to Supabase. The same JWT serves the web apps and the
future native app.

### 2. Roles: one flat column now; scoped RBAC deferred
A single `users.role` from a small fixed set (`customer`, `technician`, `staff`,
`admin`). Authorization is **simple FastAPI dependency checks** (`require_role`),
not database RLS. Rationale: roles are plumbing, not the product — build the
minimum that's safe and unblocks the business flows. **Explicitly deferred** (a
real future task, not forgotten): membership-scoped RBAC (role-per-org/team),
granular permissions, org-admin self-service boundaries — picked up when
multi-org operations actually exist.

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
- **`users` table** is added (own migration) before E2 onboarding can mean
  anything; `provider_documents.verified_by` / `media.uploaded_by` finally have a
  real referent.
- **Vendor swap-points to watch** (not blockers, just the only non-portable ties):
  Supabase **Storage** (signed URLs) and the **pooler** connection string. Auth and
  all relational data are portable.
- **OTP (Sprint 4 / E6)** remains the customer's light identity check; it layers on
  the same `users`/phone model rather than a separate system.
