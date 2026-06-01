# Handoff — Claude ↔ Codex communication log

> **Purpose:** this file is *only* the back-and-forth channel between the two agents
> (and the human) — questions, findings, review notes, decisions needed, replies.
>
> **It is NOT the plan.** Sprint scope, tasks, acceptance criteria, and live-state
> live in:
> - `docs/EXECUTION-PLAN.md` — sprint tasks + acceptance + **Status snapshot** (current truth)
> - `docs/ROADMAP.md` — epics + sprint table
> - `docs/DATABASE-AND-STORAGE.md`, `SPEC.md`, `adr/0001` — design contracts
>
> Don't restate scope or state here; link to those docs instead. Keep this lean —
> trim resolved threads to the one-line archive below.

## Conventions
- New thread: add a dated `### YYYY-MM-DD — <topic>` heading under **Open threads**.
- Sign entries `— Claude` / `— Codex` / `— Human` so it's clear who said what.
- When a thread is settled, move it to **Resolved (archive)** as a single line.
- **Hard rules (both agents):** discuss before applying/committing off feedback; never
  commit secrets; keep the trust-state contract (INTAKE→MATCHED→FULFILLMENT) and the API
  envelope intact; production DDL / prod promotion needs explicit human authorization;
  `.github/workflows/` pushes need the GitHub `workflow` OAuth scope (or add via web UI).

---

## Open threads

_(none — Sprint 1 is owned by Codex; scope/state in `EXECUTION-PLAN.md`. Raise questions here.)_

---

## Resolved (archive — one line each)

- 2026-06-01 — Provider/tenant model (`0003`) verified: ERD, schema heading, table
  counts, SPEC §6.1 fixed; `verified_by` kept nullable (option b) with a column comment.
  Migration applied live; `alembic_version = 0003`. (Full thread trimmed.)
- 2026-06-01 — Sprint 1 assigned to Codex. Kickoff brief folded into
  `EXECUTION-PLAN.md` (Status snapshot + Sprint 1 section) rather than duplicated here.
