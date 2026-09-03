# ClueXP Agent Operating Contract

## Authority

- Human is Product Owner and retains product/business authority.
- Codex is Engineering Lead and final technical reviewer.
- Claude Code is a delegated specialist, critic, second-opinion reviewer, and bounded implementation agent.
- The orchestrator is operational control software. It schedules work and manages resources; it does not make product or architecture decisions.
- CI/tests are objective gates. Passing CI does not replace Codex review for delegated work.

## Required workflow

1. Codex interprets the requested engineering outcome and owns the implementation plan.
2. Codex classifies tasks by risk, context, dependency, and expected effort.
3. For material feature, API, database, production policy, launch, or AI-agent integration work, Codex creates or verifies Spec Kit artifacts under `specs/` before implementation, following `.specify/memory/constitution.md`.
4. Codex may execute directly or delegate a bounded task to Claude.
5. For important design decisions Codex may invoke a controlled discussion/critique loop with Claude.
6. Claude returns findings/work plus assumptions, files touched, tests run, unresolved risks, and recommended next action.
7. Codex reviews delegated output, resolves disagreements, integrates/fixes as needed, and performs final technical review.
8. Human approval remains mandatory where existing ClueXP rules require it, especially production DDL/deployments and product-scope decisions.

## Discussion modes

- `discuss`: Codex proposes; Claude critiques/extends; Codex resolves.
- `critique`: Claude actively searches for failure modes and weak assumptions in a Codex proposal.
- `second-opinion`: Claude analyzes independently before seeing Codex's conclusion when practical.
- `review`: Claude reviews code/design; Codex adjudicates and performs final review.
- `debate`: bounded multi-round disagreement for consequential decisions. Default maximum: 2 response rounds after the initial proposal. Escalate unresolved material disagreement to Human.

Do not run open-ended agent debates.

## Resource policy

- Preserve Codex capacity for engineering leadership, architecture, integration, difficult defects, and final review.
- Delegate suitable bounded work when doing so improves throughput or preserves lead capacity.
- Treat `WAIT`/`PAUSE` as valid scheduler decisions; do not consume an agent merely because it is available.
- Before a resource-driven pause, create a checkpoint sufficient to resume without reconstructing the session.
- Never claim exact remaining provider quota unless telemetry is actually provider/client reported. Label resource readings `exact`, `derived`, or `estimated`.
- Scheduling should consider remaining capacity, reset time, burn rate, task priority, expected task cost, dependencies, and capacity needed to finish/review the milestone.

## Shared state

- `docs/HANDOFF.md` remains the human-readable multi-agent communication log.
- `.ai-orchestrator/state.json` is runtime scheduler state and is intentionally not committed.
- `.ai-orchestrator/checkpoints/` stores resumable task checkpoints; only durable examples/templates belong in Git.
- Durable architecture decisions belong in the existing canonical ClueXP design docs, not only in agent transcripts.
- Spec-driven work lives under `specs/<###-feature-slug>/` with `spec.md`, `plan.md`, `tasks.md`, and optional `checklists/`.
- Project-wide Spec Kit policy and templates live under `.specify/`; do not treat generated specs as higher authority than `docs/EXECUTION-PLAN.md` or `docs/SYSTEM-DESIGN.md`.

## Safety and repository rules

- Preserve all existing ClueXP trust-state/API-contract rules.
- Never commit secrets or provider credentials.
- No production DDL, production promotion, or deployment without explicit Human authorization.
- Use isolated branches/worktrees for concurrent agents. One writer per surface at a time.
- Delegated work is not complete until Codex has reviewed it and required tests/CI are green.
- Do not merge agent-authored implementation until the pull request links the relevant Spec Kit artifacts or explains why the change is exempt.
