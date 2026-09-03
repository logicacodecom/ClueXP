# ClueXP Agent Operating Contract

## Authority

- Human is Product Owner and retains product/business authority.
- Codex is Engineering Lead and final technical reviewer.
- Claude Code is a delegated specialist, critic, second-opinion reviewer, and bounded implementation agent.
- Orca worktrees are the active coordination surface for new work. Orca schedules work and manages resources; it does not make product or architecture decisions.
- CI/tests are objective gates. Passing CI does not replace Codex review for delegated work.

## Required workflow

1. Codex interprets the requested engineering outcome and owns the implementation plan.
2. Codex classifies tasks by risk, context, dependency, and expected effort.
3. For material feature, API, database, production policy, launch, or AI-agent integration work, Codex creates or verifies Spec Kit artifacts under `specs/` before implementation, following `.specify/memory/constitution.md`.
4. Codex may execute directly or delegate a bounded task to Claude.
5. Changes involving database migrations, authentication/authorization, RLS or tenant isolation, cross-tenant data, dispatch routing/state/offer lifecycle, public API or MCP contracts, payment/billing semantics, production/security secrets or configuration, GitHub Actions/SDLC enforcement, or production runbooks/deployment workflows require review by a secondary agent who did not author the change.
6. The secondary reviewer records the required/completed status, reviewer agent, and result in the pull-request body or the feature's local SDLC checklist as defined in `docs/AI-SDLC-WORKFLOW.md`.
7. For important design decisions Codex may invoke a controlled discussion/critique loop with Claude.
8. Claude returns findings/work plus assumptions, files touched, tests run, unresolved risks, and recommended next action.
9. Codex reviews delegated output, resolves disagreements, integrates/fixes as needed, and performs final technical review.
10. Human approval remains mandatory where existing ClueXP rules require it, especially production DDL/deployments and product-scope decisions.

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

- `docs/AI-SDLC-WORKFLOW.md` is the operational workflow reference.
- New task state belongs in the relevant Spec Kit feature directory and Orca task/worktree state.
- Orca worktrees are required for concurrent agent work; assign one writer per file/surface and record ownership in `tasks.md` or the Orca task/worktree before editing.
- `docs/HANDOFF.md` remains a human-readable historical communication log; promote durable decisions into canonical docs or feature specs.
- `.ai-orchestrator/*`, including `state.json` and `checkpoints/`, is legacy/historical reference only. Do not put new task state there. Reconsider it only as incidental cleanup when related work already touches that area and the Human explicitly approves the disposition.
- Durable architecture decisions belong in the existing canonical ClueXP design docs, not only in agent transcripts.
- Spec-driven work lives under `specs/<###-feature-slug>/` with `spec.md`, `plan.md`, `tasks.md`, and optional `checklists/`.
- Project-wide Spec Kit policy and templates live under `.specify/`; do not treat generated specs as higher authority than `docs/EXECUTION-PLAN.md` or `docs/SYSTEM-DESIGN.md`.

## Safety and repository rules

- Preserve all existing ClueXP trust-state/API-contract rules.
- Never commit secrets or provider credentials.
- No production DDL, production promotion, or deployment without explicit Human authorization.
- Use isolated branches/worktrees for concurrent agents. One writer per surface at a time.
- Team policy forbids direct pushes to `main`. GitHub branch protection enforces pull requests, code-owner review, one approval, conversation resolution, and the required `secret-scan`, `sdlc-policy`, `web`, `api`, and `mcp-server` checks for non-admin contributors. Organization admins retain an emergency bypass until the Human chooses to enable `enforce_admins`.
- Delegated work is not complete until Codex has reviewed it and required tests/CI are green.
- Do not merge agent-authored implementation until the pull request links the relevant Spec Kit artifacts or explains why the change is exempt.
