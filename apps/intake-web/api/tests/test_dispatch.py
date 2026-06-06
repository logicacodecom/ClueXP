"""Unit tests for the dispatch tracking contract.

Pure-function tests for the state machine + policy selection + ETA, plus a few
InMemory-store tests asserting the customer-safe invariants (no candidate leak
before acceptance, polling never creates offers). Run from apps/intake-web:

    cd apps/intake-web && pytest api/tests
"""
from __future__ import annotations

import asyncio

from api.dispatch import (
    POLICY_NETWORK_OPEN,
    POLICY_OWNER_FIRST,
    POLICY_PRIVATE,
    eta_range_from_km,
    is_terminal,
    normalize_policy,
    resolve_dispatch_state,
    select_candidates,
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
