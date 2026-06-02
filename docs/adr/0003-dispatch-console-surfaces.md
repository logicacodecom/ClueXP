# ADR 0003 — Dispatch console: two surfaces, shared shell

- **Status:** Accepted (2026-06-02)
- **Context:** `ORGANIZATION-DISPATCH-CONSOLE-SPEC.md` describes a dispatch console
  with two operating modes — **Organization** (a provider org assigns its own
  affiliated technicians) and **ClueXP** (ops dispatches individuals, routes jobs
  to orgs, handles escalations). The open question was whether to ship this as
  **one dual-mode app** (role/workspace-gated) or **two separate surfaces**
  matching the ROADMAP split (`provider-web` E2, `ops-web` E7).

## Decision

**Two surfaces (Option B), built on a shared UI/client core.**

- `provider-web` (org admin/dispatcher, **E2**) and `ops-web` (ClueXP
  dispatcher + admin/back-office, **E7**) are **separate deployable apps** with
  separate auth surfaces and bundles.
- They are **not** built by copy-paste. The ~70% common console (job queue, job
  detail, technician picker, map panel, dispatch board, timeline/audit, status
  chips, filters, escalation controls) lives in shared monorepo packages —
  e.g. `packages/console-ui` (+ `packages/api-client`, `packages/schema`) —
  imported by both. Each app is a thin shell over the shared core plus its
  surface-specific screens (provider: team mgmt, org onboarding; ops:
  escalation queue, document review/approve, dispatch-policy config).

## Rationale

- **Tenant isolation is a security boundary, not a UI preference.** An org
  dispatcher and a ClueXP admin must not share a JS bundle or auth surface; a
  single permission slip in a dual-mode app could leak cross-tenant PII /
  dispatch authority. Two deployments enforce isolation at the boundary, not
  only via in-app checks.
- **Matches ROADMAP phasing** — provider-web ships at E2 (org onboarding lands
  then); ops-web at E7 (human-oversight console comes when it's needed).
- **No duplication** — screen *count* is identical to the one-app option; the
  shared shell means the difference is packaging, not rebuilt UI.

## Consequences

- The shared `packages/console-ui` + `packages/api-client` must exist **before
  or with** `provider-web` (E2), so `ops-web` (E7) reuses rather than forks.
  **Risk to guard:** "just copy provider-web to make ops-web" — that's the
  duplication this ADR exists to prevent.
- `ORGANIZATION-DISPATCH-CONSOLE-SPEC.md` remains the **shared design contract**
  for both surfaces; it is forward design, not a near-term build order (Sprint 2
  ships **ClueXP-managed dispatch only**; org-managed flows are per SPEC §2.10,
  not scheduled).
- Pairs with `adr/0002` (same self-owned JWT `users` auth, role/workspace scopes
  drive which surface a user can load).
