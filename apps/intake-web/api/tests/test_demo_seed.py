"""Smoke tests for the demo seed/reset data (pure — no database required).

These guard the demo brief's hard requirements without a live DB:
- the skill vocabulary is exactly the dispatch vocabulary (no `car` vs `vehicle`);
- every demo job's `detail` payload rehydrates as a valid Ticket;
- the dispatch engine actually matches a Florida "vehicle" job to a Florida tech
  (the regression the brief calls out), and would NOT if `car` were stored;
- the seed identifiers are stable (so reseeding upserts instead of duplicating).
"""
from __future__ import annotations

import pytest

from api import demo_seed
from api.dispatch import rank_candidates
from api.schema import AccessType, Ticket


def test_skill_vocabulary_is_dispatch_vocabulary():
    # Canonical skills == dispatchable access-type values (home/business/vehicle).
    assert demo_seed.VALID_SKILLS == {
        AccessType.HOME.value,
        AccessType.BUSINESS.value,
        AccessType.CAR.value,
    }
    assert "car" not in demo_seed.VALID_SKILLS
    assert "vehicle" in demo_seed.VALID_SKILLS


def test_normalize_skill_maps_car_alias_to_vehicle():
    assert demo_seed.normalize_skill("car") == "vehicle"
    assert demo_seed.normalize_skill("auto") == "vehicle"
    assert demo_seed.normalize_skill("VEHICLE") == "vehicle"
    assert demo_seed.normalize_skill("commercial") == "business"
    assert demo_seed.normalize_skill("residential") == "home"
    with pytest.raises(ValueError):
        demo_seed.normalize_skill("spaceship")


def test_technician_skills_are_all_canonical():
    for tech in demo_seed.FLORIDA_TECHNICIANS:
        for skill in demo_seed.normalize_skills(tech["skills"]):
            assert skill in demo_seed.VALID_SKILLS


def test_demo_jobs_build_valid_tickets_with_canonical_access():
    for job in demo_seed.FLORIDA_DEMO_JOBS:
        ticket = demo_seed.build_demo_ticket(job)
        assert isinstance(ticket, Ticket)
        # access_type value never leaks the "car" alias.
        assert ticket.access_type.value in demo_seed.VALID_SKILLS
        # round-trips through the persisted form.
        Ticket.model_validate(ticket.model_dump(mode="json"))


def _tech_row(tech: dict) -> dict:
    """Shape a Florida technician like list_available_technicians returns."""
    return {
        "is_available": True,
        "skills": demo_seed.normalize_skills(tech["skills"]),
        "service_area_center_lat": tech["lat"],
        "service_area_center_lng": tech["lng"],
        "service_area_radius_km": demo_seed.TAMPA_RADIUS_KM,
        "rating": tech["rating"],
    }


def test_vehicle_job_matches_a_vehicle_technician():
    techs = [_tech_row(t) for t in demo_seed.FLORIDA_TECHNICIANS]
    car_job = next(j for j in demo_seed.FLORIDA_DEMO_JOBS if j["ref"] == "florida-job-2")
    job = {
        "access_type": demo_seed.normalize_skill(car_job["access_type"]),  # "vehicle"
        "lat": car_job["lat"],
        "lng": car_job["lng"],
    }
    ranked = rank_candidates(job, techs)
    assert ranked, "a vehicle job must match at least one vehicle technician"
    assert all("vehicle" in c["skills"] for c in ranked)


def test_car_vocabulary_would_not_match_proving_normalization_matters():
    """If we (wrongly) stored the job access as 'car', dispatch would find nobody —
    which is exactly why normalize_skill exists."""
    techs = [_tech_row(t) for t in demo_seed.FLORIDA_TECHNICIANS]
    bad_job = {"access_type": "car", "lat": 27.9555, "lng": -82.5240}
    assert rank_candidates(bad_job, techs) == []


def test_seed_identifiers_are_stable():
    assert demo_seed.FLORIDA_SLUG == "florida-locksmith"
    refs = [j["ref"] for j in demo_seed.FLORIDA_DEMO_JOBS]
    assert refs == sorted(refs)  # deterministic order
    assert len(set(refs)) == len(refs)  # unique markers
    emails = [t["email"] for t in demo_seed.FLORIDA_TECHNICIANS]
    assert len(set(emails)) == len(emails)  # unique → upsert, no dupes
    assert all(e.endswith("@florida-locksmith.demo") for e in emails)
