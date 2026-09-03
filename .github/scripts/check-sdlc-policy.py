#!/usr/bin/env python3
"""Diff-aware Spec Kit policy gate for ClueXP pull requests."""

from __future__ import annotations

import argparse
import fnmatch
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import PurePosixPath


MATERIAL_PATTERNS = {
    "database migration": [
        "packages/db/alembic/versions/**",
        "packages/db/**/*.sql",
    ],
    "auth or authorization": [
        "apps/intake-web/api/auth.py",
        "apps/**/auth/**",
        "**/*auth*.py",
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
    "tenant, dispatch, privacy, or real-world action": [
        "apps/intake-web/api/store.py",
        "apps/intake-web/api/dispatch.py",
        "apps/intake-web/api/communications.py",
        "apps/intake-web/api/push.py",
        "apps/intake-web/api/storage.py",
        "apps/intake-web/api/settings.py",
        "apps/intake-web/api/closeout_catalog.py",
        "apps/intake-web/api/tests/test_postgres_security.py",
        "apps/intake-web/api/tests/test_rls_schema_guard.py",
    ],
    "production workflow or external platform": [
        ".github/workflows/**",
        "docs/PRODUCTION-READINESS.md",
        "docs/PILOT-OPERATIONS.md",
        "docs/PRIVACY-SECURITY-REVIEW.md",
        "docs/AGENT-INTEGRATION-MCP-PLAN.md",
        "docs/AGENT-PLATFORM-SUBMISSION-PACKAGE.md",
        "apps/**/vercel.json",
        ".vercel*.json",
    ],
}

SPEC_MD_PATTERN = "specs/*/spec.md"
PLAN_MD_PATTERN = "specs/*/plan.md"
TASKS_MD_PATTERN = "specs/*/tasks.md"
CHECKLIST_PATTERN = "specs/*/checklists/*.md"


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
        output = subprocess.check_output(
            ["git", "diff", "--name-only", "--diff-filter=ACMR"],
            text=True,
        )
        untracked = subprocess.check_output(
            ["git", "ls-files", "--others", "--exclude-standard"],
            text=True,
        )
        return output.splitlines() + untracked.splitlines()

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

    print("SDLC policy: material changes covered by Spec Kit artifacts.")
    print("Complete Spec Kit directories:")
    for directory in sorted(complete_dirs):
        print(f"  - {directory}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
