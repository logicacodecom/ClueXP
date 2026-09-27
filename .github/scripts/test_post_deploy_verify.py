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
    def run_verify(self, revisions: list[dict[str, str | None]], *, mcp: str = OK_LIST, healthy: bool = True):
        seq = iter(revisions)
        current: dict[str, str | None] = {}
        clock = [0.0]

        def fetch(url: str) -> str:
            name = next(n for n, u in PDV.PROJECTS.items() if u == url)
            return json.dumps({"status": "ok" if healthy else "down", "revision": current[name]})

        def sleep(seconds: float) -> None:
            clock[0] += seconds
            current.update(next(seq, current))

        current.update(next(seq))
        return PDV.verify(PUSHED, fetch=fetch, post_mcp=lambda url: mcp, compare=compare_table,
                          main_head=lambda: MAIN, timeout=90, interval=30, sleep=sleep, clock=lambda: clock[0])

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


if __name__ == "__main__":
    unittest.main()
