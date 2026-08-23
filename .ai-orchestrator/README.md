# ClueXP Multi-Agent Orchestration Pilot

This directory defines the development control layer for Codex + Claude Code. It is not part of the ClueXP production runtime.

## Model

Human -> Codex Engineering Lead -> Codex/Claude execution -> tests/CI -> Codex final technical review.

The orchestrator is intentionally deterministic where possible. It manages scheduling, resource state, checkpoints, handoffs, and pause/resume. Engineering judgment remains with Codex; product authority remains with Human.

## Pilot phases

### Phase 1 — protocol (this branch)

- establish Codex-led authority in `AGENTS.md`;
- establish Claude's specialist/critic contract in `CLAUDE.md`;
- define resource and debate policy in `config.yaml`;
- retain `docs/HANDOFF.md` as the durable human-readable communication channel.

### Phase 2 — local adapters

Run on the developer machine where Codex CLI and Claude Code are authenticated. Implement adapters that:

- invoke each client through supported local interfaces/MCP;
- collect only telemetry actually exposed by the installed client/provider;
- normalize capacity/reset/burn-rate signals;
- label every measurement exact, derived, or estimated;
- checkpoint before resource exhaustion and resume queued work after capacity returns.

Provider credentials/tokens must remain local and must never be committed.

### Phase 3 — scheduler

Route a task to Codex, Claude, or WAIT using task risk/priority/dependencies plus resource state. Preserve Codex reserve for leadership, integration, and final review. Support bounded `discuss`, `critique`, `second-opinion`, `review`, and `debate` workflows.

### Phase 4 — validate on real ClueXP work

Use a bounded real task. Compare agent utilization, duplicate work, review quality, context reconstruction, and time-to-green-CI against the current manual handoff workflow before replicating the pattern to other projects.

## Important limitation

GitHub alone cannot inspect the authenticated local Codex/Claude installations or their subscription quota displays. Exact quota telemetry therefore cannot be implemented safely from the repository connector alone. The local adapter phase must be executed where those clients run. Until then, do not present estimated capacity as exact.
