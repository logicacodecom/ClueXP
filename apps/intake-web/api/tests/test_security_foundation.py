"""Systematic Sprint 0 authorization-boundary regression tests."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from starlette.testclient import TestClient

from api.auth import create_access_token
from api.dispatch import POLICY_NETWORK_OPEN, POLICY_PRIVATE, STATUS_PENDING_DISPATCH, select_candidates
from api.schema import Photo, Ticket
from api.store import InMemoryStore


def _tech(tech_id: str, org_id: str) -> dict:
    return {
        "id": tech_id,
        "display_name": tech_id,
        "skills": ["home"],
        "is_available": True,
        "status": "active",
        "vetting_status": "verified",
        "service_area_center_lat": 40.0,
        "service_area_center_lng": -73.0,
        "service_area_radius_km": 50,
        "org_ids": [org_id],
    }


def test_private_partner_and_network_candidate_visibility_are_distinct():
    job = {"access_type": "home", "lat": 40.0, "lng": -73.0}
    owner = _tech("owner-tech", "owner-org")
    foreign = _tech("foreign-tech", "foreign-org")

    private = select_candidates(
        job,
        [owner, foreign],
        policy=POLICY_PRIVATE,
        owner_org_id="owner-org",
        round_index=99,
    )
    network = select_candidates(
        job,
        [owner, foreign],
        policy=POLICY_NETWORK_OPEN,
        owner_org_id="owner-org",
        round_index=0,
    )

    assert [row["id"] for row in private] == ["owner-tech"]
    assert {row["id"] for row in network} == {"owner-tech", "foreign-tech"}


def test_store_queue_isolation_hides_foreign_private_and_network_jobs():
    store = InMemoryStore()
    own_private, foreign_private, foreign_network = map(str, (uuid4(), uuid4(), uuid4()))
    store._job_status = {
        own_private: STATUS_PENDING_DISPATCH,
        foreign_private: STATUS_PENDING_DISPATCH,
        foreign_network: STATUS_PENDING_DISPATCH,
    }
    store._job_org = {
        own_private: "org-a",
        foreign_private: "org-b",
        foreign_network: "org-b",
    }
    store._job_policy = {
        own_private: "private",
        foreign_private: "private",
        foreign_network: "network_open",
    }

    visible = asyncio.run(store.get_ops_queue(org_id="org-a"))

    assert {row["id"] for row in visible} == {own_private}


@pytest.fixture
def isolated_app(monkeypatch):
    from api import main

    replacement = InMemoryStore()
    monkeypatch.setattr(main, "store", replacement)

    async def no_latency() -> None:
        return None

    monkeypatch.setattr(main, "latency", no_latency)
    return main, replacement


def test_customer_capability_scope_and_unauthorized_raw_id_access(isolated_app):
    main, store = isolated_app
    ticket = Ticket(ticket_id=uuid4())
    asyncio.run(store.save(ticket))
    token = asyncio.run(store.get_tracking_token(ticket.ticket_id))
    store._job_status = {str(ticket.ticket_id): STATUS_PENDING_DISPATCH}

    anonymous = TestClient(main.app)
    assert anonymous.get(f"/tickets/{ticket.ticket_id}").status_code == 404
    assert anonymous.patch(
        f"/tickets/{ticket.ticket_id}", json={"additional_details": "stolen"}
    ).status_code == 404
    assert anonymous.get(f"/tickets/{ticket.ticket_id}/tracking").status_code == 404
    assert anonymous.get("/t/not-a-real-capability").status_code == 404

    authorized = TestClient(main.app)
    authorized.cookies.set(main.INTAKE_CAPABILITY_COOKIE, token)
    assert authorized.get(f"/tickets/{ticket.ticket_id}").status_code == 200
    assert authorized.get(f"/tickets/{ticket.ticket_id}/tracking").status_code == 200
    assert authorized.get(f"/t/{token}").status_code == 200
    assert asyncio.run(store.get(ticket.ticket_id)).additional_details is None


def test_intake_create_issues_http_only_same_site_capability(isolated_app, monkeypatch):
    main, store = isolated_app

    async def channel(_slug):
        return {
            "intake_channel_id": str(uuid4()),
            "origin_org_id": str(uuid4()),
            "customer_owner_org_id": str(uuid4()),
            "dispatch_cutover_enabled": False,
            "organization_name": "Test Provider",
        }

    monkeypatch.setattr(store, "resolve_intake_channel", channel)
    client = TestClient(main.app)
    created = client.post("/tickets", json={"intake_channel": "test-provider"})

    assert created.status_code == 200, created.text
    cookie = created.headers["set-cookie"]
    assert "cluexp_intake_capability=" in cookie
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie
    ticket_id = created.json()["ticket"]["ticket_id"]
    assert client.get(f"/tickets/{ticket_id}").status_code == 200


def test_private_media_path_is_not_returned_when_signing_fails(isolated_app, monkeypatch):
    main, store = isolated_app
    ticket = Ticket(ticket_id=uuid4())
    ticket.photos.append(
        Photo(
            id="photo-1",
            url="private/customer/path.jpg",
            uploaded_at=datetime.now(timezone.utc),
        )
    )
    asyncio.run(store.save(ticket))
    token = asyncio.run(store.get_tracking_token(ticket.ticket_id))

    async def signing_failed(*_args, **_kwargs):
        raise RuntimeError("upstream response containing sensitive storage detail")

    monkeypatch.setattr(main.storage, "create_signed_download_url", signing_failed)
    client = TestClient(main.app)
    client.cookies.set(main.INTAKE_CAPABILITY_COOKIE, token)
    response = client.get(f"/tickets/{ticket.ticket_id}")

    assert response.status_code == 200
    assert response.json()["ticket"]["photos"][0]["url"] == ""
    assert "private/customer/path.jpg" not in response.text


def test_technician_routes_are_self_scoped_without_raw_id_oracle(isolated_app):
    main, store = isolated_app
    owner_id, other_id = str(uuid4()), str(uuid4())
    store.users[owner_id] = {
        "id": owner_id,
        "email": "owner-tech@example.test",
        "phone": None,
        "display_name": "Owner Tech",
        "password_hash": "unused",
        "roles": ["technician"],
        "active_organization_id": None,
        "organization_name": None,
    }
    store._technicians = [
        {
            **_tech(owner_id, "org-a"),
            "user_id": owner_id,
            "location_updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ]
    bearer = create_access_token({"sub": owner_id, "roles": ["technician"]})
    headers = {"Authorization": f"Bearer {bearer}"}
    client = TestClient(main.app)

    assert client.get(f"/technicians/{other_id}/offers", headers=headers).status_code == 403
    assert client.get(f"/technicians/{other_id}/active-job", headers=headers).status_code == 403
    assert client.get(f"/technicians/{owner_id}/offers", headers=headers).status_code == 200


def test_production_rejects_missing_short_and_known_placeholder_secrets(monkeypatch):
    import importlib
    from api import config

    monkeypatch.setenv("VERCEL_ENV", "production")
    for name in ("AUTH_SECRET", "ARRIVAL_PIN_SECRET", "CRON_SECRET"):
        monkeypatch.setenv(name, "x" * 48)
    try:
        for name, bad in (
            ("AUTH_SECRET", "cluexp-dev-auth-secret-change-me"),
            ("ARRIVAL_PIN_SECRET", "dev-arrival-pin-secret"),
            ("CRON_SECRET", "too-short"),
        ):
            monkeypatch.setenv(name, bad)
            with pytest.raises(RuntimeError, match=name):
                importlib.reload(config)
            monkeypatch.setenv(name, "x" * 48)
    finally:
        monkeypatch.undo()
        importlib.reload(config)
