"""Real-Postgres Sprint 0 checks. Skipped outside the dedicated CI tier."""
from __future__ import annotations

import asyncio
import os
from uuid import uuid4

import psycopg
import pytest
from psycopg.errors import InsufficientPrivilege
from starlette.testclient import TestClient

from api.schema import Ticket
from api.store import PostgresStore


DSN = os.environ.get("POSTGRES_TEST_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POSTGRES_TEST_URL is not configured")


def test_fresh_head_has_rls_on_every_public_table():
    with psycopg.connect(DSN) as conn:
        rows = conn.execute(
            "select c.relname, c.relrowsecurity "
            "from pg_class c join pg_namespace n on n.oid = c.relnamespace "
            "where n.nspname = 'public' and c.relkind in ('r','p') order by c.relname"
        ).fetchall()

    assert rows
    assert [name for name, enabled in rows if not enabled] == []


def test_anon_and_authenticated_are_default_denied_but_owner_and_service_role_work():
    with psycopg.connect(DSN, autocommit=True) as conn:
        for role, bypass in (
            ("anon", False),
            ("authenticated", False),
            ("service_role", True),
        ):
            conn.execute(
                f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN"
                + (" BYPASSRLS" if bypass else "")
                + "; EXCEPTION WHEN duplicate_object THEN NULL; END $$"
            )
            conn.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
            conn.execute(f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {role}")
            conn.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}")

        phone = f"+1555{uuid4().int % 10_000_000:07d}"
        conn.execute("insert into customers (phone, name) values (%s, 'RLS sentinel')", (phone,))
        assert conn.execute(
            "select count(*) from customers where phone = %s", (phone,)
        ).fetchone()[0] == 1

        for role in ("anon", "authenticated"):
            conn.execute(f"SET ROLE {role}")
            assert conn.execute(
                "select count(*) from customers where phone = %s", (phone,)
            ).fetchone()[0] == 0
            assert conn.execute(
                "update customers set name = 'tampered' where phone = %s", (phone,)
            ).rowcount == 0
            assert conn.execute("delete from customers where phone = %s", (phone,)).rowcount == 0
            with pytest.raises(InsufficientPrivilege):
                conn.execute(
                    "insert into customers (phone, name) values (%s, 'forged')",
                    (f"+1666{uuid4().int % 10_000_000:07d}",),
                )
            conn.execute("RESET ROLE")

        conn.execute("SET ROLE service_role")
        assert conn.execute(
            "select count(*) from customers where phone = %s", (phone,)
        ).fetchone()[0] == 1
        conn.execute("RESET ROLE")


def test_postgres_store_executes_save_token_and_org_isolation_paths():
    async def exercise() -> None:
        store = PostgresStore(DSN)
        org_a, org_b = uuid4(), uuid4()
        async with await store._connect() as conn:
            await conn.execute(
                "insert into organizations (id, display_name, status) values "
                "(%s, 'RLS Org A', 'active'), (%s, 'RLS Org B', 'active')",
                (org_a, org_b),
            )

        ticket_a, ticket_b = Ticket(), Ticket()
        await store.save(
            ticket_a,
            {"origin_org_id": org_a, "customer_owner_org_id": org_a},
        )
        await store.save(
            ticket_b,
            {"origin_org_id": org_b, "customer_owner_org_id": org_b},
        )
        await store.set_job_status(ticket_a.ticket_id, "pending_dispatch")
        await store.set_job_status(ticket_b.ticket_id, "pending_dispatch")

        assert (await store.get(ticket_a.ticket_id)).ticket_id == ticket_a.ticket_id
        token = await store.get_tracking_token(ticket_a.ticket_id)
        assert token and await store.resolve_tracking_token(token) == str(ticket_a.ticket_id)
        assert await store.resolve_tracking_token("invalid-capability") is None
        assert {row["id"] for row in await store.get_ops_queue(str(org_a))} == {
            str(ticket_a.ticket_id)
        }
        assert {row["id"] for row in await store.get_ops_queue(str(org_b))} == {
            str(ticket_b.ticket_id)
        }

    asyncio.run(exercise())


def test_postgres_store_external_api_foundation_paths():
    async def exercise() -> None:
        store = PostgresStore(DSN)
        client = await store.create_external_client(
            name="Postgres external client",
            client_type="agent",
            scopes=["services:read", "requests:write"],
            rate_limit_per_minute=1,
            metadata={"test": True},
        )
        issued = await store.issue_external_api_key(client["id"], scopes=["services:read"])

        assert "api_key" in issued
        async with await store._connect() as conn:
            row = await (
                await conn.execute(
                    "select key_hash from external_api_keys where id = %s",
                    (issued["key"]["id"],),
                )
            ).fetchone()
        assert row[0] != issued["api_key"]

        auth = await store.authenticate_external_api_key(issued["api_key"])
        assert auth is not None
        assert auth["client"]["id"] == client["id"]
        assert auth["scopes"] == ["services:read"]

        assert await store.check_external_rate_limit(client["id"], "services:read", 1) is True
        assert await store.check_external_rate_limit(client["id"], "services:read", 1) is False

        event = await store.record_external_api_event(
            client_id=client["id"],
            api_key_id=issued["key"]["id"],
            action="services.list",
            path="/v1/services",
            status_code=200,
            request_id="pg-public-api-test",
            metadata={"ok": True},
        )
        assert event["client_id"] == client["id"]
        assert event["metadata"] == {"ok": True}

    asyncio.run(exercise())


def test_postgres_store_external_api_idempotency_reserve_replay_and_conflict():
    async def exercise() -> None:
        store = PostgresStore(DSN)
        client = await store.create_external_client(
            name="Idempotency client", client_type="agent", scopes=["coverage:check"],
        )
        client_id = client["id"]

        first = await store.begin_or_get_external_api_mutation(
            client_id, "idem-1", "hash-a", "POST", "/v1/coverage-checks",
        )
        assert first == {"state": "new"}

        pending = await store.begin_or_get_external_api_mutation(
            client_id, "idem-1", "hash-a", "POST", "/v1/coverage-checks",
        )
        assert pending["state"] == "pending"

        await store.complete_external_api_mutation(
            client_id, "idem-1", status_code=200, response={"data": {"covered": True}},
        )

        done = await store.begin_or_get_external_api_mutation(
            client_id, "idem-1", "hash-a", "POST", "/v1/coverage-checks",
        )
        assert done == {
            "state": "done", "status_code": 200, "response": {"data": {"covered": True}},
        }

        conflict = await store.begin_or_get_external_api_mutation(
            client_id, "idem-1", "hash-b", "POST", "/v1/coverage-checks",
        )
        assert conflict == {"state": "conflict"}

        # A different client with the same idempotency key string is a distinct
        # reservation (client_id is part of the primary key) — must not collide.
        other_client = await store.create_external_client(
            name="Other client", client_type="agent", scopes=["coverage:check"],
        )
        isolated = await store.begin_or_get_external_api_mutation(
            other_client["id"], "idem-1", "hash-a", "POST", "/v1/coverage-checks",
        )
        assert isolated == {"state": "new"}

    asyncio.run(exercise())


def test_postgres_store_external_client_admin_lifecycle():
    async def exercise() -> None:
        store = PostgresStore(DSN)
        client = await store.create_external_client(
            name="Admin lifecycle client", client_type="partner", scopes=["services:read"],
        )
        issued = await store.issue_external_api_key(client["id"], scopes=["services:read"])
        key_id = issued["key"]["id"]

        listed = await store.list_external_clients()
        assert any(c["id"] == client["id"] for c in listed)
        target = next(c for c in listed if c["id"] == client["id"])
        assert target["keys"][0]["id"] == key_id
        assert "key_hash" not in target["keys"][0]

        fetched = await store.get_external_client(client["id"])
        assert fetched["keys"][0]["id"] == key_id
        assert await store.get_external_client(str(uuid4())) is None

        revoked = await store.revoke_external_api_key(key_id)
        assert revoked["status"] == "revoked"
        assert revoked["revoked_at"] is not None
        assert await store.authenticate_external_api_key(issued["api_key"]) is None
        assert await store.revoke_external_api_key(str(uuid4())) is None

        updated = await store.set_external_client_status(client["id"], "suspended")
        assert updated["status"] == "suspended"
        assert await store.set_external_client_status(str(uuid4()), "suspended") is None

    asyncio.run(exercise())


def test_postgres_store_dispatch_authorization_context_and_atomic_insert():
    async def exercise() -> None:
        store = PostgresStore(DSN)
        org_id = uuid4()
        async with await store._connect() as conn:
            await conn.execute(
                "insert into organizations (id, display_name, status) values (%s, 'Net Org', 'active')",
                (org_id,),
            )
        client = await store.create_external_client(
            name="Dispatch auth client", client_type="agent", scopes=["service_requests:authorize"],
        )

        network_ticket = Ticket()
        await store.save(network_ticket, {})
        network_reference = await store.get_operational_id(network_ticket.ticket_id)

        private_ticket = Ticket()
        await store.save(private_ticket, {"origin_org_id": org_id, "customer_owner_org_id": org_id})
        private_reference = await store.get_operational_id(private_ticket.ticket_id)

        ctx = await store.get_dispatch_authorization_context_by_reference(network_reference)
        assert ctx["job_id"] == str(network_ticket.ticket_id)
        assert ctx["status"] == "draft"  # jobs.status is never actually unset
        assert ctx["customer_owner_org_id"] is None

        private_ctx = await store.get_dispatch_authorization_context_by_reference(private_reference)
        assert private_ctx["customer_owner_org_id"] == str(org_id)

        assert await store.get_dispatch_authorization_context_by_reference("not-a-real-reference") is None

        org_status = await store.get_organizations_status([str(org_id), str(uuid4())])
        assert org_status == {str(org_id): "active"}

        first = await store.create_dispatch_authorization(
            network_ticket.ticket_id, client_id=client["id"], dispatch_scope="network",
            channel="partner_api", evidence_reference="evidence-1", terms_version="v1",
        )
        assert first["job_id"] == str(network_ticket.ticket_id)

        # job_id is unique -- a second authorization for the same job is an
        # atomic no-op, the idempotency gate against duplicate offers.
        duplicate = await store.create_dispatch_authorization(
            network_ticket.ticket_id, client_id=client["id"], dispatch_scope="network",
            channel="partner_api", evidence_reference="evidence-2", terms_version="v1",
        )
        assert duplicate is None

    asyncio.run(exercise())


# --- Staging-equivalent smoke tests (no separate Supabase staging tier exists;
# CI's ephemeral Postgres is the closest available real-DB verification) ---
# Exercises the actual HTTP surface, not just store methods, against a real
# Postgres-backed app instance.


def _pg_app_client(monkeypatch) -> tuple[TestClient, PostgresStore]:
    from api import main

    pg_store = PostgresStore(DSN)
    monkeypatch.setattr(main, "store", pg_store)

    async def no_latency() -> None:
        return None

    monkeypatch.setattr(main, "latency", no_latency)
    return TestClient(main.app), pg_store


def _issue_pg_key(store: PostgresStore, scopes: list[str], *, organization_id: str | None = None) -> str:
    async def _issue() -> str:
        client = await store.create_external_client(
            name="Smoke test client", client_type="agent", scopes=scopes, organization_id=organization_id,
        )
        issued = await store.issue_external_api_key(client["id"], scopes=scopes)
        return issued["api_key"]

    return asyncio.run(_issue())


def test_smoke_private_partner_authorization_stays_isolated_to_owning_org(monkeypatch):
    client, store = _pg_app_client(monkeypatch)
    org_a, org_b = uuid4(), uuid4()

    async def seed_orgs() -> None:
        async with await store._connect() as conn:
            await conn.execute(
                "insert into organizations (id, display_name, status) values"
                " (%s, 'Org A', 'active'), (%s, 'Org B', 'active')",
                (org_a, org_b),
            )

    asyncio.run(seed_orgs())
    write_key = _issue_pg_key(store, ["service_requests:write"], organization_id=str(org_a))
    auth_key = _issue_pg_key(store, ["service_requests:authorize"], organization_id=str(org_a))

    created = client.post("/v1/service-requests", headers={"X-API-Key": write_key}, json={
        "dispatch_scope": "private_partner",
        "service_skill": "locksmith.residential_lockout",
        "location": {"lat": 40.0, "lng": -73.0, "raw_text": "smoke test address"},
        "consent": {"terms_accepted": True, "policy_version": "v1"},
    })
    assert created.status_code == 200, created.text
    reference = created.json()["data"]["request_reference"]

    authorized = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": auth_key},
        json={"channel": "partner_api", "evidence_reference": "smoke-test", "terms_version": "v1"},
    )
    assert authorized.status_code == 200, authorized.text
    assert authorized.json()["data"] == {
        "request_reference": reference, "dispatch_scope": "private_partner",
        "status": "authorized", "routing_outcome": None,
    }

    # Enters org A's own queue only -- never leaks into org B's queue, and
    # never touches network routing (no governance_events routing decision).
    queue_a = asyncio.run(store.get_ops_queue(org_id=str(org_a)))
    queue_b = asyncio.run(store.get_ops_queue(org_id=str(org_b)))
    assert any(row["id"] for row in queue_a)
    assert queue_b == []

    async def routing_events_for_this_job() -> list[dict]:
        job_id = queue_a[0]["id"]
        async with await store._connect() as conn:
            cur = await conn.execute(
                "select action from governance_events where entity_id = %s", (job_id,),
            )
            return [r[0] for r in await cur.fetchall()]

    assert asyncio.run(routing_events_for_this_job()) == []

    # The public endpoint resolves by operational_id -- a raw job UUID is not
    # a valid reference and must not be treated as a fallback lookup.
    raw_uuid_attempt = client.post(
        f"/v1/service-requests/{queue_a[0]['id']}/dispatch-authorizations",
        headers={"X-API-Key": auth_key},
        json={"channel": "partner_api", "evidence_reference": "x", "terms_version": "v1"},
    )
    assert raw_uuid_attempt.status_code == 404


def test_smoke_network_authorization_sends_at_most_one_offer_and_never_auto_reroutes(monkeypatch):
    client, store = _pg_app_client(monkeypatch)
    tech_id = uuid4()

    async def seed_technician() -> None:
        async with await store._connect() as conn:
            await conn.execute(
                "insert into technicians"
                " (id, display_name, status, vetting_status, skills, service_area_center_lat,"
                " service_area_center_lng, service_area_radius_km, rating, is_available,"
                " current_lat, current_lng, location_updated_at)"
                " values (%s, 'Smoke Tech', 'active', 'verified',"
                " array['locksmith.residential_lockout'], 40.0, -73.0, 25, 4.8, true,"
                " 40.0, -73.0, now())",
                (tech_id,),
            )

    asyncio.run(seed_technician())
    write_key = _issue_pg_key(store, ["service_requests:write"])
    auth_key = _issue_pg_key(store, ["service_requests:authorize"])

    created = client.post("/v1/service-requests", headers={"X-API-Key": write_key}, json={
        "dispatch_scope": "network",
        "service_skill": "locksmith.residential_lockout",
        "location": {"lat": 40.001, "lng": -73.001, "raw_text": "smoke test address"},
        "consent": {"terms_accepted": True, "policy_version": "v1"},
    })
    assert created.status_code == 200, created.text
    reference = created.json()["data"]["request_reference"]

    authorized = client.post(
        f"/v1/service-requests/{reference}/dispatch-authorizations",
        headers={"X-API-Key": auth_key},
        json={"channel": "ai_agent_adapter", "evidence_reference": "smoke-test", "terms_version": "v1"},
    )
    assert authorized.status_code == 200, authorized.text
    assert authorized.json()["data"]["routing_outcome"] == "offer_sent"

    async def offer_count_and_status() -> tuple[int, str]:
        async with await store._connect() as conn:
            cur = await conn.execute(
                "select count(*) from dispatch_offers where technician_id = %s", (tech_id,),
            )
            count = (await cur.fetchone())[0]
            cur = await conn.execute(
                "update dispatch_offers set expires_at = now() - interval '1 hour'"
                " where technician_id = %s returning job_id",
                (tech_id,),
            )
            job_id = (await cur.fetchone())[0]
        return count, str(job_id)

    offer_count, job_id = asyncio.run(offer_count_and_status())
    assert offer_count == 1  # at most one unowned offer, never a fan-out

    # Simulate the offer going stale, then run the same cleanup-only sweep the
    # cron uses -- it must NOT create a second/replacement offer (no auto
    # re-offer / auto-reroute), only return the job to pending_dispatch.
    asyncio.run(store.expire_stale_offers())

    async def post_expiry_state() -> tuple[int, str | None]:
        async with await store._connect() as conn:
            cur = await conn.execute(
                "select count(*) from dispatch_offers where technician_id = %s", (tech_id,),
            )
            total_offers = (await cur.fetchone())[0]
            cur = await conn.execute("select status from jobs where id = %s", (job_id,))
            row = await cur.fetchone()
        return total_offers, (row[0] if row else None)

    total_offers_after, job_status_after = asyncio.run(post_expiry_state())
    assert total_offers_after == 1  # still exactly the one original offer -- no re-offer
    assert job_status_after == "pending_dispatch"  # returned to the queue, not auto-reassigned


def test_governance_events_accepts_public_api_entity_types():
    """Regression (0058): the admin-provisioning slice (already shipped,
    entity_type='external_client'/'external_api_key') and the Network Router's
    routing-decision audit (entity_type='service_request') both write
    governance_events rows with entity types the original check constraint
    didn't allow. Neither was caught before merge -- InMemoryStore has no such
    constraint. This locks in the widened constraint directly."""
    async def exercise() -> None:
        store = PostgresStore(DSN)
        for entity_type in ("external_client", "external_api_key", "service_request"):
            event = await store.record_governance_event(
                entity_type=entity_type, entity_id=uuid4(), action="smoke_test",
            )
            assert event["entity_type"] == entity_type

    asyncio.run(exercise())
