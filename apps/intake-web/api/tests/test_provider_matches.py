"""POST /v1/provider-matches -- AI-assistant provider discovery (specs/003 phase 1)."""
from __future__ import annotations

import asyncio
import logging
from urllib.parse import parse_qs, urlsplit

import pytest
from starlette.testclient import TestClient

from api import geocode as geocode_module
from api.store import InMemoryStore

SKILL = "locksmith.residential_lockout"
ADDRESS = "221 King St W, Toronto"


@pytest.fixture
def app(monkeypatch):
    from api import main

    store = InMemoryStore()
    monkeypatch.setattr(main, "store", store)

    async def no_latency() -> None:
        return None

    monkeypatch.setattr(main, "latency", no_latency)
    external = asyncio.run(
        store.create_external_client(
            name="MCP", client_type="agent", scopes=["providers:search"], rate_limit_per_minute=600,
        )
    )
    key = asyncio.run(store.issue_external_api_key(external["id"], scopes=["providers:search"]))["api_key"]
    return main, store, TestClient(main.app), {"X-API-Key": key}, external


def _org(store, org_id, *, status="active", skills=(SKILL,), listed=True, slug=None, name=None):
    store._organizations[org_id] = {"id": org_id, "display_name": name or org_id.title(), "status": status}
    store._organization_capabilities[org_id] = set(skills)
    store._intake_channels.append({
        "organization_id": org_id, "slug": slug or org_id, "display_name": None,
        "active": True, "ai_assistant_listed": listed,
    })


def _tech(tech_id, org_ids, *, lat=40.0, lng=-73.0, rating=4.8):
    return {
        "id": tech_id, "display_name": tech_id, "skills": [SKILL], "is_available": True,
        "status": "active", "vetting_status": "verified",
        "service_area_center_lat": lat, "service_area_center_lng": lng,
        "service_area_radius_km": 25, "org_ids": list(org_ids), "rating": rating,
    }


def _search(client, headers, **body):
    return client.post("/v1/provider-matches", headers=headers, json={"service_skill": SKILL, **body})


def test_requires_providers_search_scope(app):
    main, store, client, _, _ = app
    other = asyncio.run(store.create_external_client(
        name="Other", client_type="agent", scopes=["coverage:check"], rate_limit_per_minute=60,
    ))
    key = asyncio.run(store.issue_external_api_key(other["id"], scopes=["coverage:check"]))["api_key"]
    response = _search(client, {"X-API-Key": key}, lat=40.0, lng=-73.0)
    assert response.status_code == 403
    assert response.json()["error"] == "insufficient_scope"


def test_lists_only_opted_in_active_capable_providers(app):
    _, store, client, headers, _ = app
    _org(store, "listed-co")
    _org(store, "unlisted-co", listed=False)
    _org(store, "suspended-co", status="suspended")
    _org(store, "incapable-co", skills=())
    store._technicians = [
        _tech("t1", ["listed-co"]), _tech("t2", ["unlisted-co"]),
        _tech("t3", ["suspended-co"]), _tech("t4", ["incapable-co"]),
        _tech("solo", []),  # unaffiliated: eligible for routing, never listed
    ]

    response = _search(client, headers, lat=40.0, lng=-73.0)

    assert response.status_code == 200
    assert [p["name"] for p in response.json()["data"]["providers"]] == ["Listed-Co"]


def test_multi_org_technician_never_admits_an_ineligible_listed_org(app):
    _, store, client, headers, _ = app
    _org(store, "eligible-unlisted", listed=False)
    _org(store, "suspended-listed", status="suspended")
    _org(store, "incapable-listed", skills=())
    store._technicians = [_tech("t1", ["eligible-unlisted", "suspended-listed", "incapable-listed"])]

    response = _search(client, headers, lat=40.0, lng=-73.0)

    assert response.json()["data"]["providers"] == []


def test_null_org_platform_channel_is_never_listed(app):
    _, store, client, headers, _ = app
    store._intake_channels.append({
        "organization_id": None, "slug": "cluexp", "display_name": "ClueXP",
        "active": True, "ai_assistant_listed": True,
    })
    store._technicians = [_tech("solo", [])]

    assert _search(client, headers, lat=40.0, lng=-73.0).json()["data"]["providers"] == []


def test_router_order_dedup_cap_and_recommended_flag(app):
    _, store, client, headers, _ = app
    for org in ("near", "mid", "far", "farthest"):
        _org(store, org)
    store._technicians = [
        _tech("far-1", ["far"], lat=40.10), _tech("near-1", ["near"], lat=40.00),
        _tech("near-2", ["near"], lat=40.01), _tech("mid-1", ["mid"], lat=40.05),
        _tech("farthest-1", ["farthest"], lat=40.15),
    ]

    providers = _search(client, headers, lat=40.0, lng=-73.0).json()["data"]["providers"]

    assert [p["name"] for p in providers] == ["Near", "Mid", "Far"]
    assert [p["recommended"] for p in providers] == [True, False, False]


def test_response_allow_list_fragment_link_and_private_audit(app):
    _, store, client, headers, _ = app
    _org(store, "abc", slug="abc-locksmith", name="ABC Locksmith")
    store._technicians = [_tech("secret-tech-id", ["abc"])]

    response = _search(client, headers, lat=40.0, lng=-73.0)

    provider = response.json()["data"]["providers"][0]
    assert set(provider) == {"name", "recommended", "intake_url"}
    assert "secret-tech-id" not in response.text and "rating" not in response.text
    url = urlsplit(provider["intake_url"])
    assert url.path == "/o/abc-locksmith" and url.query == ""
    prefill = parse_qs(url.fragment)
    assert prefill["skill"] == [SKILL] and prefill["src"] == ["ai_assistant"]
    event = store._external_api_events[-1]
    assert event["action"] == "provider_matches.search"
    assert event["metadata"] == {"service_skill": SKILL, "outcome": "matched", "result_count": 1}


@pytest.mark.parametrize("body", [
    {"address": ADDRESS, "lat": 40.0, "lng": -73.0},
    {"lat": 40.0},
    {},
    {"address": "  "},
])
def test_requires_exactly_one_location(app, body):
    _, _, client, headers, _ = app
    response = _search(client, headers, **body)
    assert response.status_code == 422
    assert response.json()["error"] == "invalid_request"


def _geo(location_type="ROOFTOP", *, partial=False, address="221 King St W, Toronto, ON", lat=43.6, lng=-79.4):
    return {"formatted_address": address, "lat": lat, "lng": lng,
            "location_type": location_type, "partial_match": partial}


@pytest.mark.parametrize("candidates,status,error", [
    ({"status": "OK", "results": [_geo(), _geo(address="221 King St W, Hamilton, ON")]}, 422, "address_ambiguous"),
    ({"status": "OK", "results": [_geo(partial=True)]}, 422, "address_ambiguous"),
    ({"status": "OK", "results": [_geo("APPROXIMATE")]}, 422, "address_imprecise"),
    ({"status": "OK", "results": [_geo("GEOMETRIC_CENTER")]}, 422, "address_imprecise"),
    ({"status": "ZERO_RESULTS", "results": []}, 422, "address_not_found"),
    ({"status": "OVER_QUERY_LIMIT", "results": []}, 503, "geocoding_unavailable"),
    ({"status": "UNAVAILABLE", "results": []}, 503, "geocoding_unavailable"),
])
def test_address_acceptance_rule_rejects_without_guessing(app, monkeypatch, caplog, candidates, status, error):
    main, store, client, headers, _ = app
    _org(store, "abc")
    store._technicians = [_tech("t1", ["abc"], lat=43.6, lng=-79.4)]

    async def fake_candidates(address):
        return candidates

    monkeypatch.setattr(main, "geocode_candidates", fake_candidates)
    with caplog.at_level(logging.DEBUG):
        response = _search(client, headers, address=ADDRESS)

    assert response.status_code == status
    assert response.json()["error"] == error
    assert "providers" not in response.text
    if error == "address_ambiguous" and len(candidates["results"]) > 1:
        assert response.json()["candidates"] == [r["formatted_address"] for r in candidates["results"]]
    event = store._external_api_events[-1]
    assert event["metadata"] == {"service_skill": SKILL, "outcome": error, "result_count": 0}
    assert ADDRESS not in caplog.text and ADDRESS not in str(store._external_api_events)


def test_precise_single_address_is_accepted(app, monkeypatch, caplog):
    main, store, client, headers, _ = app
    _org(store, "abc")
    store._technicians = [_tech("t1", ["abc"], lat=43.6, lng=-79.4)]

    async def fake_candidates(address):
        return {"status": "OK", "results": [_geo("RANGE_INTERPOLATED")]}

    monkeypatch.setattr(main, "geocode_candidates", fake_candidates)
    with caplog.at_level(logging.DEBUG):
        response = _search(client, headers, address=ADDRESS)

    data = response.json()["data"]
    assert response.status_code == 200
    assert data["matched_location"]["formatted_address"] == "221 King St W, Toronto, ON"
    assert parse_qs(urlsplit(data["providers"][0]["intake_url"]).fragment)["address"] == [
        "221 King St W, Toronto, ON"
    ]
    assert "King St" not in caplog.text and "King St" not in str(store._external_api_events)


def test_existing_geocode_keeps_first_result_behavior(monkeypatch):
    monkeypatch.setattr(geocode_module, "_fetch_geocode", lambda address, key: {
        "status": "OK",
        "results": [
            {"formatted_address": "first", "geometry": {"location": {"lat": 1.0, "lng": 2.0}, "location_type": "APPROXIMATE"}},
            {"formatted_address": "second", "geometry": {"location": {"lat": 3.0, "lng": 4.0}, "location_type": "ROOFTOP"}},
        ],
    })
    assert geocode_module._geocode_sync("anything", "key") == {
        "lat": 1.0, "lng": 2.0, "formatted_address": "first", "geocode_confidence": "low",
    }


# --- Intake side of the handoff (FR-012 attribution, FR-013 commit re-check) ---

def _branded_channel(monkeypatch, store, org_id="abc"):
    async def resolve(slug):
        return {
            "intake_channel_id": "c1", "origin_org_id": org_id, "customer_owner_org_id": org_id,
            "dispatch_cutover_enabled": False, "organization_name": "ABC", "dispatch_phone": None,
        } if slug == "abc-locksmith" else None

    monkeypatch.setattr(store, "resolve_intake_channel", resolve)


@pytest.mark.parametrize("source,expected", [("ai_assistant", "ai_assistant"), ("forged", None), (None, None)])
def test_ticket_attribution_is_allow_listed(app, monkeypatch, source, expected):
    _, store, client, _, _ = app
    _branded_channel(monkeypatch, store)
    body = {"intake_channel": "abc-locksmith", "access_type": "home"}
    if source:
        body["intake_source"] = source

    ticket_id = client.post("/tickets", json=body).json()["ticket"]["ticket_id"]

    assert getattr(store, "_job_origin_channel", {}).get(ticket_id) == expected


def test_provider_availability_rechecks_the_owning_provider(app, monkeypatch):
    _, store, client, _, _ = app
    _branded_channel(monkeypatch, store)
    _org(store, "abc")
    store._technicians = [_tech("t1", ["abc"])]
    created = client.post("/tickets", json={
        "intake_channel": "abc-locksmith", "access_type": "home", "intake_source": "ai_assistant",
        "location": {"raw_text": "x", "lat": 40.0, "lng": -73.0, "geocode_confidence": "high"},
    }).json()["ticket"]["ticket_id"]

    available = client.get(f"/tickets/{created}/provider-availability")
    store._organizations["abc"]["status"] = "suspended"
    suspended = client.get(f"/tickets/{created}/provider-availability")
    store._organizations["abc"]["status"] = "active"
    store._technicians = [_tech("t1", ["abc"], lat=10.0, lng=10.0)]
    out_of_range = client.get(f"/tickets/{created}/provider-availability")
    stranger = TestClient(client.app).get(f"/tickets/{created}/provider-availability")

    assert available.json() == {"eligible": True}
    assert suspended.json() == {"eligible": False}
    assert out_of_range.json() == {"eligible": False}
    assert stranger.status_code == 404  # intake capability cookie required
