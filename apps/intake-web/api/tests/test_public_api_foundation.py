"""Public API / Agent Gateway foundation boundary tests."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from starlette.testclient import TestClient

from api.auth import create_access_token
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


def _platform_admin_headers(store: InMemoryStore) -> dict[str, str]:
    uid = str(uuid4())
    store.users[uid] = {
        "id": uid, "email": f"admin-{uid}@example.test", "phone": None,
        "display_name": "Platform Admin", "password_hash": "x",
        "roles": ["platform_admin"], "active_organization_id": None,
        "organization_name": None,
    }
    token = create_access_token({"sub": uid, "id": uid, "roles": ["platform_admin"]})
    return {"Authorization": f"Bearer {token}"}


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
    assert missing.headers["X-Request-ID"] == missing.json()["request_id"]
    assert invalid.status_code == 401
    assert invalid.json()["error"] == "invalid_api_key"
    assert invalid.headers["X-Request-ID"] == invalid.json()["request_id"]
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
    store._organizations["some-org"] = {
        "id": "some-org", "display_name": "Eligible Provider", "status": "active",
    }
    store._organization_capabilities["some-org"] = {"locksmith.residential_lockout"}
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


def test_coverage_check_uses_provider_eligibility_from_network_router(isolated_app):
    main, store = isolated_app
    store._technicians = [_tech("near-tech")]
    store._organizations["some-org"] = {
        "id": "some-org", "display_name": "Suspended Provider", "status": "suspended",
    }
    store._organization_capabilities["some-org"] = {"locksmith.residential_lockout"}
    api_key = _issue_key(store, ["coverage:check"])
    client = TestClient(main.app)

    suspended = client.post(
        "/v1/coverage-checks",
        headers={"X-API-Key": api_key},
        json={"lat": 40.0, "lng": -73.0, "service_skill": "locksmith.residential_lockout"},
    )
    store._organizations["some-org"]["status"] = "active"
    store._organization_capabilities["some-org"] = set()
    not_capable = client.post(
        "/v1/coverage-checks",
        headers={"X-API-Key": api_key},
        json={"lat": 40.0, "lng": -73.0, "service_skill": "locksmith.residential_lockout"},
    )

    assert suspended.json()["data"]["covered"] is False
    assert not_capable.json()["data"]["covered"] is False


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
    assert response.headers["X-Request-ID"] == response.json()["request_id"]


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

    extra_field = dict(_VALID_SERVICE_REQUEST, origin_client_id=str(uuid4()))
    strict = client.post("/v1/service-requests", headers={"X-API-Key": write_key}, json=extra_field)
    assert strict.status_code == 422
    assert strict.json()["error"] == "invalid_request"


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


def test_admin_external_client_provisioning_requires_platform_admin(isolated_app):
    main, store = isolated_app
    client = TestClient(main.app)

    unauthenticated = client.post("/admin/external-clients", json={
        "name": "Partner Co", "client_type": "partner", "scopes": ["services:read"],
    })
    assert unauthenticated.status_code == 401

    tech_uid = str(uuid4())
    store.users[tech_uid] = {
        "id": tech_uid, "email": "tech@example.test", "phone": None, "display_name": "Tech",
        "password_hash": "x", "roles": ["technician"], "active_organization_id": None,
        "organization_name": None,
    }
    wrong_role = client.post(
        "/admin/external-clients",
        headers={"Authorization": f"Bearer {create_access_token({'sub': tech_uid, 'roles': ['technician']})}"},
        json={"name": "Partner Co", "client_type": "partner", "scopes": ["services:read"]},
    )
    assert wrong_role.status_code == 403


def test_admin_can_create_client_issue_list_revoke_and_deactivate(isolated_app):
    main, store = isolated_app
    client = TestClient(main.app)
    admin = _platform_admin_headers(store)

    created = client.post(
        "/admin/external-clients",
        headers=admin,
        json={
            "name": "Partner Co", "client_type": "partner",
            "scopes": ["services:read", "coverage:check"], "organization_id": str(uuid4()),
        },
    )
    assert created.status_code == 200
    client_id = created.json()["id"]
    assert "key_hash" not in created.json()

    issued = client.post(f"/admin/external-clients/{client_id}/keys", headers=admin, json={})
    assert issued.status_code == 200
    assert issued.json()["api_key"].startswith("cxp_live_")
    assert "key_hash" not in issued.json()["key"]
    key_id = issued.json()["key"]["id"]

    listed = client.get("/admin/external-clients", headers=admin)
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert not any("key_hash" in k for k in listed.json()[0]["keys"])

    fetched = client.get(f"/admin/external-clients/{client_id}", headers=admin)
    assert fetched.status_code == 200
    assert fetched.json()["keys"][0]["id"] == key_id

    revoked = client.post(f"/admin/external-clients/{client_id}/keys/{key_id}/revoke", headers=admin)
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"
    # A revoked key must actually stop authenticating.
    auth_after_revoke = asyncio.run(store.authenticate_external_api_key(issued.json()["api_key"]))
    assert auth_after_revoke is None

    deactivated = client.patch(
        f"/admin/external-clients/{client_id}/status", headers=admin, json={"status": "suspended"},
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "suspended"

    # Governance events recorded every step, none containing the raw key.
    actions = [e["action"] for e in store.governance_events if e["entity_type"] in ("external_client", "external_api_key")]
    assert actions == ["create", "issue", "revoke", "status_change"]
    assert not any("cxp_live_" in str(e) for e in store.governance_events)


def test_admin_rejects_unknown_scope_and_missing_client(isolated_app):
    main, store = isolated_app
    client = TestClient(main.app)
    admin = _platform_admin_headers(store)

    bad_scope = client.post(
        "/admin/external-clients",
        headers=admin,
        json={"name": "X", "client_type": "partner", "scopes": ["not_a_real_scope"]},
    )
    assert bad_scope.status_code == 422

    missing = client.post(f"/admin/external-clients/{uuid4()}/keys", headers=admin, json={})
    assert missing.status_code == 404

    missing_client = client.get(f"/admin/external-clients/{uuid4()}", headers=admin)
    assert missing_client.status_code == 404


def _create_service_request(client: TestClient, api_key: str, **overrides) -> str:
    payload = dict(_VALID_SERVICE_REQUEST, **overrides)
    created = client.post("/v1/service-requests", headers={"X-API-Key": api_key}, json=payload)
    assert created.status_code == 200, created.text
    return created.json()["data"]["request_reference"]


_VALID_AUTHORIZATION = {
    "channel": "partner_api", "evidence_reference": "chat-turn-4-explicit-yes", "terms_version": "2026-08-01",
}


def test_dispatch_authorization_context_status_is_draft_not_none_for_a_fresh_request(isolated_app):
    """Regression: PostgresStore's jobs.status is never actually NULL -- it
    starts at TicketStatus.DRAFT ("draft") and is only overwritten once
    dispatch begins. A `status is None` check would reject every real request
    in production while appearing to work against InMemoryStore. Locking in
    the cross-store contract here, not just via HTTP status codes."""
    main, store = isolated_app
    write_key = _issue_key(store, ["service_requests:write"])
    client = TestClient(main.app)
    reference = _create_service_request(client, write_key)

    ctx = asyncio.run(store.get_dispatch_authorization_context_by_reference(reference))

    assert ctx["status"] == "draft"


def test_dispatch_authorization_requires_scope_and_unknown_reference_is_404(isolated_app):
    main, store = isolated_app
    write_key = _issue_key(store, ["service_requests:write"])
    client = TestClient(main.app)
    reference = _create_service_request(client, write_key)

    wrong_scope = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": write_key}, json=_VALID_AUTHORIZATION,
    )
    assert wrong_scope.status_code == 403

    auth_key = _issue_key(store, ["service_requests:authorize"])
    missing = client.post(
        "/v1/service-requests/not-a-real-reference/dispatch-authorizations",
        headers={"X-API-Key": auth_key}, json=_VALID_AUTHORIZATION,
    )
    assert missing.status_code == 404
    assert missing.json()["error"] == "service_request_not_found"


def test_dispatch_authorization_rejects_unknown_channel(isolated_app):
    main, store = isolated_app
    write_key = _issue_key(store, ["service_requests:write"])
    auth_key = _issue_key(store, ["service_requests:authorize"])
    client = TestClient(main.app)
    reference = _create_service_request(client, write_key)

    bad = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": auth_key},
        json={"channel": "not_a_real_channel", "evidence_reference": "x", "terms_version": "v1"},
    )
    assert bad.status_code == 422


def test_private_partner_authorization_requires_matching_org_and_queues_only(isolated_app):
    main, store = isolated_app
    org_id = str(uuid4())
    write_key = _issue_key(store, ["service_requests:write"], organization_id=org_id)
    bound_auth_key = _issue_key(store, ["service_requests:authorize"], organization_id=org_id)
    other_org_auth_key = _issue_key(store, ["service_requests:authorize"], organization_id=str(uuid4()))
    client = TestClient(main.app)
    reference = _create_service_request(client, write_key, dispatch_scope="private_partner")

    wrong_org = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": other_org_auth_key}, json=_VALID_AUTHORIZATION,
    )
    assert wrong_org.status_code == 403
    assert wrong_org.json()["error"] == "not_authorized_for_organization"

    authorized = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": bound_auth_key}, json=_VALID_AUTHORIZATION,
    )
    assert authorized.status_code == 200
    body = authorized.json()["data"]
    assert body == {
        "request_reference": reference, "dispatch_scope": "private_partner",
        "status": "authorized", "routing_outcome": None,
    }
    # No routing/offer logic touched -- only visible via the org's own queue.
    job_id = next(iter(store._tickets))
    assert store._job_status[str(job_id)] == "pending_dispatch"
    assert getattr(store, "_offers", {}) == {}

    already = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": bound_auth_key}, json=_VALID_AUTHORIZATION,
    )
    assert already.status_code == 409
    assert already.json()["error"] == "not_in_receivable_state"


def _network_tech(tech_id: str, *, org_ids: list[str] | None = None) -> dict:
    return {
        "id": tech_id,
        "display_name": tech_id,
        "skills": ["locksmith.residential_lockout"],
        "is_available": True,
        "status": "active",
        "vetting_status": "verified",
        "service_area_center_lat": 40.0,
        "service_area_center_lng": -73.0,
        "service_area_radius_km": 25,
        "org_ids": org_ids or [],
        "rating": 4.5,
        "location_updated_at": datetime.now(timezone.utc),
    }


def test_residential_lockout_website_transaction_routes_accepts_and_tracks(isolated_app):
    main, store = isolated_app
    technician_id = str(uuid4())
    store._technicians = [_network_tech(technician_id, org_ids=["eligible-provider"])]
    store._organizations["eligible-provider"] = {
        "id": "eligible-provider", "display_name": "Eligible Provider", "status": "active",
    }
    store._organization_capabilities["eligible-provider"] = {"locksmith.residential_lockout"}
    website_key = _issue_key(
        store, ["service_requests:write", "service_requests:authorize", "service_requests:read"],
    )
    client = TestClient(main.app)
    reference = _create_service_request(
        client, website_key,
        location={"lat": 40.001, "lng": -73.001, "raw_text": "near"},
    )

    authorized = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": website_key}, json=_VALID_AUTHORIZATION,
    )

    assert authorized.status_code == 200
    body = authorized.json()["data"]
    assert body["dispatch_scope"] == "network"
    assert body["routing_outcome"] == "offer_sent"
    # Never leaks which technician was selected.
    assert technician_id not in authorized.text

    job_id = next(iter(store._tickets))
    assert store._job_status[str(job_id)] == "pending_dispatch"
    routing_events = [e for e in store.governance_events if e["action"] == "network_routing_decision"]
    assert len(routing_events) == 1
    assert routing_events[0]["metadata"]["selected_technician_id"] == technician_id

    offer = next(iter(store._offers.values()))
    accepted = asyncio.run(store.accept_dispatch_offer(UUID(offer["id"]), UUID(technician_id)))
    assert accepted is not None

    tracking = client.get(
        f"/v1/service-requests/{reference}/tracking",
        headers={"X-API-Key": website_key},
    )
    assert tracking.status_code == 200
    assert tracking.json()["data"]["state"] == "matched"
    assert tracking.json()["data"]["assignment"] is not None


def test_network_authorization_reports_no_eligible_provider(isolated_app):
    main, store = isolated_app
    store._technicians = []  # nobody available anywhere
    website_key = _issue_key(store, ["service_requests:write", "service_requests:authorize"])
    client = TestClient(main.app)
    reference = _create_service_request(client, website_key)

    authorized = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": website_key}, json=_VALID_AUTHORIZATION,
    )

    assert authorized.status_code == 200
    assert authorized.json()["data"]["routing_outcome"] == "no_eligible_provider"


def test_network_authorization_excludes_org_ineligible_technician(isolated_app):
    main, store = isolated_app
    store._technicians = [_network_tech("suspended-org-tech", org_ids=["org-suspended"])]
    store._organizations["org-suspended"] = {
        "id": "org-suspended", "display_name": "Suspended Co", "status": "suspended",
    }
    website_key = _issue_key(store, ["service_requests:write", "service_requests:authorize"])
    client = TestClient(main.app)
    reference = _create_service_request(client, website_key)

    authorized = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": website_key}, json=_VALID_AUTHORIZATION,
    )

    assert authorized.status_code == 200
    assert authorized.json()["data"]["routing_outcome"] == "no_eligible_provider"
    routing_events = [e for e in store.governance_events if e["action"] == "network_routing_decision"]
    assert routing_events[0]["metadata"]["considered"] == [
        {"technician_id": "suspended-org-tech", "reason_code": "organization_ineligible"}
    ]


def test_network_authorization_requires_request_level_ownership(isolated_app):
    main, store = isolated_app
    creator_key = _issue_key(store, ["service_requests:write", "service_requests:authorize"])
    unrelated_key = _issue_key(store, ["service_requests:authorize"])
    client = TestClient(main.app)
    reference = _create_service_request(client, creator_key)

    denied = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": unrelated_key},
        json=_VALID_AUTHORIZATION,
    )

    assert denied.status_code == 404
    assert denied.json()["error"] == "service_request_not_found"
    context = asyncio.run(store.get_dispatch_authorization_context_by_reference(reference))
    assert context["status"] == "draft"


def test_get_service_request_requires_scope_and_ownership(isolated_app):
    main, store = isolated_app
    # Same client, both scopes -- proves the creator (origin_client_id) branch.
    creator_key = _issue_key(store, ["service_requests:write", "service_requests:read"])
    other_read_key = _issue_key(store, ["service_requests:read"])
    client = TestClient(main.app)
    reference = _create_service_request(client, creator_key)

    wrong_scope = client.get(
        f"/v1/service-requests/{reference}", headers={"X-API-Key": _issue_key(store, ["service_requests:write"])},
    )
    assert wrong_scope.status_code == 403

    missing = client.get("/v1/service-requests/not-a-real-reference", headers={"X-API-Key": creator_key})
    assert missing.status_code == 404

    not_creator = client.get(f"/v1/service-requests/{reference}", headers={"X-API-Key": other_read_key})
    assert not_creator.status_code == 404

    ok = client.get(f"/v1/service-requests/{reference}", headers={"X-API-Key": creator_key})
    assert ok.status_code == 200
    body = ok.json()["data"]
    assert body["request_reference"] == reference
    assert body["dispatch_scope"] == "network"
    assert body["status"] == "received"
    assert body["created_at"] is not None  # real timestamp, not a placeholder null


def test_get_service_request_status_reflects_creator_authorization(isolated_app):
    main, store = isolated_app
    website_key = _issue_key(
        store, ["service_requests:write", "service_requests:authorize", "service_requests:read"],
    )
    client = TestClient(main.app)
    reference = _create_service_request(client, website_key)

    client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": website_key}, json=_VALID_AUTHORIZATION,
    )

    read_by_authorizer = client.get(
        f"/v1/service-requests/{reference}", headers={"X-API-Key": website_key},
    )
    assert read_by_authorizer.status_code == 200
    assert read_by_authorizer.json()["data"]["status"] == "authorized"


def test_tracking_reuses_customer_safe_dispatch_state_and_enforces_ownership(isolated_app):
    main, store = isolated_app
    creator_key = _issue_key(store, ["service_requests:write", "service_requests:read"])
    other_key = _issue_key(store, ["service_requests:read"])
    client = TestClient(main.app)
    reference = _create_service_request(client, creator_key)

    denied = client.get(f"/v1/service-requests/{reference}/tracking", headers={"X-API-Key": other_key})
    assert denied.status_code == 404

    ok = client.get(f"/v1/service-requests/{reference}/tracking", headers={"X-API-Key": creator_key})
    assert ok.status_code == 200
    body = ok.json()
    assert "state" in body["data"]
    assert body["data"]["assignment"] is None  # never matched -- no technician identity


def test_cancellation_is_idempotent_and_gated_by_fulfillment_stage(isolated_app):
    main, store = isolated_app
    cancel_key = _issue_key(store, ["service_requests:write", "service_requests:cancel"])
    other_key = _issue_key(store, ["service_requests:cancel"])
    client = TestClient(main.app)
    reference = _create_service_request(client, cancel_key)

    wrong_owner = client.post(
        f"/v1/service-requests/{reference}/cancellations",
        headers={"X-API-Key": other_key}, json={"reason": "no longer needed"},
    )
    assert wrong_owner.status_code == 404

    too_short_reason = client.post(
        f"/v1/service-requests/{reference}/cancellations",
        headers={"X-API-Key": cancel_key}, json={"reason": "x"},
    )
    assert too_short_reason.status_code == 422

    first = client.post(
        f"/v1/service-requests/{reference}/cancellations",
        headers={"X-API-Key": cancel_key}, json={"reason": "no longer needed"},
    )
    assert first.status_code == 200
    assert first.json()["data"] == {"request_reference": reference, "status": "cancelled"}

    job_id = next(iter(store._tickets))
    assert store._job_status[str(job_id)] == "cancelled"

    # Idempotent: cancelling again succeeds rather than 409ing.
    second = client.post(
        f"/v1/service-requests/{reference}/cancellations",
        headers={"X-API-Key": cancel_key}, json={"reason": "still cancelled"},
    )
    assert second.status_code == 200
    assert second.json()["data"]["status"] == "cancelled"


def test_cancellation_blocked_once_too_far_into_fulfillment(isolated_app):
    main, store = isolated_app
    cancel_key = _issue_key(store, ["service_requests:write", "service_requests:cancel"])
    client = TestClient(main.app)
    reference = _create_service_request(client, cancel_key)
    job_id = next(iter(store._tickets))
    store._job_status = getattr(store, "_job_status", {})
    store._job_status[str(job_id)] = "arrived"

    blocked = client.post(
        f"/v1/service-requests/{reference}/cancellations",
        headers={"X-API-Key": cancel_key}, json={"reason": "too late now"},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"] == "not_cancellable"


# --- api.cluexp.com hostname facade (docs/API-HOSTNAME-ROLLOUT.md) ---

def test_v1_reachable_directly_and_via_legacy_api_prefix(isolated_app):
    main, store = isolated_app
    api_key = _issue_key(store, ["services:read"])
    client = TestClient(main.app)

    direct = client.get("/v1/services", headers={"X-API-Key": api_key})
    legacy = client.get("/api/v1/services", headers={"X-API-Key": api_key})

    assert direct.status_code == 200
    assert legacy.status_code == 200
    assert direct.json()["data"] == legacy.json()["data"]


def test_api_only_hostname_hides_internal_api_routes(isolated_app, monkeypatch):
    main, _ = isolated_app
    monkeypatch.setattr(main.config, "API_ONLY_HOSTNAMES", {"api.cluexp.com"})
    client = TestClient(main.app, base_url="https://api.cluexp.com")

    blocked = client.get("/api/healthz")

    assert blocked.status_code == 404
    assert blocked.json()["error"] == "not_found"
    assert blocked.headers["X-Request-ID"] == blocked.json()["request_id"]


def test_api_only_hostname_hides_website_root(isolated_app, monkeypatch):
    main, _ = isolated_app
    monkeypatch.setattr(main.config, "API_ONLY_HOSTNAMES", {"api.cluexp.com"})
    client = TestClient(main.app, base_url="https://api.cluexp.com")

    blocked = client.get("/")

    assert blocked.status_code == 404
    assert blocked.json()["error"] == "not_found"


def test_api_only_hostname_still_serves_v1(isolated_app, monkeypatch):
    main, store = isolated_app
    monkeypatch.setattr(main.config, "API_ONLY_HOSTNAMES", {"api.cluexp.com"})
    api_key = _issue_key(store, ["services:read"])
    client = TestClient(main.app, base_url="https://api.cluexp.com")

    allowed = client.get("/v1/services", headers={"X-API-Key": api_key})

    assert allowed.status_code == 200


def test_api_only_hostname_rejects_legacy_api_v1_alias(isolated_app, monkeypatch):
    """api.cluexp.com must expose canonical /v1/* only, never the legacy
    /api/v1/* alias (which restrict_api_only_hostnames sees un-normalized,
    since it runs before strip_vercel_api_prefix -- see the middleware-order
    note above those functions in api/main.py)."""
    main, store = isolated_app
    monkeypatch.setattr(main.config, "API_ONLY_HOSTNAMES", {"api.cluexp.com"})
    api_key = _issue_key(store, ["services:read"])
    client = TestClient(main.app, base_url="https://api.cluexp.com")

    blocked = client.get("/api/v1/services", headers={"X-API-Key": api_key})

    assert blocked.status_code == 404
    assert blocked.json()["error"] == "not_found"
    assert blocked.headers["X-Request-ID"] == blocked.json()["request_id"]


def test_non_facade_hostname_unaffected_by_api_only_gate(isolated_app, monkeypatch):
    main, _ = isolated_app
    monkeypatch.setattr(main.config, "API_ONLY_HOSTNAMES", {"api.cluexp.com"})
    client = TestClient(main.app, base_url="https://intake.cluexp.com")

    not_gated = client.get("/api/healthz")

    assert not_gated.status_code != 404 or not_gated.json().get("error") != "not_found"


def test_non_facade_hostname_still_serves_legacy_api_v1_alias(isolated_app, monkeypatch):
    """The legacy /api/v1/* alias must keep working on a non-facade hostname
    (e.g. intake.cluexp.com) during the migration -- only the api.cluexp.com
    facade restricts itself to canonical /v1/*."""
    main, store = isolated_app
    monkeypatch.setattr(main.config, "API_ONLY_HOSTNAMES", {"api.cluexp.com"})
    api_key = _issue_key(store, ["services:read"])
    client = TestClient(main.app, base_url="https://intake.cluexp.com")

    allowed = client.get("/api/v1/services", headers={"X-API-Key": api_key})

    assert allowed.status_code == 200


@pytest.mark.parametrize("path", ["/v10", "/v1evil", "/v1evil/services"])
def test_api_only_hostname_gate_uses_exact_v1_boundary(isolated_app, monkeypatch, path):
    """A bare `startswith("/v1")` would wrongly let `/v10` or `/v1evil` through
    the facade gate. The boundary must be exact: `/v1` or `/v1/...` only."""
    main, _ = isolated_app
    monkeypatch.setattr(main.config, "API_ONLY_HOSTNAMES", {"api.cluexp.com"})
    client = TestClient(main.app, base_url="https://api.cluexp.com")

    blocked = client.get(path)

    assert blocked.status_code == 404
    assert blocked.json()["error"] == "not_found"


def test_trusted_host_rejects_unknown_host(isolated_app, monkeypatch):
    main, _ = isolated_app
    monkeypatch.setattr(main.config, "TRUSTED_HOSTS", ["api.cluexp.com", "intake.cluexp.com"])
    client = TestClient(main.app, base_url="https://evil.example.com")

    response = client.get("/v1/services")

    assert response.status_code == 400


def test_trusted_host_accepts_configured_host(isolated_app, monkeypatch):
    main, store = isolated_app
    monkeypatch.setattr(main.config, "TRUSTED_HOSTS", ["api.cluexp.com", "intake.cluexp.com"])
    api_key = _issue_key(store, ["services:read"])
    client = TestClient(main.app, base_url="https://api.cluexp.com")

    response = client.get("/v1/services", headers={"X-API-Key": api_key})

    assert response.status_code == 200


def test_trusted_hosts_unset_permits_local_and_test_hosts(isolated_app):
    main, store = isolated_app
    assert main.config.TRUSTED_HOSTS == ["*"]
    api_key = _issue_key(store, ["services:read"])
    client = TestClient(main.app)

    response = client.get("/v1/services", headers={"X-API-Key": api_key})

    assert response.status_code == 200


def test_untrusted_host_rejection_on_v1_follows_public_error_envelope(isolated_app, monkeypatch):
    """/v1 requests must get the same {error, request_id} envelope + matching
    X-Request-ID as every other public error, not a bare Starlette {detail}."""
    main, _ = isolated_app
    monkeypatch.setattr(main.config, "TRUSTED_HOSTS", ["api.cluexp.com"])
    client = TestClient(main.app, base_url="https://evil.example.com")

    response = client.get("/v1/services")

    assert response.status_code == 400
    body = response.json()
    assert body["error"] == "untrusted_host"
    assert "request_id" in body
    assert response.headers["X-Request-ID"] == body["request_id"]


def test_untrusted_host_rejection_on_legacy_v1_alias_follows_public_error_envelope(
    isolated_app, monkeypatch,
):
    main, _ = isolated_app
    monkeypatch.setattr(main.config, "TRUSTED_HOSTS", ["api.cluexp.com"])
    client = TestClient(main.app, base_url="https://evil.example.com")

    response = client.get("/api/v1/services")

    assert response.status_code == 400
    body = response.json()
    assert body["error"] == "untrusted_host"
    assert response.headers["X-Request-ID"] == body["request_id"]


def test_untrusted_host_rejection_on_internal_route_keeps_plain_detail_shape(isolated_app, monkeypatch):
    """Internal (non-/v1) routes are not part of the public contract, so they
    keep the plain {detail} shape rather than the public envelope."""
    main, _ = isolated_app
    monkeypatch.setattr(main.config, "TRUSTED_HOSTS", ["api.cluexp.com"])
    client = TestClient(main.app, base_url="https://evil.example.com")

    response = client.get("/api/healthz")

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid host header"}


def test_request_hostname_strips_port_before_matching(isolated_app, monkeypatch):
    main, store = isolated_app
    monkeypatch.setattr(main.config, "TRUSTED_HOSTS", ["api.cluexp.com"])
    api_key = _issue_key(store, ["services:read"])
    client = TestClient(main.app)

    response = client.get(
        "/v1/services", headers={"host": "api.cluexp.com:443", "X-API-Key": api_key},
    )

    assert response.status_code == 200


def test_request_hostname_handles_ipv6_literal(isolated_app, monkeypatch):
    main, store = isolated_app
    monkeypatch.setattr(main.config, "TRUSTED_HOSTS", ["::1"])
    api_key = _issue_key(store, ["services:read"])
    client = TestClient(main.app)

    response = client.get(
        "/v1/services", headers={"host": "[::1]:8000", "X-API-Key": api_key},
    )

    assert response.status_code == 200


def test_request_hostname_ipv6_literal_rejected_when_not_trusted(isolated_app, monkeypatch):
    main, _ = isolated_app
    monkeypatch.setattr(main.config, "TRUSTED_HOSTS", ["api.cluexp.com"])
    client = TestClient(main.app)

    response = client.get("/v1/services", headers={"host": "[::1]:8000"})

    assert response.status_code == 400


# --- CORS config resolution (ALLOWED_ORIGINS, requirement 4) ---
# resolve_allowed_origins is a pure function of (env value, is_production), so
# these call it directly rather than reloading api.main/api.config -- reloading
# those modules mutates shared global state (e.g. the module-level `store`)
# for the rest of the pytest session and corrupts unrelated test files.

def test_cors_missing_config_defaults_to_wildcard_in_dev(isolated_app):
    main, _ = isolated_app
    assert main.resolve_allowed_origins("", is_production=False) == ["*"]


def test_cors_missing_config_in_production_does_not_become_wildcard(isolated_app):
    main, _ = isolated_app
    result = main.resolve_allowed_origins("", is_production=True)
    assert result == []
    assert "*" not in result


def test_cors_empty_config_in_production_does_not_become_wildcard(isolated_app):
    main, _ = isolated_app
    assert main.resolve_allowed_origins("   ", is_production=True) == []


def test_cors_explicit_config_is_used_in_production(isolated_app):
    main, _ = isolated_app
    result = main.resolve_allowed_origins(
        "https://www.cluexp.com,https://cluexp.com", is_production=True
    )
    assert result == ["https://www.cluexp.com", "https://cluexp.com"]


def test_cors_explicit_config_is_used_in_dev(isolated_app):
    main, _ = isolated_app
    result = main.resolve_allowed_origins("http://localhost:3000", is_production=False)
    assert result == ["http://localhost:3000"]


# --- CORS preflight integration tests (real CORSMiddleware, real OPTIONS) ---
# api.main's own CORSMiddleware is fixed at import time from the process env,
# so these build a throwaway app the same way main.py does -- same
# CORSMiddleware, same resolve_allowed_origins() -- and issue a real preflight
# request through it, rather than only asserting on the helper's return value.

def _cors_probe_app(allowed_origins: list[str]):
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    probe = FastAPI()
    probe.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @probe.get("/v1/services")
    def _services():
        return {"ok": True}

    return probe


def test_cors_preflight_allows_approved_origin(isolated_app):
    main, _ = isolated_app
    origins = main.resolve_allowed_origins("https://www.cluexp.com", is_production=True)
    client = TestClient(_cors_probe_app(origins))

    response = client.options(
        "/v1/services",
        headers={"Origin": "https://www.cluexp.com", "Access-Control-Request-Method": "GET"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://www.cluexp.com"


def test_cors_preflight_denies_unapproved_origin(isolated_app):
    main, _ = isolated_app
    origins = main.resolve_allowed_origins("https://www.cluexp.com", is_production=True)
    client = TestClient(_cors_probe_app(origins))

    response = client.options(
        "/v1/services",
        headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "GET"},
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_cors_preflight_production_missing_config_denies_all_origins(isolated_app):
    main, _ = isolated_app
    origins = main.resolve_allowed_origins("", is_production=True)
    client = TestClient(_cors_probe_app(origins))

    response = client.options(
        "/v1/services",
        headers={"Origin": "https://www.cluexp.com", "Access-Control-Request-Method": "GET"},
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_cors_preflight_production_empty_config_denies_all_origins(isolated_app):
    main, _ = isolated_app
    origins = main.resolve_allowed_origins("   ", is_production=True)
    client = TestClient(_cors_probe_app(origins))

    response = client.options(
        "/v1/services",
        headers={"Origin": "https://www.cluexp.com", "Access-Control-Request-Method": "GET"},
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_cors_preflight_dev_default_allows_any_origin(isolated_app):
    main, _ = isolated_app
    origins = main.resolve_allowed_origins("", is_production=False)
    client = TestClient(_cors_probe_app(origins))

    response = client.options(
        "/v1/services",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
