"""expected_version guard on the technician lifecycle transition endpoint
(PATCH /tickets/{id}/status).

Covers: transition without expected_version still works (existing PWA
behavior preserved), matching version succeeds, stale version returns a
structured 409 version_conflict with NO status mutation / lifecycle_version
bump / transition side effect, a successful transition changes the next
snapshot version, and auth/self-scope is unchanged.

Run from apps/intake-web:  pytest api/tests/test_lifecycle_version_guard.py
"""
from __future__ import annotations

from uuid import uuid4

from starlette.testclient import TestClient

from api.auth import create_access_token
from api.dispatch import ACTIVE_JOB_STATUSES, STATUS_EN_ROUTE
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


def _snapshot_version(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/technicians/me/active-job/snapshot", headers=headers).json()["version"]


def test_transition_without_expected_version_still_works():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    resp = client.patch(f"/tickets/{jid}/status", headers=headers,
                        json={"status": STATUS_EN_ROUTE})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": STATUS_EN_ROUTE}
    assert app_store._job_status[jid] == STATUS_EN_ROUTE


def test_transition_with_matching_expected_version_succeeds():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    version = _snapshot_version(client, headers)
    resp = client.patch(f"/tickets/{jid}/status", headers=headers,
                        json={"status": STATUS_EN_ROUTE, "expected_version": version})
    assert resp.status_code == 200, resp.text
    assert app_store._job_status[jid] == STATUS_EN_ROUTE


def test_stale_expected_version_conflicts_without_mutation():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    version_before = app_store._job_lifecycle_version[jid]
    resp = client.patch(f"/tickets/{jid}/status", headers=headers,
                        json={"status": STATUS_EN_ROUTE, "expected_version": "stale-000"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "version_conflict"
    assert "current_version" in resp.json()["detail"]
    # no mutation, no lifecycle_version bump, no transition side effect
    assert app_store._job_status[jid] == ACTIVE_JOB_STATUSES[0]
    assert app_store._job_lifecycle_version[jid] == version_before


def test_successful_transition_changes_next_snapshot_version():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    before = _snapshot_version(client, headers)
    resp = client.patch(f"/tickets/{jid}/status", headers=headers,
                        json={"status": STATUS_EN_ROUTE, "expected_version": before})
    assert resp.status_code == 200, resp.text
    after = _snapshot_version(client, headers)
    assert after != before


def test_stale_version_reported_matches_next_valid_transition():
    """The current_version reported on conflict is exactly what a fresh snapshot
    read would return -- so a client can recover by re-fetching and retrying."""
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    conflict = client.patch(f"/tickets/{jid}/status", headers=headers,
                            json={"status": STATUS_EN_ROUTE, "expected_version": "stale-000"})
    assert conflict.status_code == 409
    reported = conflict.json()["detail"]["current_version"]
    assert reported == _snapshot_version(client, headers)
    # the reported version now works
    retry = client.patch(f"/tickets/{jid}/status", headers=headers,
                         json={"status": STATUS_EN_ROUTE, "expected_version": reported})
    assert retry.status_code == 200


def test_auth_and_self_scope_unchanged():
    client = TestClient(app)
    tid_a, headers_a = _register_tech()
    _, headers_b = _register_tech()
    jid = _assign_job(tid_a)
    # unauthenticated
    assert client.patch(f"/tickets/{jid}/status", json={"status": STATUS_EN_ROUTE}).status_code == 401
    # a different technician cannot transition someone else's job
    other = client.patch(f"/tickets/{jid}/status", headers=headers_b,
                         json={"status": STATUS_EN_ROUTE})
    assert other.status_code == 403
    assert app_store._job_status[jid] == ACTIVE_JOB_STATUSES[0]  # untouched
