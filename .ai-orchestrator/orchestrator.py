#!/usr/bin/env python3
"""Local ClueXP Codex/Claude orchestration adapter.

This runs on the developer workstation where both CLIs are authenticated.
It deliberately uses subprocess argv (no shell=True), persists runtime state
under the gitignored .ai-orchestrator/runtime directory, and never fabricates
provider quota. Usage is recorded only when a provider exposes it; otherwise
confidence remains `estimated`/`unknown` and scheduling relies on configured
reserves plus observed session burn.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".ai-orchestrator" / "runtime"
CHECKPOINTS = RUNTIME / "checkpoints"
EVENTS = RUNTIME / "events.jsonl"
# Adapter-level failures; these are not provider CLI exit codes.
AGENT_TIMEOUT_RETURN_CODE = 124
AGENT_LAUNCH_RETURN_CODE = 126


@dataclass
class AgentStatus:
    agent: str
    available: bool
    executable: str | None
    confidence: str = "unknown"
    remaining_percent: float | None = None
    reset_at: str | None = None
    note: str = "Provider quota not exposed by adapter."


def _log(kind: str, **payload: Any) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with EVENTS.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": time.time(), "kind": kind, **payload}) + "\n")


def discover() -> dict[str, AgentStatus]:
    return {
        "codex": AgentStatus("codex", bool(shutil.which("codex")), shutil.which("codex")),
        "claude": AgentStatus("claude", bool(shutil.which("claude")), shutil.which("claude")),
    }


def _stream_text(value: str | bytes | None) -> str:
    """Normalize captured process output without assuming it is present or decodable."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def _failed_agent_output(agent: str, result: subprocess.CompletedProcess[str]) -> str:
    """Return contextual diagnostics even when a failed command has sparse output."""
    stderr = _stream_text(result.stderr).strip()
    stdout = _stream_text(result.stdout).strip()
    details = []
    if stderr:
        details.append(f"stderr:\n{stderr}")
    if stdout:
        details.append(f"stdout:\n{stdout}")
    header = f"{agent} command failed with exit code {result.returncode}."
    return "\n".join([header, *details])


def _configure_stdio() -> None:
    """Keep redirected Windows console streams from reintroducing locale decoding errors."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def run_agent(
    agent: str,
    prompt: str,
    cwd: Path = ROOT,
    timeout: int = 1800,
    *,
    read_only: bool = False,
) -> subprocess.CompletedProcess[str]:
    exe = shutil.which(agent)
    if not exe:
        raise RuntimeError(f"{agent} executable not found on PATH")

    # Keep substantive prompts off argv: Windows has a small command-line limit,
    # while both supported non-interactive entrypoints accept text through stdin.
    if agent == "codex":
        argv = [exe, "exec", "--skip-git-repo-check"]
        if read_only:
            argv.extend(["--sandbox", "read-only"])
        argv.append("-")
    elif agent == "claude":
        argv = [exe, "-p", "--input-format", "text"]
        if read_only:
            argv.extend(["--permission-mode", "plan"])
    else:
        raise ValueError(agent)

    started = time.time()
    child_env = os.environ.copy()
    child_env["PYTHONUTF8"] = "1"
    child_env["PYTHONIOENCODING"] = "utf-8"
    try:
        result = subprocess.run(
            argv,
            cwd=str(cwd),
            input=prompt,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
            env=child_env,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = _stream_text(exc.stdout)
        stderr = _stream_text(exc.stderr)
        message = f"{agent} command timed out after {timeout} seconds."
        stderr = f"{stderr.rstrip()}\n{message}" if stderr.strip() else message
        result = subprocess.CompletedProcess(argv, AGENT_TIMEOUT_RETURN_CODE, stdout, stderr)
    except OSError as exc:
        result = subprocess.CompletedProcess(
            argv,
            AGENT_LAUNCH_RETURN_CODE,
            "",
            f"Unable to launch {agent} command: {exc}",
        )

    # Keep downstream handling safe even if a mocked or platform-specific runner
    # supplies missing/byte streams despite text capture being requested.
    result.stdout = _stream_text(result.stdout)
    result.stderr = _stream_text(result.stderr)
    _log(
        "agent_run",
        agent=agent,
        duration_seconds=round(time.time() - started, 2),
        returncode=result.returncode,
    )
    return result


def checkpoint(task_id: str, agent: str, payload: dict[str, Any]) -> Path:
    CHECKPOINTS.mkdir(parents=True, exist_ok=True)
    path = CHECKPOINTS / f"{task_id}-{agent}.json"
    payload = {"task_id": task_id, "agent": agent, "created_at": time.time(), **payload}
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    _log("checkpoint", task_id=task_id, agent=agent, path=str(path.relative_to(ROOT)))
    return path


def choose_agent(priority: str, risk: str, statuses: dict[str, AgentStatus]) -> str:
    """Conservative deterministic routing. Codex remains lead/final reviewer."""
    if risk in {"high", "critical"}:
        return "codex" if statuses["codex"].available else "WAIT"
    if statuses["claude"].available and priority != "critical":
        return "claude"
    if statuses["codex"].available:
        return "codex"
    return "WAIT"


def discuss(proposition: str, rounds: int = 2) -> int:
    statuses = discover()
    if not statuses["codex"].available or not statuses["claude"].available:
        missing = [a for a, s in statuses.items() if not s.available]
        print(f"Cannot discuss: missing local CLI(s): {', '.join(missing)}", file=sys.stderr)
        return 2

    codex_prompt = (
        "You are Codex, ClueXP Engineering Lead. Read AGENTS.md and relevant canonical docs. "
        "Propose a concise technical position with assumptions, risks, and acceptance criteria. "
        f"Proposition: {proposition}"
    )
    codex = run_agent("codex", codex_prompt, read_only=True)
    if codex.returncode:
        print(_failed_agent_output("codex", codex), file=sys.stderr)
        return codex.returncode
    lead = _stream_text(codex.stdout).strip()
    print("\n=== CODEX PROPOSAL ===\n" + lead)

    for n in range(1, rounds + 1):
        critique_prompt = (
            "You are Claude Code, ClueXP specialist/critic. Read CLAUDE.md and AGENTS.md. "
            "Critique the Codex proposal below. Find blocking correctness/security/tenancy/API/data risks, "
            "then optional improvements. Do not agree reflexively.\n\nCODEX PROPOSAL:\n" + lead
        )
        claude = run_agent("claude", critique_prompt, read_only=True)
        if claude.returncode:
            print(_failed_agent_output("claude", claude), file=sys.stderr)
            return claude.returncode
        critique = _stream_text(claude.stdout).strip()
        print(f"\n=== CLAUDE CRITIQUE {n} ===\n{critique}")

        resolve_prompt = (
            "You are Codex, ClueXP Engineering Lead and final technical reviewer. Read AGENTS.md. "
            "Resolve Claude's critique against your prior proposal. Accept valid findings, reject weak ones with reasons, "
            "and output the revised decision plus unresolved items requiring Human Product Owner authority.\n\n"
            f"PRIOR PROPOSAL:\n{lead}\n\nCLAUDE CRITIQUE:\n{critique}"
        )
        resolved = run_agent("codex", resolve_prompt, read_only=True)
        if resolved.returncode:
            print(_failed_agent_output("codex", resolved), file=sys.stderr)
            return resolved.returncode
        lead = _stream_text(resolved.stdout).strip()
        print(f"\n=== CODEX RESOLUTION {n} ===\n{lead}")

    checkpoint("discussion", "codex", {"completed": "bounded discussion", "remaining": [], "blockers": [], "next_action": lead})
    return 0


def main() -> int:
    _configure_stdio()
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor")
    route = sub.add_parser("route")
    route.add_argument("--priority", choices=["low", "normal", "high", "critical"], default="normal")
    route.add_argument("--risk", choices=["low", "normal", "high", "critical"], default="normal")
    debate = sub.add_parser("discuss")
    debate.add_argument("proposition")
    debate.add_argument("--rounds", type=int, choices=[1, 2], default=2)

    args = parser.parse_args()
    statuses = discover()
    if args.cmd == "doctor":
        print(json.dumps({k: asdict(v) for k, v in statuses.items()}, indent=2))
        return 0 if all(s.available for s in statuses.values()) else 1
    if args.cmd == "route":
        print(choose_agent(args.priority, args.risk, statuses))
        return 0
    if args.cmd == "discuss":
        return discuss(args.proposition, args.rounds)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
