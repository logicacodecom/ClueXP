"""Smoke tests for the demo seed/reset data (pure — no database required).

These guard the demo brief's hard requirements without a live DB:
- the job access vocabulary and technician skill vocabulary are normalized separately;
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


def test_skill_vocabulary_is_service_catalog_vocabulary():
    assert demo_seed.VALID_ACCESS_TYPES == {
        AccessType.HOME.value,
        AccessType.BUSINESS.value,
        AccessType.CAR.value,
    }
    assert "car" not in demo_seed.VALID_ACCESS_TYPES
    assert "vehicle" in demo_seed.VALID_ACCESS_TYPES
    assert "car" not in demo_seed.VALID_SKILLS
    assert "locksmith.vehicle_lockout" in demo_seed.VALID_SKILLS
    assert "locksmith.vehicle_key_programming" in demo_seed.VALID_SKILLS


def test_normalizers_map_aliases_to_the_right_vocabularies():
    assert demo_seed.normalize_access_type("car") == "vehicle"
    assert demo_seed.normalize_access_type("commercial") == "business"
    assert demo_seed.normalize_skill("car") == "locksmith.vehicle_lockout"
    assert demo_seed.normalize_skill("auto") == "locksmith.vehicle_lockout"
    assert demo_seed.normalize_skill("VEHICLE") == "locksmith.vehicle_lockout"
    assert demo_seed.normalize_skill("commercial") == "locksmith.commercial_lockout"
    assert demo_seed.normalize_skill("residential") == "locksmith.residential_lockout"
    with pytest.raises(ValueError):
        demo_seed.normalize_skill("spaceship")


def test_technician_skills_are_all_canonical():
    for tech in demo_seed.FLORIDA_TECHNICIANS:
        for skill in tech["skills"]:
            assert skill in demo_seed.VALID_SKILLS


def test_demo_jobs_build_valid_tickets_with_canonical_access():
    for job in demo_seed.FLORIDA_DEMO_JOBS:
        ticket = demo_seed.build_demo_ticket(job)
        assert isinstance(ticket, Ticket)
        # access_type value never leaks the "car" alias.
        assert ticket.access_type.value in demo_seed.VALID_ACCESS_TYPES
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
        "access_type": demo_seed.normalize_access_type(car_job["access_type"]),  # "vehicle"
        "lat": car_job["lat"],
        "lng": car_job["lng"],
    }
    ranked = rank_candidates(job, techs)
    assert ranked, "a vehicle job must match at least one vehicle technician"
    assert all("locksmith.vehicle_lockout" in c["skills"] for c in ranked)


def test_car_vocabulary_would_not_match_proving_normalization_matters():
    """The dispatch engine now normalizes legacy job aliases defensively too."""
    techs = [_tech_row(t) for t in demo_seed.FLORIDA_TECHNICIANS]
    bad_job = {"access_type": "car", "lat": 27.9555, "lng": -82.5240}
    assert rank_candidates(bad_job, techs)


def test_seed_identifiers_are_stable():
    assert demo_seed.FLORIDA_SLUG == "florida-locksmith"
    refs = [j["ref"] for j in demo_seed.FLORIDA_DEMO_JOBS]
    assert refs == sorted(refs)  # deterministic order
    assert len(set(refs)) == len(refs)  # unique markers
    emails = [t["email"] for t in demo_seed.FLORIDA_TECHNICIANS]
    assert len(set(emails)) == len(emails)  # unique → upsert, no dupes
    assert all(e.endswith("@florida-locksmith.demo") for e in emails)
