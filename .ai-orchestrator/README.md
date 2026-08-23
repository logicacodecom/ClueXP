# ClueXP Multi-Agent Orchestration Pilot

This directory defines the development control layer for Codex + Claude Code. It is not part of the ClueXP production runtime.

## Model

Human -> Codex Engineering Lead -> Codex/Claude execution -> tests/CI -> Codex final technical review.

The orchestrator is intentionally deterministic where possible. It manages scheduling, resource state, checkpoints, handoffs, and pause/resume. Engineering judgment remains with Codex; product authority remains with Human.

## Current implementation

`orchestrator.py` is the first local adapter/scheduler. Run it from the repository root on the workstation where Codex CLI and Claude Code are already authenticated:

```bash
python .ai-orchestrator/orchestrator.py doctor
python .ai-orchestrator/orchestrator.py route --priority normal --risk low
python .ai-orchestrator/orchestrator.py discuss "Review the next ClueXP implementation decision" --rounds 2
```

`doctor` discovers the local `codex` and `claude` executables without reading credentials. `discuss` executes the required Codex-proposal -> Claude-critique -> Codex-resolution loop and checkpoints the result. Runtime events/checkpoints are written under `.ai-orchestrator/runtime/`, which is gitignored.

## Pilot phases

### Phase 1 — protocol — implemented

- Codex-led authority in `AGENTS.md`;
- Claude specialist/critic contract in `CLAUDE.md`;
- resource/debate policy in `config.yaml`;
- `docs/HANDOFF.md` retained as the durable human-readable communication channel.

### Phase 2 — local adapters — implementation committed, workstation execution required

The adapter:

- invokes Codex through its non-interactive `exec` entrypoint;
- invokes Claude Code through its non-interactive print entrypoint;
- uses argv subprocess execution rather than shell interpolation;
- records run duration/return status locally;
- never reads or commits provider credentials;
- never invents remaining quota.

The final workstation step is to run `doctor` and one bounded `discuss` command where both authenticated clients exist.

### Phase 3 — scheduler — initial deterministic router implemented

The initial router can return `codex`, `claude`, or `WAIT`. High/critical-risk work stays with Codex. Lower-risk bounded work prefers Claude when available, preserving Codex for leadership/final review. The next scheduler increment will incorporate real capacity/reset signals only if the installed clients expose them reliably.

### Phase 4 — validate on real ClueXP work

Use a bounded real task. Compare agent utilization, duplicate work, review quality, context reconstruction, and time-to-green-CI against the current manual handoff workflow before replicating the pattern to other projects.

## Usage telemetry boundary

Do not confuse API rate limits with ChatGPT/Claude subscription usage windows. OpenAI API responses expose token usage and API models have tier-based rate limits, but those are not automatically the same as the authenticated Codex product usage allowance. The same principle applies to Claude Code. The orchestrator therefore labels quota as unknown unless a supported local/provider interface supplies it. Session duration/burn may be used as an estimate, but must never be presented as exact remaining capacity.
