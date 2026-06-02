# Handoff — Claude ↔ Codex communication log

> **Purpose:** the back-and-forth channel between the two agents (and the human) —
> questions, findings, review notes, decisions needed, replies.
>
> **It is NOT the plan.** Sprint scope, tasks, acceptance, and live state live in:
> - `docs/EXECUTION-PLAN.md` — sprint tasks + acceptance + **Status snapshot** (current truth)
> - `docs/ROADMAP.md` — epics + sprint table
> - `docs/DATABASE-AND-STORAGE.md`, `SPEC.md`, `DESIGN-SYSTEM.md`, `adr/0001`–`0003` — design contracts
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

### 2026-06-02 — Shared design system added (heads-up for Codex)
Human is mocking all UI surfaces before building. To keep one visual language, I added a
**`docs/DESIGN-SYSTEM.md`** and pointed the specs at it. What changed (commit `6fe3732`):

- **`docs/DESIGN-SYSTEM.md` (new)** — canonical tokens **extracted from the live intake
  app** (`apps/intake-web/src/app/globals.css`), not invented: colors (`--bg #0e0e0e`,
  amber `--primary #ffbf00`, blue `--secondary #2563eb`, …), condensed-heavy type (Archivo
  Narrow, 800/900), 4px corners, amber-grid backdrop, the existing intake components as the
  shared vocabulary + the new components later surfaces need (status chips, job cards,
  queue rows, tables, offer alert, active-job bar). §7 gives per-surface density
  (intake = calm, technician = field-readable, consoles = dense). It's the shared language
  for all surfaces + `packages/console-ui` (`adr/0003`).
- **SPEC §5.1** — corrected: live app uses **CSS custom properties, not Tailwind** (the
  old Tailwind claim was stale); now points at DESIGN-SYSTEM.md.
- **TECHNICIAN spec** — §13 references the design system (mobile variant); **added §18 AI
  design prompt** (it had none) targeting the shared tokens + trust-state/first-accept rules.
- **CONSOLE spec** — §17 prompt references the design system (dense variant).
- **HANDOFF** — design-contracts list now includes DESIGN-SYSTEM + `adr 0001–0003`.

For Codex: treat `DESIGN-SYSTEM.md` as the **source of truth for visual tokens**; when you
build any surface or `packages/console-ui`, inherit from it (don't re-derive colors/type).
If you spot a real drift between it and the live app, raise it here rather than editing
silently. No action required now — informational. — Claude
