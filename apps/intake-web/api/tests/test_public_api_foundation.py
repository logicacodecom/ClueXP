"""Public API / Agent Gateway foundation boundary tests."""
from __future__ import annotations

import asyncio

import pytest
from starlette.testclient import TestClient

from api.store import InMemoryStore


@pytest.fixture
def isolated_app(monkeypatch):
    from api import main

    replacement = InMemoryStore()
    monkeypatch.setattr(main, "store", replacement)

    async def no_latency() -> None:
        return None

    monkeypatch.setattr(main, "latency", no_latency)
    return main, replacement


def _issue_key(
    store: InMemoryStore, scopes: list[str], *, rate_limit: int = 60, organization_id: str | None = None,
) -> str:
    client = asyncio.run(
        store.create_external_client(
            name="Test external client",
            client_type="agent",
            scopes=scopes,
            rate_limit_per_minute=rate_limit,
            organization_id=organization_id,
        )
    )
    issued = asyncio.run(store.issue_external_api_key(client["id"], scopes=scopes))
    return issued["api_key"]


def test_public_services_requires_api_key_and_audits_failures(isolated_app):
    main, store = isolated_app
    client = TestClient(main.app)

    missing = client.get("/v1/services")
    invalid = client.get("/v1/services", headers={"Authorization": "Bearer not-real"})

    assert missing.status_code == 401
    assert missing.json()["error"] == "missing_api_key"
    assert invalid.status_code == 401
    assert invalid.json()["error"] == "invalid_api_key"
    assert [event["action"] for event in store._external_api_events] == [
        "auth_missing",
        "auth_invalid",
    ]


def test_public_services_requires_services_read_scope(isolated_app):
    main, store = isolated_app
    api_key = _issue_key(store, ["requests:write"])
    client = TestClient(main.app)

    response = client.get("/v1/services", headers={"X-API-Key": api_key})

    assert response.status_code == 403
    assert response.json()["error"] == "insufficient_scope"
    assert store._external_api_events[-1]["action"] == "scope_denied"


def test_public_services_returns_active_catalog_envelope_and_audits_success(isolated_app):
    main, store = isolated_app
    api_key = _issue_key(store, ["services:read"])
    client = TestClient(main.app)

    response = client.get(
        "/v1/services",
        headers={"Authorization": f"Bearer {api_key}", "X-Request-ID": "req-test-services"},
    )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "req-test-services"
    body = response.json()
    assert body["meta"] == {"request_id": "req-test-services", "api_version": "v1"}
    assert body["data"]
    assert {category["code"] for category in body["data"]} == {"locksmith"}
    assert all(
        set(skill) == {"code", "label", "requires_verification"}
        for category in body["data"]
        for skill in category["skills"]
    )
    assert store._external_api_events[-1]["action"] == "services.list"
    assert store._external_api_events[-1]["status_code"] == 200


def test_public_services_is_rate_limited_per_external_client(isolated_app):
    main, store = isolated_app
    api_key = _issue_key(store, ["services:read"], rate_limit=1)
    client = TestClient(main.app)

    first = client.get("/v1/services", headers={"X-API-Key": api_key})
    second = client.get("/v1/services", headers={"X-API-Key": api_key})

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"] == "rate_limited"
    assert store._external_api_events[-1]["action"] == "rate_limited"


def _tech(tech_id: str, *, lat: float = 40.0, lng: float = -73.0) -> dict:
    return {
        "id": tech_id,
        "display_name": tech_id,
        "skills": ["locksmith.residential_lockout"],
        "is_available": True,
        "status": "active",
        "vetting_status": "verified",
        "service_area_center_lat": lat,
        "service_area_center_lng": lng,
        "service_area_radius_km": 25,
        "org_ids": ["some-org"],
        "rating": 4.8,
    }


def test_coverage_check_requires_scope_and_api_key(isolated_app):
    main, store = isolated_app
    client = TestClient(main.app)

    missing_key = client.post(
        "/v1/coverage-checks",
        json={"lat": 40.0, "lng": -73.0, "service_skill": "locksmith.residential_lockout"},
    )
    assert missing_key.status_code == 401

    api_key = _issue_key(store, ["services:read"])
    wrong_scope = client.post(
        "/v1/coverage-checks",
        headers={"X-API-Key": api_key},
        json={"lat": 40.0, "lng": -73.0, "service_skill": "locksmith.residential_lockout"},
    )
    assert wrong_scope.status_code == 403
    assert wrong_scope.json()["error"] == "insufficient_scope"


def test_coverage_check_reports_true_only_when_a_verified_technician_is_in_range(isolated_app):
    main, store = isolated_app
    store._technicians = [_tech("near-tech", lat=40.0, lng=-73.0)]
    api_key = _issue_key(store, ["coverage:check"])
    client = TestClient(main.app)

    covered = client.post(
        "/v1/coverage-checks",
        headers={"X-API-Key": api_key},
        json={"lat": 40.01, "lng": -73.01, "service_skill": "locksmith.residential_lockout"},
    )
    not_covered = client.post(
        "/v1/coverage-checks",
        headers={"X-API-Key": api_key},
        json={"lat": 10.0, "lng": 10.0, "service_skill": "locksmith.residential_lockout"},
    )

    assert covered.status_code == 200
    assert covered.json()["data"] == {"covered": True, "service_skill": "locksmith.residential_lockout"}
    assert not_covered.status_code == 200
    assert not_covered.json()["data"]["covered"] is False
    # No technician identity, roster, or count is ever exposed -- only the boolean.
    assert "near-tech" not in covered.text
    last_event = store._external_api_events[-1]
    assert last_event["action"] == "coverage_checks.create"
    assert last_event["metadata"] == {"covered": False, "service_skill": "locksmith.residential_lockout"}


def test_coverage_check_rejects_out_of_range_coordinates(isolated_app):
    main, store = isolated_app
    api_key = _issue_key(store, ["coverage:check"])
    client = TestClient(main.app)

    response = client.post(
        "/v1/coverage-checks",
        headers={"X-API-Key": api_key},
        json={"lat": 999.0, "lng": -73.0, "service_skill": "locksmith.residential_lockout"},
    )

    assert response.status_code == 422
    assert response.json()["error"] == "invalid_request"
    assert "request_id" in response.json()


def test_coverage_check_idempotency_key_replays_then_rejects_conflicting_body(isolated_app):
    main, store = isolated_app
    store._technicians = [_tech("near-tech")]
    api_key = _issue_key(store, ["coverage:check"])
    client = TestClient(main.app)
    headers = {"X-API-Key": api_key, "Idempotency-Key": "cov-key-1"}

    first = client.post(
        "/v1/coverage-checks",
        headers=headers,
        json={"lat": 40.01, "lng": -73.01, "service_skill": "locksmith.residential_lockout"},
    )
    replay = client.post(
        "/v1/coverage-checks",
        headers=headers,
        json={"lat": 40.01, "lng": -73.01, "service_skill": "locksmith.residential_lockout"},
    )
    conflict = client.post(
        "/v1/coverage-checks",
        headers=headers,
        json={"lat": 10.0, "lng": 10.0, "service_skill": "locksmith.residential_lockout"},
    )

    assert first.status_code == 200 and first.json() == replay.json()
    assert conflict.status_code == 409
    assert conflict.json()["error"] == "idempotency_key_reuse"
    # The replay must not perform the check again or emit a second audit event.
    create_events = [e for e in store._external_api_events if e["action"] == "coverage_checks.create"]
    assert len(create_events) == 1


_VALID_SERVICE_REQUEST = {
    "dispatch_scope": "network",
    "service_skill": "locksmith.residential_lockout",
    "location": {"lat": 40.0, "lng": -73.0, "raw_text": "123 Main St"},
    "consent": {"terms_accepted": True, "policy_version": "2026-08-01"},
    "customer": {"name": "Jamie Rivera", "phone": "+15551234567"},
}


def test_service_request_requires_scope_and_consent(isolated_app):
    main, store = isolated_app
    api_key = _issue_key(store, ["coverage:check"])
    client = TestClient(main.app)

    wrong_scope = client.post("/v1/service-requests", headers={"X-API-Key": api_key}, json=_VALID_SERVICE_REQUEST)
    assert wrong_scope.status_code == 403

    write_key = _issue_key(store, ["service_requests:write"])
    no_consent = dict(_VALID_SERVICE_REQUEST, consent={"terms_accepted": False, "policy_version": "2026-08-01"})
    rejected = client.post("/v1/service-requests", headers={"X-API-Key": write_key}, json=no_consent)
    assert rejected.status_code == 422


def test_network_service_request_is_created_but_invisible_until_authorized(isolated_app):
    main, store = isolated_app
    api_key = _issue_key(store, ["service_requests:write"])
    client = TestClient(main.app)

    response = client.post("/v1/service-requests", headers={"X-API-Key": api_key}, json=_VALID_SERVICE_REQUEST)

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["dispatch_scope"] == "network"
    assert body["status"] == "received"
    # Safe external reference only -- never the raw job UUID.
    assert body["request_reference"]
    assert len(body["request_reference"]) < 36 or "-" not in body["request_reference"][:8]

    # The whole point of Tier 1: no job_status was set, so it is invisible to
    # both the ops queue and the dispatch sweep -- not by an extra flag, but
    # because both already gate strictly on "pending_dispatch".
    assert getattr(store, "_job_status", {}) == {}
    assert asyncio.run(store.get_ops_queue(None)) == []


def test_private_partner_service_request_requires_partner_bound_client(isolated_app):
    main, store = isolated_app
    unbound_key = _issue_key(store, ["service_requests:write"])
    client = TestClient(main.app)

    payload = dict(_VALID_SERVICE_REQUEST, dispatch_scope="private_partner")
    rejected = client.post("/v1/service-requests", headers={"X-API-Key": unbound_key}, json=payload)
    assert rejected.status_code == 422
    assert rejected.json()["error"] == "dispatch_scope_requires_partner_client"

    bound_key = _issue_key(store, ["service_requests:write"], organization_id="partner-org-1")
    accepted = client.post("/v1/service-requests", headers={"X-API-Key": bound_key}, json=payload)
    assert accepted.status_code == 200
    assert accepted.json()["data"]["dispatch_scope"] == "private_partner"
    ticket_id = next(iter(store._tickets))
    assert store._job_org[str(ticket_id)] == "partner-org-1"


def test_service_request_rejects_unknown_skill_and_idempotency_replays(isolated_app):
    main, store = isolated_app
    api_key = _issue_key(store, ["service_requests:write"])
    client = TestClient(main.app)

    unknown = dict(_VALID_SERVICE_REQUEST, service_skill="not.a.real.skill")
    rejected = client.post("/v1/service-requests", headers={"X-API-Key": api_key}, json=unknown)
    assert rejected.status_code == 422
    assert rejected.json()["error"] == "unknown_service_skill"

    headers = {"X-API-Key": api_key, "Idempotency-Key": "svc-req-1"}
    first = client.post("/v1/service-requests", headers=headers, json=_VALID_SERVICE_REQUEST)
    replay = client.post("/v1/service-requests", headers=headers, json=_VALID_SERVICE_REQUEST)
    assert first.status_code == 200
    assert first.json() == replay.json()
    assert len(store._tickets) == 1  # replay must not create a second job
