#!/usr/bin/env python3
"""Git-integration tests for the SDLC policy gate using real temporary repositories (specs/004)."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_PATH = Path(__file__).with_name("check-sdlc-policy.py")
SPEC = importlib.util.spec_from_file_location("check_sdlc_policy_git", SCRIPT_PATH)
assert SPEC and SPEC.loader
POLICY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = POLICY
SPEC.loader.exec_module(POLICY)


def record(head: str, scope: str = "implementation", result: str = "approve") -> str:
    return (
        "# Checklist\n\n## Review Record\n\n"
        "Secondary-agent review required: yes\n"
        "Author agents: Claude Code\n"
        "Reviewer agent: Codex\n"
        f"Review scope: {scope}\n"
        f"Reviewed head: {head}\n"
        f"Review result: {result}\n"
        "Merge owner: Claude Code\n\n## Notes\n"
    )


class Repo:
    def __init__(self, root: Path):
        self.root = root

    def git(self, *args: str) -> str:
        return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()

    def write(self, path: str, text: str) -> None:
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")

    def commit(self, message: str) -> str:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")


class GitGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Repo(Path(self.tmp.name))
        self.repo.git("init", "-q", "-b", "main")
        self.repo.git("config", "user.email", "t@example.test")
        self.repo.git("config", "user.name", "t")
        self.repo.git("config", "core.autocrlf", "false")
        self.repo.write("README.md", "base\n")
        self.repo.write("apps/intake-web/api/auth.py", "auth = 1\n")
        self.base = self.repo.commit("base")
        self.old_cwd = os.getcwd()
        os.chdir(self.repo.root)

    def tearDown(self) -> None:
        os.chdir(self.old_cwd)
        self.tmp.cleanup()

    def artifacts(self, feature: str = "004-x") -> None:
        for name in ("spec.md", "plan.md", "tasks.md"):
            self.repo.write(f"specs/{feature}/{name}", f"{name}\n")
        self.repo.write(f"specs/{feature}/checklists/sdlc-policy.md", "# Checklist\n")

    def quiet(self, fn, *args):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = fn(*args)
        return code, out.getvalue()

    # FR-007: deletions and renames are classified.
    def test_delete_only_risky_change_is_material(self) -> None:
        self.repo.git("rm", "-q", "apps/intake-web/api/auth.py")
        head = self.repo.commit("delete auth")
        entries = POLICY.range_entries(f"{self.base}..{head}")
        self.assertEqual("D", entries[0].status)
        self.assertTrue(POLICY.classify(POLICY.risk_paths(entries)))

    def test_rename_out_of_risky_path_is_material(self) -> None:
        self.repo.git("mv", "apps/intake-web/api/auth.py", "moved.txt")
        head = self.repo.commit("rename away")
        entries = POLICY.range_entries(f"{self.base}..{head}")
        self.assertEqual("R", entries[0].status)
        self.assertTrue(POLICY.classify(POLICY.risk_paths(entries)))

    # FR-004: freshness against real history.
    def reviewed_setup(self) -> tuple[str, set[str]]:
        self.artifacts()
        self.repo.write("apps/intake-web/api/auth.py", "auth = 2\n")
        reviewed = self.repo.commit("feature")
        return reviewed, {"specs/004-x"}

    def review(self, reviewed: str, target: str, dirs: set[str]) -> list[str]:
        parsed = POLICY.parse_record(record(reviewed))
        return POLICY.review_errors(parsed, risky=True, implementation=True, target=target, complete_dirs=dirs)

    def test_new_code_after_review_fails(self) -> None:
        reviewed, dirs = self.reviewed_setup()
        self.repo.write("apps/intake-web/api/auth.py", "auth = 3\n")
        target = self.repo.commit("more code")
        self.assertTrue(self.review(reviewed, target, dirs))

    def test_governing_checklist_evidence_after_review_passes(self) -> None:
        reviewed, dirs = self.reviewed_setup()
        self.repo.write("specs/004-x/checklists/sdlc-policy.md", record(reviewed))
        target = self.repo.commit("reviewer evidence")
        self.assertEqual([], self.review(reviewed, target, dirs))

    def test_other_feature_checklist_after_review_fails(self) -> None:
        reviewed, dirs = self.reviewed_setup()
        self.repo.write("specs/003-y/checklists/sdlc-policy.md", "x\n")
        target = self.repo.commit("unrelated checklist")
        self.assertTrue(self.review(reviewed, target, dirs))

    def test_mode_change_after_review_fails(self) -> None:
        reviewed, dirs = self.reviewed_setup()
        self.repo.git("update-index", "--chmod=+x", "specs/004-x/checklists/sdlc-policy.md")
        self.repo.git("commit", "-q", "-m", "chmod")
        target = self.repo.git("rev-parse", "HEAD")
        self.assertTrue(self.review(reviewed, target, dirs))

    def test_reviewed_head_not_ancestor_fails(self) -> None:
        reviewed, dirs = self.reviewed_setup()
        self.repo.git("checkout", "-q", "-b", "side", self.base)
        self.repo.write("README.md", "side\n")
        side = self.repo.commit("side")
        errors = self.review(side, reviewed, dirs)
        self.assertTrue(any("ancestor" in e for e in errors))

    # FR-009: --base/--head reads committed head content regardless of checkout.
    def test_local_mode_reads_head_content_while_checkout_differs(self) -> None:
        reviewed, _ = self.reviewed_setup()
        self.repo.write("specs/004-x/checklists/sdlc-policy.md", record(reviewed))
        head = self.repo.commit("evidence")
        self.repo.git("checkout", "-q", self.base)
        code, out = self.quiet(POLICY.local_mode, self.base, head, False, None)
        self.assertEqual(0, code, out)

    def test_local_mode_spec_scope_on_implementation_fails(self) -> None:
        reviewed, _ = self.reviewed_setup()
        self.repo.write("specs/004-x/checklists/sdlc-policy.md", record(reviewed, scope="spec"))
        head = self.repo.commit("evidence")
        code, _ = self.quiet(POLICY.local_mode, self.base, head, False, None)
        self.assertEqual(1, code)

    def test_split_artifacts_across_features_fail(self) -> None:
        for name in ("spec.md", "plan.md"):
            self.repo.write(f"specs/004-x/{name}", "x\n")
        self.repo.write("specs/005-y/tasks.md", "x\n")
        self.repo.write("specs/005-y/checklists/a.md", "x\n")
        self.repo.write("apps/intake-web/api/auth.py", "auth = 9\n")
        head = self.repo.commit("split")
        code, out = self.quiet(POLICY.local_mode, self.base, head, False, None)
        self.assertEqual(1, code)
        self.assertIn("spec.md", out)

    # FR-009: working tree is preflight only.
    def test_working_tree_preflight_never_satisfies_review(self) -> None:
        self.repo.write("README.md", "uncommitted\n")
        code, out = self.quiet(POLICY.preflight_mode)
        self.assertEqual(0, code)
        self.assertIn("review: not evaluated (preflight)", out)
        self.repo.write("apps/intake-web/api/auth.py", "uncommitted risky\n")
        code, out = self.quiet(POLICY.preflight_mode)
        self.assertEqual(1, code)
        self.assertIn("not evaluated", out)

    # FR-009: push diagnostics over the full payload range.
    def test_push_multi_commit_range(self) -> None:
        self.artifacts()
        self.repo.commit("artifacts first")
        self.repo.write("apps/intake-web/api/auth.py", "auth = 5\n")
        after = self.repo.commit("code second")
        with mock.patch.dict(os.environ, {"PUSH_BEFORE": self.base, "PUSH_AFTER": after}):
            code, _ = self.quiet(POLICY.push_mode)
        self.assertEqual(0, code)
        with mock.patch.dict(os.environ, {"PUSH_BEFORE": f"{after}~1", "PUSH_AFTER": after}):
            code, _ = self.quiet(POLICY.push_mode)
        self.assertEqual(1, code)


if __name__ == "__main__":
    unittest.main()
