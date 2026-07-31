"""Versioned active-job snapshot + expected_version guard tests (InMemory).

Snapshot: returns the signed-in technician's active job with a derived version
and allowed_actions; is self-scoped; returns a null shape when idle; requires
technician auth. report-issue: matching expected_version proceeds, a stale one
returns a structured 409 version_conflict with no side effect, and the guard
composes with the PR #60 idempotency key.

Run from apps/intake-web:  pytest api/tests/test_active_job_snapshot.py
"""
from __future__ import annotations

import asyncio
from uuid import UUID
from uuid import uuid4

from starlette.testclient import TestClient

from api.auth import create_access_token
from api.dispatch import ACTIVE_JOB_STATUSES
from api.main import app, store as app_store


def _register_tech() -> tuple[str, dict[str, str]]:
    tid = str(uuid4())
    app_store.users[tid] = {
        "id": tid, "email": f"tech-{tid}@example.com", "phone": None,
        "display_name": "Dev Tech", "password_hash": "x",
        "roles": ["technician"], "active_organization_id": None,
        "organization_name": None,
    }
    techs = app_store._technicians = getattr(app_store, "_technicians", [])
    techs.append({
        "id": tid, "display_name": "Dev Tech", "status": "active",
        "vetting_status": "verified", "is_available": True,
    })
    token = create_access_token({"sub": tid, "roles": ["technician"]})
    return tid, {"authorization": f"Bearer {token}"}


def _assign_job(tid: str, status: str | None = None) -> str:
    jid = str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_lifecycle_version = getattr(app_store, "_job_lifecycle_version", {})
    app_store._job_status[jid] = status or ACTIVE_JOB_STATUSES[0]  # "assigned"
    app_store._job_tech[jid] = tid
    app_store._job_lifecycle_version[jid] = 1
    return jid


def _issue_events(jid: str) -> int:
    return sum(1 for e in app_store.events if jid in e and "tech_issue" in e)


# --- snapshot -------------------------------------------------------------
def test_snapshot_returns_active_job_version_and_actions():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)  # "assigned"
    body = client.get("/technicians/me/active-job/snapshot", headers=headers).json()
    assert body["active_job"]["id"] == jid
    assert body["active_job"]["status"] == "assigned"
    assert isinstance(body["version"], str) and body["version"]
    assert "advance_to:en_route" in body["allowed_actions"]
    assert "report_issue" in body["allowed_actions"]
    # deterministic: unchanged state -> same version
    again = client.get("/technicians/me/active-job/snapshot", headers=headers).json()
    assert again["version"] == body["version"]


def test_snapshot_version_uses_lifecycle_marker_not_only_status():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    first = client.get("/technicians/me/active-job/snapshot", headers=headers).json()["version"]
    app_store._job_lifecycle_version[jid] += 1
    second = client.get("/technicians/me/active-job/snapshot", headers=headers).json()["version"]
    assert second != first


def test_snapshot_version_changes_after_status_transition():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    first = client.get("/technicians/me/active-job/snapshot", headers=headers).json()["version"]
    asyncio.run(app_store.set_job_status(
        UUID(jid), ACTIVE_JOB_STATUSES[1], expected_current=ACTIVE_JOB_STATUSES[0]))
    second = client.get("/technicians/me/active-job/snapshot", headers=headers).json()
    assert second["active_job"]["status"] == ACTIVE_JOB_STATUSES[1]
    assert second["version"] != first


def test_snapshot_null_when_idle():
    client = TestClient(app)
    _, headers = _register_tech()
    body = client.get("/technicians/me/active-job/snapshot", headers=headers).json()
    assert body == {"active_job": None, "version": None, "allowed_actions": []}


def test_snapshot_only_returns_own_job():
    client = TestClient(app)
    tid_a, headers_a = _register_tech()
    _, headers_b = _register_tech()
    _assign_job(tid_a)
    assert client.get("/technicians/me/active-job/snapshot", headers=headers_a).json()["active_job"]
    # B has no job of their own -> null, never A's
    assert client.get("/technicians/me/active-job/snapshot", headers=headers_b).json()["active_job"] is None


def test_snapshot_requires_technician_auth():
    client = TestClient(app)
    assert client.get("/technicians/me/active-job/snapshot").status_code == 401
    prov = {"authorization": f"Bearer {create_access_token({'sub': 'usr_provider_demo'})}"}
    assert client.get("/technicians/me/active-job/snapshot", headers=prov).status_code in (403, 409)


# --- report-issue expected_version guard ---------------------------------
def test_report_issue_matching_expected_version_succeeds():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    version = client.get("/technicians/me/active-job/snapshot", headers=headers).json()["version"]
    resp = client.post(f"/jobs/{jid}/report-issue", headers=headers,
                       json={"kind": "cannot_complete", "expected_version": version})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"reported": True, "kind": "cannot_complete"}


def test_report_issue_stale_expected_version_conflicts_without_side_effect():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    before = _issue_events(jid)
    resp = client.post(f"/jobs/{jid}/report-issue", headers=headers,
                       json={"kind": "cannot_complete", "expected_version": "stale-version-000"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "version_conflict"
    assert "current_version" in resp.json()["detail"]
    assert _issue_events(jid) == before  # nothing logged


def test_report_issue_without_expected_version_still_works():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    resp = client.post(f"/jobs/{jid}/report-issue", headers=headers,
                       json={"kind": "customer_unavailable"})
    assert resp.status_code == 200


def test_expected_version_composes_with_idempotency_key():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    version = client.get("/technicians/me/active-job/snapshot", headers=headers).json()["version"]
    key = "mut_" + uuid4().hex
    body = {"kind": "unsafe", "expected_version": version, "client_mutation_id": key}
    first = client.post(f"/jobs/{jid}/report-issue", headers=headers, json=body)
    assert first.status_code == 200, first.text
    before = _issue_events(jid)
    retry = client.post(f"/jobs/{jid}/report-issue", headers=headers, json=body)
    assert retry.status_code == 200
    assert retry.json() == first.json()  # idempotent replay preserved
    assert _issue_events(jid) == before  # no duplicate side effect
