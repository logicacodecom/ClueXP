#!/usr/bin/env python3
"""Unit tests for the SDLC policy gate (specs/004 FR-001..FR-011). No network, no git writes."""

from __future__ import annotations

import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_PATH = Path(__file__).with_name("check-sdlc-policy.py")
SPEC = importlib.util.spec_from_file_location("check_sdlc_policy", SCRIPT_PATH)
assert SPEC and SPEC.loader
POLICY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = POLICY
SPEC.loader.exec_module(POLICY)

HEAD = "8d2269fed1a11aba5ac2ca1cc87b46da60eddfa8"
OTHER = "404bc525e1bef4f5dde37e8080a1b82da0e02077"


def record(**overrides: str) -> str:
    fields = {
        "Secondary-agent review required": "yes",
        "Author agents": "Claude Code, Other: Gemini",
        "Reviewer agent": "Codex",
        "Review scope": "implementation",
        "Reviewed head": HEAD,
        "Review result": "approve",
        "Merge owner": "Claude Code",
    }
    fields.update(overrides)
    lines = [f"- {k}: {v}" for k, v in fields.items() if v is not None]
    return "## Summary\n\ntext\n\n## Review Record\n\n" + "\n".join(lines) + "\n\n## Verification\n\n- ok\n"


def E(status: str, src: str | None, dst: str | None, mode: str = "100644"):
    return POLICY.Entry(status=status, src=src, dst=dst, mode=mode)


FULL_ARTIFACTS = [E("M", "specs/004-x/" + f, "specs/004-x/" + f) for f in ("spec.md", "plan.md", "tasks.md")] + [
    E("A", None, "specs/004-x/checklists/sdlc-policy.md")
]


class ClassificationTests(unittest.TestCase):
    def test_representative_risky_paths(self) -> None:
        cases = {
            "packages/db/alembic/versions/0060_example.py": "database migration",
            "apps/intake-web/api/auth.py": "auth or authorization",
            "apps/intake-web/api/store.py": "RLS, tenant isolation, or cross-tenant data",
            "apps/technician-web/src/app/api/offers/route.ts": "dispatch routing, state, or offer lifecycle",
            "apps/cluexp-mcp-server/mcp_server/server.py": "public API or MCP contract",
            "apps/example/billing/route.ts": "payments or billing semantics",
            "apps/intake-web/api/config.py": "secrets, environment, or production security config",
            ".github/workflows/ci.yml": "GitHub Actions or SDLC policy enforcement",
            ".github/CODEOWNERS": "GitHub Actions or SDLC policy enforcement",
            "AGENTS.md": "GitHub Actions or SDLC policy enforcement",
            "docs/AI-SDLC-WORKFLOW.md": "GitHub Actions or SDLC policy enforcement",
            "apps/cluexp-mcp-server/INTERNAL-PREVIEW-RUNBOOK.md": "production runbook, deployment, or external platform",
        }
        found = {m.path: m.category for m in POLICY.classify(list(cases))}
        self.assertEqual(cases, found)

    def test_every_enforcement_helper_is_risky(self) -> None:
        for path in (
            ".github/scripts/sdlc_github.py",
            ".github/scripts/post_deploy_verify.py",
            ".github/scripts/protection_projection.py",
            ".github/scripts/test_check_sdlc_policy_git.py",
            ".github/scripts/new_helper.py",
        ):
            self.assertEqual(1, len(POLICY.classify([path])), path)

    def test_rename_and_delete_endpoints_count_for_risk(self) -> None:
        entries = [E("D", "apps/intake-web/api/auth.py", None, "000000"), E("R", ".github/scripts/sdlc_github.py", "tools/x.py")]
        paths = POLICY.risk_paths(entries)
        self.assertIn("apps/intake-web/api/auth.py", paths)
        self.assertIn(".github/scripts/sdlc_github.py", paths)
        self.assertEqual(2, len(POLICY.classify(paths)))

    def test_deleted_artifacts_do_not_count(self) -> None:
        entries = FULL_ARTIFACTS[:3] + [E("D", "specs/004-x/checklists/sdlc-policy.md", None, "000000")]
        self.assertEqual(set(), POLICY.complete_artifact_dirs(POLICY.surviving_paths(entries)))
        self.assertEqual({"specs/004-x"}, POLICY.complete_artifact_dirs(POLICY.surviving_paths(FULL_ARTIFACTS)))


class GrammarTests(unittest.TestCase):
    def test_valid_record(self) -> None:
        parsed = POLICY.parse_record(record())
        self.assertEqual({"claude code", "other:gemini"}, parsed["authors"])
        self.assertEqual("codex", parsed["reviewer"])
        self.assertEqual(HEAD, parsed["reviewed_head"])

    def test_bold_backticks_and_star_bullets(self) -> None:
        text = record().replace("- Review result: approve", "* **Review result**: `approve`")
        self.assertEqual("approve", POLICY.parse_record(text)["result"])

    def test_deprecated_completed_key_is_rejected(self) -> None:
        text = record().replace("- Review result", "- Secondary-agent review completed: yes\n- Review result")
        self.assertInvalid(text, "unknown review record key")

    def assertInvalid(self, text: str, fragment: str) -> None:
        with self.assertRaises(POLICY.PolicyError) as ctx:
            POLICY.parse_record(text)
        self.assertIn(fragment, str(ctx.exception))

    def test_invalid_examples(self) -> None:
        self.assertInvalid(record() + "\n## Review Record\n", "exactly one")
        self.assertInvalid(record().replace("- Review result: approve", "- Review result: changes-requested\n- Review result: approve"), "duplicate")
        self.assertInvalid(record(**{"Reviewer agent": "Other"}), "invalid agent")
        self.assertInvalid(record(**{"Reviewer agent": "Other:"}), "Other needs a name")
        self.assertInvalid(record(**{"Reviewer agent": ""}), "invalid agent")
        self.assertInvalid(record(**{"Reviewed head": "8d2269f"}), "40-character")
        self.assertInvalid(record().replace("- Merge owner", "- Approved by: Codex\n- Merge owner"), "unknown review record key")
        self.assertInvalid(record(**{"Merge owner": None}), "missing review record keys")
        self.assertInvalid(record(**{"Author agents": "Codex, "}), "invalid author agents")
        self.assertInvalid(record(**{"Review scope": "everything"}), "invalid review scope")

    def test_heading_inside_fence_is_not_a_block(self) -> None:
        fenced = "## Summary\n\n```markdown\n## Review Record\n- Review result: approve\n```\n"
        self.assertFalse(POLICY.has_record(fenced))
        with self.assertRaises(POLICY.PolicyError):
            POLICY.parse_record(fenced)

    def test_agent_normalization_and_aliases(self) -> None:
        self.assertEqual("codex", POLICY.normalize_agent("  CODEX "))
        self.assertEqual("codex", POLICY.normalize_agent("Other: codex"))
        self.assertEqual("claude code", POLICY.normalize_agent("other:  Claude"))
        self.assertEqual("other:gemini 2", POLICY.normalize_agent("Other:  Gemini   2"))
        for bad in ("other", "Cidex", "Other: a,b", ""):
            with self.assertRaises(POLICY.PolicyError):
                POLICY.normalize_agent(bad)


NL = "\n"


def block(result: str) -> str:
    full = record(**{"Review result": result})
    return full[full.index("## Review Record"):full.index("## Verification")]


class FenceTests(unittest.TestCase):
    """CommonMark fences (Codex T024 finding 1): only the real, unfenced record counts."""

    def risky_errors(self, body: str) -> list[str]:
        entries = FULL_ARTIFACTS + [E("M", "apps/intake-web/api/auth.py", "apps/intake-web/api/auth.py")]
        return POLICY.evaluate(entries, body, HEAD)[0]

    def test_codex_reproduction_fenced_approval_cannot_override_real_revocation(self) -> None:
        body = NL.join(["```text", "~~~", block("approve"), "## Notes", "```", "", block("changes-requested")])
        self.assertEqual("changes-requested", POLICY.parse_record(body)["result"])
        self.assertTrue(any("changes-requested" in e for e in self.risky_errors(body)))

    def test_shorter_closer_does_not_close_longer_fence(self) -> None:
        body = NL.join(["````markdown", "```", block("approve"), "```", "````", "", block("changes-requested")])
        self.assertEqual("changes-requested", POLICY.parse_record(body)["result"])

    def test_mixed_delimiters(self) -> None:
        body = NL.join(["~~~", "```", block("approve"), "~~~", "", block("changes-requested")])
        self.assertEqual("changes-requested", POLICY.parse_record(body)["result"])

    def test_indented_fence_and_backtick_info_string(self) -> None:
        body = NL.join(["   ```", block("approve"), "   ```", "", block("changes-requested")])
        self.assertEqual("changes-requested", POLICY.parse_record(body)["result"])
        # A backtick info string containing a backtick is not a fence opener.
        self.assertEqual("approve", POLICY.parse_record("```a`b" + NL + record())["result"])

    def test_fenced_lines_inside_a_real_block_are_not_keys(self) -> None:
        inner = NL.join(["```", "Review result: approve", "```", "- Merge owner: Claude Code"])
        body = record(**{"Review result": "changes-requested"}).replace("- Merge owner: Claude Code", inner)
        self.assertEqual("changes-requested", POLICY.parse_record(body)["result"])


class ReviewTests(unittest.TestCase):
    def errors(self, text: str, *, risky: bool = True, implementation: bool = True) -> list[str]:
        return POLICY.review_errors(POLICY.parse_record(text), risky=risky, implementation=implementation,
                                    target=HEAD, complete_dirs={"specs/004-x"})

    def test_independent_approve_at_head_passes(self) -> None:
        self.assertEqual([], self.errors(record()))

    def test_author_may_be_merge_owner(self) -> None:
        self.assertEqual([], self.errors(record(**{"Merge owner": "Claude Code"})))

    def test_same_family_is_rejected_including_aliases_and_instances(self) -> None:
        self.assertTrue(self.errors(record(**{"Author agents": "Codex", "Reviewer agent": "Other: codex"})))
        self.assertTrue(self.errors(record(**{"Author agents": "Claude Code, Codex", "Reviewer agent": "Codex"})))

    def test_changes_requested_blocks(self) -> None:
        self.assertIn("changes-requested", " ".join(self.errors(record(**{"Review result": "changes-requested"}))))

    def test_risky_diff_requires_required_yes(self) -> None:
        self.assertTrue(self.errors(record(**{"Secondary-agent review required": "no"})))

    def test_spec_scope_cannot_approve_implementation(self) -> None:
        self.assertTrue(self.errors(record(**{"Review scope": "spec"})))
        self.assertEqual([], self.errors(record(**{"Review scope": "spec"}), implementation=False))


class EvaluateTests(unittest.TestCase):
    def test_non_material_pr_needs_no_record(self) -> None:
        errors, material, _ = POLICY.evaluate([E("M", "README.md", "README.md")], "", HEAD)
        self.assertEqual(([], []), (errors, material))

    def test_declared_required_record_is_enforced_on_non_material_pr(self) -> None:
        text = record(**{"Review result": "changes-requested", "Review scope": "spec"})
        errors, _, _ = POLICY.evaluate([E("M", "README.md", "README.md")], text, HEAD)
        self.assertTrue(any("changes-requested" in e for e in errors))

    def test_declared_not_required_record_is_grammar_only(self) -> None:
        text = record(**{"Secondary-agent review required": "no", "Review result": "changes-requested"})
        errors, _, _ = POLICY.evaluate([E("M", "README.md", "README.md")], text, HEAD)
        self.assertEqual([], errors)
        errors, _, _ = POLICY.evaluate([E("M", "README.md", "README.md")], record(**{"Reviewer agent": "Other"}), HEAD)
        self.assertTrue(errors)

    def test_risky_without_record_or_artifacts_fails(self) -> None:
        errors, material, _ = POLICY.evaluate([E("M", "apps/intake-web/api/main.py", "apps/intake-web/api/main.py")], "", HEAD)
        self.assertTrue(material)
        self.assertTrue(any("Spec Kit" in e or "spec.md" in e for e in errors))
        self.assertTrue(any("Review Record" in e for e in errors))

    def test_risky_with_artifacts_and_record_passes(self) -> None:
        entries = FULL_ARTIFACTS + [E("M", "apps/intake-web/api/main.py", "apps/intake-web/api/main.py")]
        errors, _, dirs = POLICY.evaluate(entries, record(), HEAD)
        self.assertEqual([], errors)
        self.assertEqual({"specs/004-x"}, dirs)


class PostReviewTests(unittest.TestCase):
    def test_only_governing_checklists_may_change(self) -> None:
        dirs = {"specs/004-x"}
        self.assertEqual([], POLICY.post_review_errors([E("M", "specs/004-x/checklists/a.md", "specs/004-x/checklists/a.md")], dirs))
        for bad in (
            E("M", "specs/003-y/checklists/a.md", "specs/003-y/checklists/a.md"),
            E("M", "apps/x.py", "apps/x.py"),
            E("D", "specs/004-x/checklists/a.md", None, "000000"),
            E("R", "specs/004-x/checklists/a.md", "specs/004-x/checklists/b.md"),
            E("M", "specs/004-x/checklists/a.md", "specs/004-x/checklists/a.md", "100755"),
            E("T", "specs/004-x/checklists/a.md", "specs/004-x/checklists/a.md", "120000"),
            E("M", "specs/004-x/tasks.md", "specs/004-x/tasks.md"),
        ):
            self.assertTrue(POLICY.post_review_errors([bad], dirs), bad)


class PrModeTests(unittest.TestCase):
    def fake_github(self, pulls: list[dict]) -> types.ModuleType:
        module = types.ModuleType("sdlc_github")
        calls = iter(pulls)
        module.get_pull = lambda number: next(calls)
        return module

    def run_pr(self, pulls: list[dict], event_head: str = HEAD) -> int:
        pr_entries = FULL_ARTIFACTS + [E("M", "apps/intake-web/api/main.py", "apps/intake-web/api/main.py")]
        env = {"PR_NUMBER": "7", "PR_HEAD_SHA": event_head}
        with mock.patch.dict(sys.modules, {"sdlc_github": self.fake_github(pulls)}), \
             mock.patch.dict(os.environ, env), \
             mock.patch.object(POLICY, "range_entries", return_value=pr_entries), \
             mock.patch.object(POLICY, "git_ok", return_value=True), \
             mock.patch("builtins.print"):
            return POLICY.pr_mode()

    def pull(self, body: str, head: str = HEAD, updated: str = "t1") -> dict:
        return {"head": {"sha": head}, "base": {"sha": OTHER}, "body": body, "updated_at": updated}

    def test_current_approved_body_passes(self) -> None:
        self.assertEqual(0, self.run_pr([self.pull(record()), self.pull(record())]))

    def test_obsolete_run_fails(self) -> None:
        self.assertEqual(1, self.run_pr([self.pull(record(), head=OTHER)], event_head=HEAD))

    def test_metadata_changed_during_evaluation_fails(self) -> None:
        revoked = record(**{"Review result": "changes-requested"})
        self.assertEqual(1, self.run_pr([self.pull(record()), self.pull(revoked, updated="t2")]))

    def test_old_event_rerun_evaluates_current_body(self) -> None:
        revoked = record(**{"Review result": "changes-requested"})
        self.assertEqual(1, self.run_pr([self.pull(revoked), self.pull(revoked)]))

    def test_empty_body_is_no_evidence(self) -> None:
        self.assertEqual(1, self.run_pr([self.pull(""), self.pull("")]))
        self.assertEqual(1, self.run_pr([self.pull(None), self.pull(None)]))


class PushModeTests(unittest.TestCase):
    def test_all_zero_before_fails_closed(self) -> None:
        with mock.patch.dict(os.environ, {"PUSH_BEFORE": "0" * 40, "PUSH_AFTER": HEAD}), mock.patch("builtins.print"):
            self.assertEqual(1, POLICY.push_mode())

    def test_push_is_diagnostics_only(self) -> None:
        entries = FULL_ARTIFACTS + [E("M", "apps/intake-web/api/main.py", "apps/intake-web/api/main.py")]
        with mock.patch.dict(os.environ, {"PUSH_BEFORE": OTHER, "PUSH_AFTER": HEAD}), \
             mock.patch.object(POLICY, "range_entries", return_value=entries), mock.patch("builtins.print"):
            self.assertEqual(0, POLICY.push_mode())
        with mock.patch.dict(os.environ, {"PUSH_BEFORE": OTHER, "PUSH_AFTER": HEAD}), \
             mock.patch.object(POLICY, "range_entries", return_value=entries[4:]), mock.patch("builtins.print"):
            self.assertEqual(1, POLICY.push_mode())


if __name__ == "__main__":
    unittest.main()
