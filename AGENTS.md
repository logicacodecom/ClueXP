# ClueXP Agent Operating Contract

## Authority

- Human is Product Owner only: product/business authority, risk acceptance, and the production authorizations in `.specify/memory/constitution.md`. The Human is not a code reviewer or PR approval gate.
- Hermes is the engineering orchestrator and accountable engineering lead: coordination, disagreement resolution, and deploy-incident ownership.
- Codex is architect, lead engineer, implementer, and reviewer.
- Claude Code is implementer and reviewer.
- Other agents may work when useful.
- Orca worktrees are the active coordination surface for new work. Orca schedules work and manages resources; it does not make product or architecture decisions.
- CI/tests are objective gates. Passing CI does not replace independent secondary-agent review for risky changes.

## Required workflow

1. Hermes (or Codex acting as lead for a task) interprets the requested engineering outcome and owns the implementation plan.
2. Tasks are classified by risk, context, dependency, and expected effort.
3. For material feature, API, database, production policy, launch, or AI-agent integration work, Spec Kit artifacts under `specs/` are created or verified before implementation, following `.specify/memory/constitution.md`.
4. Any agent may execute directly or delegate a bounded task to another agent.
5. Changes involving database migrations, authentication/authorization, RLS or tenant isolation, cross-tenant data, dispatch routing/state/offer lifecycle, public API or MCP contracts, payment/billing semantics, production/security secrets or configuration, GitHub Actions/SDLC enforcement, or production runbooks/deployment workflows require review by a secondary agent from a different agent family than every author.
6. The reviewer records the `## Review Record` (authors, reviewer, scope, reviewed head, result, merge owner) in the pull-request body as defined in `.specify/memory/constitution.md`.
7. For important design decisions Codex may invoke a controlled discussion/critique loop with Claude.
8. Claude returns findings/work plus assumptions, files touched, tests run, unresolved risks, and recommended next action.
9. Any agent merges, or arms auto-merge, once the constitution's merge gates pass; Hermes resolves engineering disagreements and escalates only Product Owner categories.
10. Human approval (Product Owner authorization) is required only for the categories listed in `.specify/memory/constitution.md`; there is no human code review or PR approval.

## Discussion modes

- `discuss`: Codex proposes; Claude critiques/extends; Codex resolves.
- `critique`: Claude actively searches for failure modes and weak assumptions in a Codex proposal.
- `second-opinion`: Claude analyzes independently before seeing Codex's conclusion when practical.
- `review`: an agent from a different family reviews code/design and records the Review Record; Hermes adjudicates disagreements.
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
- No production DDL/migrations, activation, out-of-band promotion/rollback, secret/domain/platform change, or real send/transaction without explicit Product Owner authorization. Merging to `main` is the normal production deployment and must be safe live.
- Use isolated branches/worktrees for concurrent agents. One writer per surface at a time.
- Direct pushes to `main` are forbidden. GitHub branch protection enforces pull requests, the required `secret-scan`, `sdlc-policy`, `web`, `api`, and `mcp-server` checks on up-to-date branches, conversation resolution, and `enforce_admins` (no admin bypass). No human approval is required.
- Before merging or arming auto-merge, check for open `deploy-incident` issues; while one is open only `incident-fix` PRs merge, and Hermes disarms queued auto-merges.
- Work is not complete until required tests/CI are green and, for risky changes, an independent agent has recorded `approve` at the current head.
- Do not merge agent-authored implementation until the pull request links the relevant Spec Kit artifacts or explains why the change is exempt.
