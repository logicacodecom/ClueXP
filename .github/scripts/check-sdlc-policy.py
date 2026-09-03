#!/usr/bin/env python3
"""Diff-aware Spec Kit policy gate for ClueXP pull requests."""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
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
        ".github/scripts/check-sdlc-policy.py",
        ".github/scripts/test_check_sdlc_policy.py",
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

REVIEW_MARKERS = {
    "secondary-agent review required": "yes",
    "secondary-agent review completed": "yes",
    "reviewer agent": {"claude code", "codex", "other"},
    "review result": "approve",
}


@dataclass(frozen=True)
class Match:
    path: str
    category: str


def normalize_path(path: str) -> str:
    normalized = path.strip().replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def matches(path: str, pattern: str) -> bool:
    return fnmatch.fnmatchcase(path, pattern)


def changed_files_from_git(args: argparse.Namespace) -> list[str]:
    if args.working_tree:
        unstaged = subprocess.check_output(
            ["git", "diff", "--name-only", "--diff-filter=ACMR"],
            text=True,
        )
        staged = subprocess.check_output(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
            text=True,
        )
        untracked = subprocess.check_output(
            ["git", "ls-files", "--others", "--exclude-standard"],
            text=True,
        )
        return unstaged.splitlines() + staged.splitlines() + untracked.splitlines()

    if args.base and args.head:
        diff_range = f"{args.base}...{args.head}" if args.merge_base else f"{args.base}..{args.head}"
    else:
        event_name = os.environ.get("GITHUB_EVENT_NAME", "")
        base_ref = os.environ.get("GITHUB_BASE_REF", "")
        before = os.environ.get("GITHUB_EVENT_BEFORE", "")
        sha = os.environ.get("GITHUB_SHA", "HEAD")
        if event_name == "pull_request" and base_ref:
            diff_range = f"origin/{base_ref}...HEAD"
        elif before and not set(before) <= {"0"}:
            diff_range = f"{before}..{sha}"
        else:
            diff_range = "HEAD^..HEAD"

    output = subprocess.check_output(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", diff_range],
        text=True,
    )
    return output.splitlines()


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


def parse_review_markers(text: str) -> dict[str, str]:
    markers: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip().lstrip("-* ").replace("**", "").replace("`", "")
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        normalized_key = " ".join(key.strip().lower().split())
        if normalized_key in REVIEW_MARKERS:
            markers[normalized_key] = " ".join(value.strip().lower().split())
    return markers


def secondary_review_errors(text: str) -> list[str]:
    markers = parse_review_markers(text)
    errors: list[str] = []
    for key, expected in REVIEW_MARKERS.items():
        actual = markers.get(key)
        if actual is None:
            errors.append(f"missing marker: {key}")
        elif isinstance(expected, set) and actual not in expected:
            errors.append(f"invalid {key}: expected one of {', '.join(sorted(expected))}")
        elif isinstance(expected, str) and actual != expected:
            errors.append(f"invalid {key}: expected {expected}")
    return errors


def pull_request_body() -> str | None:
    if os.environ.get("GITHUB_EVENT_NAME") not in {"pull_request", "pull_request_target"}:
        return None
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        return ""
    with open(event_path, encoding="utf-8") as event_file:
        event = json.load(event_file)
    return (event.get("pull_request") or {}).get("body") or ""


def checklist_review_evidence(complete_dirs: set[str]) -> list[tuple[str, str]]:
    evidence: list[tuple[str, str]] = []
    for directory in sorted(complete_dirs):
        checklist = Path(directory) / "checklists" / "sdlc-policy.md"
        if checklist.is_file():
            evidence.append((checklist.as_posix(), checklist.read_text(encoding="utf-8")))
    return evidence


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", help="base git ref")
    parser.add_argument("--head", help="head git ref")
    parser.add_argument("--merge-base", action="store_true", help="use base...head instead of base..head")
    parser.add_argument("--working-tree", action="store_true", help="check unstaged, staged, and untracked local files")
    parser.add_argument("--pr-body-file", help="read pull-request review markers from this file (for local validation)")
    args = parser.parse_args()

    paths = sorted(set(normalize_path(path) for path in changed_files_from_git(args) if path.strip()))
    material = classify(paths)
    if not material:
        print("SDLC policy: no material path changes detected.")
        return 0

    spec_dirs = artifact_dirs(paths, SPEC_MD_PATTERN)
    plan_dirs = artifact_dirs(paths, PLAN_MD_PATTERN)
    task_dirs = artifact_dirs(paths, TASKS_MD_PATTERN)
    checklist_dirs = artifact_dirs(paths, CHECKLIST_PATTERN)
    complete_dirs = spec_dirs & plan_dirs & task_dirs & checklist_dirs

    if not complete_dirs:
        print("SDLC policy: material changes require Spec Kit artifacts in the same PR.")
        print("\nMaterial paths:")
        for item in material:
            print(f"  - {item.path} ({item.category})")
        print("\nRequired artifacts must appear in one feature directory:")
        print(f"  - {SPEC_MD_PATTERN}")
        print(f"  - {PLAN_MD_PATTERN}")
        print(f"  - {TASKS_MD_PATTERN}")
        print(f"  - {CHECKLIST_PATTERN}")
        if spec_dirs | plan_dirs | task_dirs | checklist_dirs:
            print("\nArtifact directories found, but none are complete:")
            for directory in sorted(spec_dirs | plan_dirs | task_dirs | checklist_dirs):
                labels = []
                if directory in spec_dirs:
                    labels.append("spec")
                if directory in plan_dirs:
                    labels.append("plan")
                if directory in task_dirs:
                    labels.append("tasks")
                if directory in checklist_dirs:
                    labels.append("checklist")
                print(f"  - {directory}: {', '.join(labels)}")
        print("\nCreate/update a feature directory under specs/<###-feature-slug>/, or split the policy-exempt change into a docs-only PR.")
        return 1

    if args.pr_body_file:
        evidence = [(args.pr_body_file, Path(args.pr_body_file).read_text(encoding="utf-8"))]
    else:
        body = pull_request_body()
        evidence = [("pull request body", body)] if body is not None else checklist_review_evidence(complete_dirs)

    approved_source: str | None = None
    evidence_errors: list[tuple[str, list[str]]] = []
    for source, text in evidence:
        errors = secondary_review_errors(text)
        if not errors:
            approved_source = source
            break
        evidence_errors.append((source, errors))

    if approved_source is None:
        print("SDLC policy: risky changes require a completed, approving secondary-agent review.")
        print("\nRequired markers:")
        print("  Secondary-agent review required: yes")
        print("  Secondary-agent review completed: yes")
        print("  Reviewer agent: Claude Code|Codex|Other")
        print("  Review result: approve")
        if not evidence:
            print("\nNo review evidence was found in a changed Spec Kit checklist.")
        else:
            print("\nReview evidence errors:")
            for source, errors in evidence_errors:
                print(f"  - {source}: {', '.join(errors)}")
        print("\nPull requests must put the markers in the PR body. Local and non-PR checks must put them in specs/<feature>/checklists/sdlc-policy.md.")
        return 1

    print("SDLC policy: risky changes covered by Spec Kit artifacts and approved secondary-agent review.")
    print("Complete Spec Kit directories:")
    for directory in sorted(complete_dirs):
        print(f"  - {directory}")
    print(f"Secondary-agent review evidence: {approved_source}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
