"""Real-Postgres Sprint 0 checks. Skipped outside the dedicated CI tier."""
from __future__ import annotations

import asyncio
import os
from uuid import uuid4

import psycopg
import pytest
from psycopg.errors import InsufficientPrivilege

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
