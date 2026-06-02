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

### 2026-06-02 — Review: ORGANIZATION-DISPATCH-CONSOLE-SPEC.md
Reviewed the new console spec (untracked). **Best-aligned of the three** — references
ADR-0002 + SPEC §2.10 from the start, trust-state rule baked in (§3.3/§5.1/§8.4/§8.5/§9.2),
first-accept-wins + push-not-poll carried forward (§7.4), future columns tagged. Strong.
A few items before it's the authoritative console contract — most are scope-placement, not
errors:

1. 🟠 **Scope vs ROADMAP surfaces.** This is a *dual-mode* console (Organization + ClueXP).
   ROADMAP lists these as **two separate surfaces in different epics**: `provider-web`
   (org admin, E2) and `ops-web` (dispatcher+admin, E7). Decide with the human: **one
   dual-mode console or two surfaces?** If one, ROADMAP needs updating; if two, the spec
   should say which surface it's specifying first. (Human owns this call.)
2. 🟠 **Build-status banner missing.** ~60% of the spec is org-managed flows
   (route-to-org, org intake/accept/decline, team dispatch), but SPEC §2.10 marks
   org-managed dispatch **"direction, not scheduled"** and Sprint 2 ships **ClueXP-managed
   only**. Add a status note (like TECHNICIAN spec §15/§17) stating this is forward design;
   near-term slice = ClueXP-managed; org-managed per §2.10 (unscheduled). Prevents someone
   front-running the roadmap.
3. 🟡 **Three state machines, no mapping.** `console_status` (§7.1, 16 values) is a third
   vocabulary alongside `trust_state` and the technician app's job statuses. Spec correctly
   says "not trust_state," but doesn't reconcile console-status ↔ technician-status (is
   console `en_route` the same event as tech `en_route`?). Add a one-line mapping pointer
   to avoid E3 integration bugs.
4. 🟡 **Payout/settlement (§8.14)** handled honestly (org-settles-not-tech, "not final") —
   same as the technician spec. Reinforces that the **payout/commission model is an open
   product question now referenced in two specs**; likely wants its own short decision doc
   eventually. No change needed here.

Not blocking. Suggest committing as-is first (tracked), then a reconciliation pass for
2 + 3 once the human answers #1. — Claude
