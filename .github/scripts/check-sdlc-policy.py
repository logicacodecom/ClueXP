#!/usr/bin/env python3
"""Diff-aware Spec Kit and agent-review policy gate for ClueXP (specs/004).

PR events evaluate the current PR metadata from the GitHub API; push events to main are
post-merge diagnostics only; --base/--head evaluates committed content; --working-tree is
a preflight that never satisfies review.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


RISKY_PATTERNS = {
    "database migration": [
        "packages/db/alembic/versions/**",
        "packages/db/**/*.sql",
    ],
    "auth or authorization": [
        "apps/intake-web/api/auth.py",
        "apps/**/auth/**",
        "**/*auth*.py",
        "**/*auth*.js",
        "**/*auth*.jsx",
        "**/*auth*.ts",
        "**/*auth*.tsx",
        "apps/cluexp-mcp-server/mcp_server/oauth.py",
    ],
    "public API or MCP contract": [
        "docs/openapi-v1-snapshot.json",
        "apps/intake-web/api/schema.py",
        "apps/intake-web/api/main.py",
        "apps/intake-web/scripts/export_openapi_v1.py",
        "packages/api-client/**",
        "apps/cluexp-mcp-server/api/**",
        "apps/cluexp-mcp-server/chatgpt-app-submission.json",
        "apps/cluexp-mcp-server/mcp_server/asgi.py",
        "apps/cluexp-mcp-server/mcp_server/client.py",
        "apps/cluexp-mcp-server/mcp_server/server.py",
    ],
    "RLS, tenant isolation, or cross-tenant data": [
        "**/*tenant*",
        "**/*TENANT*",
        "**/*rls*",
        "**/*RLS*",
        "apps/intake-web/api/store.py",
        "apps/intake-web/api/storage.py",
        "apps/intake-web/api/settings.py",
        "apps/intake-web/api/closeout_catalog.py",
        "apps/intake-web/api/tests/test_postgres_security.py",
        "apps/intake-web/api/tests/test_rls_schema_guard.py",
    ],
    "dispatch routing, state, or offer lifecycle": [
        "apps/**/dispatch/**",
        "apps/intake-web/api/dispatch.py",
        "apps/intake-web/api/communications.py",
        "apps/intake-web/api/push.py",
        "apps/technician-web/src/components/live-offers.tsx",
        "apps/technician-web/src/app/api/offers/**",
        "apps/technician-web/src/app/offer/**",
        "apps/provider-web/src/app/api/provider/jobs/*/recall-offer/**",
        "apps/provider-web/src/app/api/provider/settings/dispatch/**",
    ],
    "payments or billing semantics": [
        "apps/**/billing/**",
        "apps/**/payments/**",
        "apps/**/settlements/**",
        "apps/**/*billing*.py",
        "apps/**/*billing*.js",
        "apps/**/*billing*.jsx",
        "apps/**/*billing*.ts",
        "apps/**/*billing*.tsx",
        "apps/**/*payment*.py",
        "apps/**/*payment*.ts",
        "apps/**/*payment*.tsx",
        "apps/**/*settlement*.py",
        "apps/**/*settlement*.ts",
        "apps/**/*settlement*.tsx",
    ],
    "secrets, environment, or production security config": [
        ".env*",
        "**/.env*",
        "apps/intake-web/api/config.py",
        "apps/**/vercel.json",
        ".vercel*.json",
    ],
    "GitHub Actions or SDLC policy enforcement": [
        "AGENTS.md",
        "CLAUDE.md",
        ".specify/memory/constitution.md",
        ".specify/templates/**",
        ".github/workflows/**",
        ".github/scripts/**",
        ".github/pull_request_template.md",
        ".github/copilot-instructions.md",
        ".github/CODEOWNERS",
        "docs/AI-SDLC-WORKFLOW.md",
    ],
    "production runbook, deployment, or external platform": [
        "docs/PRODUCTION-READINESS.md",
        "docs/PILOT-OPERATIONS.md",
        "docs/PRIVACY-SECURITY-REVIEW.md",
        "docs/AGENT-INTEGRATION-MCP-PLAN.md",
        "docs/AGENT-PLATFORM-SUBMISSION-PACKAGE.md",
        "**/*RUNBOOK*.md",
        "**/*runbook*.md",
    ],
}

MATERIAL_PATTERNS = RISKY_PATTERNS

SPEC_MD_PATTERN = "specs/*/spec.md"
PLAN_MD_PATTERN = "specs/*/plan.md"
TASKS_MD_PATTERN = "specs/*/tasks.md"
CHECKLIST_PATTERN = "specs/*/checklists/*.md"

# --- Review record (specs/004 FR-001) ---
RECORD_HEADING = "## Review Record"
RECORD_KEYS = {
    "secondary-agent review required",
    "author agents",
    "reviewer agent",
    "review scope",
    "reviewed head",
    "review result",
    "merge owner",
}
KNOWN_FAMILIES = {"claude code", "codex", "hermes"}
OTHER_ALIASES = {"claude": "claude code", "claude code": "claude code", "codex": "codex", "hermes": "hermes"}
OTHER_NAME_RE = re.compile(r"[a-z0-9 ._-]{1,40}")
SHA_RE = re.compile(r"[0-9a-f]{40}")
ZERO_SHA = "0" * 40


@dataclass(frozen=True)
class Match:
    path: str
    category: str


@dataclass(frozen=True)
class Entry:
    status: str  # first letter of git status: A, M, D, R, C, T, ...
    src: str | None
    dst: str | None
    mode: str  # new file mode, e.g. 100644; "000000" for deletions


class PolicyError(Exception):
    pass


def normalize_path(path: str) -> str:
    normalized = path.strip().replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def matches(path: str, pattern: str) -> bool:
    return fnmatch.fnmatchcase(path, pattern)


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True)


def git_ok(*args: str) -> bool:
    return subprocess.run(["git", *args], capture_output=True).returncode == 0


def parse_raw_diff(output: str) -> list[Entry]:
    """Parse `git diff --raw -z` output (status-aware, keeps deletions and both rename endpoints)."""
    tokens = output.split("\0")
    entries: list[Entry] = []
    i = 0
    while i < len(tokens):
        header = tokens[i]
        if not header.startswith(":"):
            i += 1
            continue
        fields = header[1:].split()
        new_mode, status = fields[1], fields[4][0]
        if status in {"R", "C"}:
            src, dst = normalize_path(tokens[i + 1]), normalize_path(tokens[i + 2])
            i += 3
        else:
            path = normalize_path(tokens[i + 1])
            src, dst = (path, None) if status == "D" else (path if status != "A" else None, path)
            i += 2
        entries.append(Entry(status=status, src=src, dst=dst, mode=new_mode))
    return entries


def range_entries(diff_range: str) -> list[Entry]:
    return parse_raw_diff(git("diff", "--raw", "-M", "-C", "-z", diff_range))


def working_tree_entries() -> list[Entry]:
    entries = parse_raw_diff(git("diff", "--raw", "-M", "-C", "-z"))
    entries += parse_raw_diff(git("diff", "--cached", "--raw", "-M", "-C", "-z"))
    for path in git("ls-files", "--others", "--exclude-standard", "-z").split("\0"):
        if path:
            entries.append(Entry(status="A", src=None, dst=normalize_path(path), mode="100644"))
    return entries


def classify(paths: list[str]) -> list[Match]:
    found: list[Match] = []
    for raw_path in paths:
        path = normalize_path(raw_path)
        if not path:
            continue
        for category, patterns in MATERIAL_PATTERNS.items():
            if any(matches(path, pattern) for pattern in patterns):
                found.append(Match(path=path, category=category))
                break
    return found


def risk_paths(entries: list[Entry]) -> list[str]:
    """Both endpoints count for risk: deleting or renaming away a risky file is risky (FR-007)."""
    paths: list[str] = []
    for entry in entries:
        for path in (entry.src, entry.dst):
            if path and path not in paths:
                paths.append(path)
    return paths


def surviving_paths(entries: list[Entry]) -> list[str]:
    """Only surviving destinations supply artifacts; deleted artifacts never count (FR-007/FR-008)."""
    return [e.dst for e in entries if e.dst and e.status in {"A", "M", "R", "C"}]


def artifact_dirs(paths: list[str], pattern: str) -> set[str]:
    directories: set[str] = set()
    for raw_path in paths:
        path = normalize_path(raw_path)
        if not matches(path, pattern):
            continue
        pure_path = PurePosixPath(path)
        if pattern == CHECKLIST_PATTERN:
            directories.add(str(pure_path.parent.parent))
        else:
            directories.add(str(pure_path.parent))
    return directories


def complete_artifact_dirs(paths: list[str]) -> set[str]:
    return (
        artifact_dirs(paths, SPEC_MD_PATTERN)
        & artifact_dirs(paths, PLAN_MD_PATTERN)
        & artifact_dirs(paths, TASKS_MD_PATTERN)
        & artifact_dirs(paths, CHECKLIST_PATTERN)
    )


# --- Review record grammar (FR-001) ---

def has_record(text: str | None) -> bool:
    return bool(text) and _record_blocks(text) != []


FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def _fence_open(line: str) -> tuple[str, int] | None:
    """CommonMark fence opener: up to 3 spaces, >=3 backticks or tildes; a backtick
    fence's info string may not contain a backtick."""
    m = FENCE_OPEN_RE.match(line)
    if not m:
        return None
    marker, info = m.group(1), m.group(2)
    if marker[0] == "`" and "`" in info:
        return None
    return marker[0], len(marker)


def _fence_closes(line: str, char: str, length: int) -> bool:
    """A closer uses the SAME character, at least the opener's length, up to 3 spaces
    of indent, and nothing but whitespace after."""
    m = re.match(r"^ {0,3}(" + re.escape(char) + r"{3,})\s*$", line)
    return bool(m) and len(m.group(1)) >= length


def _record_blocks(text: str) -> list[list[str]]:
    """Return the content lines of each `## Review Record` block that sits outside fenced
    code. Fenced lines are never part of a block (FR-001)."""
    blocks: list[list[str]] = []
    current: list[str] | None = None
    fence: tuple[str, int] | None = None
    for raw in text.replace(chr(13), "").split(chr(10)):
        if fence is not None:
            if _fence_closes(raw, *fence):
                fence = None
            continue
        opened = _fence_open(raw)
        if opened is not None:
            fence = opened
            continue
        if raw.rstrip() == RECORD_HEADING:
            current = []
            blocks.append(current)
            continue
        if current is not None and (raw.startswith("# ") or raw.startswith("## ")):
            current = None
            continue
        if current is not None:
            current.append(raw)
    return blocks


def normalize_agent(value: str) -> str:
    """Return the agent family, or raise PolicyError (FR-001)."""
    text = " ".join(value.strip().lower().split())
    if text in KNOWN_FAMILIES:
        return text
    if text.startswith("other:"):
        name = " ".join(text[len("other:"):].split())
        if not name:
            raise PolicyError(f"invalid agent {value!r}: Other needs a name")
        if name in OTHER_ALIASES:
            return OTHER_ALIASES[name]
        if not OTHER_NAME_RE.fullmatch(name):
            raise PolicyError(f"invalid agent {value!r}: name must match [A-Za-z0-9 ._-]{{1,40}}")
        return f"other:{name}"
    raise PolicyError(f"invalid agent {value!r}: use Claude Code, Codex, Hermes, or Other: <name>")


def parse_record(text: str) -> dict:
    """Parse exactly one `## Review Record` block into validated fields (FR-001)."""
    blocks = _record_blocks(text or "")
    if len(blocks) != 1:
        raise PolicyError(f"expected exactly one '{RECORD_HEADING}' block, found {len(blocks)}")
    raw: dict[str, str] = {}
    for line in blocks[0]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped[:2] in {"- ", "* "}:
            stripped = stripped[2:]
        stripped = stripped.replace("**", "").replace("`", "")
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        key = " ".join(key.strip().lower().split())
        if key not in RECORD_KEYS:
            raise PolicyError(f"unknown review record key: {key!r}")
        if key in raw:
            raise PolicyError(f"duplicate review record key: {key!r}")
        raw[key] = value.strip()
    missing = sorted(RECORD_KEYS - raw.keys())
    if missing:
        raise PolicyError(f"missing review record keys: {', '.join(missing)}")

    def choice(key: str, allowed: set[str]) -> str:
        value = raw[key].lower()
        if value not in allowed:
            raise PolicyError(f"invalid {key}: expected one of {', '.join(sorted(allowed))}")
        return value

    authors_raw = [part for part in raw["author agents"].split(",")]
    if not authors_raw or any(not part.strip() for part in authors_raw):
        raise PolicyError("invalid author agents: list one or more agents separated by commas")
    reviewed_head = raw["reviewed head"].strip()
    if not SHA_RE.fullmatch(reviewed_head):
        raise PolicyError("invalid reviewed head: expected a full 40-character lowercase commit SHA")
    return {
        "required": choice("secondary-agent review required", {"yes", "no"}),
        "authors": {normalize_agent(part) for part in authors_raw},
        "reviewer": normalize_agent(raw["reviewer agent"]),
        "scope": choice("review scope", {"implementation", "spec"}),
        "reviewed_head": reviewed_head,
        "result": choice("review result", {"approve", "changes-requested"}),
        "merge_owner": normalize_agent(raw["merge owner"]),
    }


# --- Review evaluation (FR-002..FR-006) ---

def post_review_errors(entries: list[Entry], complete_dirs: set[str]) -> list[str]:
    """Only regular Markdown checklists of the governing feature may change after review (FR-004)."""
    errors: list[str] = []
    allowed_prefixes = {f"{d}/checklists/" for d in complete_dirs}
    for entry in entries:
        path = entry.dst or entry.src or ""
        ok = (
            entry.status in {"A", "M"}
            and entry.mode == "100644"
            and entry.dst is not None
            and matches(entry.dst, CHECKLIST_PATTERN)
            and any(entry.dst.startswith(prefix) for prefix in allowed_prefixes)
        )
        if not ok:
            errors.append(f"changed after the reviewed head: {entry.status} {path} (re-review the current head)")
    return errors


def review_errors(record: dict, *, risky: bool, implementation: bool, target: str, complete_dirs: set[str]) -> list[str]:
    errors: list[str] = []
    if risky and record["required"] != "yes":
        errors.append("risky diff: 'Secondary-agent review required' must be yes")
    if record["required"] != "yes":
        return errors
    if record["result"] != "approve":
        errors.append(f"review result is {record['result']}; only approve satisfies the gate")
    if record["reviewer"] in record["authors"]:
        errors.append("reviewer agent must be a different agent family from every author (PO-7)")
    if implementation and record["scope"] != "implementation":
        errors.append("diff contains implementation paths: 'Review scope' must be implementation")
    reviewed = record["reviewed_head"]
    if reviewed != target:
        if not git_ok("cat-file", "-e", f"{reviewed}^{{commit}}") or not git_ok(
            "merge-base", "--is-ancestor", reviewed, target
        ):
            errors.append(f"reviewed head {reviewed[:12]} is not an ancestor of the current head {target[:12]}")
        else:
            errors.extend(post_review_errors(range_entries(f"{reviewed}..{target}"), complete_dirs))
    return errors


def evaluate(entries: list[Entry], record_text: str | None, target: str) -> tuple[list[str], list[Match], set[str]]:
    """Shared PR/local evaluation. Returns (errors, material matches, complete dirs)."""
    material = classify(risk_paths(entries))
    complete_dirs = complete_artifact_dirs(surviving_paths(entries))
    errors: list[str] = []
    if material and not complete_dirs:
        errors.append(
            "risky changes require spec.md, plan.md, tasks.md and one checklists/*.md changed "
            "(and surviving) in one specs/<feature>/ directory"
        )
    implementation = any(not m.path.startswith("specs/") for m in material)
    record = None
    if record_text and has_record(record_text):
        try:
            record = parse_record(record_text)
        except PolicyError as exc:
            errors.append(str(exc))
    elif material:
        errors.append(f"risky changes require a '{RECORD_HEADING}' block with an independent approve")
    if record is not None:
        errors.extend(
            review_errors(record, risky=bool(material), implementation=implementation, target=target,
                          complete_dirs=complete_dirs)
        )
    return errors, material, complete_dirs


def report(errors: list[str], material: list[Match], label: str) -> int:
    if material:
        print("Material paths:")
        for item in material:
            print(f"  - {item.path} ({item.category})")
    if errors:
        print(f"SDLC policy ({label}): FAIL")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(f"SDLC policy ({label}): OK" + ("" if material else " (no material path changes)"))
    return 0


# --- Modes (FR-009/FR-010) ---

def pr_mode() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import sdlc_github  # noqa: E402

    number = os.environ["PR_NUMBER"]
    event_head = os.environ.get("PR_HEAD_SHA", "")
    pr = sdlc_github.get_pull(number)
    target = pr["head"]["sha"]
    if event_head and target != event_head:
        print(f"SDLC policy: FAIL obsolete run (event head {event_head[:12]}, current head {target[:12]}); the newer run decides")
        return 1
    base = pr["base"]["sha"]
    for sha in (base, target):
        if not git_ok("cat-file", "-e", f"{sha}^{{commit}}"):
            subprocess.run(["git", "fetch", "--no-tags", "origin", sha], check=False)
    entries = range_entries(f"{base}...{target}")
    errors, material, _ = evaluate(entries, pr.get("body") or "", target)
    if not errors:
        again = sdlc_github.get_pull(number)
        if (again.get("body"), again["head"]["sha"], again.get("updated_at")) != (
            pr.get("body"), target, pr.get("updated_at")
        ):
            errors.append("metadata changed during evaluation; the newer run decides")
    return report(errors, material, f"PR #{number} at {target[:12]}")


def push_mode() -> int:
    before, after = os.environ.get("PUSH_BEFORE", ""), os.environ.get("PUSH_AFTER", "")
    if not after or not before or before == ZERO_SHA:
        print("SDLC policy (push): FAIL unexpected branch creation or missing range; diagnostics fail closed")
        return 1
    entries = range_entries(f"{before}..{after}")
    material = classify(risk_paths(entries))
    errors: list[str] = []
    if material and not complete_artifact_dirs(surviving_paths(entries)):
        errors.append("risky changes landed on main without complete Spec Kit artifacts")
    print("Push diagnostics only: review was enforced on the PR; this run does not prove review.")
    return report(errors, material, f"push {before[:12]}..{after[:12]}")


def local_mode(base: str, head: str, three_dot: bool, pr_body_file: str | None) -> int:
    target = git("rev-parse", head).strip()
    entries = range_entries(f"{base}...{target}" if three_dot else f"{base}..{target}")
    if pr_body_file:
        record_text = Path(pr_body_file).read_text(encoding="utf-8")
    else:
        complete_dirs = complete_artifact_dirs(surviving_paths(entries))
        candidates = []
        for path in surviving_paths(entries):
            if matches(path, CHECKLIST_PATTERN) and str(PurePosixPath(path).parent.parent) in complete_dirs:
                content = git("show", f"{target}:{path}")
                if has_record(content):
                    candidates.append(content)
        record_text = candidates[0] if len(candidates) == 1 else None
        if len(candidates) > 1:
            print("SDLC policy: FAIL more than one changed governing checklist carries a review record")
            return 1
    errors, material, _ = evaluate(entries, record_text, target)
    return report(errors, material, f"{base}..{head} at {target[:12]}")


def preflight_mode() -> int:
    entries = working_tree_entries()
    material = classify(risk_paths(entries))
    errors: list[str] = []
    if material and not complete_artifact_dirs(surviving_paths(entries)):
        errors.append("risky changes require complete Spec Kit artifacts in one feature directory")
    code = report(errors, material, "working tree preflight")
    print("review: not evaluated (preflight)")
    return code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", help="base git ref")
    parser.add_argument("--head", help="head git ref")
    parser.add_argument("--merge-base", action="store_true", help="use base...head instead of base..head")
    parser.add_argument("--working-tree", action="store_true", help="preflight uncommitted changes (never satisfies review)")
    parser.add_argument("--pr-body-file", help="evaluate this PR body text in --base/--head mode")
    args = parser.parse_args()

    if args.working_tree:
        return preflight_mode()
    if args.base and args.head:
        return local_mode(args.base, args.head, args.merge_base, args.pr_body_file)
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    if event == "pull_request":
        return pr_mode()
    if event == "push":
        return push_mode()
    print("SDLC policy: unsupported context; use --working-tree or --base/--head (or run in the sdlc-policy workflow)")
    return 2


if __name__ == "__main__":
    sys.exit(main())
