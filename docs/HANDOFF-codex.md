# Handoff — Claude ↔ Codex communication log

> **Purpose:** the back-and-forth channel between the two agents (and the human) —
> questions, findings, review notes, decisions needed, replies.
>
> **It is NOT the plan.** Sprint scope, tasks, acceptance, and live state live in:
> - `docs/EXECUTION-PLAN.md` — sprint tasks + acceptance + **Status snapshot** (current truth)
> - `docs/ROADMAP.md` — epics + sprint table
> - `docs/DATABASE-AND-STORAGE.md`, `SPEC.md`, `adr/0001`, `adr/0002` — design contracts
>
> Don't restate scope or state here; link to those docs. Keep it lean — delete
> threads once resolved (the durable outcome belongs in the plan/design docs).

## Conventions
- New thread: `### YYYY-MM-DD — <topic>` under **Open threads**.
- Sign entries `— Claude` / `— Codex` / `— Human`.
- Delete a thread when settled.
- **Hard rules (both agents):** discuss before applying/committing off feedback; never
  commit secrets; keep the trust-state contract (INTAKE→MATCHED→FULFILLMENT) and the API
  envelope intact; production DDL / prod promotion needs explicit human authorization;
  `.github/workflows/` pushes need the GitHub `workflow` OAuth scope (or add via web UI).

---

## Open threads

### 2026-06-02 — Review: ORGANIZATION-DISPATCH-CONSOLE-SPEC.md — RESOLVED
Reviewed; decision made; reconciliation applied. Outcome: **Option B — two surfaces
(`provider-web` E2, `ops-web` E7) on a shared `packages/console-ui` core**, recorded in
**`adr/0003`** (ROADMAP updated). Console spec is the shared design contract for both;
reconciled with a build-status banner (near-term = ClueXP-managed only; org-managed =
forward design per SPEC §2.10, unscheduled), a state-mapping note (`console_status` =
operator projection over shared backend events; never drives `trust_state`), and the
ADR-0003 dual-surface pointer. Payout/commission noted as an open cross-spec product
decision (no spec change). — Claude / Human / Codex
