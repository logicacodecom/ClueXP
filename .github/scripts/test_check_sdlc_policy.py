#!/usr/bin/env python3
"""Focused tests for the diff-aware SDLC policy gate."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("check-sdlc-policy.py")
SPEC = importlib.util.spec_from_file_location("check_sdlc_policy", SCRIPT_PATH)
assert SPEC and SPEC.loader
POLICY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = POLICY
SPEC.loader.exec_module(POLICY)


APPROVED_REVIEW = """\
Secondary-agent review required: yes
Secondary-agent review completed: yes
Reviewer agent: Claude Code
Review result: approve
"""


class PolicyTests(unittest.TestCase):
    def test_representative_risky_paths_are_classified(self) -> None:
        cases = {
            "packages/db/alembic/versions/0060_example.py": "database migration",
            "apps/intake-web/api/auth.py": "auth or authorization",
            "apps/example/auth/session.js": "auth or authorization",
            "apps/intake-web/api/store.py": "RLS, tenant isolation, or cross-tenant data",
            "packages/example/tenant-query.ts": "RLS, tenant isolation, or cross-tenant data",
            "docs/POSTGRES-RLS-REVIEW.md": "RLS, tenant isolation, or cross-tenant data",
            "apps/technician-web/src/app/api/offers/route.ts": "dispatch routing, state, or offer lifecycle",
            "apps/example/dispatch/route.ts": "dispatch routing, state, or offer lifecycle",
            "apps/cluexp-mcp-server/mcp_server/server.py": "public API or MCP contract",
            "apps/provider-web/src/app/api/provider/settlements/route.ts": "payments or billing semantics",
            "apps/example/billing/route.ts": "payments or billing semantics",
            "apps/intake-web/api/config.py": "secrets, environment, or production security config",
            ".github/workflows/ci.yml": "GitHub Actions or SDLC policy enforcement",
            ".github/CODEOWNERS": "GitHub Actions or SDLC policy enforcement",
            ".github/copilot-instructions.md": "GitHub Actions or SDLC policy enforcement",
            ".specify/templates/spec-template.md": "GitHub Actions or SDLC policy enforcement",
            ".specify/memory/constitution.md": "GitHub Actions or SDLC policy enforcement",
            "AGENTS.md": "GitHub Actions or SDLC policy enforcement",
            "docs/AI-SDLC-WORKFLOW.md": "GitHub Actions or SDLC policy enforcement",
            "apps/cluexp-mcp-server/INTERNAL-PREVIEW-RUNBOOK.md": "production runbook, deployment, or external platform",
        }
        matches = {match.path: match.category for match in POLICY.classify(list(cases))}
        self.assertEqual(cases, matches)

    def test_completed_approved_review_is_accepted(self) -> None:
        self.assertEqual([], POLICY.secondary_review_errors(APPROVED_REVIEW))

    def test_changes_requested_does_not_pass_gate(self) -> None:
        text = APPROVED_REVIEW.replace("approve", "changes-requested")
        self.assertIn("invalid review result: expected approve", POLICY.secondary_review_errors(text))

    def test_missing_review_markers_do_not_pass_gate(self) -> None:
        errors = POLICY.secondary_review_errors("Reviewer agent: Codex")
        self.assertIn("missing marker: secondary-agent review required", errors)
        self.assertIn("missing marker: secondary-agent review completed", errors)
        self.assertIn("missing marker: review result", errors)

    def test_local_evidence_requires_sdlc_policy_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            feature_dir = Path(temp_dir) / "specs" / "001-example"
            checklist_dir = feature_dir / "checklists"
            checklist_dir.mkdir(parents=True)
            (checklist_dir / "security.md").write_text(APPROVED_REVIEW, encoding="utf-8")
            self.assertEqual([], POLICY.checklist_review_evidence({str(feature_dir)}))
            policy_checklist = checklist_dir / "sdlc-policy.md"
            policy_checklist.write_text(APPROVED_REVIEW, encoding="utf-8")
            evidence = POLICY.checklist_review_evidence({str(feature_dir)})
            self.assertEqual([(policy_checklist.as_posix(), APPROVED_REVIEW)], evidence)


if __name__ == "__main__":
    unittest.main()
