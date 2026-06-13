"""Unit tests for the dispatch tracking contract.

Pure-function tests for the state machine + policy selection + ETA, plus a few
InMemory-store tests asserting the customer-safe invariants (no candidate leak
before acceptance, polling never creates offers). Run from apps/intake-web:

    cd apps/intake-web && pytest api/tests
"""
from __future__ import annotations

import asyncio
from uuid import UUID

from api.dispatch import (
    POLICY_NETWORK_OPEN,
    POLICY_OWNER_FIRST,
    POLICY_PRIVATE,
    STATUS_ARRIVED,
    STATUS_ASSIGNED,
    STATUS_COMPLETED_CONFIRMED,
    STATUS_COMPLETED_PENDING,
    STATUS_EN_ROUTE,
    STATUS_IN_PROGRESS,
    STATUS_PENDING_DISPATCH,
    can_technician_transition,
    customer_actions,
    eta_range_from_km,
    is_terminal,
    normalize_policy,
    resolve_dispatch_state,
    select_candidates,
    to_db_policy,
)
from api.store import InMemoryStore

MAX = 3


def _state(**kw):
    base = dict(matched=False, active_offers=0, total_offers=0, attempts=0, max_attempts=MAX, timed_out=False)
    base.update(kw)
    return resolve_dispatch_state(**base)


# --- state machine ---------------------------------------------------------
def test_matched_wins():
    assert _state(matched=True, active_offers=2) == "matched"


def test_waiting_active_offers():
    assert _state(active_offers=2, attempts=1) == "waiting"


def test_waiting_not_yet_dispatched():
    assert _state(attempts=0) == "waiting"


def test_expired_retry_when_offers_lapsed():
    assert _state(attempts=1, total_offers=3, active_offers=0) == "expired_retry"


def test_no_eligible_when_round_found_none():
    assert _state(attempts=1, total_offers=0, active_offers=0) == "no_eligible"


def test_no_eligible_when_max_rounds():
    assert _state(attempts=MAX, total_offers=3) == "no_eligible"


def test_no_eligible_when_timed_out():
    assert _state(attempts=1, total_offers=3, active_offers=0, timed_out=True) == "no_eligible"


def test_terminal_flags():
    assert is_terminal("matched", attempts=0, max_attempts=MAX, timed_out=False) is True
    assert is_terminal("no_eligible", attempts=MAX, max_attempts=MAX, timed_out=False) is True
    assert is_terminal("no_eligible", attempts=1, max_attempts=MAX, timed_out=False) is False
    assert is_terminal("expired_retry", attempts=1, max_attempts=MAX, timed_out=False) is False


# --- policy ----------------------------------------------------------------
def test_normalize_policy_mapping():
    assert normalize_policy("private", "org1") == POLICY_PRIVATE
    assert normalize_policy("network_overflow", "org1") == POLICY_OWNER_FIRST
    assert normalize_policy("network_open", "org1") == POLICY_NETWORK_OPEN
    # no owner org → always network_open
    assert normalize_policy("private", None) == POLICY_NETWORK_OPEN


_JOB = {"access_type": "home", "lat": 40.79, "lng": -73.95}


def _tech(tid, org_ids, lat=40.79, lng=-73.95):
    return {
        "id": tid, "display_name": tid, "skills": ["home"], "is_available": True,
        "service_area_center_lat": lat, "service_area_center_lng": lng,
        "service_area_radius_km": 25, "rating": 4.8, "org_ids": org_ids,
    }


def test_private_owner_only_excludes_network():
    techs = [_tech("owner", ["org1"]), _tech("network", ["org2"]), _tech("solo", [])]
    out = select_candidates(_JOB, techs, policy=POLICY_PRIVATE, owner_org_id="org1", round_index=0)
    assert [t["id"] for t in out] == ["owner"]


def test_owner_first_round0_then_network():
    techs = [_tech("owner", ["org1"]), _tech("network", ["org2"])]
    r0 = select_candidates(_JOB, techs, policy=POLICY_OWNER_FIRST, owner_org_id="org1", round_index=0)
    assert [t["id"] for t in r0] == ["owner"]
    r1 = select_candidates(_JOB, techs, policy=POLICY_OWNER_FIRST, owner_org_id="org1", round_index=1)
    assert {t["id"] for t in r1} == {"owner", "network"}


def test_network_open_includes_all():
    techs = [_tech("owner", ["org1"]), _tech("network", ["org2"]), _tech("solo", [])]
    out = select_candidates(_JOB, techs, policy=POLICY_NETWORK_OPEN, owner_org_id="org1", round_index=0)
    assert {t["id"] for t in out} == {"owner", "network", "solo"}


def test_no_owner_treated_as_network_open():
    techs = [_tech("a", ["org1"]), _tech("b", [])]
    out = select_candidates(_JOB, techs, policy=POLICY_PRIVATE, owner_org_id=None, round_index=0)
    assert len(out) == 2


# --- canonical mapping + fail-safe (vocabulary reconciliation) --------------
def test_to_db_policy_accepts_both_vocabularies_and_rejects_unknown():
    assert to_db_policy("private") == "private"
    assert to_db_policy("private_owner_only") == "private"
    assert to_db_policy("network_overflow") == "network_overflow"
    assert to_db_policy("owner_first_then_network") == "network_overflow"
    assert to_db_policy("network_open") == "network_open"
    assert to_db_policy("nonsense") is None
    assert to_db_policy(None) is None


def test_unknown_policy_fails_closed_for_company_owned():
    # company-owned (owner org present) + unknown/None stored value → private (fail closed)
    assert normalize_policy("garbage", "org1") == POLICY_PRIVATE
    assert normalize_policy(None, "org1") == POLICY_PRIVATE
    # public (no owner) → network_open regardless of stored value
    assert normalize_policy("garbage", None) == POLICY_NETWORK_OPEN
    assert normalize_policy(None, None) == POLICY_NETWORK_OPEN


def test_private_does_not_leak_when_no_owner_pool_member_available():
    # company-owned job, only network/solo techs exist → empty, NEVER the network
    techs = [_tech("network", ["org2"]), _tech("solo", [])]
    out = select_candidates(_JOB, techs, policy=POLICY_PRIVATE, owner_org_id="org1", round_index=3)
    assert out == []


def test_private_never_widens_on_any_round():
    techs = [_tech("owner", ["org1"]), _tech("network", ["org2"])]
    for rnd in (0, 1, 2, 5):
        out = select_candidates(_JOB, techs, policy=POLICY_PRIVATE, owner_org_id="org1", round_index=rnd)
        assert [t["id"] for t in out] == ["owner"], f"private leaked on round {rnd}"


def test_overflow_widens_only_when_policy_and_state_allow():
    techs = [_tech("owner", ["org1"]), _tech("network", ["org2"])]
    # round 0: owner only; later rounds: widen to network
    assert [t["id"] for t in select_candidates(
        _JOB, techs, policy=POLICY_OWNER_FIRST, owner_org_id="org1", round_index=0)] == ["owner"]
    assert {t["id"] for t in select_candidates(
        _JOB, techs, policy=POLICY_OWNER_FIRST, owner_org_id="org1", round_index=1)} == {"owner", "network"}


def test_unknown_company_policy_end_to_end_stays_owner_only():
    # misconfigured company job: normalize fails closed → private → owner-only even late
    techs = [_tech("owner", ["org1"]), _tech("network", ["org2"])]
    policy = normalize_policy("garbage", "org1")
    out = select_candidates(_JOB, techs, policy=policy, owner_org_id="org1", round_index=2)
    assert [t["id"] for t in out] == ["owner"]


def test_network_open_for_public_cluexp_job():
    techs = [_tech("a", ["org1"]), _tech("b", ["org2"]), _tech("c", [])]
    policy = normalize_policy("private", None)  # public job: stored value irrelevant
    out = select_candidates(_JOB, techs, policy=policy, owner_org_id=None, round_index=0)
    assert {t["id"] for t in out} == {"a", "b", "c"}


# --- ETA -------------------------------------------------------------------
def test_eta_is_coarse_range_and_estimate():
    lo, hi = eta_range_from_km(5.0)
    assert lo is not None and hi is not None and lo < hi and lo >= 10
    assert eta_range_from_km(None) == (None, None)


# --- I/O invariants (InMemory) --------------------------------------------
def test_polling_does_not_create_offers():
    store = InMemoryStore()
    jid = "00000000-0000-0000-0000-000000000001"
    before = len(getattr(store, "_offers", {}))
    status = asyncio.run(store.get_dispatch_status(jid, max_attempts=MAX, total_timeout_seconds=480))
    after = len(getattr(store, "_offers", {}))
    assert before == after  # pure read
    assert status["assignment"] is None  # no candidate/assignment leak before acceptance


def test_no_assignment_before_match():
    store = InMemoryStore()
    jid = "00000000-0000-0000-0000-000000000002"
    status = asyncio.run(store.get_dispatch_status(jid, max_attempts=MAX, total_timeout_seconds=480))
    assert status["state"] in {"waiting", "no_eligible"}
    assert status["assignment"] is None


# --- fulfillment cutover: technician transitions (pure) --------------------
def test_technician_forward_transitions_allowed():
    assert can_technician_transition(STATUS_ASSIGNED, STATUS_EN_ROUTE)
    assert can_technician_transition(STATUS_EN_ROUTE, STATUS_ARRIVED)
    assert can_technician_transition(STATUS_ARRIVED, STATUS_IN_PROGRESS)
    assert can_technician_transition(STATUS_IN_PROGRESS, STATUS_COMPLETED_PENDING)
    # forward skip is permitted (tech forgot an intermediate state)
    assert can_technician_transition(STATUS_ASSIGNED, STATUS_IN_PROGRESS)


def test_technician_cannot_go_backward_or_confirm():
    assert not can_technician_transition(STATUS_ARRIVED, STATUS_EN_ROUTE)
    assert not can_technician_transition(STATUS_IN_PROGRESS, STATUS_IN_PROGRESS)
    # hard rule: technician may NEVER set completed_confirmed
    assert not can_technician_transition(STATUS_COMPLETED_PENDING, STATUS_COMPLETED_CONFIRMED)
    # cannot act before assignment / on a non-ladder status
    assert not can_technician_transition(STATUS_PENDING_DISPATCH, STATUS_EN_ROUTE)
    assert not can_technician_transition("complete", STATUS_EN_ROUTE)


def test_customer_actions_only_when_completion_pending():
    pending = customer_actions(STATUS_COMPLETED_PENDING)
    assert pending["can_confirm"] is True
    assert pending["can_dispute"] is True
    assert pending["can_review"] is True
    assert pending["can_cancel"] is False  # arrived+ → cancel blocked
    # in-progress: no completion affordance yet
    ip = customer_actions(STATUS_IN_PROGRESS)
    assert ip["can_confirm"] is False
    assert ip["can_dispute"] is False
    assert ip["can_review"] is False
    assert ip["can_cancel"] is False
    # confirmed: review still allowed (grace), but no re-confirm / dispute / cancel
    confirmed = customer_actions(STATUS_COMPLETED_CONFIRMED)
    assert confirmed["can_confirm"] is False
    assert confirmed["can_dispute"] is False
    assert confirmed["can_review"] is True
    assert confirmed["can_cancel"] is False


# --- fulfillment cutover: store transition gating (InMemory) ---------------
def test_set_job_status_guarded_by_expected_current():
    store = InMemoryStore()
    jid = "00000000-0000-0000-0000-000000000010"
    asyncio.run(store.set_job_status(jid, STATUS_ASSIGNED))
    # wrong expected_current → no-op (None)
    assert asyncio.run(
        store.set_job_status(jid, STATUS_ARRIVED, expected_current=STATUS_EN_ROUTE)
    ) is None
    # correct expected_current → advances
    out = asyncio.run(
        store.set_job_status(jid, STATUS_EN_ROUTE, expected_current=STATUS_ASSIGNED)
    )
    assert out["status"] == STATUS_EN_ROUTE


def test_unknown_token_resolves_to_none():
    store = InMemoryStore()
    assert asyncio.run(store.resolve_tracking_token("nope")) is None
    assert asyncio.run(
        store.get_tracking_by_token("nope", max_attempts=MAX, total_timeout_seconds=480)
    ) is None


# --- customer cancel ---------------------------------------------------------
def test_can_customer_cancel_allowed_statuses():
    from api.dispatch import can_customer_cancel, STATUS_PENDING_DISPATCH, STATUS_ASSIGNED, STATUS_EN_ROUTE
    assert can_customer_cancel(STATUS_PENDING_DISPATCH) is True
    assert can_customer_cancel(STATUS_ASSIGNED) is True
    assert can_customer_cancel(STATUS_EN_ROUTE) is True


def test_can_customer_cancel_blocked_statuses():
    from api.dispatch import can_customer_cancel
    for s in (STATUS_ARRIVED, STATUS_IN_PROGRESS, STATUS_COMPLETED_PENDING,
              STATUS_COMPLETED_CONFIRMED, None, "old_intake_status"):
        assert can_customer_cancel(s) is False, f"expected False for {s!r}"


def test_cancel_job_succeeds_and_returns_cancelled():
    store = InMemoryStore()
    jid = "00000000-0000-0000-0000-000000000020"
    asyncio.run(store.set_job_status(jid, STATUS_PENDING_DISPATCH))
    result = asyncio.run(store.cancel_job(UUID(jid), current_status=STATUS_PENDING_DISPATCH))
    assert result is not None
    assert result["status"] == "cancelled"
    status = asyncio.run(store.get_dispatch_status(jid, max_attempts=MAX, total_timeout_seconds=480))
    assert status["status"] == "cancelled"


def test_cancel_job_blocked_by_wrong_current_status():
    store = InMemoryStore()
    jid = "00000000-0000-0000-0000-000000000021"
    asyncio.run(store.set_job_status(jid, STATUS_ARRIVED))
    result = asyncio.run(store.cancel_job(UUID(jid), current_status=STATUS_EN_ROUTE))
    assert result is None  # guard mismatched → concurrent change detected


def test_cancel_job_atomically_revokes_outstanding_offers():
    store = InMemoryStore()
    jid = "00000000-0000-0000-0000-000000000022"
    asyncio.run(store.set_job_status(jid, STATUS_PENDING_DISPATCH))
    store._offers = {"offer-1": {"job_id": jid, "status": "offered", "technician_id": "t1"}}
    asyncio.run(store.cancel_job(UUID(jid), current_status=STATUS_PENDING_DISPATCH))
    assert store._offers["offer-1"]["status"] == "superseded"


# --- blind tracking (token endpoint strips dispatch internals) ---------------
def test_token_endpoint_omits_dispatch_internals():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    client = TestClient(app)

    # seed a job with a known token
    jid = UUID("00000000-0000-0000-0000-000000000030")
    token = "test-blind-tracking-token"
    app_store._tokens = getattr(app_store, "_tokens", {})
    app_store._tokens[str(jid)] = token

    resp = client.get(f"/t/{token}")
    assert resp.status_code == 200
    body = resp.json()
    for field in ("attempts", "max_attempts", "offers_pending", "offer_expires_at"):
        assert field not in body, f"dispatch internal field {field!r} leaked into token response"


# --- ops-controlled model: legacy endpoints gated --------------------------
def test_legacy_dispatch_endpoint_is_gone():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    resp = client.post("/tickets/00000000-0000-0000-0000-000000000099/dispatch")
    assert resp.status_code == 410


def test_legacy_offers_endpoint_is_gone():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    resp = client.post("/tickets/00000000-0000-0000-0000-000000000099/offers")
    assert resp.status_code == 410


# --- cron sweep is cleanup-only (no re-dispatch) ---------------------------
def test_cron_sweep_response_has_no_redispatch_field():
    from unittest.mock import patch
    from starlette.testclient import TestClient
    from api.main import app
    import api.main as _main_mod
    secret = "test-cron-secret-sprint34"
    client = TestClient(app)
    with patch.object(_main_mod.config, "CRON_SECRET", secret):
        resp = client.post("/cron/dispatch-sweep", headers={"Authorization": f"Bearer {secret}"})
    assert resp.status_code == 200
    body = resp.json()
    assert "expired_offers" in body
    assert "auto_closed" in body
    # no re-dispatch fields — this is cleanup-only
    assert "dispatchable_jobs" not in body
    assert "redispatched" not in body


# --- ops endpoints require authentication ----------------------------------
def test_ops_queue_requires_auth():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    resp = client.get("/ops/queue")
    assert resp.status_code == 401


def test_ops_candidates_requires_auth():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    resp = client.get("/ops/queue/00000000-0000-0000-0000-000000000001/candidates")
    assert resp.status_code == 401


def test_ops_assign_requires_auth():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    resp = client.post(
        "/ops/queue/00000000-0000-0000-0000-000000000001/assign",
        json={"technician_id": "00000000-0000-0000-0000-000000000002"},
    )
    assert resp.status_code == 401


def test_ops_fleet_requires_auth():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    resp = client.get("/ops/fleet")
    assert resp.status_code == 401


# --- ops dispatcher role gate (invalid role → 403) -------------------------
def test_ops_queue_requires_dispatcher_role():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    # seed a user with only the technician role
    uid = "user-role-test-99"
    app_store.users[uid] = {
        "id": uid, "email": "roletest@cluexp.test", "phone": None,
        "display_name": "Role Test", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    token = create_access_token({"sub": uid, "id": uid})
    client = TestClient(app)
    resp = client.get("/ops/queue", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


# --- InMemoryStore: decline marks offer as declined ------------------------
def test_inmemory_decline_marks_offered():
    from uuid import uuid4
    store = InMemoryStore()
    tid = str(uuid4())
    oid = str(uuid4())
    store._offers = {oid: {"id": oid, "job_id": "jid-1", "status": "offered", "technician_id": tid}}
    result = asyncio.run(store.decline_dispatch_offer(UUID(oid), UUID(tid)))
    assert result is True
    assert store._offers[oid]["status"] == "declined"


def test_inmemory_decline_returns_false_for_nonexistent():
    from uuid import uuid4
    store = InMemoryStore()
    result = asyncio.run(store.decline_dispatch_offer(UUID(str(uuid4())), UUID(str(uuid4()))))
    assert result is False


# --- ops endpoints require platform_admin, not just any dispatcher ----------
def test_ops_queue_requires_platform_admin_not_provider_dispatcher():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    uid = "user-provider-dispatcher-99"
    app_store.users[uid] = {
        "id": uid, "email": "provdisp@cluexp.test", "phone": None,
        "display_name": "Provider Dispatcher", "password_hash": "",
        "roles": ["dispatcher"], "active_organization_id": None, "organization_name": None,
    }
    token = create_access_token({"sub": uid, "id": uid})
    client = TestClient(app)
    resp = client.get("/ops/queue", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_ops_assign_requires_platform_admin_not_provider_dispatcher():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    from uuid import uuid4
    uid = "user-provider-dispatcher-98"
    app_store.users[uid] = {
        "id": uid, "email": "provdisp2@cluexp.test", "phone": None,
        "display_name": "Provider Dispatcher 2", "password_hash": "",
        "roles": ["dispatcher"], "active_organization_id": None, "organization_name": None,
    }
    token = create_access_token({"sub": uid, "id": uid})
    client = TestClient(app)
    resp = client.post(
        f"/ops/queue/{uuid4()}/assign",
        json={"technician_id": str(uuid4())},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


# --- InMemoryStore: ops_create_single_offer blocks duplicate ----------------
def test_inmemory_ops_create_single_offer_success():
    from uuid import uuid4
    from datetime import datetime, timezone, timedelta
    store = InMemoryStore()
    jid = uuid4()
    tid = uuid4()
    expires = datetime.now(timezone.utc) + timedelta(seconds=600)
    offer = asyncio.run(store.ops_create_single_offer(jid, tid, None, expires))
    assert offer is not None
    assert offer["status"] == "offered"
    assert offer["technician_id"] == str(tid)


def test_inmemory_ops_create_single_offer_blocks_duplicate():
    from uuid import uuid4
    from datetime import datetime, timezone, timedelta
    store = InMemoryStore()
    jid = uuid4()
    expires = datetime.now(timezone.utc) + timedelta(seconds=600)
    first = asyncio.run(store.ops_create_single_offer(jid, uuid4(), None, expires))
    second = asyncio.run(store.ops_create_single_offer(jid, uuid4(), None, expires))
    assert first is not None
    assert second is None


# --- InMemoryStore: get_ops_technician ----------------------------------------
def test_inmemory_get_ops_technician_returns_active_verified():
    from uuid import uuid4
    store = InMemoryStore()
    tid = str(uuid4())
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified", "display_name": "T"}]
    result = asyncio.run(store.get_ops_technician(UUID(tid)))
    assert result is not None
    assert result["id"] == tid


def test_inmemory_get_ops_technician_returns_none_for_inactive():
    from uuid import uuid4
    store = InMemoryStore()
    tid = str(uuid4())
    store._technicians = [{"id": tid, "status": "inactive", "vetting_status": "verified", "display_name": "T"}]
    result = asyncio.run(store.get_ops_technician(UUID(tid)))
    assert result is None


def test_inmemory_get_ops_technician_returns_none_for_unknown():
    from uuid import uuid4
    store = InMemoryStore()
    store._technicians = []
    result = asyncio.run(store.get_ops_technician(uuid4()))
    assert result is None


# --- HTTP: platform_admin can query ops queue (empty) -----------------------
def test_ops_queue_ok_for_platform_admin():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    uid = "user-platform-admin-ops-1"
    app_store.users[uid] = {
        "id": uid, "email": "admin_ops@cluexp.test", "phone": None,
        "display_name": "Platform Admin", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }
    token = create_access_token({"sub": uid, "id": uid, "roles": ["platform_admin"]})
    client = TestClient(app)
    resp = client.get("/ops/queue", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# --- HTTP: assign unknown technician returns 422 ----------------------------
def test_ops_assign_unknown_tech_returns_422():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    from uuid import uuid4
    uid = "user-platform-admin-ops-2"
    jid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "admin_ops2@cluexp.test", "phone": None,
        "display_name": "Platform Admin 2", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }
    # Seed job in pending_dispatch
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_PENDING_DISPATCH
    token = create_access_token({"sub": uid, "id": uid, "roles": ["platform_admin"]})
    client = TestClient(app)
    resp = client.post(
        f"/ops/queue/{jid}/assign",
        json={"technician_id": str(uuid4())},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


# --- HTTP: concurrent assign returns 409 ------------------------------------
def test_ops_assign_concurrent_409():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    from uuid import uuid4
    uid = "user-platform-admin-ops-3"
    jid = str(uuid4())
    tid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "admin_ops3@cluexp.test", "phone": None,
        "display_name": "Platform Admin 3", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }
    # Seed job in pending_dispatch and a verified tech
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_PENDING_DISPATCH
    app_store._technicians = getattr(app_store, "_technicians", [])
    app_store._technicians.append({"id": tid, "status": "active", "vetting_status": "verified",
                                   "display_name": "T", "primary_organization_id": None})
    token = create_access_token({"sub": uid, "id": uid, "roles": ["platform_admin"]})
    client = TestClient(app)
    # First assign succeeds
    r1 = client.post(
        f"/ops/queue/{jid}/assign",
        json={"technician_id": tid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r1.status_code == 200
    # Second assign on same job → 409 (offer_active)
    r2 = client.post(
        f"/ops/queue/{jid}/assign",
        json={"technician_id": tid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 409
