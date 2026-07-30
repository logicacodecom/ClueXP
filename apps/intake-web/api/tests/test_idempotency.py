"""Offline-sync idempotency contract tests (InMemory store via TestClient).

Store level: reserve -> pending -> done; conflict on a different request hash;
per-technician scoping. Endpoint level (report-issue): first mutation succeeds,
exact retry replays the same result with no double side effect, same key with a
different payload is a structured 409 conflict, and auth/role is enforced.

Run from apps/intake-web:  pytest api/tests/test_idempotency.py
"""
from __future__ import annotations

import asyncio
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


def _assign_job(tid: str) -> str:
    jid = str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_status[jid] = ACTIVE_JOB_STATUSES[0]
    app_store._job_tech[jid] = tid
    return jid


# --- store level ----------------------------------------------------------
def test_store_reserve_pending_done_and_conflict():
    tid = str(uuid4())
    key = "mut-" + uuid4().hex

    first = asyncio.run(app_store.begin_or_get_technician_mutation(tid, key, "hash-1"))
    assert first == {"state": "new"}

    pending = asyncio.run(app_store.begin_or_get_technician_mutation(tid, key, "hash-1"))
    assert pending["state"] == "pending"

    asyncio.run(app_store.complete_technician_mutation(
        tid, key, status_code=200, response={"ok": True}))
    done = asyncio.run(app_store.begin_or_get_technician_mutation(tid, key, "hash-1"))
    assert done == {"state": "done", "status_code": 200, "response": {"ok": True}}

    conflict = asyncio.run(app_store.begin_or_get_technician_mutation(tid, key, "hash-2"))
    assert conflict == {"state": "conflict"}


def test_store_key_is_scoped_per_technician():
    key = "shared-" + uuid4().hex
    t1, t2 = str(uuid4()), str(uuid4())
    assert asyncio.run(app_store.begin_or_get_technician_mutation(t1, key, "h"))["state"] == "new"
    # same key string under a different technician is independent
    assert asyncio.run(app_store.begin_or_get_technician_mutation(t2, key, "h"))["state"] == "new"


# --- endpoint level (report-issue) ---------------------------------------
def test_report_issue_first_then_exact_retry_is_idempotent():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    key = "mut-" + uuid4().hex
    body = {"kind": "cannot_complete", "reason": "no access", "client_mutation_id": key}

    first = client.post(f"/jobs/{jid}/report-issue", headers=headers, json=body)
    assert first.status_code == 200, first.text
    assert first.json() == {"reported": True, "kind": "cannot_complete"}

    before = sum(1 for e in app_store.events if jid in e and "tech_issue" in e)
    retry = client.post(f"/jobs/{jid}/report-issue", headers=headers, json=body)
    assert retry.status_code == 200
    assert retry.json() == first.json()  # same safe result
    after = sum(1 for e in app_store.events if jid in e and "tech_issue" in e)
    assert after == before  # no double side effect


def test_report_issue_same_key_different_payload_conflicts():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    key = "mut-" + uuid4().hex
    ok = client.post(f"/jobs/{jid}/report-issue", headers=headers,
                     json={"kind": "cannot_complete", "client_mutation_id": key})
    assert ok.status_code == 200
    # reuse the key with a materially different payload
    conflict = client.post(f"/jobs/{jid}/report-issue", headers=headers,
                           json={"kind": "unsafe", "client_mutation_id": key})
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency_key_reuse"


def test_report_issue_without_key_still_works():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    resp = client.post(f"/jobs/{jid}/report-issue", headers=headers,
                       json={"kind": "customer_unavailable"})
    assert resp.status_code == 200


def test_report_issue_requires_technician_auth():
    client = TestClient(app)
    tid, _ = _register_tech()
    jid = _assign_job(tid)
    assert client.post(f"/jobs/{jid}/report-issue",
                       json={"kind": "cannot_complete"}).status_code == 401
    prov = {"authorization": f"Bearer {create_access_token({'sub': 'usr_provider_demo'})}"}
    assert client.post(f"/jobs/{jid}/report-issue", headers=prov,
                       json={"kind": "cannot_complete"}).status_code in (403, 409)
