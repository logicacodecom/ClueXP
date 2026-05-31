"""Ticket persistence.

Selected at import time from the environment:
- DATABASE_URL set  -> Supabase Postgres (one JSONB row per ticket + an events
  audit table). Use the Supabase *transaction pooler* URL (port 6543) on Vercel
  serverless; prepared statements are disabled so the pooler is happy.
- DATABASE_URL unset -> in-memory store, for local development without a DB.

The Ticket Pydantic model stays the single source of truth: we persist
`Ticket.model_dump(mode="json")` and rehydrate with `Ticket.model_validate`,
so no per-field columns drift from api/schema.py.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import UUID

from api.schema import Ticket

DATABASE_URL = os.environ.get("DATABASE_URL")


def _trust_state_value(ticket: Ticket) -> str:
    state = ticket.trust_state
    return state.value if hasattr(state, "value") else str(state)


class Store:
    async def startup(self) -> None:  # pragma: no cover - interface
        ...

    async def get(self, ticket_id: UUID) -> Ticket | None:  # pragma: no cover
        raise NotImplementedError

    async def save(self, ticket: Ticket) -> None:  # pragma: no cover
        raise NotImplementedError

    async def log_event(self, ticket: Ticket, event: str) -> None:  # pragma: no cover
        raise NotImplementedError


class InMemoryStore(Store):
    def __init__(self) -> None:
        self._tickets: dict[UUID, Ticket] = {}
        self.events: list[str] = []

    async def get(self, ticket_id: UUID) -> Ticket | None:
        return self._tickets.get(ticket_id)

    async def save(self, ticket: Ticket) -> None:
        self._tickets[ticket.ticket_id] = ticket

    async def log_event(self, ticket: Ticket, event: str) -> None:
        stamp = datetime.now(timezone.utc).isoformat()
        self.events.append(f"{stamp} {ticket.ticket_id} {event} {_trust_state_value(ticket)}")


class PostgresStore(Store):
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    async def _connect(self):
        import psycopg

        # autocommit + no prepared statements => safe behind the Supabase pooler.
        return await psycopg.AsyncConnection.connect(
            self._dsn, autocommit=True, prepare_threshold=None
        )

    async def startup(self) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "create table if not exists tickets ("
                "  ticket_id uuid primary key,"
                "  data jsonb not null,"
                "  updated_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists events ("
                "  id bigserial primary key,"
                "  ticket_id uuid,"
                "  event text not null,"
                "  trust_state text,"
                "  at timestamptz not null default now()"
                ")"
            )

    async def get(self, ticket_id: UUID) -> Ticket | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select data from tickets where ticket_id = %s", (str(ticket_id),)
            )
            row = await cur.fetchone()
        return Ticket.model_validate(row[0]) if row else None

    async def save(self, ticket: Ticket) -> None:
        from psycopg.types.json import Jsonb

        payload = ticket.model_dump(mode="json")
        async with await self._connect() as conn:
            await conn.execute(
                "insert into tickets (ticket_id, data, updated_at)"
                " values (%s, %s, now())"
                " on conflict (ticket_id)"
                " do update set data = excluded.data, updated_at = now()",
                (str(ticket.ticket_id), Jsonb(payload)),
            )

    async def log_event(self, ticket: Ticket, event: str) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "insert into events (ticket_id, event, trust_state) values (%s, %s, %s)",
                (str(ticket.ticket_id), event, _trust_state_value(ticket)),
            )


def make_store() -> Store:
    if DATABASE_URL:
        return PostgresStore(DATABASE_URL)
    return InMemoryStore()
