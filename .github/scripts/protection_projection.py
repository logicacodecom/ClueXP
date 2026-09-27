#!/usr/bin/env python3
"""Canonical projection of GitHub branch-protection JSON (specs/004 plan, T033).

GET/PUT responses and PUT request payloads have different shapes (URL fields, {enabled: x}
wrappers, derived `contexts`, app_id null vs -1). Projecting all of them to one policy object
lets a transition compare intent, response, read-back and snapshot without false mismatches,
while real drift (any material setting) still differs.

Usage: protection_projection.py A.json B.json  -> exit 0 if equal, else prints the diff.
"""

from __future__ import annotations

import json
import sys


def _enabled(value) -> bool:
    if isinstance(value, dict):
        return bool(value.get("enabled"))
    return bool(value)


def _identity(item) -> str:
    """Requests use login/slug strings; responses use objects with login/slug."""
    if isinstance(item, str):
        return item.lower()
    if isinstance(item, dict):
        return str(item.get("login") or item.get("slug") or item.get("name") or item.get("id")).lower()
    return str(item).lower()


def _members(obj) -> dict | None:
    """None stays None (unrestricted); an object, even empty, is a restriction list."""
    if obj is None:
        return None
    return {kind: sorted(_identity(i) for i in (obj.get(kind) or [])) for kind in ("users", "teams", "apps")}


def project(doc: dict) -> dict:
    checks_src = (doc.get("required_status_checks") or {}).get("checks") or []
    checks = sorted(
        (c["context"], "any" if c.get("app_id") in (None, -1) else int(c["app_id"])) for c in checks_src
    )
    reviews = doc.get("required_pull_request_reviews")
    return {
        "strict": bool((doc.get("required_status_checks") or {}).get("strict")),
        "checks": checks,
        "enforce_admins": _enabled(doc.get("enforce_admins")),
        "reviews_required_object": reviews is not None,
        "approvals": (reviews or {}).get("required_approving_review_count"),
        "code_owner": bool((reviews or {}).get("require_code_owner_reviews")),
        "dismiss_stale": bool((reviews or {}).get("dismiss_stale_reviews")),
        "last_push": bool((reviews or {}).get("require_last_push_approval")),
        # Absent bypass/dismissal lists mean "nobody"; compare actual identities.
        "bypass": _members((reviews or {}).get("bypass_pull_request_allowances") or {}),
        "dismissal": _members((reviews or {}).get("dismissal_restrictions") or {}),
        "restrictions": _members(doc.get("restrictions")),
        "linear": _enabled(doc.get("required_linear_history")),
        "force_push": _enabled(doc.get("allow_force_pushes")),
        "deletions": _enabled(doc.get("allow_deletions")),
        "conversation": _enabled(doc.get("required_conversation_resolution")),
        "lock": _enabled(doc.get("lock_branch")),
        "fork_sync": _enabled(doc.get("allow_fork_syncing")),
        "signatures": _enabled(doc.get("required_signatures")),
        "block_creations": _enabled(doc.get("block_creations")),
    }


def diff(a: dict, b: dict) -> dict:
    pa, pb = project(a), project(b)
    return {k: (pa[k], pb[k]) for k in pa if pa[k] != pb[k]}


def main() -> int:
    with open(sys.argv[1], encoding="utf-8") as fa, open(sys.argv[2], encoding="utf-8") as fb:
        delta = diff(json.load(fa), json.load(fb))
    if delta:
        print(json.dumps(delta, indent=2))
        return 1
    print("projections equal")
    return 0


if __name__ == "__main__":
    sys.exit(main())
