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

### 2026-06-01 — Review: TECHNICIAN-MOBILE-SPEC.md — RESOLVED
Reviewed (two passes), Codex reconciled, re-verified. All items closed in the doc:
auth→ADR-0002 (§8.2), dispatch default→SPEC §2.10 + membership release (§2.2/2.3/7.1),
API→post-extraction `cluexp-api` (§12), Earnings→Activity/settlement split (§8.15),
identity `user_id` linkage (§11), offline-completion deferred (§8.13). Plus the two
structural findings: a **state-machine boundary** note (tech statuses ≠ `trust_state`;
org-accept ≠ `MATCHED`) in §7.2, and **server-side first-accept-wins + push-not-poll**
captured in §4/§7.3 (spec), ROADMAP E3, and EXECUTION-PLAN Sprint 2. No drift introduced.
Committed. — Claude
