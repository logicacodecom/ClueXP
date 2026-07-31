"""Collection reporting native contracts (InMemory).

POST /jobs/{id}/collection remains compatible with existing PWA callers while
supporting optional expected_version and client_mutation_id for native/offline
replay.

Run from apps/intake-web:
  pytest api/tests/test_collection_idempotency.py
"""
from __future__ import annotations

import asyncio
from uuid import UUID
from uuid import uuid4

from starlette.testclient import TestClient

from api.auth import create_access_token
from api.dispatch import STATUS_IN_PROGRESS
from api.main import app, store as app_store
from api.main import PaymentReportRequest, _build_closeout_report, _mutation_request_hash


def _register_tech() -> tuple[str, dict[str, str]]:
    tid = str(uuid4())
    app_store.users[tid] = {
        "id": tid, "email": f"collector-{tid}@example.com", "phone": None,
        "display_name": "Collection Tech", "password_hash": "x",
        "roles": ["technician"], "active_organization_id": None,
        "organization_name": None,
    }
    techs = app_store._technicians = getattr(app_store, "_technicians", [])
    techs.append({
        "id": tid, "display_name": "Collection Tech", "status": "active",
        "vetting_status": "verified", "is_available": True,
    })
    token = create_access_token({"sub": tid, "roles": ["technician"]})
    return tid, {"authorization": f"Bearer {token}"}


def _assign_job(tid: str) -> str:
    jid = str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_lifecycle_version = getattr(app_store, "_job_lifecycle_version", {})
    app_store._job_status[jid] = STATUS_IN_PROGRESS
    app_store._job_tech[jid] = tid
    app_store._job_lifecycle_version[jid] = 1
    return jid


def _snapshot_version(client: TestClient, headers: dict[str, str]) -> str:
    resp = client.get("/technicians/me/active-job/snapshot", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["version"]


def _payment(jid: str) -> dict | None:
    return asyncio.run(app_store.get_payment_reports(jid))["technician"]


def _closeout(jid: str) -> dict | None:
    return asyncio.run(app_store.get_job_closeout(jid))


def test_collection_without_native_fields_still_works():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)

    resp = client.post(f"/jobs/{jid}/collection", headers=headers,
                       json={"amount": 125, "method": "cash"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["payment"]["amount"] == 125.0
    assert resp.json()["payment"]["method"] == "cash"


def test_collection_matching_expected_version_succeeds():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    version = _snapshot_version(client, headers)

    resp = client.post(f"/jobs/{jid}/collection", headers=headers,
                       json={"amount": 80, "method": "zelle", "expected_version": version})

    assert resp.status_code == 200, resp.text
    assert resp.json()["payment"]["amount"] == 80.0


def test_collection_stale_expected_version_conflicts_without_writes_or_key_reservation():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    key = "mut_" + uuid4().hex
    body = {
        "amount": 60,
        "method": "cash",
        "expected_version": "stale-version",
        "client_mutation_id": key,
    }

    conflict = client.post(f"/jobs/{jid}/collection", headers=headers, json=body)

    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "version_conflict"
    assert "current_version" in conflict.json()["detail"]
    assert _payment(jid) is None
    assert _closeout(jid) is None

    recovered = dict(body)
    recovered["expected_version"] = conflict.json()["detail"]["current_version"]
    retry = client.post(f"/jobs/{jid}/collection", headers=headers, json=recovered)
    assert retry.status_code == 200, retry.text
    assert retry.json()["payment"]["amount"] == 60.0


def test_collection_exact_retry_replays_without_rewriting_closeout_or_payment():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    key = "mut_" + uuid4().hex
    body = {
        "method": "credit_card",
        "amount": 100,
        "tip_amount": 10,
        "client_mutation_id": key,
    }

    first = client.post(f"/jobs/{jid}/collection", headers=headers, json=body)
    assert first.status_code == 200, first.text
    payment_reported_at = first.json()["payment"]["reported_at"]
    closeout_updated_at = first.json()["closeout"]["updated_at"]

    retry = client.post(f"/jobs/{jid}/collection", headers=headers, json=body)
    assert retry.status_code == 200, retry.text
    assert retry.json() == first.json()
    assert retry.json()["payment"]["reported_at"] == payment_reported_at
    assert retry.json()["closeout"]["updated_at"] == closeout_updated_at


def test_collection_same_key_different_normalized_payload_conflicts():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    key = "mut_" + uuid4().hex

    ok = client.post(f"/jobs/{jid}/collection", headers=headers,
                     json={"amount": 90, "method": "cash", "client_mutation_id": key})
    assert ok.status_code == 200, ok.text

    conflict = client.post(f"/jobs/{jid}/collection", headers=headers,
                           json={"amount": 91, "method": "cash", "client_mutation_id": key})
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency_key_reuse"
    assert _payment(jid)["amount"] == 90.0


def test_collection_in_flight_idempotency_key_conflicts_without_writes():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)
    key = "mut_" + uuid4().hex
    payload = PaymentReportRequest(amount=25, method="cash")
    lifecycle = asyncio.run(app_store.get_job_lifecycle(jid))
    closeout, method = asyncio.run(_build_closeout_report(
        job_id=UUID(jid), payload=payload, lifecycle=lifecycle))
    req_hash = _mutation_request_hash(
        "report-collection",
        jid,
        {
            "currency": closeout["currency"],
            "method": method,
            "line_items": closeout["line_items"],
            "subtotal_cents": closeout["subtotal_cents"],
            "taxable_subtotal_cents": closeout["taxable_subtotal_cents"],
            "tax_rate_basis_points": closeout["tax_rate_basis_points"],
            "tax_cents": closeout["tax_cents"],
            "tip_cents": closeout["tip_cents"],
            "card_fee_basis_points": closeout["card_fee_basis_points"],
            "card_fee_fixed_cents": closeout["card_fee_fixed_cents"],
            "card_fee_cents": closeout["card_fee_cents"],
            "total_cents": closeout["total_cents"],
            "no_tax_reason": closeout["no_tax_reason"],
        },
    )
    asyncio.run(app_store.begin_or_get_technician_mutation(UUID(tid), key, req_hash))

    resp = client.post(f"/jobs/{jid}/collection", headers=headers,
                       json={"amount": 25, "method": "cash", "client_mutation_id": key})

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "idempotency_in_progress"
    assert _payment(jid) is None
    assert _closeout(jid) is None


def test_collection_client_mutation_id_validation():
    client = TestClient(app)
    tid, headers = _register_tech()
    jid = _assign_job(tid)

    bad = client.post(f"/jobs/{jid}/collection", headers=headers,
                      json={"amount": 10, "method": "cash", "client_mutation_id": "bad key"})

    assert bad.status_code == 422
