"""Unit tests for the Network Router MVP (Tier 2). Pure function, no I/O."""
from __future__ import annotations

from api.dispatch import (
    ROUTING_REASON_NOT_ELIGIBLE,
    ROUTING_REASON_ORG_INELIGIBLE,
    ROUTING_REASON_SELECTED,
    route_network_request,
)


def _tech(tech_id: str, *, org_ids: list[str] | None = None, lat: float = 40.0, lng: float = -73.0, rating: float = 4.5) -> dict:
    return {
        "id": tech_id,
        "is_available": True,
        "skills": ["locksmith.residential_lockout"],
        "service_area_center_lat": lat,
        "service_area_center_lng": lng,
        "service_area_radius_km": 25,
        "rating": rating,
        "org_ids": org_ids or [],
    }


_JOB = {"access_type": "locksmith.residential_lockout", "lat": 40.0, "lng": -73.0}


def test_unaffiliated_individual_technician_is_eligible_without_any_org():
    result = route_network_request(
        _JOB, [_tech("solo-1")],
        skill_needed="locksmith.residential_lockout", org_status={}, org_capabilities={},
    )
    assert result["selected_technician_id"] == "solo-1"
    assert result["considered"] == [{"technician_id": "solo-1", "reason_code": ROUTING_REASON_SELECTED}]


def test_org_affiliated_technician_requires_active_org_and_capability():
    inactive_org = _tech("tech-inactive-org", org_ids=["org-a"])
    no_capability = _tech("tech-no-capability", org_ids=["org-b"])
    eligible = _tech("tech-eligible", org_ids=["org-c"], lat=40.001, lng=-73.001)

    result = route_network_request(
        _JOB, [inactive_org, no_capability, eligible],
        skill_needed="locksmith.residential_lockout",
        org_status={"org-a": "suspended", "org-b": "active", "org-c": "active"},
        org_capabilities={"org-c": {"locksmith.residential_lockout"}},
    )

    by_id = {c["technician_id"]: c["reason_code"] for c in result["considered"]}
    assert by_id["tech-inactive-org"] == ROUTING_REASON_ORG_INELIGIBLE
    assert by_id["tech-no-capability"] == ROUTING_REASON_ORG_INELIGIBLE
    assert by_id["tech-eligible"] == ROUTING_REASON_SELECTED
    assert result["selected_technician_id"] == "tech-eligible"


def test_deterministic_ranking_prefers_nearest_among_eligible():
    far = _tech("far", org_ids=["org-a"], lat=41.0, lng=-74.0)
    near = _tech("near", org_ids=["org-a"], lat=40.001, lng=-73.001)

    result = route_network_request(
        _JOB, [far, near],
        skill_needed="locksmith.residential_lockout",
        org_status={"org-a": "active"},
        org_capabilities={"org-a": {"locksmith.residential_lockout"}},
    )

    assert result["selected_technician_id"] == "near"
    by_id = {c["technician_id"]: c["reason_code"] for c in result["considered"]}
    assert by_id["far"] == ROUTING_REASON_NOT_ELIGIBLE
    assert by_id["near"] == ROUTING_REASON_SELECTED


def test_no_eligible_technician_selects_nothing():
    result = route_network_request(
        _JOB, [_tech("tech-a", org_ids=["org-a"])],
        skill_needed="locksmith.residential_lockout",
        org_status={"org-a": "suspended"},
        org_capabilities={},
    )
    assert result["selected_technician_id"] is None
    assert result["considered"] == [{"technician_id": "tech-a", "reason_code": ROUTING_REASON_ORG_INELIGIBLE}]


def test_technician_affiliated_with_any_eligible_org_among_several_is_eligible():
    # Multi-org affiliation: only one of the technician's orgs needs to qualify.
    tech = _tech("multi-org-tech", org_ids=["org-suspended", "org-active"])
    result = route_network_request(
        _JOB, [tech],
        skill_needed="locksmith.residential_lockout",
        org_status={"org-suspended": "suspended", "org-active": "active"},
        org_capabilities={"org-active": {"locksmith.residential_lockout"}},
    )
    assert result["selected_technician_id"] == "multi-org-tech"


def test_no_skill_needed_skips_capability_gate_but_still_requires_active_org():
    active_no_cap = _tech("active-no-cap", org_ids=["org-a"])
    suspended = _tech("suspended", org_ids=["org-b"])

    result = route_network_request(
        _JOB, [active_no_cap, suspended],
        skill_needed=None,
        org_status={"org-a": "active", "org-b": "suspended"},
        org_capabilities={},
    )
    assert result["selected_technician_id"] == "active-no-cap"
