"""Unit tests for the dispatch tracking contract.

Pure-function tests for the state machine + policy selection + ETA, plus a few
InMemory-store tests asserting the customer-safe invariants (no candidate leak
before acceptance, polling never creates offers). Run from apps/intake-web:

    cd apps/intake-web && pytest api/tests
"""
from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

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
    assert not can_technician_transition(STATUS_ASSIGNED, STATUS_IN_PROGRESS)
    assert not can_technician_transition(STATUS_EN_ROUTE, STATUS_IN_PROGRESS)
    assert not can_technician_transition(STATUS_ARRIVED, STATUS_COMPLETED_PENDING)


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


def test_token_endpoint_always_returns_guards():
    """The tracking UI reads guards.may_show_live_tracking / may_show_technician
    unconditionally; the endpoint must always supply the guards object so the
    customer page never crashes on `undefined` once a technician is assigned."""
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    client = TestClient(app)

    jid = UUID("00000000-0000-0000-0000-000000000031")
    token = "test-guards-token"
    app_store._tokens = getattr(app_store, "_tokens", {})
    app_store._tokens[str(jid)] = token

    body = client.get(f"/t/{token}").json()
    assert "guards" in body, "guards object missing from tracking response"
    for key in ("may_show_technician", "may_show_live_tracking", "may_show_eta"):
        assert isinstance(body["guards"].get(key), bool), f"guards.{key} must be a bool"


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


def test_ops_assign_route_removed():
    # ClueXP is SaaS and does not dispatch — the platform assign mutation is gone.
    # Dispatch lives only under /provider/queue/{id}/assign.
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    resp = client.post(
        "/ops/queue/00000000-0000-0000-0000-000000000001/assign",
        json={"technician_id": "00000000-0000-0000-0000-000000000002"},
    )
    assert resp.status_code in (404, 405)


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


def test_inmemory_decline_reason_persisted_and_surfaced_in_queue():
    from datetime import datetime, timezone
    store = InMemoryStore()
    jid = str(uuid4())
    tid = uuid4()
    store._job_status = {jid: STATUS_PENDING_DISPATCH}
    offer = asyncio.run(
        store.ops_create_single_offer(UUID(jid), tid, None, datetime.now(timezone.utc))
    )
    assert "id" in offer
    ok = asyncio.run(store.decline_dispatch_offer(UUID(offer["id"]), tid, "Too far"))
    assert ok is True
    assert store._offers[offer["id"]]["decline_reason"] == "Too far"
    # Declining with no active offer left returns the job to the Ops queue,
    # annotated with the most recent decline reason for reassignment.
    queue = asyncio.run(store.get_ops_queue())
    row = next(r for r in queue if r["id"] == jid)
    assert row["last_decline_reason"] == "Too far"
    assert row["decline_count"] == 1


def test_http_decline_offer_records_reason():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    oid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "tech_decline@cluexp.test", "phone": None,
        "display_name": "Decliner", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    app_store._offers = getattr(app_store, "_offers", {})
    app_store._offers[oid] = {
        "id": oid, "job_id": str(uuid4()), "status": "offered", "technician_id": uid,
    }
    _orig_session = app_store.get_user_session

    async def _patched_session(user_id):
        s = await _orig_session(user_id)
        if s and user_id == uid:
            s["technician"] = {"id": uid, "approved": True}
        return s

    app_store.get_user_session = _patched_session
    token = create_access_token({"sub": uid, "id": uid, "roles": ["technician"]})
    client = TestClient(app)
    try:
        resp = client.post(
            f"/offers/{oid}/decline", json={"reason": "On another job"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json().get("declined") is True
        assert app_store._offers[oid]["decline_reason"] == "On another job"
    finally:
        app_store.get_user_session = _orig_session


# ---------------------------------------------------------------------------
# Gate 2: secure arrival PIN — store-level state machine
# ---------------------------------------------------------------------------

def _pin_future(minutes: int = 10):
    from datetime import datetime, timezone, timedelta
    return datetime.now(timezone.utc) + timedelta(minutes=minutes)


def _pin_past(minutes: int = 10):
    from datetime import datetime, timezone, timedelta
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


def test_inmemory_arrival_pin_success_then_single_use():
    store = InMemoryStore()
    jid, tid = uuid4(), uuid4()
    asyncio.run(store.create_arrival_pin(jid, tid, "H", _pin_future(), 5))
    ok = asyncio.run(store.verify_arrival_pin(jid, tid, "H"))
    assert ok["ok"] is True
    # single-use: the same correct hash cannot verify twice
    again = asyncio.run(store.verify_arrival_pin(jid, tid, "H"))
    assert again["ok"] is False and again["reason"] == "already_used"


def test_inmemory_arrival_pin_wrong_then_lockout():
    store = InMemoryStore()
    jid, tid = uuid4(), uuid4()
    asyncio.run(store.create_arrival_pin(jid, tid, "RIGHT", _pin_future(), 3))
    results = [asyncio.run(store.verify_arrival_pin(jid, tid, "WRONG")) for _ in range(3)]
    assert [r["remaining"] for r in results] == [2, 1, 0]
    assert results[-1]["reason"] == "locked"
    # the correct PIN is refused once locked — no advance past the attempt cap
    blocked = asyncio.run(store.verify_arrival_pin(jid, tid, "RIGHT"))
    assert blocked["ok"] is False and blocked["reason"] == "locked"


def test_inmemory_arrival_pin_expired():
    store = InMemoryStore()
    jid, tid = uuid4(), uuid4()
    asyncio.run(store.create_arrival_pin(jid, tid, "H", _pin_past(), 5))
    r = asyncio.run(store.verify_arrival_pin(jid, tid, "H"))
    assert r["ok"] is False and r["reason"] == "expired"


def test_inmemory_arrival_pin_technician_mismatch():
    store = InMemoryStore()
    jid, tid, other = uuid4(), uuid4(), uuid4()
    asyncio.run(store.create_arrival_pin(jid, tid, "H", _pin_future(), 5))
    r = asyncio.run(store.verify_arrival_pin(jid, other, "H"))
    assert r["ok"] is False and r["reason"] == "technician_mismatch"


def test_arrival_pin_secret_fails_secure_in_production(monkeypatch):
    """In production, an absent ARRIVAL_PIN_SECRET must fail startup rather than
    silently fall back to the public dev default."""
    import importlib
    import pytest
    from api import config as config_module

    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.delenv("ARRIVAL_PIN_SECRET", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    try:
        with pytest.raises(RuntimeError):
            importlib.reload(config_module)
    finally:
        # Restore the normal (dev-default) config for the rest of the suite.
        monkeypatch.undo()
        importlib.reload(config_module)
    assert config_module.ARRIVAL_PIN_SECRET == "dev-arrival-pin-secret"


# ---------------------------------------------------------------------------
# Gate 2: secure arrival PIN — HTTP flow
# ---------------------------------------------------------------------------

def _seed_en_route_job(app_store, tech_uid, jid, *, token=None):
    app_store.users[tech_uid] = {
        "id": tech_uid, "email": f"arr_{tech_uid[:8]}@cluexp.test", "phone": None,
        "display_name": "Arr Tech", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_EN_ROUTE
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tech_uid
    if token is not None:
        app_store._tokens = getattr(app_store, "_tokens", {})
        app_store._tokens[jid] = token


def test_http_arrival_pin_issue_and_verify_flow():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    tech_uid = str(uuid4())
    jid = str(uuid4())
    token = "track-" + uuid4().hex
    _seed_en_route_job(app_store, tech_uid, jid, token=token)
    _orig_session = app_store.get_user_session

    async def _patched_session(user_id):
        s = await _orig_session(user_id)
        if s and user_id == tech_uid:
            s["technician"] = {"id": tech_uid, "approved": True}
        return s

    app_store.get_user_session = _patched_session
    access = create_access_token({"sub": tech_uid, "id": tech_uid, "roles": ["technician"]})
    client = TestClient(app)
    try:
        # Customer issues the PIN through the tracking token (no account auth).
        issued = client.post(f"/t/{token}/arrival-pin")
        assert issued.status_code == 200, issued.text
        pin = issued.json()["pin"]
        assert len(pin) == 6 and pin.isdigit()

        # A wrong PIN never advances the job.
        wrong = "000000" if pin != "000000" else "111111"
        bad = client.post(
            f"/jobs/{jid}/arrival/verify", json={"pin": wrong},
            headers={"Authorization": f"Bearer {access}"},
        )
        assert bad.status_code in (422, 429)
        assert app_store._job_status[jid] == STATUS_EN_ROUTE

        # The correct PIN moves en_route -> arrived.
        good = client.post(
            f"/jobs/{jid}/arrival/verify", json={"pin": pin},
            headers={"Authorization": f"Bearer {access}"},
        )
        assert good.status_code == 200, good.text
        assert good.json()["status"] == STATUS_ARRIVED
        assert app_store._job_status[jid] == STATUS_ARRIVED
    finally:
        app_store.get_user_session = _orig_session


def test_http_technician_cannot_set_arrived_directly():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    tech_uid = str(uuid4())
    jid = str(uuid4())
    _seed_en_route_job(app_store, tech_uid, jid)
    _orig_session = app_store.get_user_session

    async def _patched_session(user_id):
        s = await _orig_session(user_id)
        if s and user_id == tech_uid:
            s["technician"] = {"id": tech_uid, "approved": True}
        return s

    app_store.get_user_session = _patched_session
    access = create_access_token({"sub": tech_uid, "id": tech_uid, "roles": ["technician"]})
    client = TestClient(app)
    try:
        resp = client.patch(
            f"/tickets/{jid}/status", json={"status": "arrived"},
            headers={"Authorization": f"Bearer {access}"},
        )
        assert resp.status_code == 409
        assert "PIN" in resp.json().get("detail", "")
        assert app_store._job_status[jid] == STATUS_EN_ROUTE
    finally:
        app_store.get_user_session = _orig_session


def test_http_provider_override_arrival_requires_reason_and_is_tenant_scoped():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    disp_uid = str(uuid4())
    tech_uid = str(uuid4())
    jid = str(uuid4())
    _seed_en_route_job(app_store, tech_uid, jid)
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org  # job belongs to this company
    app_store.users[disp_uid] = {
        "id": disp_uid, "email": "disp_ovr@cluexp.test", "phone": None,
        "display_name": "Dispatcher", "password_hash": "",
        "roles": ["dispatcher"], "active_organization_id": org, "organization_name": "Acme",
    }
    access = create_access_token({"sub": disp_uid, "id": disp_uid, "roles": ["dispatcher"]})
    client = TestClient(app)

    # Reason required.
    missing = client.post(
        f"/provider/jobs/{jid}/arrival/override", json={"reason": ""},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert missing.status_code == 422
    assert app_store._job_status[jid] == STATUS_EN_ROUTE

    # A dispatcher from a different org cannot override this company's job.
    other_uid = str(uuid4())
    app_store.users[other_uid] = {
        "id": other_uid, "email": "disp_other@cluexp.test", "phone": None,
        "display_name": "Other", "password_hash": "",
        "roles": ["dispatcher"], "active_organization_id": str(uuid4()), "organization_name": "Other",
    }
    other_access = create_access_token({"sub": other_uid, "id": other_uid, "roles": ["dispatcher"]})
    foreign = client.post(
        f"/provider/jobs/{jid}/arrival/override", json={"reason": "trying cross-tenant"},
        headers={"Authorization": f"Bearer {other_access}"},
    )
    assert foreign.status_code == 404
    assert app_store._job_status[jid] == STATUS_EN_ROUTE

    # The owning company's dispatcher can override with a reason.
    ok = client.post(
        f"/provider/jobs/{jid}/arrival/override", json={"reason": "Customer could not read the PIN"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == STATUS_ARRIVED
    assert app_store._job_status[jid] == STATUS_ARRIVED


# ---------------------------------------------------------------------------
# Provider-managed dispatch (SaaS pivot): company dispatcher, org-scoped,
# tenant-isolated. ClueXP does not dispatch — the company does.
# ---------------------------------------------------------------------------

def _seed_dispatcher(app_store, uid, org_id):
    app_store.users[uid] = {
        "id": uid, "email": f"disp_{uid[:8]}@cluexp.test", "phone": None,
        "display_name": "Dispatcher", "password_hash": "",
        "roles": ["dispatcher"], "active_organization_id": org_id, "organization_name": "Acme",
    }


def _seed_provider_job(app_store, org_id, jid):
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_PENDING_DISPATCH
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org_id


def _seed_org_tech(app_store, org_id, tid):
    from datetime import datetime, timezone
    app_store._technicians = getattr(app_store, "_technicians", [])
    app_store._technicians.append({
        "id": tid, "status": "active", "vetting_status": "verified",
        "display_name": "Org Tech", "skills": [], "rating": 4.5,
        "current_lat": None, "current_lng": None,
        "service_area_center_lat": None, "service_area_center_lng": None,
        "location_updated_at": datetime.now(timezone.utc).isoformat(),
        "primary_organization_id": org_id,
    })


def test_provider_queue_scoped_to_org():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org_a, org_b = str(uuid4()), str(uuid4())
    uid = str(uuid4())
    job_a, job_b = str(uuid4()), str(uuid4())
    _seed_dispatcher(app_store, uid, org_a)
    _seed_provider_job(app_store, org_a, job_a)
    _seed_provider_job(app_store, org_b, job_b)
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    resp = client.get("/provider/queue", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    ids = [j["id"] for j in resp.json()]
    assert job_a in ids and job_b not in ids, "dispatcher must see only their own org's jobs"


def test_provider_assign_happy_path_own_tech():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid, jid, tid = str(uuid4()), str(uuid4()), str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    _seed_provider_job(app_store, org, jid)
    _seed_org_tech(app_store, org, tid)
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    resp = client.post(
        f"/provider/queue/{jid}/assign", json={"technician_id": tid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert "offer_id" in resp.json()


def test_provider_assign_rejects_foreign_technician():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org_a, org_b = str(uuid4()), str(uuid4())
    uid, jid, foreign_tid = str(uuid4()), str(uuid4()), str(uuid4())
    _seed_dispatcher(app_store, uid, org_a)
    _seed_provider_job(app_store, org_a, jid)
    _seed_org_tech(app_store, org_b, foreign_tid)  # tech belongs to a DIFFERENT org
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    resp = client.post(
        f"/provider/queue/{jid}/assign", json={"technician_id": foreign_tid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422  # not eligible: not this company's technician


def test_provider_cannot_touch_other_orgs_job():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org_a, org_b = str(uuid4()), str(uuid4())
    uid, other_job, tid = str(uuid4()), str(uuid4()), str(uuid4())
    _seed_dispatcher(app_store, uid, org_a)
    _seed_provider_job(app_store, org_b, other_job)  # job owned by another company
    _seed_org_tech(app_store, org_a, tid)
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    resp = client.post(
        f"/provider/queue/{other_job}/assign", json={"technician_id": tid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404  # not in this dispatcher's queue


def test_provider_requires_active_org():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "disp_noorg@cluexp.test", "phone": None,
        "display_name": "Dispatcher", "password_hash": "",
        "roles": ["dispatcher"], "active_organization_id": None, "organization_name": None,
    }
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    resp = client.get("/provider/queue", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 409


def test_provider_queue_rejects_technician_role():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "techrole@cluexp.test", "phone": None,
        "display_name": "Tech", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    token = create_access_token({"sub": uid, "id": uid, "roles": ["technician"]})
    client = TestClient(app)
    resp = client.get("/provider/queue", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


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


# (Removed test_ops_assign_requires_platform_admin_not_provider_dispatcher: the
# platform assign mutation no longer exists — see test_ops_assign_route_removed
# and the provider tenant-isolation tests.)


# --- InMemoryStore: ops_create_single_offer blocks duplicate ----------------
def test_inmemory_ops_create_single_offer_success():
    from uuid import uuid4
    from datetime import datetime, timezone, timedelta
    store = InMemoryStore()
    jid = uuid4()
    tid = uuid4()
    expires = datetime.now(timezone.utc) + timedelta(seconds=600)
    store._job_status = {str(jid): STATUS_PENDING_DISPATCH}
    offer = asyncio.run(store.ops_create_single_offer(jid, tid, None, expires))
    assert offer is not None
    assert "error_code" not in offer
    assert offer["status"] == "offered"
    assert offer["technician_id"] == str(tid)


def test_inmemory_ops_create_single_offer_blocks_duplicate():
    from uuid import uuid4
    from datetime import datetime, timezone, timedelta
    store = InMemoryStore()
    jid = uuid4()
    expires = datetime.now(timezone.utc) + timedelta(seconds=600)
    store._job_status = {str(jid): STATUS_PENDING_DISPATCH}
    first = asyncio.run(store.ops_create_single_offer(jid, uuid4(), None, expires))
    second = asyncio.run(store.ops_create_single_offer(jid, uuid4(), None, expires))
    assert first is not None and "error_code" not in first
    assert second is not None and second.get("error_code") == "concurrent_offer"


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


def test_inmemory_update_technician_profile_updates_user_and_technician():
    store = InMemoryStore()
    tid = str(uuid4())
    store.users[tid] = {"id": tid, "display_name": "Old Name", "phone": "5550000000"}
    store._technicians = [{
        "id": tid,
        "display_name": "Old Name",
        "phone": "5550000000",
        "skills": ["home"],
        "service_area_radius_km": 15,
    }]
    result = asyncio.run(store.update_technician_profile(UUID(tid), {
        "display_name": "New Name",
        "phone": "5551112222",
        "skills": ["business", "vehicle"],
        "service_area_radius_km": 30,
    }))
    assert result is not None
    assert store.users[tid]["display_name"] == "New Name"
    assert store.users[tid]["phone"] == "5551112222"
    assert store._technicians[0]["skills"] == ["business", "vehicle"]
    assert store._technicians[0]["service_area_radius_km"] == 30


# ---------------------------------------------------------------------------
# HTTP: PATCH /technicians/me/profile — self-scoped, validated, persisted
# ---------------------------------------------------------------------------
def test_http_update_my_profile_validates_and_persists():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "tech_profile@cluexp.test", "phone": "5550000000",
        "display_name": "Old Name", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    app_store._technicians = getattr(app_store, "_technicians", [])
    app_store._technicians.append({
        "id": uid, "status": "active", "vetting_status": "verified",
        "display_name": "Old Name", "phone": "5550000000",
        "skills": ["home"], "service_area_radius_km": 15,
    })
    # The InMemory session has no technician block (only PostgresStore builds one);
    # inject it so the endpoint sees a technician, mirroring production.
    _orig_session = app_store.get_user_session

    async def _patched_session(user_id):
        s = await _orig_session(user_id)
        if s and user_id == uid:
            s["technician"] = {
                "id": uid, "approved": True,
                "status": "active", "vetting_status": "verified",
            }
        return s

    app_store.get_user_session = _patched_session
    token = create_access_token({"sub": uid, "id": uid, "roles": ["technician"]})
    client = TestClient(app)
    try:
        # Happy path: persists, and normalizes skills (trim, lowercase, dedupe, sort).
        ok = client.patch(
            "/technicians/me/profile",
            json={"display_name": "New Name", "phone": "5551112222",
                  "skills": ["Business", " vehicle ", "business"],
                  "service_area_radius_km": 30},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert ok.status_code == 200, ok.text
        assert app_store.users[uid]["display_name"] == "New Name"
        assert app_store.users[uid]["phone"] == "5551112222"
        tech = next(t for t in app_store._technicians if t["id"] == uid)
        assert tech["skills"] == ["locksmith.commercial_lockout", "locksmith.vehicle_lockout"]
        assert tech["service_area_radius_km"] == 30

        # Too-short display name → 422.
        bad_name = client.patch(
            "/technicians/me/profile", json={"display_name": "x"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert bad_name.status_code == 422

        # Too-short phone → 422.
        bad_phone = client.patch(
            "/technicians/me/profile", json={"phone": "123"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert bad_phone.status_code == 422

        # Radius outside 1..250 → 422.
        bad_radius = client.patch(
            "/technicians/me/profile", json={"service_area_radius_km": 999},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert bad_radius.status_code == 422

        # Skills are catalog-backed, not free text.
        bad_skill = client.patch(
            "/technicians/me/profile", json={"skills": ["safe-cracking"]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert bad_skill.status_code == 422
    finally:
        app_store.get_user_session = _orig_session


def test_admin_service_catalog_skill_becomes_profile_valid():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    admin_id = str(uuid4())
    tech_id = str(uuid4())
    app_store.users[admin_id] = {
        "id": admin_id, "email": "catalog_admin@cluexp.test", "phone": None,
        "display_name": "Catalog Admin", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }
    app_store.users[tech_id] = {
        "id": tech_id, "email": "catalog_tech@cluexp.test", "phone": "5552223333",
        "display_name": "Catalog Tech", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    app_store._technicians = getattr(app_store, "_technicians", [])
    app_store._technicians.append({
        "id": tech_id, "status": "active", "vetting_status": "verified",
        "display_name": "Catalog Tech", "phone": "5552223333",
        "skills": [], "service_area_radius_km": 15,
    })
    _orig_session = app_store.get_user_session

    async def _patched_session(user_id):
        session = await _orig_session(user_id)
        if session and user_id == tech_id:
            session["technician"] = {
                "id": tech_id,
                "approved": True,
                "status": "active",
                "vetting_status": "verified",
            }
        return session

    app_store.get_user_session = _patched_session
    client = TestClient(app)
    admin_token = create_access_token({"sub": admin_id, "id": admin_id, "roles": ["platform_admin"]})
    tech_token = create_access_token({"sub": tech_id, "id": tech_id, "roles": ["technician"]})
    try:
        category = client.put(
            "/admin/service-catalog/categories/hvac_test",
            json={"code": "hvac_test", "label": "HVAC Test", "status": "active", "sort_order": 900},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert category.status_code == 200, category.text
        skill = client.put(
            "/admin/service-catalog/skills/hvac_test.diagnostics",
            json={
                "code": "hvac_test.diagnostics",
                "category_code": "hvac_test",
                "label": "Diagnostics",
                "status": "active",
                "requires_verification": True,
                "sort_order": 10,
            },
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert skill.status_code == 200, skill.text
        update = client.patch(
            "/technicians/me/profile",
            json={"skills": ["hvac_test.diagnostics"]},
            headers={"Authorization": f"Bearer {tech_token}"},
        )
        assert update.status_code == 200, update.text
        tech = next(t for t in app_store._technicians if t["id"] == tech_id)
        assert tech["skills"] == ["hvac_test.diagnostics"]
    finally:
        app_store.get_user_session = _orig_session


def test_provider_capabilities_are_catalog_validated_and_persisted():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    org_id = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "capabilities@cluexp.test", "phone": None,
        "display_name": "Capabilities Admin", "password_hash": "",
        "roles": ["provider_admin"], "active_organization_id": org_id, "organization_name": "Capability Co",
    }
    token = create_access_token({
        "sub": uid,
        "id": uid,
        "roles": ["provider_admin"],
        "active_organization_id": org_id,
    })
    client = TestClient(app)

    saved = client.patch(
        "/provider/settings/capabilities",
        json={"skills": ["rekey", "locksmith.vehicle_key_programming"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["skills"] == ["locksmith.rekey", "locksmith.vehicle_key_programming"]

    listed = client.get(
        "/provider/settings/capabilities",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["skills"] == ["locksmith.rekey", "locksmith.vehicle_key_programming"]

    bad = client.patch(
        "/provider/settings/capabilities",
        json={"skills": ["locksmith.safe_cracking"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert bad.status_code == 422


def test_http_update_my_profile_requires_technician_role():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "notatech@cluexp.test", "phone": None,
        "display_name": "Admin Only", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }
    token = create_access_token({"sub": uid, "id": uid, "roles": ["platform_admin"]})
    client = TestClient(app)
    resp = client.patch(
        "/technicians/me/profile", json={"display_name": "Hacker"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Security: technician status transitions must advance exactly one step
# (so a tech cannot skip the arrival milestone behind the PIN gate).
# ---------------------------------------------------------------------------
def test_can_technician_transition_requires_single_step():
    # Single forward step is allowed at each rung of the ladder.
    assert can_technician_transition(STATUS_ASSIGNED, STATUS_EN_ROUTE) is True
    assert can_technician_transition(STATUS_EN_ROUTE, STATUS_ARRIVED) is True
    assert can_technician_transition(STATUS_ARRIVED, STATUS_IN_PROGRESS) is True
    assert can_technician_transition(STATUS_IN_PROGRESS, STATUS_COMPLETED_PENDING) is True

    # Skipping a milestone is rejected (assigned -> arrived skips en_route).
    assert can_technician_transition(STATUS_ASSIGNED, STATUS_ARRIVED) is False
    assert can_technician_transition(STATUS_ASSIGNED, STATUS_IN_PROGRESS) is False
    assert can_technician_transition(STATUS_EN_ROUTE, STATUS_IN_PROGRESS) is False

    # Backward moves are rejected.
    assert can_technician_transition(STATUS_ARRIVED, STATUS_EN_ROUTE) is False

    # completed_confirmed is never technician-settable, even one step ahead.
    assert can_technician_transition(STATUS_COMPLETED_PENDING, STATUS_COMPLETED_CONFIRMED) is False


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
def test_provider_assign_unknown_tech_returns_422():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    from uuid import uuid4
    org = str(uuid4())
    uid = str(uuid4())
    jid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    _seed_provider_job(app_store, org, jid)
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    resp = client.post(
        f"/provider/queue/{jid}/assign",
        json={"technician_id": str(uuid4())},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


# --- HTTP: concurrent assign returns 409 (provider) -------------------------
def test_provider_assign_concurrent_409():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    from uuid import uuid4
    org = str(uuid4())
    uid = str(uuid4())
    jid = str(uuid4())
    tid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    _seed_provider_job(app_store, org, jid)
    _seed_org_tech(app_store, org, tid)  # online, in-org tech (no override needed)
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    # First assign succeeds
    r1 = client.post(
        f"/provider/queue/{jid}/assign",
        json={"technician_id": tid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r1.status_code == 200, r1.text
    # Second assign on same job → 409 (offer_active)
    r2 = client.post(
        f"/provider/queue/{jid}/assign",
        json={"technician_id": tid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 409


# ---------------------------------------------------------------------------
# P0 regression: cancellation / assignment race
# ---------------------------------------------------------------------------

def test_inmemory_ops_create_offer_rejects_cancelled_job():
    """Offer creation must fail when the job was cancelled between the
    dispatcher queue-read and the actual INSERT."""
    from datetime import datetime, timezone, timedelta
    store = InMemoryStore()
    jid = UUID(str(uuid4()))
    expires = datetime.now(timezone.utc) + timedelta(seconds=600)
    store._job_status = {str(jid): "cancelled"}
    result = asyncio.run(store.ops_create_single_offer(jid, UUID(str(uuid4())), None, expires))
    assert result is not None
    assert result.get("error_code") == "job_not_pending"


def test_inmemory_accept_dispatch_offer_blocked_on_cancelled_job():
    """Acceptance must not flip trust_state or assign the technician when the
    job was cancelled between offer creation and the Accept tap."""
    from datetime import datetime, timezone, timedelta
    store = InMemoryStore()
    jid = UUID(str(uuid4()))
    tid = UUID(str(uuid4()))
    expires = datetime.now(timezone.utc) + timedelta(seconds=600)
    store._job_status = {str(jid): STATUS_PENDING_DISPATCH}
    offer = asyncio.run(store.ops_create_single_offer(jid, tid, None, expires))
    assert offer and "id" in offer
    # Customer cancels before acceptance
    store._job_status[str(jid)] = "cancelled"
    result = asyncio.run(store.accept_dispatch_offer(UUID(offer["id"])))
    assert result is not None
    assert result.get("accepted") is False
    assert result.get("reason") == "job_not_pending"
    # Technician must NOT be assigned; job stays cancelled
    assert store._job_status.get(str(jid)) == "cancelled"
    assert not getattr(store, "_job_tech", {}).get(str(jid))


def test_inmemory_accept_on_non_pending_does_not_assign_tech():
    """trust_state equivalent (_job_tech) is untouched even if status changes
    to a non-pending value other than cancelled (e.g. already assigned)."""
    from datetime import datetime, timezone, timedelta
    store = InMemoryStore()
    jid = UUID(str(uuid4()))
    tid = UUID(str(uuid4()))
    expires = datetime.now(timezone.utc) + timedelta(seconds=600)
    store._job_status = {str(jid): STATUS_PENDING_DISPATCH}
    offer = asyncio.run(store.ops_create_single_offer(jid, tid, None, expires))
    assert offer and "id" in offer
    store._job_status[str(jid)] = "assigned"
    result = asyncio.run(store.accept_dispatch_offer(UUID(offer["id"])))
    assert result is None or not result.get("accepted")
    assert getattr(store, "_job_tech", {}).get(str(jid)) is None


# ---------------------------------------------------------------------------
# P1 regression: candidate ordering (nearest first, unknown distance last)
# ---------------------------------------------------------------------------

def test_ops_candidates_sorted_nearest_first():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    from datetime import datetime, timezone

    uid = "user-platform-admin-cand-1"
    jid = str(uuid4())
    t_near = str(uuid4())
    t_far = str(uuid4())
    t_nodist = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "admin_cand@cluexp.test", "phone": None,
        "display_name": "Admin", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_PENDING_DISPATCH
    now_iso = datetime.now(timezone.utc).isoformat()

    # Patch get_ops_queue to return the job with known coordinates
    _orig_queue = app_store.get_ops_queue

    async def _patched_queue():
        rows = await _orig_queue()
        for r in rows:
            if str(r["id"]) == jid:
                r["lat"] = 37.7749
                r["lng"] = -122.4194
                r["access_type"] = None
        return rows

    app_store.get_ops_queue = _patched_queue
    app_store._technicians = [
        {"id": t_far, "status": "active", "vetting_status": "verified",
         "display_name": "Far", "skills": [], "rating": 4.0,
         "current_lat": 37.3305, "current_lng": -121.8811,
         "service_area_center_lat": None, "service_area_center_lng": None,
         "location_updated_at": now_iso, "primary_organization_id": None},
        {"id": t_nodist, "status": "active", "vetting_status": "verified",
         "display_name": "NoCoords", "skills": [], "rating": 5.0,
         "current_lat": None, "current_lng": None,
         "service_area_center_lat": None, "service_area_center_lng": None,
         "location_updated_at": now_iso, "primary_organization_id": None},
        {"id": t_near, "status": "active", "vetting_status": "verified",
         "display_name": "Near", "skills": [], "rating": 4.5,
         "current_lat": 37.7750, "current_lng": -122.4195,
         "service_area_center_lat": None, "service_area_center_lng": None,
         "location_updated_at": now_iso, "primary_organization_id": None},
    ]
    token = create_access_token({"sub": uid, "id": uid, "roles": ["platform_admin"]})
    client = TestClient(app)
    resp = client.get(
        f"/ops/queue/{jid}/candidates",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    candidates = resp.json()["candidates"]
    ids = [c["id"] for c in candidates]
    assert ids.index(t_near) < ids.index(t_far), "Near must come before Far"
    assert ids.index(t_near) < ids.index(t_nodist), "Near must come before NoCoords"
    assert ids.index(t_far) < ids.index(t_nodist), "Far must come before NoCoords"
    app_store.get_ops_queue = _orig_queue


# ---------------------------------------------------------------------------
# P1 regression: override_reason required for flagged technicians
# ---------------------------------------------------------------------------

def test_provider_assign_offline_tech_requires_override():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    jid = str(uuid4())
    tid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    _seed_provider_job(app_store, org, jid)
    app_store._technicians = getattr(app_store, "_technicians", [])
    # In-org tech with no location_updated_at → is_online=False → override required
    app_store._technicians.append({
        "id": tid, "status": "active", "vetting_status": "verified",
        "display_name": "Offline", "skills": [], "primary_organization_id": org,
    })
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    resp = client.post(
        f"/provider/queue/{jid}/assign",
        json={"technician_id": tid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422
    assert "Override required" in resp.json().get("detail", "")


def test_provider_assign_offline_tech_with_override_succeeds():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    jid = str(uuid4())
    tid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    _seed_provider_job(app_store, org, jid)
    app_store._technicians = getattr(app_store, "_technicians", [])
    # Same offline in-org tech — override_reason unlocks the assignment
    app_store._technicians.append({
        "id": tid, "status": "active", "vetting_status": "verified",
        "display_name": "Offline", "skills": [], "primary_organization_id": org,
    })
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    resp = client.post(
        f"/provider/queue/{jid}/assign",
        json={"technician_id": tid, "override_reason": "urgent — only available tech"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert "offer_id" in resp.json()


# ---------------------------------------------------------------------------
# Integration test: Postgres concurrent assignment (requires live DB)
# Run with: pytest -m integration apps/intake-web/api/tests/test_dispatch.py
# ---------------------------------------------------------------------------
# What this verifies (cannot be replicated in unit env):
#   - Two simultaneous ops_create_single_offer calls for the same job_id
#     exercise the INSERT ... SELECT partial-index constraint at the DB level.
#   - Exactly one call wins (returns {"id": ...}).
#   - The losing call returns {"error_code": "concurrent_offer"} without
#     raising an unhandled UniqueViolation.
#   - The winning offer is not superseded (status stays "offered").
import pytest


@pytest.mark.skip(reason="Integration test — requires live Postgres; run with -m integration")
def test_postgres_concurrent_assign_isolation():
    import asyncio as _aio
    from datetime import datetime, timezone, timedelta
    from api.store import PostgresStore

    store = PostgresStore()
    jid = uuid4()
    t1, t2 = uuid4(), uuid4()
    expires = datetime.now(timezone.utc) + timedelta(seconds=600)

    async def _run():
        results = await _aio.gather(
            store.ops_create_single_offer(jid, t1, None, expires),
            store.ops_create_single_offer(jid, t2, None, expires),
        )
        successes = [r for r in results if r and "id" in r and "error_code" not in r]
        failures = [r for r in results if r and r.get("error_code") == "concurrent_offer"]
        assert len(successes) == 1, f"Expected 1 winner, got {len(successes)}"
        assert len(failures) == 1, f"Expected 1 loser, got {len(failures)}"

    _aio.run(_run())


# ---------------------------------------------------------------------------
# Recovery (/admin/jobs/{id}/resolve) is tenant-scoped — no cross-tenant
# platform override (ClueXP does not recover other companies' jobs).
# ---------------------------------------------------------------------------

def test_resolve_job_rejects_platform_admin():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    uid = str(uuid4())
    jid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "admin_resolve@cluexp.test", "phone": None,
        "display_name": "Platform Admin", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }
    _seed_provider_job(app_store, str(uuid4()), jid)  # job owned by some company
    token = create_access_token({"sub": uid, "id": uid, "roles": ["platform_admin"]})
    client = TestClient(app)
    resp = client.post(
        f"/admin/jobs/{jid}/resolve", json={"action": "cancel"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403  # platform admins do not resolve tenant jobs


def test_resolve_job_is_tenant_scoped():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    org_a, org_b = str(uuid4()), str(uuid4())
    uid = str(uuid4())
    own_job, other_job = str(uuid4()), str(uuid4())
    _seed_dispatcher(app_store, uid, org_a)
    _seed_provider_job(app_store, org_a, own_job)
    _seed_provider_job(app_store, org_b, other_job)
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    # Another company's job is not resolvable (and not revealed).
    foreign = client.post(
        f"/admin/jobs/{other_job}/resolve", json={"action": "cancel"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert foreign.status_code == 404
    # The company's own job resolves.
    own = client.post(
        f"/admin/jobs/{own_job}/resolve", json={"action": "cancel"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert own.status_code == 200, own.text


# ---------------------------------------------------------------------------
# Gate 3: company recovery controls — tenant-scoped, expected-status, revoke
# prior technician on release.
# ---------------------------------------------------------------------------

def _client_for_dispatcher(org_id):
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    uid = str(uuid4())
    _seed_dispatcher(app_store, uid, org_id)
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    return TestClient(app), app_store, token


def test_provider_cancel_tenant_scoped():
    org_a, org_b = str(uuid4()), str(uuid4())
    client, app_store, token = _client_for_dispatcher(org_a)
    own, foreign = str(uuid4()), str(uuid4())
    _seed_provider_job(app_store, org_a, own)
    _seed_provider_job(app_store, org_b, foreign)
    h = {"Authorization": f"Bearer {token}"}
    # Another company's job is not cancellable (and not revealed).
    r_foreign = client.post(f"/provider/jobs/{foreign}/cancel", json={"reason": "x"}, headers=h)
    assert r_foreign.status_code == 404
    assert app_store._job_status[foreign] == STATUS_PENDING_DISPATCH
    # Reason required.
    r_noreason = client.post(f"/provider/jobs/{own}/cancel", json={"reason": ""}, headers=h)
    assert r_noreason.status_code == 422
    # Own job cancels.
    r_ok = client.post(f"/provider/jobs/{own}/cancel", json={"reason": "customer no longer needs it"}, headers=h)
    assert r_ok.status_code == 200, r_ok.text
    assert app_store._job_status[own] == "cancelled"


def test_provider_release_revokes_prior_technician():
    import asyncio
    org = str(uuid4())
    client, app_store, token = _client_for_dispatcher(org)
    jid, tid = str(uuid4()), str(uuid4())
    _seed_provider_job(app_store, org, jid)
    # Put the job on the ladder with an assigned technician.
    app_store._job_status[jid] = STATUS_EN_ROUTE
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tid
    # Tech can see it as their active job before release.
    assert asyncio.run(app_store.get_technician_active_job(UUID(tid))) is not None
    resp = client.post(
        f"/provider/jobs/{jid}/release", json={"reason": "tech unresponsive"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert app_store._job_status[jid] == STATUS_PENDING_DISPATCH
    # Prior technician's access is revoked: no longer their active job.
    assert app_store._job_tech.get(jid) is None
    assert asyncio.run(app_store.get_technician_active_job(UUID(tid))) is None


def test_provider_recover_expected_status_409():
    org = str(uuid4())
    client, app_store, token = _client_for_dispatcher(org)
    jid = str(uuid4())
    _seed_provider_job(app_store, org, jid)
    # Job already completed_pending_customer — not a no-show-able state.
    app_store._job_status[jid] = STATUS_COMPLETED_PENDING
    resp = client.post(
        f"/provider/jobs/{jid}/no-show", json={"reason": "n/a"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 409


def test_provider_jobs_list_scoped():
    org_a, org_b = str(uuid4()), str(uuid4())
    client, app_store, token = _client_for_dispatcher(org_a)
    ja, jb = str(uuid4()), str(uuid4())
    _seed_provider_job(app_store, org_a, ja)
    _seed_provider_job(app_store, org_b, jb)
    app_store._job_status[ja] = STATUS_EN_ROUTE
    app_store._job_status[jb] = STATUS_EN_ROUTE
    resp = client.get("/provider/jobs", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    ids = [j["id"] for j in resp.json()]
    assert ja in ids and jb not in ids


# ---------------------------------------------------------------------------
# Gate 4 hardening: demo routes gated, health check, ops flags, token rate limit
# ---------------------------------------------------------------------------

def test_demo_payment_routes_gone():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    jid = str(uuid4())
    for path in (f"/tickets/{jid}/finalize", f"/tickets/{jid}/approve-final",
                 f"/tickets/{jid}/charge", f"/tickets/{jid}/review"):
        r = client.post(path, json={})
        assert r.status_code == 410, f"{path} -> {r.status_code}"


def test_healthz_ok():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_ops_flags_admin_only():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    admin = str(uuid4())
    app_store.users[admin] = {
        "id": admin, "email": "flags_admin@cluexp.test", "phone": None,
        "display_name": "Avery", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }
    disp = str(uuid4())
    app_store.users[disp] = {
        "id": disp, "email": "flags_disp@cluexp.test", "phone": None,
        "display_name": "D", "password_hash": "",
        "roles": ["dispatcher"], "active_organization_id": str(uuid4()), "organization_name": "Acme",
    }
    client = TestClient(app)
    ok = client.get("/ops/flags", headers={"Authorization": f"Bearer {create_access_token({'sub': admin, 'id': admin, 'roles': ['platform_admin']})}"})
    assert ok.status_code == 200
    body = ok.json()
    assert "dispatch_cutover_global_off" in body and "arrival_pin_configured" in body
    forbidden = client.get("/ops/flags", headers={"Authorization": f"Bearer {create_access_token({'sub': disp, 'id': disp, 'roles': ['dispatcher']})}"})
    assert forbidden.status_code == 403


def test_token_action_rate_limited():
    from starlette.testclient import TestClient
    from api.main import app, _token_action_hits, store as app_store
    from api import settings as rs
    # The limit is now runtime-tunable via global_settings; drive it through the store.
    asyncio.run(app_store.upsert_global_setting("token_action_max", 2, "integer", None))
    rs.clear_cache()
    _token_action_hits.clear()
    try:
        client = TestClient(app)
        tok = "rl-" + uuid4().hex
        # The limiter runs before token resolution: first 2 pass (unknown token → 404),
        # the 3rd trips the limit → 429.
        assert client.post(f"/t/{tok}/confirm").status_code == 404
        assert client.post(f"/t/{tok}/confirm").status_code == 404
        assert client.post(f"/t/{tok}/confirm").status_code == 429
    finally:
        # Restore the seeded default so the shared app store doesn't leak into other tests.
        asyncio.run(app_store.upsert_global_setting("token_action_max", 30, "integer", None))
        rs.clear_cache()


# ---------------------------------------------------------------------------
# Gate 3 remainder: recall-offer + internal notes (tenant-scoped)
# ---------------------------------------------------------------------------

def test_provider_recall_offer():
    org = str(uuid4())
    client, app_store, token = _client_for_dispatcher(org)
    jid, oid = str(uuid4()), str(uuid4())
    _seed_provider_job(app_store, org, jid)  # pending_dispatch
    app_store._offers = getattr(app_store, "_offers", {})
    app_store._offers[oid] = {"id": oid, "job_id": jid, "status": "offered", "technician_id": str(uuid4())}
    resp = client.post(
        f"/provider/jobs/{jid}/recall-offer", json={"reason": "wrong technician"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert app_store._job_status[jid] == STATUS_PENDING_DISPATCH
    assert app_store._offers[oid]["status"] == "superseded"


def test_provider_internal_notes_tenant_scoped():
    org_a, org_b = str(uuid4()), str(uuid4())
    client, app_store, token = _client_for_dispatcher(org_a)
    own, foreign = str(uuid4()), str(uuid4())
    _seed_provider_job(app_store, org_a, own)
    _seed_provider_job(app_store, org_b, foreign)
    h = {"Authorization": f"Bearer {token}"}
    # Add a note to the company's own job.
    add = client.post(f"/provider/jobs/{own}/notes", json={"body": "Customer prefers afternoon"}, headers=h)
    assert add.status_code == 200, add.text
    # It lists back.
    listed = client.get(f"/provider/jobs/{own}/notes", headers=h)
    assert listed.status_code == 200
    assert any(n["body"] == "Customer prefers afternoon" for n in listed.json())
    # Another company's job is not noteable (404, no leak).
    foreign_add = client.post(f"/provider/jobs/{foreign}/notes", json={"body": "x"}, headers=h)
    assert foreign_add.status_code == 404
    # Empty note rejected.
    empty = client.post(f"/provider/jobs/{own}/notes", json={"body": "   "}, headers=h)
    assert empty.status_code == 422


# ---------------------------------------------------------------------------
# #1 technician failure reporting + #4 provider audit timeline
# ---------------------------------------------------------------------------

def test_technician_report_issue_surfaces_to_provider_and_timeline():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    tech_uid = str(uuid4())
    disp_uid = str(uuid4())
    jid = str(uuid4())
    # Job en route, assigned to the technician, owned by the company.
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_EN_ROUTE
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tech_uid
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org
    app_store.users[tech_uid] = {
        "id": tech_uid, "email": "issue_tech@cluexp.test", "phone": None,
        "display_name": "Tech", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    _seed_dispatcher(app_store, disp_uid, org)
    _orig = app_store.get_user_session

    async def _patched(user_id):
        s = await _orig(user_id)
        if s and user_id == tech_uid:
            s["technician"] = {"id": tech_uid, "approved": True}
        return s

    app_store.get_user_session = _patched
    tech_tok = create_access_token({"sub": tech_uid, "id": tech_uid, "roles": ["technician"]})
    disp_tok = create_access_token({"sub": disp_uid, "id": disp_uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    try:
        # Bad kind rejected.
        assert client.post(f"/jobs/{jid}/report-issue", json={"kind": "bogus"},
                           headers={"Authorization": f"Bearer {tech_tok}"}).status_code == 422
        # Assigned technician reports a real issue.
        rep = client.post(
            f"/jobs/{jid}/report-issue", json={"kind": "unsafe", "reason": "aggressive dog on site"},
            headers={"Authorization": f"Bearer {tech_tok}"},
        )
        assert rep.status_code == 200, rep.text
        # It surfaces in the provider recovery list (last_issue) ...
        jobs = client.get("/provider/jobs", headers={"Authorization": f"Bearer {disp_tok}"}).json()
        row = next(j for j in jobs if j["id"] == jid)
        assert row["last_issue"] and row["last_issue"].startswith("tech_issue:unsafe")
        # ... and in the job's audit timeline.
        tl = client.get(f"/provider/jobs/{jid}/timeline", headers={"Authorization": f"Bearer {disp_tok}"})
        assert tl.status_code == 200
        assert any(e["event"].startswith("tech_issue:unsafe") for e in tl.json())
    finally:
        app_store.get_user_session = _orig


def test_report_issue_rejects_unassigned_technician():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    other_tech = str(uuid4())
    jid = str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_EN_ROUTE
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = str(uuid4())  # assigned to someone else
    app_store.users[other_tech] = {
        "id": other_tech, "email": "other_tech@cluexp.test", "phone": None,
        "display_name": "Other", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    _orig = app_store.get_user_session

    async def _patched(user_id):
        s = await _orig(user_id)
        if s and user_id == other_tech:
            s["technician"] = {"id": other_tech, "approved": True}
        return s

    app_store.get_user_session = _patched
    tok = create_access_token({"sub": other_tech, "id": other_tech, "roles": ["technician"]})
    client = TestClient(app)
    try:
        r = client.post(f"/jobs/{jid}/report-issue", json={"kind": "cannot_complete", "reason": "x"},
                        headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 403
    finally:
        app_store.get_user_session = _orig


def test_provider_timeline_tenant_scoped():
    org_a, org_b = str(uuid4()), str(uuid4())
    client, app_store, token = _client_for_dispatcher(org_a)
    foreign = str(uuid4())
    _seed_provider_job(app_store, org_b, foreign)
    r = client.get(f"/provider/jobs/{foreign}/timeline", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404


def test_provider_audit_tenant_scoped_owned_and_fulfilled():
    org_a, org_b = str(uuid4()), str(uuid4())
    client, app_store, token = _client_for_dispatcher(org_a)
    owned, fulfilled, foreign = str(uuid4()), str(uuid4()), str(uuid4())
    _seed_provider_job(app_store, org_a, owned)
    _seed_provider_job(app_store, org_b, fulfilled)
    _seed_provider_job(app_store, org_b, foreign)
    app_store._job_fulfillment_org = getattr(app_store, "_job_fulfillment_org", {})
    app_store._job_fulfillment_org[fulfilled] = org_a
    app_store._job_address = getattr(app_store, "_job_address", {})
    app_store._job_address[owned] = "100 Main St"
    app_store._job_address[fulfilled] = "200 Oak St"

    asyncio.run(app_store.log_event_raw(UUID(owned), "audit_test:owned"))
    asyncio.run(app_store.log_event_raw(UUID(fulfilled), "audit_test:fulfilled"))
    asyncio.run(app_store.log_event_raw(UUID(foreign), "audit_test:foreign"))

    response = client.get("/provider/audit", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    rows = [row for row in response.json() if row["event"].startswith("audit_test:")]
    assert [row["job_id"] for row in rows] == [fulfilled, owned]
    assert {row["address"] for row in rows} == {"100 Main St", "200 Oak St"}
    assert all(row["job_id"] != foreign for row in rows)


def test_provider_candidates_tenant_scoped():
    # Closes the cross-tenant sweep: a dispatcher cannot view candidates for
    # another company's job.
    org_a, org_b = str(uuid4()), str(uuid4())
    client, app_store, token = _client_for_dispatcher(org_a)
    foreign = str(uuid4())
    _seed_provider_job(app_store, org_b, foreign)
    r = client.get(f"/provider/queue/{foreign}/candidates", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404

# ---------------------------------------------------------------------------
# Payment reconciliation + finished-job history (tech collection + customer pay)
# ---------------------------------------------------------------------------

def _tech_client(app_store, tech_uid):
    """A TestClient + bearer token for a technician, with the session patched to
    carry a technician profile (mirrors the arrival-PIN test setup)."""
    from starlette.testclient import TestClient
    from api.main import app
    from api.auth import create_access_token
    app_store.users[tech_uid] = {
        "id": tech_uid, "email": f"pay_{tech_uid[:8]}@cluexp.test", "phone": None,
        "display_name": "Pay Tech", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    _orig = app_store.get_user_session

    async def _patched(user_id):
        s = await _orig(user_id)
        if s and user_id == tech_uid:
            s["technician"] = {"id": tech_uid, "approved": True}
        return s

    app_store.get_user_session = _patched
    access = create_access_token({"sub": tech_uid, "id": tech_uid, "roles": ["technician"]})
    return TestClient(app), access, _orig


def test_payment_reports_and_technician_history():
    from api.main import store as app_store

    tech_uid, jid, token = str(uuid4()), str(uuid4()), "track-" + uuid4().hex
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_IN_PROGRESS
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tech_uid
    app_store._tokens = getattr(app_store, "_tokens", {})
    app_store._tokens[jid] = token

    client, access, _orig = _tech_client(app_store, tech_uid)
    try:
        # Technician reports what they collected (the single source of truth).
        c = client.post(
            f"/jobs/{jid}/collection", json={"amount": 150, "method": "Cash App"},
            headers={"Authorization": f"Bearer {access}"},
        )
        assert c.status_code == 200, c.text
        assert c.json()["payment"]["method"] == "cash_app"

        # Move to completion-pending so the customer can confirm.
        app_store._job_status[jid] = STATUS_COMPLETED_PENDING

        # The customer sees the technician's payment on the tracking read and
        # acknowledges it by confirming completion (no separate customer entry).
        t = client.get(f"/t/{token}")
        assert t.status_code == 200, t.text
        assert t.json()["payment"] == {"amount": 150.0, "currency": "USD", "method": "cash_app"}

        r = client.post(f"/t/{token}/review", json={"rating": 5, "comment": "great"})
        assert r.status_code == 200, r.text
        assert app_store._job_status[jid] == STATUS_COMPLETED_CONFIRMED

        # History shows the finished job with the technician payment + the review;
        # there is no separate customer-reported amount (Ops does not compare).
        h = client.get("/technician/jobs/history", headers={"Authorization": f"Bearer {access}"})
        assert h.status_code == 200, h.text
        rows = [row for row in h.json() if row["id"] == jid]
        assert len(rows) == 1
        row = rows[0]
        assert row["payments"]["technician"]["amount"] == 150.0
        assert row["payments"]["technician"]["method"] == "cash_app"
        assert row["payments"]["customer"] is None
        assert row["review"]["rating"] == 5
    finally:
        app_store.get_user_session = _orig


def test_collection_validation_and_ownership():
    from api.main import store as app_store

    tech_uid, jid = str(uuid4()), str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_IN_PROGRESS
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tech_uid

    client, access, _orig = _tech_client(app_store, tech_uid)
    try:
        hdr = {"Authorization": f"Bearer {access}"}
        # Unknown method -> 422.
        assert client.post(f"/jobs/{jid}/collection", json={"amount": 10, "method": "bitcoin"}, headers=hdr).status_code == 422
        # Negative amount -> 422.
        assert client.post(f"/jobs/{jid}/collection", json={"amount": -5, "method": "cash"}, headers=hdr).status_code == 422
        # Someone else's job -> 403.
        other = str(uuid4())
        app_store._job_status[other] = STATUS_IN_PROGRESS
        app_store._job_tech[other] = str(uuid4())
        assert client.post(f"/jobs/{other}/collection", json={"amount": 10, "method": "cash"}, headers=hdr).status_code == 403
    finally:
        app_store.get_user_session = _orig


def test_structured_closeout_calculates_receipt_and_tracking():
    from api.main import store as app_store

    org, tech_uid, jid, token = str(uuid4()), str(uuid4()), str(uuid4()), "track-" + uuid4().hex
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_IN_PROGRESS
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tech_uid
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org
    app_store._tokens = getattr(app_store, "_tokens", {})
    app_store._tokens[jid] = token
    asyncio.run(app_store.upsert_organization_setting(org, "closeout_default_tax_rate_basis_points", 700, "integer"))
    asyncio.run(app_store.upsert_organization_setting(org, "closeout_card_fee_basis_points", 300, "integer"))
    asyncio.run(app_store.upsert_organization_setting(org, "closeout_card_fee_fixed_cents", 30, "integer"))

    client, access, _orig = _tech_client(app_store, tech_uid)
    try:
        payload = {
            "method": "credit_card",
            "tip_amount": 20,
            "line_items": [
                {
                    "item_type_code": "service_fee",
                    "description": "Service",
                    "quantity": 1,
                    "unit_amount": 100,
                    "taxable": True,
                },
                {
                    "item_type_code": "key_code_purchase",
                    "description": "Key code",
                    "quantity": 1,
                    "unit_amount": 25,
                    "taxable": False,
                    "provided_by": "technician",
                    "note": "Nastf code purchase",
                },
            ],
        }
        response = client.post(
            f"/jobs/{jid}/collection",
            json=payload,
            headers={"Authorization": f"Bearer {access}"},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        closeout = body["closeout"]
        assert closeout["subtotal_cents"] == 12500
        assert closeout["taxable_subtotal_cents"] == 10000
        assert closeout["tax_cents"] == 700
        assert closeout["tip_cents"] == 2000
        assert closeout["card_fee_cents"] == 486
        assert closeout["total_cents"] == 15686
        assert body["payment"]["amount"] == 156.86
        assert closeout["line_items"][1]["provided_by"] == "technician"

        app_store._job_status[jid] = STATUS_COMPLETED_PENDING
        tracking = client.get(f"/t/{token}")
        assert tracking.status_code == 200, tracking.text
        assert tracking.json()["closeout"]["total_cents"] == 15686
        assert tracking.json()["payment"]["amount"] == 156.86
    finally:
        app_store.get_user_session = _orig


def test_structured_closeout_respects_max_line_items():
    from api.main import store as app_store

    org, tech_uid, jid = str(uuid4()), str(uuid4()), str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_IN_PROGRESS
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tech_uid
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org
    asyncio.run(app_store.upsert_organization_setting(org, "closeout_max_line_items", 1, "integer"))

    client, access, _orig = _tech_client(app_store, tech_uid)
    try:
        response = client.post(
            f"/jobs/{jid}/collection",
            json={
                "method": "cash",
                "line_items": [
                    {"item_type_code": "service_fee", "description": "Service", "unit_amount": 10},
                    {"item_type_code": "labor", "description": "Labor", "unit_amount": 20},
                ],
            },
            headers={"Authorization": f"Bearer {access}"},
        )
        assert response.status_code == 422
        assert "at most 1 line items" in response.text
    finally:
        app_store.get_user_session = _orig


def test_structured_closeout_requires_part_source_and_note():
    from api.main import store as app_store

    tech_uid, jid = str(uuid4()), str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_IN_PROGRESS
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tech_uid

    client, access, _orig = _tech_client(app_store, tech_uid)
    try:
        response = client.post(
            f"/jobs/{jid}/collection",
            json={
                "method": "cash",
                "line_items": [
                    {
                        "item_type_code": "key_code_purchase",
                        "description": "Key code",
                        "unit_amount": 25,
                    },
                ],
            },
            headers={"Authorization": f"Bearer {access}"},
        )
        assert response.status_code == 422
        assert "requires provided_by" in response.text

        response = client.post(
            f"/jobs/{jid}/collection",
            json={
                "method": "cash",
                "line_items": [
                    {
                        "item_type_code": "key_code_purchase",
                        "description": "Key code",
                        "unit_amount": 25,
                        "provided_by": "company",
                    },
                ],
            },
            headers={"Authorization": f"Bearer {access}"},
        )
        assert response.status_code == 422
        assert "requires a note" in response.text
    finally:
        app_store.get_user_session = _orig


def test_provider_job_history_scoped_and_enriched():
    org = str(uuid4())
    client, app_store, token = _client_for_dispatcher(org)
    jid = str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_COMPLETED_CONFIRMED
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org

    asyncio.run(
        app_store.record_payment_report(
            job_id=UUID(jid), reported_by="technician", amount=80.0, method="check",
        )
    )

    h = client.get("/provider/jobs/history", headers={"Authorization": f"Bearer {token}"})
    assert h.status_code == 200, h.text
    rows = [row for row in h.json() if row["id"] == jid]
    assert len(rows) == 1
    assert rows[0]["payments"]["technician"]["method"] == "check"


def test_history_includes_completed_pending_customer():
    """A job the technician just finished (completed_pending_customer, before the
    customer confirms) must already appear in the provider history."""
    org = str(uuid4())
    client, app_store, token = _client_for_dispatcher(org)
    jid = str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_COMPLETED_PENDING
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org

    h = client.get("/provider/jobs/history", headers={"Authorization": f"Bearer {token}"})
    assert h.status_code == 200, h.text
    assert any(row["id"] == jid for row in h.json())


def test_customer_cancel_requires_reason():
    """Cancellation must include a customer-provided reason; the reason is recorded."""
    from starlette.testclient import TestClient
    from api.main import app, store as app_store

    jid, token = str(uuid4()), "track-" + uuid4().hex
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_PENDING_DISPATCH
    app_store._tokens = getattr(app_store, "_tokens", {})
    app_store._tokens[jid] = token
    client = TestClient(app)

    # No reason -> 422, job untouched.
    bad = client.post(f"/t/{token}/cancel", json={})
    assert bad.status_code == 422, bad.text
    assert app_store._job_status[jid] == STATUS_PENDING_DISPATCH

    # With a reason -> cancelled, and the reason is recorded as an audit event.
    ok = client.post(f"/t/{token}/cancel", json={"reason": "Found my spare key"})
    assert ok.status_code == 200, ok.text
    assert app_store._job_status[jid] == "cancelled"
    assert any("customer_cancel:Found my spare key" in e for e in app_store.events)


def test_customer_live_location_gated_to_fulfillment():
    """The customer sees the technician's live location + destination only while the
    job is en_route/arrived/in_progress — never before (privacy gate)."""
    from datetime import datetime, timezone
    from starlette.testclient import TestClient
    from api.main import app, store as app_store

    tech_uid, jid, token = str(uuid4()), str(uuid4()), "track-" + uuid4().hex
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._tokens = getattr(app_store, "_tokens", {})
    app_store._tech_location = getattr(app_store, "_tech_location", {})
    app_store._job_loc = getattr(app_store, "_job_loc", {})
    app_store._job_tech[jid] = tech_uid
    app_store._tokens[jid] = token
    fresh = datetime.now(timezone.utc).isoformat()
    app_store._tech_location[tech_uid] = (40.7128, -74.0060, fresh)
    app_store._job_loc[jid] = (40.7589, -73.9851)
    client = TestClient(app)

    # Assigned (not yet en route) -> no live location, no destination.
    app_store._job_status[jid] = STATUS_ASSIGNED
    body = client.get(f"/t/{token}").json()
    assert body["assignment"]["live_lat"] is None
    assert body["destination"] is None
    assert body["guards"]["may_show_live_tracking"] is False

    # En route + fresh location -> safe live location + destination exposed.
    app_store._job_status[jid] = STATUS_EN_ROUTE
    body = client.get(f"/t/{token}").json()
    assert body["assignment"]["live_lat"] == 40.7128
    assert body["assignment"]["live_lng"] == -74.0060
    assert body["destination"] == {"lat": 40.7589, "lng": -73.9851}
    assert body["guards"]["may_show_live_tracking"] is True


def test_customer_live_location_requires_fresh_position():
    """Even while en_route, a stale or missing technician timestamp must not be
    presented as a live location — the guard goes False and coordinates are nulled
    so the UI can show "temporarily unavailable" instead of a frozen point."""
    from datetime import datetime, timezone, timedelta
    from starlette.testclient import TestClient
    from api.main import app, store as app_store

    tech_uid, jid, token = str(uuid4()), str(uuid4()), "track-" + uuid4().hex
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._tokens = getattr(app_store, "_tokens", {})
    app_store._tech_location = getattr(app_store, "_tech_location", {})
    app_store._job_tech[jid] = tech_uid
    app_store._tokens[jid] = token
    app_store._job_status[jid] = STATUS_EN_ROUTE
    client = TestClient(app)

    # Stale timestamp (well past LOCATION_ONLINE_THRESHOLD_MINUTES) -> not live.
    stale = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    app_store._tech_location[tech_uid] = (40.7128, -74.0060, stale)
    body = client.get(f"/t/{token}").json()
    assert body["assignment"]["live_lat"] is None
    assert body["assignment"]["location_updated_at"] is None
    assert body["guards"]["may_show_live_tracking"] is False

    # Missing timestamp (2-tuple, no time) -> not live.
    app_store._tech_location[tech_uid] = (40.7128, -74.0060)
    body = client.get(f"/t/{token}").json()
    assert body["assignment"]["live_lat"] is None
    assert body["guards"]["may_show_live_tracking"] is False

    # Fresh again -> live restored.
    app_store._tech_location[tech_uid] = (
        40.7128, -74.0060, datetime.now(timezone.utc).isoformat(),
    )
    body = client.get(f"/t/{token}").json()
    assert body["assignment"]["live_lat"] == 40.7128
    assert body["guards"]["may_show_live_tracking"] is True


def test_no_show_in_provider_history_not_technician_history():
    """A no-show appears in the org's provider history but NOT in the technician's
    history (recovery clears the tech link; a no-show is not work they fulfilled)."""
    from api.main import store as app_store

    org = str(uuid4())
    client, app_store2, token = _client_for_dispatcher(org)
    tech_uid, jid = str(uuid4()), str(uuid4())
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = "no_show"
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tech_uid

    # Provider (org-scoped) history includes the no-show.
    ph = client.get("/provider/jobs/history", headers={"Authorization": f"Bearer {token}"})
    assert ph.status_code == 200, ph.text
    assert any(row["id"] == jid for row in ph.json())

    # Technician history excludes it.
    tclient, access, _orig = _tech_client(app_store, tech_uid)
    try:
        th = tclient.get("/technician/jobs/history", headers={"Authorization": f"Bearer {access}"})
        assert th.status_code == 200, th.text
        assert all(row["id"] != jid for row in th.json())
    finally:
        app_store.get_user_session = _orig


# --- Slice A: provider workforce affiliation source of truth ------------------

def test_active_affiliation_makes_tech_dispatch_eligible():
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified", "display_name": "T"}]
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid)))  # active / dispatch_allowed by default
    assert [t["id"] for t in asyncio.run(store.list_all_technicians_for_ops(org))] == [tid]
    assert asyncio.run(store.get_ops_technician(UUID(tid), org)) is not None


def test_ended_suspended_pending_affiliations_not_eligible():
    org, tid = str(uuid4()), str(uuid4())
    for state in ("ended", "suspended", "pending_invite", "rejected"):
        store = InMemoryStore()
        store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified", "display_name": "T"}]
        asyncio.run(store.add_affiliation(UUID(org), UUID(tid), status=state))
        assert asyncio.run(store.list_all_technicians_for_ops(org)) == []
        assert asyncio.run(store.get_ops_technician(UUID(tid), org)) is None


def test_dispatch_not_allowed_affiliation_not_eligible():
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified", "display_name": "T"}]
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid), dispatch_allowed=False))
    assert asyncio.run(store.list_all_technicians_for_ops(org)) == []
    assert asyncio.run(store.get_ops_technician(UUID(tid), org)) is None


def test_affiliation_tenant_isolation():
    store = InMemoryStore()
    org_a, org_b, tid = str(uuid4()), str(uuid4()), str(uuid4())
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified", "display_name": "T"}]
    asyncio.run(store.add_affiliation(UUID(org_a), UUID(tid)))
    assert [t["id"] for t in asyncio.run(store.list_all_technicians_for_ops(org_a))] == [tid]
    assert asyncio.run(store.list_all_technicians_for_ops(org_b)) == []
    assert asyncio.run(store.get_ops_technician(UUID(tid), org_b)) is None


def test_primary_org_fallback_only_when_no_affiliations():
    # Legacy tech (primary_organization_id, no affiliation rows) stays eligible via the
    # denormalized cache until backfilled; once any affiliation row exists, the cache
    # fallback no longer applies and eligibility is authoritative.
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified",
                           "display_name": "T", "primary_organization_id": org}]
    assert [t["id"] for t in asyncio.run(store.list_all_technicians_for_ops(org))] == [tid]
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid), status="ended"))
    assert asyncio.run(store.list_all_technicians_for_ops(org)) == []


def test_backfill_creates_active_affiliation_from_primary_org():
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified",
                           "display_name": "T", "primary_organization_id": org}]
    inserted = asyncio.run(store.backfill_affiliations_from_primary_org())
    assert inserted == 1
    assert any(a["organization_id"] == org and a["technician_id"] == tid
               and a["status"] == "active" and a["dispatch_allowed"] for a in store._affiliations)
    assert asyncio.run(store.backfill_affiliations_from_primary_org()) == 0  # idempotent
    assert [t["id"] for t in asyncio.run(store.list_all_technicians_for_ops(org))] == [tid]


def test_exclusive_active_affiliation_guard():
    store = InMemoryStore()
    org_a, org_b, tid = str(uuid4()), str(uuid4()), str(uuid4())
    asyncio.run(store.add_affiliation(UUID(org_a), UUID(tid), exclusivity="exclusive"))
    raised = False
    try:
        asyncio.run(store.add_affiliation(UUID(org_b), UUID(tid), exclusivity="exclusive"))
    except ValueError as exc:
        raised = "exclusive_conflict" in str(exc)
    assert raised, "second active exclusive affiliation should be rejected"
    # A non-exclusive second affiliation is allowed.
    asyncio.run(store.add_affiliation(UUID(org_b), UUID(tid), exclusivity="non_exclusive"))


def test_active_job_lock_is_technician_scoped():
    store = InMemoryStore()
    tid, jid = str(uuid4()), str(uuid4())
    store._job_tech = {jid: tid}
    store._job_status = {jid: "in_progress"}
    active = asyncio.run(store.get_technician_active_job(UUID(tid)))
    assert active is not None and active["id"] == jid


# --- Slice B: invite/attach existing tech + leave/rejoin history --------------

def test_create_new_technician_creates_active_affiliation():
    store = InMemoryStore()
    org = str(uuid4())
    result = asyncio.run(store.create_affiliated_technician(UUID(org), {
        "display_name": "New Tech", "email": "new@x.com", "password": "password123",
        "affiliation_type": "contractor", "exclusivity": "non_exclusive",
    }))
    assert result.get("existing") is not True
    assert result["affiliation"]["status"] == "active"
    assert result["affiliation"]["is_pending_invite"] is False
    assert len(store._technicians) == 1
    assert len(store._affiliations) == 1 and store._affiliations[0]["status"] == "active"


def test_existing_technician_creates_pending_invite_no_duplicate():
    store = InMemoryStore()
    org_a, org_b = str(uuid4()), str(uuid4())
    first = asyncio.run(store.create_affiliated_technician(UUID(org_a), {
        "display_name": "Tech", "email": "dup@x.com", "password": "password123",
    }))
    tid = first["id"]
    # Same email (case-insensitive), different company → attach existing tech as a
    # pending invite; no duplicate technician, not dispatch-eligible.
    second = asyncio.run(store.create_affiliated_technician(UUID(org_b), {
        "display_name": "Tech", "email": "DUP@x.com", "password": "password123",
    }))
    assert second["id"] == tid
    assert second["existing"] is True
    assert second["affiliation"]["status"] == "pending_invite"
    assert second["affiliation"]["is_pending_invite"] is True
    assert len(store._technicians) == 1
    assert asyncio.run(store.list_all_technicians_for_ops(org_b)) == []


def test_existing_technician_matched_by_phone():
    store = InMemoryStore()
    org_a, org_b = str(uuid4()), str(uuid4())
    asyncio.run(store.create_affiliated_technician(UUID(org_a), {
        "display_name": "Tech", "phone": "5551112222", "password": "password123",
    }))
    second = asyncio.run(store.create_affiliated_technician(UUID(org_b), {
        "display_name": "Tech", "phone": "5551112222", "password": "password123",
    }))
    assert second["existing"] is True and second["affiliation"]["status"] == "pending_invite"
    assert len(store._technicians) == 1


def test_leave_then_rejoin_preserves_affiliation_history():
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified", "display_name": "T"}]
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid)))  # join
    assert [t["id"] for t in asyncio.run(store.list_all_technicians_for_ops(org))] == [tid]
    ended = asyncio.run(store.end_affiliation(UUID(org), UUID(tid), reason="moved region"))
    assert ended and ended["status"] == "ended"
    assert asyncio.run(store.list_all_technicians_for_ops(org)) == []  # ended → not eligible
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid)))  # rejoin → NEW period row
    rows = [a for a in store._affiliations if a["organization_id"] == org and a["technician_id"] == tid]
    assert len(rows) == 2  # history preserved
    assert sum(1 for a in rows if a["ended_at"] is None and a["status"] == "active") == 1
    assert sum(1 for a in rows if a["status"] == "ended" and a["ended_at"] is not None) == 1
    assert [t["id"] for t in asyncio.run(store.list_all_technicians_for_ops(org))] == [tid]  # eligible again


def test_provider_workspace_roster_uses_current_open_affiliation_only():
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified", "display_name": "T"}]
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid)))
    asyncio.run(store.end_affiliation(UUID(org), UUID(tid), reason="left market"))
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid)))

    workspace = asyncio.run(store.get_provider_workspace(UUID(org)))
    assert workspace is not None
    assert [tech["id"] for tech in workspace["technicians"]] == [tid]
    assert workspace["technicians"][0]["affiliation"]["status"] == "active"
    assert workspace["technicians"][0]["affiliation"]["ended_at"] is None


def test_end_affiliation_returns_none_when_no_open_period():
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    assert asyncio.run(store.end_affiliation(UUID(org), UUID(tid))) is None


def test_pending_invite_does_not_violate_active_exclusive_guard():
    # A pending invite to a technician who already has an active exclusive affiliation
    # elsewhere is allowed (only active exclusivity is guarded; activation is later).
    store = InMemoryStore()
    org_a, org_b, tid = str(uuid4()), str(uuid4()), str(uuid4())
    asyncio.run(store.add_affiliation(UUID(org_a), UUID(tid), exclusivity="exclusive"))
    aff = asyncio.run(store.add_affiliation(
        UUID(org_b), UUID(tid), status="pending_invite", exclusivity="exclusive"))
    assert aff["status"] == "pending_invite"


def test_existing_tech_invite_is_tenant_scoped():
    store = InMemoryStore()
    org_a, org_b = str(uuid4()), str(uuid4())
    first = asyncio.run(store.create_affiliated_technician(UUID(org_a), {
        "display_name": "Tech", "email": "scoped@x.com", "password": "password123",
    }))
    tid = first["id"]
    asyncio.run(store.create_affiliated_technician(UUID(org_b), {
        "display_name": "Tech", "email": "scoped@x.com", "password": "password123",
    }))
    # org_a keeps its active affiliation; org_b only holds a pending invite.
    a_rows = [a for a in store._affiliations if a["organization_id"] == org_a and a["technician_id"] == tid]
    b_rows = [a for a in store._affiliations if a["organization_id"] == org_b and a["technician_id"] == tid]
    assert a_rows and a_rows[0]["status"] == "active"
    assert b_rows and b_rows[0]["status"] == "pending_invite"


# --- Slice E: customer-safe assigned-technician identity ----------------------

def _status_for(store, jid, tid, *, job_status="en_route", tech=None):
    store._job_status = {jid: job_status}
    store._job_tech = {jid: tid} if tid else {}
    if tech is not None:
        store._technicians = [tech]
    return asyncio.run(store.get_dispatch_status(UUID(jid), max_attempts=3, total_timeout_seconds=300))


def test_assigned_technician_approved_photo_exposed_to_customer():
    store = InMemoryStore()
    jid, tid = str(uuid4()), str(uuid4())
    status = _status_for(store, jid, tid, tech={
        "id": tid, "display_name": "Alex Tech",
        "profile_photo_url": "https://cdn.example/alex.jpg", "profile_photo_status": "approved",
    })
    aff = status["assignment"]
    assert aff is not None
    assert aff["technician_display_name"] == "Alex Tech"
    assert aff["technician_photo_url"] == "https://cdn.example/alex.jpg"


def test_unapproved_photo_is_not_exposed_to_customer():
    for st in ("pending", "rejected", "none"):
        store = InMemoryStore()
        jid, tid = str(uuid4()), str(uuid4())
        status = _status_for(store, jid, tid, tech={
            "id": tid, "display_name": "Alex Tech",
            "profile_photo_url": "https://cdn.example/alex.jpg", "profile_photo_status": st,
        })
        aff = status["assignment"]
        assert aff["technician_photo_url"] is None, f"photo leaked with status={st}"
        assert aff["technician_display_name"] == "Alex Tech"


def test_no_technician_identity_before_assignment():
    # No assigned technician → no assignment object → no name/photo leak.
    store = InMemoryStore()
    jid = str(uuid4())
    status = _status_for(store, jid, None, job_status="pending_dispatch")
    assert status["assignment"] is None


# --- Slice D backend: technician self-service affiliations + photo ------------

def test_accept_pending_invite_activates_and_is_self_scoped():
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    aff = asyncio.run(store.add_affiliation(UUID(org), UUID(tid), status="pending_invite"))
    aid = aff["id"]
    # A different technician cannot accept this invite (self-scoped).
    assert asyncio.run(store.accept_affiliation(UUID(aid), uuid4())) is None
    result = asyncio.run(store.accept_affiliation(UUID(aid), UUID(tid)))
    assert result["status"] == "active"
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified", "display_name": "T"}]
    assert [t["id"] for t in asyncio.run(store.list_all_technicians_for_ops(org))] == [tid]


def test_accept_enforces_exclusivity_at_activation():
    store = InMemoryStore()
    org_a, org_b, tid = str(uuid4()), str(uuid4()), str(uuid4())
    asyncio.run(store.add_affiliation(UUID(org_a), UUID(tid), status="active", exclusivity="exclusive"))
    invite = asyncio.run(store.add_affiliation(UUID(org_b), UUID(tid), status="pending_invite", exclusivity="non_exclusive"))
    raised = False
    try:
        asyncio.run(store.accept_affiliation(UUID(invite["id"]), UUID(tid)))
    except ValueError as exc:
        raised = "exclusive_conflict" in str(exc)
    assert raised, "cannot activate a new affiliation while an active exclusive exists elsewhere"


def test_decline_sets_rejected_and_closes_period():
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    invite = asyncio.run(store.add_affiliation(UUID(org), UUID(tid), status="pending_invite"))
    result = asyncio.run(store.decline_affiliation(UUID(invite["id"]), UUID(tid), reason="not interested"))
    assert result["status"] == "rejected" and result["ended_at"] is not None
    # Declining closes the period, so the provider can re-invite (a new open row).
    again = asyncio.run(store.add_affiliation(UUID(org), UUID(tid), status="pending_invite"))
    assert again["id"] != invite["id"]


def test_list_technician_affiliations_self_scoped():
    store = InMemoryStore()
    org, tid, other = str(uuid4()), str(uuid4()), str(uuid4())
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid), status="pending_invite"))
    asyncio.run(store.add_affiliation(UUID(org), UUID(other), status="active"))
    rows = asyncio.run(store.list_technician_affiliations(UUID(tid)))
    assert len(rows) == 1
    assert rows[0]["status"] == "pending_invite" and rows[0]["organization_id"] == org


def test_set_technician_photo_marks_pending_and_not_customer_exposed():
    store = InMemoryStore()
    tid = str(uuid4())
    store._technicians = [{"id": tid, "display_name": "T", "profile_photo_status": "none"}]
    result = asyncio.run(store.set_technician_photo(UUID(tid), "https://cdn.example/x.jpg"))
    assert result == {"photo_url": "https://cdn.example/x.jpg", "photo_status": "pending"}
    assert store._technicians[0]["profile_photo_status"] == "pending"
    # Slice E gate: a pending photo is NOT exposed to the customer.
    status = _status_for(store, str(uuid4()), tid)
    assert status["assignment"]["technician_photo_url"] is None


# --- Slice D/E backend completion: photo review + provider suspend/end ---------

def test_photo_review_approve_exposes_to_customer_reject_does_not():
    store = InMemoryStore()
    tid = str(uuid4())
    store._technicians = [{
        "id": tid, "display_name": "T",
        "profile_photo_url": "https://cdn.example/x.jpg", "profile_photo_status": "pending",
    }]
    asyncio.run(store.set_technician_photo_status(UUID(tid), "rejected"))
    assert _status_for(store, str(uuid4()), tid)["assignment"]["technician_photo_url"] is None
    asyncio.run(store.set_technician_photo_status(UUID(tid), "approved"))
    assert _status_for(store, str(uuid4()), tid)["assignment"]["technician_photo_url"] == "https://cdn.example/x.jpg"


def test_pending_technician_photos_list_only_pending_with_photo():
    store = InMemoryStore()
    pending, approved, no_photo = str(uuid4()), str(uuid4()), str(uuid4())
    store._technicians = [
        {
            "id": pending, "display_name": "Pending Photo", "email": "pending@example.test",
            "profile_photo_url": "https://cdn.example/pending.jpg",
            "profile_photo_status": "pending", "status": "active", "vetting_status": "verified",
        },
        {
            "id": approved, "display_name": "Approved Photo",
            "profile_photo_url": "https://cdn.example/approved.jpg",
            "profile_photo_status": "approved",
        },
        {
            "id": no_photo, "display_name": "No Photo",
            "profile_photo_status": "pending",
        },
    ]

    rows = asyncio.run(store.list_pending_technician_photos())
    assert [row["technician_id"] for row in rows] == [pending]
    assert rows[0]["photo_url"] == "https://cdn.example/pending.jpg"


def test_admin_pending_technician_photos_requires_platform_admin():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    admin_id = f"admin-photo-{uuid4()}"
    tech_id = str(uuid4())
    app_store.users[admin_id] = {
        "id": admin_id, "email": "admin-photo@example.test", "phone": None,
        "display_name": "Photo Admin", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }
    app_store._technicians = getattr(app_store, "_technicians", [])
    app_store._technicians.append({
        "id": tech_id, "display_name": "Pending Headshot",
        "profile_photo_url": "https://cdn.example/headshot.jpg",
        "profile_photo_status": "pending",
    })
    token = create_access_token({"sub": admin_id, "id": admin_id, "roles": ["platform_admin"]})
    client = TestClient(app)

    unauth = client.get("/admin/technicians/photos")
    assert unauth.status_code in {401, 403}
    resp = client.get("/admin/technicians/photos", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert any(row["technician_id"] == tech_id for row in resp.json()["photos"])


def test_provider_suspend_makes_ineligible_and_can_reactivate():
    store = InMemoryStore()
    org, tid = str(uuid4()), str(uuid4())
    store._technicians = [{"id": tid, "status": "active", "vetting_status": "verified", "display_name": "T"}]
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid)))
    assert [t["id"] for t in asyncio.run(store.list_all_technicians_for_ops(org))] == [tid]
    res = asyncio.run(store.end_affiliation(UUID(org), UUID(tid), status="suspended", reason="paused"))
    assert res["status"] == "suspended"
    assert asyncio.run(store.list_all_technicians_for_ops(org)) == []  # suspended → ineligible
    asyncio.run(store.add_affiliation(UUID(org), UUID(tid)))  # reactivate the open period
    assert [t["id"] for t in asyncio.run(store.list_all_technicians_for_ops(org))] == [tid]


def test_provider_end_affiliation_is_tenant_scoped():
    store = InMemoryStore()
    org_a, org_b, tid = str(uuid4()), str(uuid4()), str(uuid4())
    asyncio.run(store.add_affiliation(UUID(org_a), UUID(tid)))
    # Another company cannot end org_a's affiliation (no open period for org_b, tid).
    assert asyncio.run(store.end_affiliation(UUID(org_b), UUID(tid), status="ended")) is None
    a = next(x for x in store._affiliations if x["organization_id"] == org_a)
    assert a["status"] == "active" and a["ended_at"] is None


# --- Technician documents (0020/0021 fixes): flow + self-scope ----------------

def test_technician_documents_flow_and_self_scope():
    store = InMemoryStore()
    store.technician_documents = []
    t1, t2 = str(uuid4()), str(uuid4())
    d = asyncio.run(store.create_technician_document(UUID(t1), {
        "document_type": "locksmith_license",
        "storage_bucket": "private-verification",
        "storage_path": "technicians/x/documents/a.pdf",
    }))
    assert d["id"] and d["status"] == "pending_review"
    # self-scoped: another technician cannot fetch it; the owner can.
    assert asyncio.run(store.get_technician_document(UUID(d["id"]), UUID(t2))) is None
    assert asyncio.run(store.get_technician_document(UUID(d["id"]), UUID(t1)))["id"] == d["id"]
    # pending list includes it; review → approved removes it from pending.
    assert any(x["id"] == d["id"] for x in asyncio.run(store.list_pending_technician_documents()))
    # admin getter resolves by id alone (not self-scoped) for the Ops download path.
    admin_doc = asyncio.run(store.get_technician_document_admin(UUID(d["id"])))
    assert admin_doc["storage_bucket"] == "private-verification"
    assert admin_doc["storage_path"] == "technicians/x/documents/a.pdf"
    assert asyncio.run(store.get_technician_document_admin(uuid4())) is None
    asyncio.run(store.review_technician_document(UUID(d["id"]), status="approved", reviewer_id=None))
    assert asyncio.run(store.list_pending_technician_documents()) == []
    assert asyncio.run(store.list_technician_documents(UUID(t1)))[0]["status"] == "approved"


def test_postgres_sql_has_no_unescaped_percent():
    """Guard the psycopg landmine that the in-memory tests can't see: in a
    parameterised query a literal '%' (e.g. LIKE 'x:%') must be doubled as '%%',
    or psycopg raises at execute time and the endpoint 500s. Regression for the
    get_provider_active_jobs 'tech_issue:%' bug. Scans the store source for a '%'
    that is not part of '%s', '%%', or a '%(name)s' mapping placeholder."""
    import re
    from pathlib import Path

    src = Path(__file__).resolve().parents[1].joinpath("store.py").read_text(encoding="utf-8")
    # strip the valid tokens (%%, %s, %(name)s) then flag any '%' that remains.
    offenders = [
        (i + 1, line.strip())
        for i, line in enumerate(src.splitlines())
        if "%" in re.sub(r"%%|%s|%\([^)]+\)s", "", line)
    ]
    assert not offenders, f"unescaped '%' in SQL (use '%%'): {offenders}"


# ---------------------------------------------------------------------------
# Provider workforce: technician directory, invite flow, document ownership.
# Tenant-scoped; provider companies may not manage technician documents.
# ---------------------------------------------------------------------------

def test_provider_technicians_directory_is_tenant_scoped():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    res = client.get("/provider/technicians", headers={"Authorization": f"Bearer {access}"})
    assert res.status_code == 200, res.text
    assert "technicians" in res.json()
    assert isinstance(res.json()["technicians"], list)


def test_provider_invite_link_for_new_email_and_resolve():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)

    # Missing email → 422.
    bad = client.post("/provider/technicians/invite", json={"email": ""},
                      headers={"Authorization": f"Bearer {access}"})
    assert bad.status_code == 422

    # New email → invite link with a token.
    res = client.post("/provider/technicians/invite", json={"email": "newbie@example.com"},
                      headers={"Authorization": f"Bearer {access}"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "invite_link"
    token = body["invite"]["token"]
    assert token

    # Public resolve works for the pending token.
    resolved = client.get(f"/technician-invites/{token}")
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["organization_id"] == org

    # Unknown token → 404.
    assert client.get("/technician-invites/does-not-exist").status_code == 404


def test_provider_cannot_create_global_technician_profile_directly():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)

    res = client.post(
        "/provider/technicians",
        json={
            "display_name": "Provider Created Tech",
            "email": "provider-created@example.com",
            "password": "temporary-password",
            "skills": ["home"],
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert res.status_code == 410
    assert "invite" in res.json()["detail"].lower()


def test_provider_cannot_upload_technician_documents():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    res = client.post(
        "/provider/documents",
        json={"owner_type": "technician", "owner_id": str(uuid4()),
              "document_type": "technician_license", "storage_path": "x/y"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert res.status_code == 403, res.text


# --- global_settings: DB-backed offer TTL + admin API (migration 0023) -------

def test_settings_resolve_ttl_from_db():
    from api import settings as rs
    store = InMemoryStore()  # seeded with dispatch_offer_ttl_seconds = 300
    rs.clear_cache()
    assert asyncio.run(rs.resolve_offer_ttl_seconds(store)) == 300
    asyncio.run(store.upsert_global_setting("dispatch_offer_ttl_seconds", 240, "integer", None))
    rs.clear_cache()
    assert asyncio.run(rs.resolve_offer_ttl_seconds(store)) == 240


def test_settings_fallback_to_env_when_db_absent(monkeypatch):
    from api import settings as rs
    store = InMemoryStore()
    store._global_settings.clear()  # no DB row
    monkeypatch.setenv("DISPATCH_OFFER_TTL_SECONDS", "120")
    rs.clear_cache()
    assert asyncio.run(rs.resolve_offer_ttl_seconds(store)) == 120


def test_settings_fallback_to_hardcoded_300_when_db_and_env_absent(monkeypatch):
    from api import settings as rs
    store = InMemoryStore()
    store._global_settings.clear()
    monkeypatch.delenv("DISPATCH_OFFER_TTL_SECONDS", raising=False)
    rs.clear_cache()
    assert asyncio.run(rs.resolve_offer_ttl_seconds(store)) == 300


def test_settings_invalid_db_value_falls_back(monkeypatch):
    from api import settings as rs
    store = InMemoryStore()
    store._global_settings["dispatch_offer_ttl_seconds"] = {
        "key": "dispatch_offer_ttl_seconds", "value": 30, "value_type": "integer",
        "description": None, "is_secret": False, "is_runtime_editable": True,
        "updated_at": None, "updated_by": None,
    }
    monkeypatch.delenv("DISPATCH_OFFER_TTL_SECONDS", raising=False)
    rs.clear_cache()
    assert asyncio.run(rs.resolve_offer_ttl_seconds(store)) == 300


def test_settings_db_read_failure_falls_back_and_dispatch_survives(monkeypatch):
    from api import settings as rs

    class BrokenStore(InMemoryStore):
        async def get_global_setting(self, key):
            raise RuntimeError("db unavailable")

    store = BrokenStore()
    monkeypatch.delenv("DISPATCH_OFFER_TTL_SECONDS", raising=False)
    rs.clear_cache()
    # Resolver must not raise; dispatch keeps working on the hardcoded fallback.
    assert asyncio.run(rs.resolve_offer_ttl_seconds(store)) == 300


def test_settings_validation_type_and_range():
    import pytest
    from api import settings as rs
    for bad in ("abc", 59, 901, True, 30.5):
        with pytest.raises(rs.SettingValidationError):
            rs.coerce_and_validate("dispatch_offer_ttl_seconds", bad)
    # boundaries accepted
    assert rs.coerce_and_validate("dispatch_offer_ttl_seconds", 60) == 60
    assert rs.coerce_and_validate("dispatch_offer_ttl_seconds", 900) == 900


def test_settings_unknown_key_rejected():
    import pytest
    from api import settings as rs
    assert rs.is_known_key("dispatch_offer_ttl_seconds") is True
    assert rs.is_known_key("definitely_not_a_setting") is False
    with pytest.raises(rs.SettingValidationError):
        rs.coerce_and_validate("definitely_not_a_setting", 100)


def test_existing_offer_ttl_stamped_at_creation_unaffected_by_later_change():
    """New offers pick up the new TTL; an already-stamped expires_at does not move.
    Verified at the resolver/stamp boundary (where main.py computes expires_at)."""
    from datetime import datetime, timezone, timedelta
    from api import settings as rs
    store = InMemoryStore()
    rs.clear_cache()
    ttl1 = asyncio.run(rs.resolve_offer_ttl_seconds(store))           # 300 (seed)
    created1 = datetime.now(timezone.utc)
    expires1 = created1 + timedelta(seconds=ttl1)                     # stamped onto offer #1
    # Operator lowers the TTL after offer #1 already exists.
    asyncio.run(store.upsert_global_setting("dispatch_offer_ttl_seconds", 120, "integer", None))
    rs.clear_cache()
    ttl2 = asyncio.run(rs.resolve_offer_ttl_seconds(store))           # 120 (new offers only)
    created2 = datetime.now(timezone.utc)
    expires2 = created2 + timedelta(seconds=ttl2)
    assert ttl1 == 300 and ttl2 == 120
    assert abs((expires1 - created1).total_seconds() - 300) < 1
    assert abs((expires2 - created2).total_seconds() - 120) < 1
    # offer #1's stamped expiry is unchanged by the setting change.
    assert (expires1 - created1).total_seconds() > 290


def _settings_user(store, roles):
    from uuid import uuid4
    uid = str(uuid4())
    store.users[uid] = {
        "id": uid, "email": f"{uid}@cluexp.test", "phone": None,
        "display_name": "U", "password_hash": "",
        "roles": roles, "active_organization_id": None, "organization_name": None,
    }
    return uid


def test_admin_global_settings_endpoints_authz_and_validation():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token
    from api import settings as rs
    rs.clear_cache()

    admin = _settings_user(app_store, ["platform_admin"])
    disp = _settings_user(app_store, ["dispatcher"])
    padmin = _settings_user(app_store, ["provider_admin"])
    tech = _settings_user(app_store, ["technician"])
    client = TestClient(app)

    def hdr(uid, roles):
        return {"Authorization": f"Bearer {create_access_token({'sub': uid, 'id': uid, 'roles': roles})}"}

    path = "/admin/global-settings/dispatch_offer_ttl_seconds"

    # GET as platform_admin lists the seeded setting.
    r = client.get("/admin/global-settings", headers=hdr(admin, ["platform_admin"]))
    assert r.status_code == 200
    assert any(s["key"] == "dispatch_offer_ttl_seconds" for s in r.json()["settings"])

    # PATCH valid (admin) + boundaries.
    assert client.patch(path, json={"value": 300}, headers=hdr(admin, ["platform_admin"])).status_code == 200
    assert client.patch(path, json={"value": 60}, headers=hdr(admin, ["platform_admin"])).status_code == 200
    ok = client.patch(path, json={"value": 900}, headers=hdr(admin, ["platform_admin"]))
    assert ok.status_code == 200 and ok.json()["value"] == 900

    # Invalid type / range → 422.
    assert client.patch(path, json={"value": "abc"}, headers=hdr(admin, ["platform_admin"])).status_code == 422
    assert client.patch(path, json={"value": 59}, headers=hdr(admin, ["platform_admin"])).status_code == 422
    assert client.patch(path, json={"value": 901}, headers=hdr(admin, ["platform_admin"])).status_code == 422

    # Unknown key → 404.
    assert client.patch("/admin/global-settings/nope", json={"value": 100},
                        headers=hdr(admin, ["platform_admin"])).status_code == 404

    # Non-platform-admins cannot read or update.
    for uid, roles in ((disp, ["dispatcher"]), (padmin, ["provider_admin"]), (tech, ["technician"])):
        assert client.patch(path, json={"value": 300}, headers=hdr(uid, roles)).status_code == 403
        assert client.get("/admin/global-settings", headers=hdr(uid, roles)).status_code == 403

    # Restore the seed so other tests see the default, and clear the resolver cache.
    assert client.patch(path, json={"value": 300}, headers=hdr(admin, ["platform_admin"])).status_code == 200
    rs.clear_cache()


# --- provider workforce: technician detail + team management (read-only ownership) ---

def _seed_affiliation(app_store, org_id, tid, *, status="active"):
    from datetime import datetime, timezone
    app_store._affiliations = getattr(app_store, "_affiliations", [])
    app_store._affiliations.append({
        "id": str(uuid4()), "organization_id": org_id, "technician_id": tid,
        "status": status, "affiliation_type": "employee_w2", "exclusivity": "non_exclusive",
        "dispatch_allowed": True, "ended_at": None,
        "starts_at": datetime.now(timezone.utc).isoformat(),
    })


def test_provider_technician_detail_tenant_scoped_and_read_only():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org, other_org = str(uuid4()), str(uuid4())
    uid, tid = str(uuid4()), str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    _seed_org_tech(app_store, org, tid)
    _seed_affiliation(app_store, org, tid)
    app_store._job_reviews = [
        {"fulfillment_technician_ref": tid, "fulfillment_org_id": org, "rating": 5},
        {"fulfillment_technician_ref": tid, "fulfillment_org_id": other_org, "rating": 3},
    ]
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)

    ok = client.get(f"/provider/technicians/{tid}", headers={"Authorization": f"Bearer {access}"})
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["id"] == tid
    assert "team_memberships" in body and "documents" in body
    # company review summary scoped to this org; global spans all orgs.
    assert body["reviews"]["company"] == {"count": 1, "average": 5.0}
    assert body["reviews"]["global"]["count"] == 2 and body["reviews"]["global"]["average"] == 4.0
    # No write/edit affordance is exposed in the contract (read-only profile).
    assert "password" not in body

    # A technician with no affiliation to this org is invisible (no cross-tenant leak).
    foreign = str(uuid4())
    _seed_org_tech(app_store, other_org, foreign)
    _seed_affiliation(app_store, other_org, foreign)
    miss = client.get(f"/provider/technicians/{foreign}", headers={"Authorization": f"Bearer {access}"})
    assert miss.status_code == 404


def test_provider_technician_agreement_is_affiliation_scoped():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org_a, org_b, tid = str(uuid4()), str(uuid4()), str(uuid4())
    _seed_org_tech(app_store, org_a, tid)
    _seed_affiliation(app_store, org_a, tid)
    _seed_affiliation(app_store, org_b, tid)

    admin_a = str(uuid4())
    admin_b = str(uuid4())
    app_store.users[admin_a] = {
        "id": admin_a, "email": f"agr_a_{admin_a[:8]}@cluexp.test", "phone": None,
        "display_name": "Provider Admin A", "password_hash": "",
        "roles": ["provider_admin"], "active_organization_id": org_a, "organization_name": "A",
    }
    app_store.users[admin_b] = {
        "id": admin_b, "email": f"agr_b_{admin_b[:8]}@cluexp.test", "phone": None,
        "display_name": "Provider Admin B", "password_hash": "",
        "roles": ["provider_admin"], "active_organization_id": org_b, "organization_name": "B",
    }
    client = TestClient(app)
    hdr_a = {"Authorization": f"Bearer {create_access_token({'sub': admin_a, 'id': admin_a, 'roles': ['provider_admin']})}"}
    hdr_b = {"Authorization": f"Bearer {create_access_token({'sub': admin_b, 'id': admin_b, 'roles': ['provider_admin']})}"}

    payload = {
        "status": "active",
        "default_labor_cut_basis_points": 6000,
        "tip_policy": "tech_keeps",
        "tip_cut_basis_points": 10000,
        "card_fee_policy": "company_pays",
        "minimum_payout_cents": 0,
        "flat_job_bonus_cents": 0,
        "service_area_counties": ["Orange"],
        "service_area_zipcodes": ["32801"],
        "service_hours": {"mon": ["08:00-18:00"]},
        "rules": {"skill_cuts": {"locksmith.vehicle_key_programming": 7000}},
    }
    saved = client.patch(f"/provider/technicians/{tid}/agreement", json=payload, headers=hdr_a)
    assert saved.status_code == 200, saved.text
    assert saved.json()["default_labor_cut_basis_points"] == 6000

    scoped_a = client.get(f"/provider/technicians/{tid}", headers=hdr_a)
    scoped_b = client.get(f"/provider/technicians/{tid}", headers=hdr_b)
    assert scoped_a.status_code == 200, scoped_a.text
    assert scoped_b.status_code == 200, scoped_b.text
    assert scoped_a.json()["agreement"]["default_labor_cut_basis_points"] == 6000
    assert scoped_b.json()["agreement"]["default_labor_cut_basis_points"] == 5000


def test_provider_settlement_excludes_parts_and_reimburses_tech_items():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org, tid, jid = str(uuid4()), str(uuid4()), str(uuid4())
    _seed_org_tech(app_store, org, tid)
    _seed_affiliation(app_store, org, tid)
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_COMPLETED_CONFIRMED
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tid
    app_store._job_access_type = getattr(app_store, "_job_access_type", {})
    app_store._job_access_type[jid] = "locksmith.vehicle_key_programming"

    admin = str(uuid4())
    app_store.users[admin] = {
        "id": admin, "email": f"set_{admin[:8]}@cluexp.test", "phone": None,
        "display_name": "Provider Admin", "password_hash": "",
        "roles": ["provider_admin"], "active_organization_id": org, "organization_name": "Acme",
    }
    client = TestClient(app)
    H = {"Authorization": f"Bearer {create_access_token({'sub': admin, 'id': admin, 'roles': ['provider_admin']})}"}

    assert client.patch(
        f"/provider/technicians/{tid}/agreement",
        json={
            "status": "active",
            "default_labor_cut_basis_points": 6000,
            "tip_policy": "tech_keeps",
            "tip_cut_basis_points": 10000,
            "card_fee_policy": "company_pays",
            "minimum_payout_cents": 0,
            "flat_job_bonus_cents": 0,
            "rules": {},
        },
        headers=H,
    ).status_code == 200
    asyncio.run(app_store.record_job_closeout({
        "job_id": jid,
        "reported_by": "technician",
        "currency": "USD",
        "method": "cash",
        "subtotal_cents": 17500,
        "taxable_subtotal_cents": 15000,
        "tax_rate_basis_points": 0,
        "tax_cents": 0,
        "tip_cents": 2000,
        "card_fee_basis_points": 0,
        "card_fee_fixed_cents": 0,
        "card_fee_cents": 0,
        "total_cents": 19500,
        "settings_snapshot": {},
        "line_items": [
            {"line_number": 1, "item_type_code": "service_fee", "description": "Service", "quantity": 1, "unit_amount_cents": 10000, "line_total_cents": 10000, "taxable": True, "provided_by": None, "compensation_eligible": True, "reimbursement_eligible": False, "note": None},
            {"line_number": 2, "item_type_code": "hardware", "description": "Lock", "quantity": 1, "unit_amount_cents": 5000, "line_total_cents": 5000, "taxable": True, "provided_by": "company", "compensation_eligible": False, "reimbursement_eligible": True, "note": None},
            {"line_number": 3, "item_type_code": "key_code_purchase", "description": "Code", "quantity": 1, "unit_amount_cents": 2500, "line_total_cents": 2500, "taxable": False, "provided_by": "technician", "compensation_eligible": False, "reimbursement_eligible": True, "note": "purchase"},
        ],
    }))

    report = client.get("/provider/settlements", headers=H)
    assert report.status_code == 200, report.text
    row = next(item for item in report.json() if item["job_id"] == jid)
    assert row["commissionable_cents"] == 10000
    assert row["company_provided_items_cents"] == 5000
    assert row["tech_reimbursement_cents"] == 2500
    assert row["tech_service_payout_cents"] == 6000
    assert row["tech_tip_cents"] == 2000
    assert row["tech_payout_cents"] == 10500
    assert row["company_retained_cents"] == 9000

    csv = client.get("/provider/settlements?format=csv", headers=H)
    assert csv.status_code == 200
    assert "tech_payout_cents" in csv.text


def test_settlement_period_locks_snapshot_and_status_flow():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org, tid, jid = str(uuid4()), str(uuid4()), str(uuid4())
    _seed_org_tech(app_store, org, tid)
    _seed_affiliation(app_store, org, tid)
    app_store._job_status = getattr(app_store, "_job_status", {})
    app_store._job_status[jid] = STATUS_COMPLETED_CONFIRMED
    app_store._job_org = getattr(app_store, "_job_org", {})
    app_store._job_org[jid] = org
    app_store._job_tech = getattr(app_store, "_job_tech", {})
    app_store._job_tech[jid] = tid
    app_store._job_access_type = getattr(app_store, "_job_access_type", {})
    app_store._job_access_type[jid] = "locksmith.vehicle_key_programming"

    admin = str(uuid4())
    app_store.users[admin] = {
        "id": admin, "email": f"period_{admin[:8]}@cluexp.test", "phone": None,
        "display_name": "Provider Admin", "password_hash": "",
        "roles": ["provider_admin"], "active_organization_id": org, "organization_name": "Acme",
    }
    client = TestClient(app)
    H = {"Authorization": f"Bearer {create_access_token({'sub': admin, 'id': admin, 'roles': ['provider_admin']})}"}

    agreement = {
        "status": "active",
        "default_labor_cut_basis_points": 6000,
        "tip_policy": "tech_keeps",
        "tip_cut_basis_points": 10000,
        "card_fee_policy": "company_pays",
        "minimum_payout_cents": 0,
        "flat_job_bonus_cents": 0,
        "rules": {},
    }
    assert client.patch(f"/provider/technicians/{tid}/agreement", json=agreement, headers=H).status_code == 200
    asyncio.run(app_store.record_job_closeout({
        "job_id": jid,
        "reported_by": "technician",
        "currency": "USD",
        "method": "cash",
        "subtotal_cents": 10000,
        "taxable_subtotal_cents": 10000,
        "tax_rate_basis_points": 0,
        "tax_cents": 0,
        "tip_cents": 1000,
        "card_fee_basis_points": 0,
        "card_fee_fixed_cents": 0,
        "card_fee_cents": 0,
        "total_cents": 11000,
        "settings_snapshot": {},
        "line_items": [
            {"line_number": 1, "item_type_code": "service_fee", "description": "Service", "quantity": 1, "unit_amount_cents": 10000, "line_total_cents": 10000, "taxable": True, "provided_by": None, "compensation_eligible": True, "reimbursement_eligible": False, "note": None},
        ],
    }))

    created = client.post("/provider/settlement-periods", json={"label": "First half"}, headers=H)
    assert created.status_code == 200, created.text
    period = created.json()
    assert period["job_count"] == 1
    assert period["final_tech_payout_cents"] == 7000
    period_id = period["id"]

    agreement["default_labor_cut_basis_points"] = 9000
    assert client.patch(f"/provider/technicians/{tid}/agreement", json=agreement, headers=H).status_code == 200
    live = client.get("/provider/settlements", headers=H).json()
    assert next(row for row in live if row["job_id"] == jid)["tech_payout_cents"] == 10000
    saved = client.get(f"/provider/settlement-periods/{period_id}", headers=H).json()
    assert saved["rows"][0]["tech_payout_cents"] == 7000

    adjusted = client.post(
        f"/provider/settlement-periods/{period_id}/adjustments",
        json={"amount_cents": 500, "reason": "fuel bonus"},
        headers=H,
    )
    assert adjusted.status_code == 200, adjusted.text
    assert adjusted.json()["final_tech_payout_cents"] == 7500

    locked = client.post(f"/provider/settlement-periods/{period_id}/lock", json={"note": "approved"}, headers=H)
    assert locked.status_code == 200, locked.text
    assert locked.json()["status"] == "locked"
    denied_adjust = client.post(
        f"/provider/settlement-periods/{period_id}/adjustments",
        json={"amount_cents": 100, "reason": "late"},
        headers=H,
    )
    assert denied_adjust.status_code == 409

    paid = client.post(f"/provider/settlement-periods/{period_id}/paid", json={"note": "paid outside ClueXP"}, headers=H)
    assert paid.status_code == 200, paid.text
    assert paid.json()["status"] == "paid"
    assert client.post(f"/provider/settlement-periods/{period_id}/paid", json={}, headers=H).status_code == 409
    csv = client.get(f"/provider/settlement-periods/{period_id}?format=csv", headers=H)
    assert csv.status_code == 200 and "tech_payout_cents" in csv.text


def test_provider_team_membership_add_remove_and_affiliation_required():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid, tid = str(uuid4()), str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    _seed_org_tech(app_store, org, tid)
    _seed_affiliation(app_store, org, tid)
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    H = {"Authorization": f"Bearer {access}"}
    client = TestClient(app)

    team = client.post("/provider/teams", json={"name": "North Crew"}, headers=H).json()
    team_id = team["id"]

    # Add an affiliated technician.
    add = client.post(f"/provider/teams/{team_id}/technicians", json={"technician_id": tid}, headers=H)
    assert add.status_code == 200 and add.json()["added"] is True
    # Idempotent: adding again is a no-op.
    assert client.post(f"/provider/teams/{team_id}/technicians", json={"technician_id": tid}, headers=H).json()["added"] is False

    # A non-affiliated technician cannot join.
    stranger = str(uuid4())
    _seed_org_tech(app_store, org, stranger)  # profile but NO affiliation row
    bad = client.post(f"/provider/teams/{team_id}/technicians", json={"technician_id": stranger}, headers=H)
    assert bad.status_code == 422

    # Unknown team → 404.
    assert client.post(f"/provider/teams/{uuid4()}/technicians", json={"technician_id": tid}, headers=H).status_code == 404

    # Remove membership.
    rm = client.delete(f"/provider/teams/{team_id}/technicians/{tid}", headers=H)
    assert rm.status_code == 200 and rm.json()["removed"] is True
    # Removing again → 404 (not a member).
    assert client.delete(f"/provider/teams/{team_id}/technicians/{tid}", headers=H).status_code == 404


def test_provider_team_safe_delete():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    H = {"Authorization": f"Bearer {access}"}
    client = TestClient(app)

    parent = client.post("/provider/teams", json={"name": "Region"}, headers=H).json()
    child = client.post("/provider/teams", json={"name": "Sub", "parent_team_id": parent["id"]}, headers=H).json()

    # Refuse to delete a team that still has sub-teams.
    assert client.delete(f"/provider/teams/{parent['id']}", headers=H).status_code == 409
    # Deleting the leaf is fine.
    assert client.delete(f"/provider/teams/{child['id']}", headers=H).status_code == 200
    # Now the parent has no children → deletable.
    assert client.delete(f"/provider/teams/{parent['id']}", headers=H).status_code == 200
    # Unknown/foreign team → 404.
    assert client.delete(f"/provider/teams/{uuid4()}", headers=H).status_code == 404


def test_provider_can_revoke_pending_invite_before_acceptance():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid, tid = str(uuid4()), str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    _seed_org_tech(app_store, org, tid)
    _seed_affiliation(app_store, org, tid, status="pending_invite")
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    H = {"Authorization": f"Bearer {access}"}
    client = TestClient(app)

    # Revoke = end the still-open (pending) affiliation period before the tech accepts.
    missing_reason = client.post(f"/provider/technicians/{tid}/affiliation/end", json={}, headers=H)
    assert missing_reason.status_code == 422
    revoke = client.post(f"/provider/technicians/{tid}/affiliation/end", json={"reason": "mistake"}, headers=H)
    assert revoke.status_code == 200
    assert revoke.json()["status"] == "ended"


# --- per-provider dispatch phone (channel info + token read) -----------------
def test_channel_info_unknown_slug_is_404():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    assert client.get("/channels/not-a-real-channel").status_code == 404


def test_channel_info_returns_provider_dispatch_phone(monkeypatch):
    from starlette.testclient import TestClient
    from api.main import app, store as app_store

    async def fake_resolve(slug):
        assert slug == "metro-key"
        return {
            "intake_channel_id": "c1",
            "origin_org_id": "o1",
            "customer_owner_org_id": "o1",
            "dispatch_cutover_enabled": True,
            "organization_name": "Metro Key Partners",
            "dispatch_phone": "+15551234567",
        }

    monkeypatch.setattr(app_store, "resolve_intake_channel", fake_resolve)
    client = TestClient(app)
    body = client.get("/channels/metro-key").json()
    # Customer-safe shape only: no internal IDs, no cutover flag.
    assert body == {
        "slug": "metro-key",
        "organization_name": "Metro Key Partners",
        "dispatch_phone": "+15551234567",
    }


def test_token_read_includes_owner_dispatch_phone(monkeypatch):
    from starlette.testclient import TestClient
    from api.main import app, store as app_store

    jid = str(uuid4())
    token = "t" * 43
    app_store._tokens = {jid: token}
    app_store._job_status = {jid: STATUS_PENDING_DISPATCH}

    async def fake_phone(job_id):
        assert str(job_id) == jid
        return "+15559876543"

    monkeypatch.setattr(app_store, "get_customer_owner_phone", fake_phone)
    client = TestClient(app)
    body = client.get(f"/t/{token}").json()
    assert body["dispatch_phone"] == "+15559876543"


# --- per-provider dispatch settings (0025): ack SLA / stalled threshold override --
def test_dispatch_settings_default_before_any_override():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    H = {"Authorization": f"Bearer {access}"}
    client = TestClient(app)

    body = client.get("/provider/settings/dispatch", headers=H).json()
    assert body == {
        "ack_sla_minutes": {"value": 5, "is_override": False, "platform_default": 5},
        "stalled_minutes": {"value": 15, "is_override": False, "platform_default": 15},
    }


def test_dispatch_settings_override_and_clear():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    H = {"Authorization": f"Bearer {access}"}
    client = TestClient(app)

    # Set an override on both fields.
    r = client.patch("/provider/settings/dispatch", json={"ack_sla_minutes": 10, "stalled_minutes": 30}, headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["ack_sla_minutes"] == {"value": 10, "is_override": True, "platform_default": 5}
    assert body["stalled_minutes"] == {"value": 30, "is_override": True, "platform_default": 15}

    # Another org is unaffected (per-org, not global).
    other_org = str(uuid4())
    other_uid = str(uuid4())
    _seed_dispatcher(app_store, other_uid, other_org)
    other_access = create_access_token({"sub": other_uid, "id": other_uid, "roles": ["dispatcher"]})
    other = client.get("/provider/settings/dispatch", headers={"Authorization": f"Bearer {other_access}"}).json()
    assert other["ack_sla_minutes"]["is_override"] is False

    # Clearing one field (explicit null) reverts just that field to the platform default.
    r2 = client.patch("/provider/settings/dispatch", json={"ack_sla_minutes": None}, headers=H)
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["ack_sla_minutes"] == {"value": 5, "is_override": False, "platform_default": 5}
    assert body2["stalled_minutes"]["is_override"] is True  # untouched


def test_dispatch_settings_rejects_ack_above_stalled_and_out_of_range():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    _seed_dispatcher(app_store, uid, org)
    access = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    H = {"Authorization": f"Bearer {access}"}
    client = TestClient(app)

    # ack_sla_minutes (20) > stalled_minutes default (15) -> rejected.
    r = client.patch("/provider/settings/dispatch", json={"ack_sla_minutes": 20}, headers=H)
    assert r.status_code == 422

    # Out of the per-key allowed range.
    r2 = client.patch("/provider/settings/dispatch", json={"stalled_minutes": 5000}, headers=H)
    assert r2.status_code == 422

    # No fields sent at all.
    r3 = client.patch("/provider/settings/dispatch", json={}, headers=H)
    assert r3.status_code == 422


def test_dispatch_settings_requires_dispatch_org():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    # A technician session has no dispatcher/provider_admin role.
    uid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": "techrole2@cluexp.test", "phone": None,
        "display_name": "Tech", "password_hash": "",
        "roles": ["technician"], "active_organization_id": None, "organization_name": None,
    }
    access = create_access_token({"sub": uid, "id": uid, "roles": ["technician"]})
    client = TestClient(app)
    r = client.get("/provider/settings/dispatch", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 403


def test_financial_settings_default_override_and_clear():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    uid = str(uuid4())
    app_store.users[uid] = {
        "id": uid, "email": f"fin_{uid[:8]}@cluexp.test", "phone": None,
        "display_name": "Provider Admin", "password_hash": "",
        "roles": ["provider_admin"], "active_organization_id": org, "organization_name": "Acme",
    }
    access = create_access_token({"sub": uid, "id": uid, "roles": ["provider_admin"]})
    H = {"Authorization": f"Bearer {access}"}
    client = TestClient(app)

    body = client.get("/provider/settings/financial", headers=H).json()
    assert body == {
        "max_line_items": {"value": 20, "is_override": False, "platform_default": 20},
        "tax_rate_basis_points": {"value": 0, "is_override": False, "platform_default": 0},
        "card_fee_basis_points": {"value": 0, "is_override": False, "platform_default": 0},
        "card_fee_fixed_cents": {"value": 0, "is_override": False, "platform_default": 0},
    }

    r = client.patch(
        "/provider/settings/financial",
        json={
            "max_line_items": 30,
            "tax_rate_basis_points": 725,
            "card_fee_basis_points": 290,
            "card_fee_fixed_cents": 30,
        },
        headers=H,
    )
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["max_line_items"] == {"value": 30, "is_override": True, "platform_default": 20}
    assert saved["tax_rate_basis_points"]["value"] == 725
    assert saved["card_fee_basis_points"]["value"] == 290
    assert saved["card_fee_fixed_cents"]["value"] == 30

    cleared = client.patch(
        "/provider/settings/financial",
        json={"card_fee_fixed_cents": None},
        headers=H,
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["card_fee_fixed_cents"] == {"value": 0, "is_override": False, "platform_default": 0}


def test_financial_settings_authz_and_validation():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    dispatcher = str(uuid4())
    _seed_dispatcher(app_store, dispatcher, org)
    dispatcher_access = create_access_token({"sub": dispatcher, "id": dispatcher, "roles": ["dispatcher"]})
    H = {"Authorization": f"Bearer {dispatcher_access}"}
    client = TestClient(app)

    # Dispatchers can read the effective settings but cannot mutate provider financial policy.
    assert client.get("/provider/settings/financial", headers=H).status_code == 200
    assert client.patch("/provider/settings/financial", json={"max_line_items": 10}, headers=H).status_code == 403

    admin = str(uuid4())
    app_store.users[admin] = {
        "id": admin, "email": f"fin_admin_{admin[:8]}@cluexp.test", "phone": None,
        "display_name": "Provider Admin", "password_hash": "",
        "roles": ["provider_admin"], "active_organization_id": org, "organization_name": "Acme",
    }
    admin_access = create_access_token({"sub": admin, "id": admin, "roles": ["provider_admin"]})
    AH = {"Authorization": f"Bearer {admin_access}"}
    assert client.patch("/provider/settings/financial", json={}, headers=AH).status_code == 422
    assert client.patch("/provider/settings/financial", json={"max_line_items": 101}, headers=AH).status_code == 422
    assert client.patch("/provider/settings/financial", json={"tax_rate_basis_points": 2501}, headers=AH).status_code == 422
    assert client.patch("/provider/settings/financial", json={"card_fee_fixed_cents": -1}, headers=AH).status_code == 422


def test_closeout_item_type_catalog_admin_managed():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    admin = _settings_user(app_store, ["platform_admin"])
    dispatcher = _settings_user(app_store, ["dispatcher"])
    client = TestClient(app)

    def hdr(uid, roles):
        return {"Authorization": f"Bearer {create_access_token({'sub': uid, 'id': uid, 'roles': roles})}"}

    public = client.get("/closeout-item-types")
    assert public.status_code == 200
    assert any(row["code"] == "key_code_purchase" for row in public.json()["item_types"])

    denied = client.get("/admin/closeout-item-types", headers=hdr(dispatcher, ["dispatcher"]))
    assert denied.status_code == 403

    listed = client.get("/admin/closeout-item-types", headers=hdr(admin, ["platform_admin"]))
    assert listed.status_code == 200
    key_code = next(row for row in listed.json()["item_types"] if row["code"] == "key_code_purchase")
    assert key_code["requires_provided_by"] is True
    assert key_code["requires_receipt"] is True
    assert key_code["default_compensation_eligible"] is False

    updated = client.put(
        "/admin/closeout-item-types/key_code_purchase",
        json={**key_code, "label": "Key code / PIN purchase", "sort_order": 101},
        headers=hdr(admin, ["platform_admin"]),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["label"] == "Key code / PIN purchase"

    mismatch = client.put(
        "/admin/closeout-item-types/key_code_purchase",
        json={**key_code, "code": "other"},
        headers=hdr(admin, ["platform_admin"]),
    )
    assert mismatch.status_code == 422


# --- self-service account: identity update + password change ----------------
def _seed_full_user(app_store, uid, *, email="orig@cluexp.test", phone=None, password="orig-pw-123"):
    from api.auth import hash_password
    app_store.users[uid] = {
        "id": uid, "email": email, "phone": phone,
        "display_name": "Original Name", "password_hash": hash_password(password),
        "roles": ["dispatcher"], "active_organization_id": str(uuid4()), "organization_name": "Acme",
    }


def test_update_account_changes_identity_fields():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    _seed_full_user(app_store, uid)
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)

    r = client.patch(
        "/auth/me", json={"display_name": "New Name", "email": "new@cluexp.test", "phone": "+15550001111"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["display_name"] == "New Name"
    assert body["email"] == "new@cluexp.test"
    assert body["phone"] == "+15550001111"

    # Untouched field (e.g. re-fetch) reflects the partial update; a field left
    # unset in a follow-up PATCH stays as-is.
    r2 = client.patch("/auth/me", json={"display_name": "Newer Name"}, headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["email"] == "new@cluexp.test"


def test_update_account_rejects_empty_string():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    _seed_full_user(app_store, uid)
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    r = client.patch("/auth/me", json={"display_name": "   "}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 422


def test_update_account_rejects_email_conflict():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid_a, uid_b = str(uuid4()), str(uuid4())
    _seed_full_user(app_store, uid_a, email="taken@cluexp.test")
    _seed_full_user(app_store, uid_b, email="free@cluexp.test")
    token = create_access_token({"sub": uid_b, "id": uid_b, "roles": ["dispatcher"]})
    client = TestClient(app)
    r = client.patch("/auth/me", json={"email": "taken@cluexp.test"}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 409


def test_update_account_requires_auth():
    from starlette.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    r = client.patch("/auth/me", json={"display_name": "X"})
    assert r.status_code == 401


def test_change_password_requires_correct_current_password():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    _seed_full_user(app_store, uid, password="correct-horse-battery")
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    r = client.post(
        "/auth/me/password", json={"current_password": "wrong-password", "new_password": "brand-new-pw-1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_change_password_rejects_short_new_password():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    _seed_full_user(app_store, uid, password="correct-horse-battery")
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    r = client.post(
        "/auth/me/password", json={"current_password": "correct-horse-battery", "new_password": "short"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_change_password_success_then_login_with_new_password():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    uid = str(uuid4())
    _seed_full_user(app_store, uid, email="pwchange@cluexp.test", password="correct-horse-battery")
    token = create_access_token({"sub": uid, "id": uid, "roles": ["dispatcher"]})
    client = TestClient(app)

    r = client.post(
        "/auth/me/password", json={"current_password": "correct-horse-battery", "new_password": "new-password-99"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json() == {"status": "updated"}

    # Old password no longer works; new one does (proves the hash was actually
    # replaced, not just accepted-and-discarded).
    old_login = client.post("/auth/login", json={"identifier": "pwchange@cluexp.test", "password": "correct-horse-battery"})
    assert old_login.status_code == 401
    new_login = client.post("/auth/login", json={"identifier": "pwchange@cluexp.test", "password": "new-password-99"})
    assert new_login.status_code == 200


# ---------------------------------------------------------------------------
# Console: platform-wide company/technician directories, tenant limits, and
# provider self-service users. See docs/CONSOLE-WEB-SCOPE-PLAN.md.
# ---------------------------------------------------------------------------

def _seed_platform_admin(app_store, uid):
    app_store.users[uid] = {
        "id": uid, "email": f"admin_{uid[:8]}@cluexp.test", "phone": None,
        "display_name": "Console Admin", "password_hash": "",
        "roles": ["platform_admin"], "active_organization_id": None, "organization_name": None,
    }


def test_admin_org_and_tech_directories_require_platform_admin():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    dispatcher_uid = str(uuid4())
    _seed_dispatcher(app_store, dispatcher_uid, org)
    dispatcher_token = create_access_token({"sub": dispatcher_uid, "id": dispatcher_uid, "roles": ["dispatcher"]})
    client = TestClient(app)

    routes = [
        ("GET", "/admin/organizations"),
        ("GET", f"/admin/organizations/{org}"),
        ("GET", f"/admin/organizations/{org}/limits"),
        ("GET", "/admin/technicians"),
        ("GET", f"/admin/technicians/{uuid4()}"),
    ]
    for method, path in routes:
        unauth = client.request(method, path)
        assert unauth.status_code == 401, path
        forbidden = client.request(method, path, headers={"Authorization": f"Bearer {dispatcher_token}"})
        assert forbidden.status_code == 403, path

    admin_uid = str(uuid4())
    _seed_platform_admin(app_store, admin_uid)
    admin_token = create_access_token({"sub": admin_uid, "id": admin_uid, "roles": ["platform_admin"]})
    H = {"Authorization": f"Bearer {admin_token}"}
    # In-memory store has no organizations/technicians table (Postgres-only
    # directory, matching the existing list_pending_registrations convention);
    # the point here is the permission gate + graceful empty response.
    assert client.get("/admin/organizations", headers=H).json() == {"organizations": []}
    assert client.get("/admin/technicians", headers=H).json() == {"technicians": []}
    assert client.get(f"/admin/organizations/{org}", headers=H).status_code == 404
    assert client.get(f"/admin/technicians/{uuid4()}", headers=H).status_code == 404


def test_admin_users_directories_require_platform_admin():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    dispatcher_uid = str(uuid4())
    _seed_dispatcher(app_store, dispatcher_uid, str(uuid4()))
    dispatcher_token = create_access_token({"sub": dispatcher_uid, "id": dispatcher_uid, "roles": ["dispatcher"]})
    client = TestClient(app)
    other_uid = str(uuid4())

    get_routes = [
        ("GET", "/admin/users"),
        ("GET", "/admin/users?scope=platform"),
        ("GET", f"/admin/users/{other_uid}"),
    ]
    mutate_routes = [
        ("PATCH", f"/admin/users/{other_uid}", {"display_name": "New Name"}),
        ("POST", f"/admin/users/{other_uid}/suspend", {"reason": "left the company"}),
        ("POST", f"/admin/users/{other_uid}/reactivate", {}),
        ("DELETE", f"/admin/users/{other_uid}", {"reason": "duplicate entry"}),
        ("POST", "/admin/users", {"display_name": "New Admin", "password": "supersecret1", "email": "new-admin@cluexp.test"}),
    ]
    for method, path in get_routes:
        unauth = client.request(method, path)
        assert unauth.status_code == 401, path
        forbidden = client.request(method, path, headers={"Authorization": f"Bearer {dispatcher_token}"})
        assert forbidden.status_code == 403, path
    for method, path, body in mutate_routes:
        unauth = client.request(method, path, json=body)
        assert unauth.status_code == 401, path
        forbidden = client.request(method, path, json=body, headers={"Authorization": f"Bearer {dispatcher_token}"})
        assert forbidden.status_code == 403, path

    admin_uid = str(uuid4())
    _seed_platform_admin(app_store, admin_uid)
    admin_token = create_access_token({"sub": admin_uid, "id": admin_uid, "roles": ["platform_admin"]})
    H = {"Authorization": f"Bearer {admin_token}"}
    # In-memory store has no cross-org user directory (Postgres-only, same
    # convention as the organizations/technicians directories above); the
    # point here is the permission gate + graceful empty/404 response.
    assert client.get("/admin/users", headers=H).json() == {"users": []}
    assert client.get("/admin/users?scope=platform", headers=H).json() == {"users": []}
    assert client.get("/admin/users?scope=bogus", headers=H).status_code == 422
    assert client.get(f"/admin/users/{other_uid}", headers=H).status_code == 404
    assert client.patch(f"/admin/users/{other_uid}", json={"display_name": "New Name"}, headers=H).status_code == 404
    assert client.post(f"/admin/users/{other_uid}/reactivate", json={}, headers=H).status_code == 404
    # Suspend/delete require a reason before anything else runs.
    assert client.post(f"/admin/users/{other_uid}/suspend", json={}, headers=H).status_code == 422
    assert client.request("DELETE", f"/admin/users/{other_uid}", json={}, headers=H).status_code == 422
    # A platform admin can never suspend or delete their own account.
    self_suspend = client.post(f"/admin/users/{admin_uid}/suspend", json={"reason": "testing"}, headers=H)
    assert self_suspend.status_code == 409
    self_delete = client.request("DELETE", f"/admin/users/{admin_uid}", json={"reason": "testing"}, headers=H)
    assert self_delete.status_code == 409


def test_admin_can_suspend_and_reactivate_technician():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    admin_uid = str(uuid4())
    tech_id = str(uuid4())
    _seed_platform_admin(app_store, admin_uid)
    app_store._technicians = [{
        "id": tech_id,
        "display_name": "Riley Harper",
        "status": "active",
        "vetting_status": "verified",
        "is_available": True,
    }]
    token = create_access_token({"sub": admin_uid, "id": admin_uid, "roles": ["platform_admin"]})
    H = {"Authorization": f"Bearer {token}"}
    client = TestClient(app)

    missing_reason = client.post(f"/admin/technicians/{tech_id}/suspend", json={}, headers=H)
    assert missing_reason.status_code == 422

    suspended = client.post(f"/admin/technicians/{tech_id}/suspend", json={"reason": "expired insurance"}, headers=H)
    assert suspended.status_code == 200, suspended.text
    assert suspended.json()["status"] == "suspended"
    assert suspended.json()["reason"] == "expired insurance"
    assert app_store._technicians[0]["is_available"] is False
    events = asyncio.run(app_store.list_governance_events("technician", UUID(tech_id)))
    assert events[0]["action"] == "suspend"
    assert events[0]["reason"] == "expired insurance"
    assert events[0]["actor_id"] == admin_uid

    reactivated = client.post(f"/admin/technicians/{tech_id}/reactivate", json={}, headers=H)
    assert reactivated.status_code == 200, reactivated.text
    assert reactivated.json()["status"] == "active"


def test_admin_delete_archives_referenced_technician():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    admin_uid = str(uuid4())
    tech_id = str(uuid4())
    org_id = str(uuid4())
    _seed_platform_admin(app_store, admin_uid)
    app_store._technicians = [{
        "id": tech_id,
        "display_name": "Riley Harper",
        "status": "active",
        "vetting_status": "verified",
        "is_available": True,
    }]
    app_store._affiliations = [{
        "id": str(uuid4()),
        "organization_id": org_id,
        "technician_id": tech_id,
        "status": "active",
        "ended_at": None,
    }]
    token = create_access_token({"sub": admin_uid, "id": admin_uid, "roles": ["platform_admin"]})
    H = {"Authorization": f"Bearer {token}"}
    client = TestClient(app)

    missing_reason = client.request("DELETE", f"/admin/technicians/{tech_id}", json={}, headers=H)
    assert missing_reason.status_code == 422

    archived = client.request("DELETE", f"/admin/technicians/{tech_id}", json={"reason": "duplicate profile"}, headers=H)
    assert archived.status_code == 200, archived.text
    body = archived.json()
    assert body["action"] == "archived"
    assert body["status"] == "archived"
    assert app_store._technicians[0]["status"] == "archived"
    assert app_store._technicians[0]["is_available"] is False
    events = asyncio.run(app_store.list_governance_events("technician", UUID(tech_id)))
    assert events[0]["action"] == "archive"
    assert events[0]["reason"] == "duplicate profile"
    assert events[0]["metadata"]["references"] == body["references"]


def test_admin_organization_limits_default_then_override_then_clear():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    admin_uid = str(uuid4())
    _seed_platform_admin(app_store, admin_uid)
    token = create_access_token({"sub": admin_uid, "id": admin_uid, "roles": ["platform_admin"]})
    H = {"Authorization": f"Bearer {token}"}
    client = TestClient(app)

    # No override yet: both limits inherit the platform default (5).
    got = client.get(f"/admin/organizations/{org}/limits", headers=H)
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["max_users"] == {"value": 5, "is_override": False, "platform_default": 5}
    assert body["max_technicians"] == {"value": 5, "is_override": False, "platform_default": 5}

    # Override max_technicians to 2.
    patched = client.patch(f"/admin/organizations/{org}/limits", json={"max_technicians": 2}, headers=H)
    assert patched.status_code == 200, patched.text
    assert patched.json()["max_technicians"] == {"value": 2, "is_override": True, "platform_default": 5}
    assert patched.json()["max_users"]["is_override"] is False

    # Out-of-range value is rejected (SettingSpec range 1-500).
    bad = client.patch(f"/admin/organizations/{org}/limits", json={"max_users": 0}, headers=H)
    assert bad.status_code == 422

    # Clearing (null) reverts to the platform default.
    cleared = client.patch(f"/admin/organizations/{org}/limits", json={"max_technicians": None}, headers=H)
    assert cleared.status_code == 200
    assert cleared.json()["max_technicians"] == {"value": 5, "is_override": False, "platform_default": 5}


def test_provider_technician_invite_blocked_at_org_limit():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    admin_uid, dispatcher_uid = str(uuid4()), str(uuid4())
    _seed_platform_admin(app_store, admin_uid)
    _seed_dispatcher(app_store, dispatcher_uid, org)
    admin_token = create_access_token({"sub": admin_uid, "id": admin_uid, "roles": ["platform_admin"]})
    dispatcher_token = create_access_token({"sub": dispatcher_uid, "id": dispatcher_uid, "roles": ["dispatcher"]})
    client = TestClient(app)

    # Console caps this org at 1 technician.
    limits = client.patch(
        f"/admin/organizations/{org}/limits", json={"max_technicians": 1},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert limits.status_code == 200, limits.text

    H = {"Authorization": f"Bearer {dispatcher_token}"}
    first = client.post("/provider/technicians/invite", json={"email": "first@example.com"}, headers=H)
    assert first.status_code == 200, first.text

    second = client.post("/provider/technicians/invite", json={"email": "second@example.com"}, headers=H)
    assert second.status_code == 409
    assert "limit" in second.json()["detail"].lower()


def test_provider_users_list_add_and_limit():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    admin_uid, dispatcher_uid, provider_admin_uid = str(uuid4()), str(uuid4()), str(uuid4())
    _seed_platform_admin(app_store, admin_uid)
    _seed_dispatcher(app_store, dispatcher_uid, org)
    app_store.users[provider_admin_uid] = {
        "id": provider_admin_uid, "email": f"padmin_{provider_admin_uid[:8]}@cluexp.test", "phone": None,
        "display_name": "Provider Admin", "password_hash": "",
        "roles": ["provider_admin"], "active_organization_id": org, "organization_name": "Acme",
    }
    admin_token = create_access_token({"sub": admin_uid, "id": admin_uid, "roles": ["platform_admin"]})
    dispatcher_token = create_access_token({"sub": dispatcher_uid, "id": dispatcher_uid, "roles": ["dispatcher"]})
    provider_admin_token = create_access_token({"sub": provider_admin_uid, "id": provider_admin_uid, "roles": ["provider_admin"]})
    client = TestClient(app)

    # The seeded dispatcher and provider admin already occupy user slots.
    listed = client.get("/provider/users", headers={"Authorization": f"Bearer {dispatcher_token}"})
    assert listed.status_code == 200
    assert len(listed.json()["users"]) == 2

    # Dispatchers can view the roster but cannot create users or escalate peers
    # into provider admins.
    forbidden = client.post(
        "/provider/users",
        json={"display_name": "Nope", "email": "nope@example.com", "password": "longenough1"},
        headers={"Authorization": f"Bearer {dispatcher_token}"},
    )
    assert forbidden.status_code == 403

    # Console caps this org at 2 users — the seeded dispatcher/admin already fill it.
    limits = client.patch(
        f"/admin/organizations/{org}/limits", json={"max_users": 2},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert limits.status_code == 200, limits.text

    blocked = client.post(
        "/provider/users",
        json={"display_name": "New Dispatcher", "email": "newdispatcher@example.com", "password": "longenough1"},
        headers={"Authorization": f"Bearer {provider_admin_token}"},
    )
    assert blocked.status_code == 409
    assert "limit" in blocked.json()["detail"].lower()

    # Raise the cap; the same request now succeeds and shows up in the roster.
    client.patch(
        f"/admin/organizations/{org}/limits", json={"max_users": 3},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    added = client.post(
        "/provider/users",
        json={"display_name": "New Dispatcher", "email": "newdispatcher@example.com", "password": "longenough1"},
        headers={"Authorization": f"Bearer {provider_admin_token}"},
    )
    assert added.status_code == 200, added.text
    assert added.json()["role"] == "dispatcher"
    listed_again = client.get("/provider/users", headers={"Authorization": f"Bearer {dispatcher_token}"})
    assert len(listed_again.json()["users"]) == 3

    # An invalid role is rejected before touching the store.
    bad_role = client.post(
        "/provider/users",
        json={"display_name": "X", "email": "badrole@example.com", "password": "longenough1", "role": "owner"},
        headers={"Authorization": f"Bearer {provider_admin_token}"},
    )
    assert bad_role.status_code == 422

    # A duplicate email is rejected.
    dup = client.post(
        "/provider/users",
        json={"display_name": "Dup", "email": "newdispatcher@example.com", "password": "longenough1"},
        headers={"Authorization": f"Bearer {provider_admin_token}"},
    )
    assert dup.status_code == 409


def test_admin_org_and_tech_create_endpoints_gate_on_platform_admin():
    from starlette.testclient import TestClient
    from api.main import app, store as app_store
    from api.auth import create_access_token

    org = str(uuid4())
    dispatcher_uid = str(uuid4())
    _seed_dispatcher(app_store, dispatcher_uid, org)
    dispatcher_token = create_access_token({"sub": dispatcher_uid, "id": dispatcher_uid, "roles": ["dispatcher"]})
    client = TestClient(app)

    # Registration itself requires Postgres (same as public self-signup in this
    # codebase); here we only assert the permission gate runs before any store
    # call, so a non-admin never reaches it.
    org_payload = {
        "organization_name": "New Co", "admin_display_name": "Admin", "admin_email": "new@co.example",
        "password": "longenough1",
    }
    tech_payload = {"display_name": "New Tech", "email": "newtech@example.com", "password": "longenough1"}

    assert client.post("/admin/organizations", json=org_payload).status_code == 401
    assert client.post("/admin/organizations", json=org_payload,
                        headers={"Authorization": f"Bearer {dispatcher_token}"}).status_code == 403
    assert client.post("/admin/technicians", json=tech_payload).status_code == 401
    assert client.post("/admin/technicians", json=tech_payload,
                        headers={"Authorization": f"Bearer {dispatcher_token}"}).status_code == 403
