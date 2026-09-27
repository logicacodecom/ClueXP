#!/usr/bin/env python3
"""Unit tests for post-deploy verification and the shared health/list_services parsers (specs/004 FR-013)."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("post_deploy_verify", Path(__file__).with_name("post_deploy_verify.py"))
assert SPEC and SPEC.loader
PDV = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PDV
SPEC.loader.exec_module(PDV)

PUSHED = "1" * 40
NEWER = "2" * 40
OLDER = "3" * 40
BRANCH = "4" * 40
MAIN = NEWER
OK_LIST = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"data":[{"code":"locksmith"}]},"isError":false}}\n'


def compare_table(base: str, head: str) -> str:
    """Fake GitHub compare: status of `head` relative to `base`. MAIN is NEWER."""
    if base == head:
        return "identical"
    return {(PUSHED, NEWER): "ahead", (PUSHED, OLDER): "behind", (PUSHED, BRANCH): "ahead"}.get((base, head), "diverged")


class ParserTests(unittest.TestCase):
    def test_health_semantics(self) -> None:
        self.assertEqual((True, None, "ok"), PDV.parse_health('{"status":"ok"}'))
        self.assertEqual((True, None, "ok"), PDV.parse_health('{"status":"ok","revision":null}'))
        self.assertEqual((True, PUSHED, "ok"), PDV.parse_health(json.dumps({"status": "ok", "revision": PUSHED})))
        self.assertFalse(PDV.parse_health("<html>")[0])
        self.assertFalse(PDV.parse_health('{"status":"degraded"}')[0])
        self.assertEqual(None, PDV.parse_health('{"status":"ok","revision":"not-a-sha"}')[1])

    def test_list_services_semantics(self) -> None:
        self.assertTrue(PDV.parse_list_services(OK_LIST)[0])
        api_error = 'data: {"result":{"structuredContent":{"error":"invalid_api_key","status_code":401},"isError":false}}'
        self.assertFalse(PDV.parse_list_services(api_error)[0])
        self.assertFalse(PDV.parse_list_services('data: {"result":{"structuredContent":{"data":[]}}}')[0])
        self.assertFalse(PDV.parse_list_services("garbage")[0])


class ContainsTests(unittest.TestCase):
    def test_containment(self) -> None:
        self.assertEqual("yes", PDV.contains(PUSHED, NEWER, MAIN, compare_table))
        self.assertEqual("no", PDV.contains(PUSHED, OLDER, MAIN, compare_table))
        self.assertEqual("no", PDV.contains(PUSHED, None, MAIN, compare_table))
        self.assertEqual("no", PDV.contains(PUSHED, "abc", MAIN, compare_table))
        self.assertEqual("no", PDV.contains(PUSHED, BRANCH, MAIN, compare_table))  # descendant, not on main

    def test_api_error_is_unknown(self) -> None:
        def boom(base: str, head: str) -> str:
            raise RuntimeError("rate limited")
        self.assertEqual("unknown", PDV.contains(PUSHED, NEWER, MAIN, boom))


class VerifyTests(unittest.TestCase):
    def run_verify(self, revisions: list[dict[str, str | None]], *, mcp: str = OK_LIST, healthy: bool = True,
                   during_smoke: dict[str, str | None] | None = None):
        seq = iter(revisions)
        current: dict[str, str | None] = {}
        clock = [0.0]

        def fetch(url: str) -> str:
            name = next(n for n, u in PDV.PROJECTS.items() if u == url)
            return json.dumps({"status": "ok" if healthy else "down", "revision": current[name]})

        def sleep(seconds: float) -> None:
            clock[0] += seconds
            current.update(next(seq, current))

        def post_mcp(url: str) -> str:
            if during_smoke:  # production moves while the smoke request is in flight
                current.update(during_smoke)
            return mcp

        current.update(next(seq))
        return PDV.verify(PUSHED, fetch=fetch, post_mcp=post_mcp, compare=compare_table,
                          main_head=lambda: MAIN, timeout=90, interval=30, sleep=sleep, clock=lambda: clock[0])

    def test_rollback_during_smoke_is_not_verified(self) -> None:
        # Codex T024 finding 3: attributed before smoke, rolled back to an older revision during it.
        ok, lines = self.run_verify([{"cluexp-intake": PUSHED, "cluexp-mcp-server": PUSHED}],
                                    during_smoke={"cluexp-mcp-server": OLDER})
        self.assertFalse(ok)
        self.assertTrue(any("attribution changed during smoke" in line for line in lines), lines)

    def test_superseding_deploy_during_smoke_still_verifies(self) -> None:
        ok, lines = self.run_verify([{"cluexp-intake": PUSHED, "cluexp-mcp-server": PUSHED}],
                                    during_smoke={"cluexp-intake": NEWER})
        self.assertTrue(ok, lines)
        self.assertIn("RESULT: verified", lines[-1])

    def test_superseding_revision_on_both_projects_verifies(self) -> None:
        ok, lines = self.run_verify([{"cluexp-intake": OLDER, "cluexp-mcp-server": OLDER},
                                     {"cluexp-intake": NEWER, "cluexp-mcp-server": PUSHED}])
        self.assertTrue(ok, lines)
        self.assertIn("RESULT: verified", lines[-1])

    def test_one_project_lagging_fails_after_timeout(self) -> None:
        ok, lines = self.run_verify([{"cluexp-intake": PUSHED, "cluexp-mcp-server": OLDER}])
        self.assertFalse(ok)
        self.assertIn("not attributed", lines[-1])

    def test_null_revision_fails(self) -> None:
        ok, _ = self.run_verify([{"cluexp-intake": None, "cluexp-mcp-server": None}])
        self.assertFalse(ok)

    def test_attributed_but_mcp_smoke_fails(self) -> None:
        bad = 'data: {"result":{"structuredContent":{"error":"invalid_api_key"},"isError":false}}'
        ok, lines = self.run_verify([{"cluexp-intake": PUSHED, "cluexp-mcp-server": PUSHED}], mcp=bad)
        self.assertFalse(ok)
        self.assertIn("MCP smoke failed", lines[-1])

    def test_attributed_but_unhealthy_fails(self) -> None:
        ok, lines = self.run_verify([{"cluexp-intake": PUSHED, "cluexp-mcp-server": PUSHED}], healthy=False)
        self.assertFalse(ok)


class CliTests(unittest.TestCase):
    """The `verify` CLI: failure opens an incident; an incident-creation failure still exits red."""

    def run_cli(self, verify_result, open_incident):
        import contextlib
        import io
        import os
        import types
        from unittest import mock

        fake = types.ModuleType("sdlc_github")
        fake.compare_status = lambda a, b: "identical"
        fake.request = lambda method, path: {"sha": MAIN}
        fake.repo = lambda: "o/r"
        fake.open_incident = open_incident
        out = io.StringIO()
        with mock.patch.dict(sys.modules, {"sdlc_github": fake}), \
             mock.patch.object(PDV, "verify", return_value=verify_result), \
             mock.patch.object(sys, "argv", ["post_deploy_verify.py", "verify", "--pushed", PUSHED]), \
             mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}), \
             contextlib.redirect_stdout(out):
            code = PDV.main()
        return code, out.getvalue()

    def test_timeout_opens_incident(self) -> None:
        calls = []
        code, out = self.run_cli((False, ["RESULT: release not attributed"]),
                                 lambda title, body: calls.append((title, body)) or "https://issue/1")
        self.assertEqual(1, code)
        self.assertEqual(1, len(calls))
        self.assertIn(PUSHED[:12], calls[0][0])
        self.assertIn("incident: https://issue/1", out)

    def test_incident_creation_failure_still_fails_red(self) -> None:
        def boom(title, body):
            raise RuntimeError("issues API down")
        code, out = self.run_cli((False, ["RESULT: release not attributed"]), boom)
        self.assertEqual(1, code)
        self.assertIn("incident issue could not be created", out)

    def test_success_opens_no_incident(self) -> None:
        calls = []
        code, _ = self.run_cli((True, ["RESULT: verified"]), lambda t, b: calls.append(t))
        self.assertEqual(0, code)
        self.assertEqual([], calls)


if __name__ == "__main__":
    unittest.main()
