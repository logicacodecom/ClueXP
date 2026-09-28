#!/usr/bin/env python3
"""Release attribution and smoke checks for merge = deploy (specs/004 FR-013).

Subcommands:
  health <url>          semantic health check (status == ok; revision may be present/null)
  list-services <url>   MCP tools/call list_services semantic check
  verify                post-deploy: wait until BOTH projects serve a revision containing
                        the pushed commit (GitHub compare API), then smoke; on failure open a
                        `deploy-incident` issue. Unknown is never success.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

SHA_RE = re.compile(r"[0-9a-f]{40}")
PROJECTS = {
    "cluexp-intake": "https://intake.cluexp.com/api/healthz",
    "cluexp-mcp-server": "https://mcp.cluexp.com/healthz",
}
# Inputs each project's Vercel ignored-build step watches (scripts/vercel-ignore-build.sh).
# Keep in sync with the projects' commandForIgnoringBuildStep.
WATCHED = {
    "cluexp-intake": ("apps/intake-web/", "packages/", "package.json", "package-lock.json", ".vercelignore"),
    "cluexp-mcp-server": ("apps/cluexp-mcp-server/", ".vercelignore"),
}
MCP_URL ="https://mcp.cluexp.com/mcp"
LIST_SERVICES = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_services", "arguments": {}}}


# --- pure parsers (unit-tested) ---

def parse_health(text: str) -> tuple[bool, str | None, str]:
    """Return (healthy, revision, detail). Extra keys are allowed; status must be "ok"."""
    try:
        body = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return False, None, "health response is not JSON"
    if not isinstance(body, dict):
        return False, None, "health response is not an object"
    revision = body.get("revision")
    if revision is not None and not (isinstance(revision, str) and SHA_RE.fullmatch(revision)):
        revision = None
    if body.get("status") != "ok":
        return False, revision, f"status is {body.get('status')!r}"
    return True, revision, "ok"


def parse_list_services(raw: str) -> tuple[bool, str]:
    """Streamable HTTP answers as SSE ("data: {...}") or JSON. An API error inside the result fails."""
    payloads = [line[len("data:"):].strip() for line in raw.splitlines() if line.startswith("data:")]
    try:
        message = json.loads(payloads[-1] if payloads else raw)
    except (IndexError, json.JSONDecodeError) as exc:
        return False, f"unparseable MCP response: {exc}"
    result = message.get("result") if isinstance(message, dict) else None
    if not isinstance(result, dict) or result.get("isError"):
        return False, f"tool call failed: {message.get('error') if isinstance(message, dict) else message!r}"
    content = result.get("structuredContent")
    if not isinstance(content, dict):
        return False, "tool result has no structuredContent"
    if "error" in content:
        return False, f"list_services returned API error {content.get('error')!r} (status {content.get('status_code')})"
    categories = content.get("data")
    if not isinstance(categories, list) or not categories:
        return False, "list_services returned an empty service catalog"
    return True, f"{len(categories)} service categories"


def contains(pushed: str, revision: str | None, main_head: str, compare: Callable[[str, str], str],
             changed: Callable[[str, str], list[str] | None] | None = None, watched: tuple[str, ...] = ()) -> str:
    """yes | unchanged | no | unknown.

    yes: `revision` includes `pushed` and belongs to main. unchanged: `revision` is an older
    main commit and none of the project's watched inputs changed up to `pushed`, so the
    ignored-build step legitimately skipped this project.
    """
    if not revision or not SHA_RE.fullmatch(revision):
        return "no"
    try:
        status = compare(pushed, revision)
        if status == "behind" and changed and watched:
            files = changed(revision, pushed)
            if files is None:
                return "unknown"  # truncated diff: cannot prove the inputs are unchanged
            if any(f == w or f.startswith(w) for f in files for w in watched):
                return "no"
            status = "unchanged"
        elif status not in {"identical", "ahead"}:
            return "no"
        if compare(revision, main_head) not in {"identical", "ahead"}:
            return "no"  # descendant of pushed but not on main (e.g. a branch deployment)
    except Exception:  # noqa: BLE001 - API/network failure is "unknown", never success
        return "unknown"
    return "unchanged" if status == "unchanged" else "yes"


# --- I/O ---

def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "Pragma": "no-cache"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", "replace")


def http_post_mcp(url: str) -> str:
    req = urllib.request.Request(
        url,
        data=json.dumps(LIST_SERVICES).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "replace")


def observe(fetch: Callable[[str], str]) -> dict[str, tuple[bool, str | None, str]]:
    out = {}
    for name, url in PROJECTS.items():
        try:
            out[name] = parse_health(fetch(url))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            out[name] = (False, None, f"unreachable: {exc}")
    return out


def _sample(pushed, fetch, compare, main_head, changed=None):
    observed = observe(fetch)
    try:
        head = main_head()
    except Exception:  # noqa: BLE001 - an unknown main head never counts as success
        head = None
    states = {
        name: (contains(pushed, rev, head, compare, changed, WATCHED.get(name, ())) if head else "unknown")
        for name, (_, rev, _) in observed.items()
    }
    return observed, states


def _attributed(observed, states) -> bool:
    return all(s in {"yes", "unchanged"} for s in states.values()) and all(h for h, _, _ in observed.values())


def _describe(observed, states, label: str) -> list[str]:
    return [
        f"- {label} {name}: revision {rev or 'null'}, contains pushed: {states.get(name)}, health: {detail}"
        for name, (_, rev, detail) in observed.items()
    ]


def verify(
    pushed: str,
    *,
    fetch: Callable[[str], str],
    post_mcp: Callable[[str], str],
    compare: Callable[[str, str], str],
    main_head: Callable[[], str],
    changed: Callable[[str, str], list[str] | None] | None = None,
    timeout: float = 1200,
    interval: float = 30,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> tuple[bool, list[str]]:
    """Returns (ok, report lines).

    Success needs BOTH projects attributed and healthy before AND after the MCP smoke
    (Codex T024 finding 3): if production moves during the smoke (a rollback, or one project
    changing), retry within the deadline instead of trusting the pre-smoke sample.
    """
    deadline = clock() + timeout
    notes: list[str] = []
    while True:
        before, before_states = _sample(pushed, fetch, compare, main_head, changed)
        if _attributed(before, before_states):
            try:
                mcp_ok, mcp_detail = parse_list_services(post_mcp(MCP_URL))
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                mcp_ok, mcp_detail = False, f"unreachable: {exc}"
            after, after_states = _sample(pushed, fetch, compare, main_head, changed)
            lines = [f"pushed commit: {pushed}"] + notes + _describe(before, before_states, "before smoke")
            lines += [f"- mcp list_services: {mcp_detail}"] + _describe(after, after_states, "after smoke")
            if not _attributed(after, after_states):
                notes.append("- attribution changed during smoke; re-sampling")
                if clock() >= deadline:
                    return False, lines + ["RESULT: attribution changed during smoke (rollback or deployment movement)"]
                sleep(interval)
                continue
            if not mcp_ok:
                return False, lines + ["RESULT: attributed but MCP smoke failed"]
            return True, lines + ["RESULT: verified"]
        if clock() >= deadline:
            lines = [f"pushed commit: {pushed}"] + notes + _describe(before, before_states, "final")
            if all(s in {"yes", "unchanged"} for s in before_states.values()):
                return False, lines + ["RESULT: attributed but unhealthy"]
            return False, lines + ["RESULT: release not attributed (build failed/queued/rate-limited, rollback-paused, or unknown)"]
        sleep(interval)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("health").add_argument("url")
    sub.add_parser("list-services").add_argument("url")
    v = sub.add_parser("verify")
    v.add_argument("--pushed", default=os.environ.get("PUSH_AFTER", ""))
    v.add_argument("--timeout", type=float, default=1200)
    args = parser.parse_args()

    if args.cmd in {"health", "list-services"}:
        try:
            if args.cmd == "health":
                ok, rev, detail = parse_health(http_get(args.url))
                detail = f"health: {detail}; revision: {rev or 'null'}"
            else:
                ok, detail = parse_list_services(http_post_mcp(args.url))
        except urllib.error.HTTPError as exc:
            ok, detail = False, f"HTTP {exc.code} from {args.url}"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            ok, detail = False, f"unreachable {args.url}: {exc}"
        print(detail if ok else f"::error::{detail}")
        return 0 if ok else 1

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import sdlc_github  # noqa: E402

    if not SHA_RE.fullmatch(args.pushed or ""):
        print("verify: --pushed must be a 40-character commit SHA")
        return 2
    ok, lines = verify(
        args.pushed,
        fetch=http_get,
        post_mcp=http_post_mcp,
        compare=sdlc_github.compare_status,
        changed=sdlc_github.compare_files,
        main_head=lambda: sdlc_github.request("GET", f"/repos/{sdlc_github.repo()}/commits/main")["sha"],
        timeout=args.timeout,
    )
    report = "\n".join(lines)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        Path(summary).write_text("## Post-deploy verification\n\n" + report + "\n", encoding="utf-8")
    if not ok:
        run = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY', '')}/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}"
        body = report + f"\n\nRun: {run}\n\nHermes: acknowledge here, disarm armed auto-merges (`gh pr merge --disable-auto`), and resolve (specs/004 FR-011/FR-015)."
        try:
            print("incident:", sdlc_github.open_incident(f"deploy-incident: {args.pushed[:12]}", body))
        except Exception as exc:  # noqa: BLE001 - the job still fails red; Hermes treats red as an incident
            print(f"incident issue could not be created: {exc}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
