#!/usr/bin/env python3
"""Fixture tests for the branch-protection projection (specs/004 T033). Fixtures are real
read-backs from 2026-09-27 with URLs redacted."""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("protection_projection", HERE / "protection_projection.py")
assert SPEC and SPEC.loader
PP = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PP
SPEC.loader.exec_module(PP)


def load(name: str) -> dict:
    return json.loads((HERE / "fixtures" / name).read_text(encoding="utf-8"))


INTENDED = load("protection-intended-put.json")
AFTER = load("protection-get-after.json")
BEFORE = load("protection-get-before.json")

RESTORE_PUT = copy.deepcopy(INTENDED)
RESTORE_PUT["enforce_admins"] = False
RESTORE_PUT["required_pull_request_reviews"]["require_code_owner_reviews"] = True
RESTORE_PUT["required_pull_request_reviews"]["required_approving_review_count"] = 1
for check in RESTORE_PUT["required_status_checks"]["checks"]:
    if check["context"] == "sdlc-policy":
        check["app_id"] = -1


class ProjectionTests(unittest.TestCase):
    def test_successful_readback_equals_intent(self) -> None:
        # A successful PUT/GET response must NOT look like drift (no false rollback).
        self.assertEqual({}, PP.diff(INTENDED, AFTER))

    def test_restore_payload_equals_original_snapshot(self) -> None:
        # app_id -1 (request) and null (read-back) both mean "any app".
        self.assertEqual({}, PP.diff(RESTORE_PUT, BEFORE))

    def test_material_drift_is_detected(self) -> None:
        drifted = copy.deepcopy(AFTER)
        drifted["required_pull_request_reviews"]["required_approving_review_count"] = 1
        drifted["required_status_checks"]["checks"] = drifted["required_status_checks"]["checks"][:-1]
        delta = PP.diff(INTENDED, drifted)
        self.assertIn("approvals", delta)
        self.assertIn("checks", delta)

    def test_order_and_wrappers_are_normalized(self) -> None:
        shuffled = copy.deepcopy(AFTER)
        shuffled["required_status_checks"]["checks"].reverse()
        self.assertEqual({}, PP.diff(AFTER, shuffled))

    def test_bypass_allowances_and_null_reviews_are_material(self) -> None:
        with_bypass = copy.deepcopy(AFTER)
        with_bypass["required_pull_request_reviews"]["bypass_pull_request_allowances"] = {"users": [{"login": "x"}]}
        self.assertIn("bypass", PP.diff(AFTER, with_bypass))
        no_reviews = copy.deepcopy(INTENDED)
        no_reviews["required_pull_request_reviews"] = None
        self.assertIn("reviews_required_object", PP.diff(INTENDED, no_reviews))

    def test_request_strings_equal_response_objects(self) -> None:
        # Codex T024 finding 2: PUT requests use login/slug strings; responses use objects.
        request = copy.deepcopy(INTENDED)
        request["restrictions"] = {"users": ["Alice"], "teams": ["ops"], "apps": []}
        request["required_pull_request_reviews"]["bypass_pull_request_allowances"] = {"users": ["alice"]}
        response = copy.deepcopy(AFTER)
        response["restrictions"] = {"users": [{"login": "alice", "url": "x"}], "teams": [{"slug": "ops"}], "apps": []}
        response["required_pull_request_reviews"]["bypass_pull_request_allowances"] = {"users": [{"login": "alice"}], "teams": [], "apps": []}
        self.assertEqual({}, PP.diff(request, response))

    def test_member_substitution_and_removal_are_drift(self) -> None:
        alice = copy.deepcopy(AFTER)
        alice["restrictions"] = {"users": [{"login": "alice"}], "teams": [], "apps": []}
        mallory = copy.deepcopy(alice)
        mallory["restrictions"]["users"] = [{"login": "mallory"}]
        self.assertIn("restrictions", PP.diff(alice, mallory))
        removed = copy.deepcopy(alice)
        removed["restrictions"]["users"] = []
        self.assertIn("restrictions", PP.diff(alice, removed))

    def test_unrestricted_differs_from_empty_restriction_list(self) -> None:
        empty = copy.deepcopy(AFTER)
        empty["restrictions"] = {"users": [], "teams": [], "apps": []}
        self.assertIn("restrictions", PP.diff(AFTER, empty))

    def test_dismissal_restriction_identities_are_compared(self) -> None:
        a = copy.deepcopy(AFTER)
        a["required_pull_request_reviews"]["dismissal_restrictions"] = {"users": [{"login": "alice"}]}
        b = copy.deepcopy(a)
        b["required_pull_request_reviews"]["dismissal_restrictions"] = {"users": [{"login": "mallory"}]}
        self.assertIn("dismissal", PP.diff(a, b))


if __name__ == "__main__":
    unittest.main()
