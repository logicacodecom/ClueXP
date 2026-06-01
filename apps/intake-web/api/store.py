"""Ticket persistence.

Selected at import time from the environment:
- DATABASE_URL set  -> Supabase Postgres (`jobs.detail` JSONB plus queryable
  dispatch columns, with events linked by `job_id`). Use the Supabase
  *transaction pooler* URL (port 6543) on Vercel serverless; prepared statements
  are disabled so the pooler is happy.
- DATABASE_URL unset -> in-memory store, for local development without a DB.

The Ticket Pydantic model stays the single source of truth: we persist
`Ticket.model_dump(mode="json")` into `jobs.detail` and rehydrate with
`Ticket.model_validate`, while promoting the fields dispatch needs to query.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import UUID, uuid4

from api.schema import Ticket

DATABASE_URL = os.environ.get("DATABASE_URL")


def _trust_state_value(ticket: Ticket) -> str:
    state = ticket.trust_state
    return state.value if hasattr(state, "value") else str(state)


def _enum_value(value) -> str | None:
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


def _customer_from_payload(payload: dict) -> tuple[str | None, str | None]:
    """Best-effort bridge until the public Ticket schema grows customer fields."""
    customer = payload.get("customer") if isinstance(payload.get("customer"), dict) else {}
    identity = payload.get("identity") if isinstance(payload.get("identity"), dict) else {}
    phone = (
        payload.get("customer_phone")
        or customer.get("phone")
        or identity.get("phone")
        or identity.get("customer_phone")
    )
    name = (
        payload.get("customer_name")
        or customer.get("name")
        or identity.get("name")
        or identity.get("customer_name")
    )
    return (str(phone) if phone else None, str(name) if name else None)


def _uuid_or_none(value: str | UUID | None) -> UUID | None:
    if value is None:
        return None
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except ValueError:
        return None


class Store:
    async def startup(self) -> None:  # pragma: no cover - interface
        ...

    async def get(self, ticket_id: UUID) -> Ticket | None:  # pragma: no cover
        raise NotImplementedError

    async def save(self, ticket: Ticket) -> None:  # pragma: no cover
        raise NotImplementedError

    async def log_event(self, ticket: Ticket, event: str) -> None:  # pragma: no cover
        raise NotImplementedError

    async def record_media(
        self,
        *,
        owner_type: str,
        owner_id: UUID,
        kind: str,
        bucket: str,
        path: str,
        visibility: str,
    ) -> str:  # pragma: no cover
        raise NotImplementedError


class InMemoryStore(Store):
    def __init__(self) -> None:
        self._tickets: dict[UUID, Ticket] = {}
        self.events: list[str] = []
        self.media: list[dict[str, str]] = []

    async def get(self, ticket_id: UUID) -> Ticket | None:
        return self._tickets.get(ticket_id)

    async def save(self, ticket: Ticket) -> None:
        self._tickets[ticket.ticket_id] = ticket

    async def log_event(self, ticket: Ticket, event: str) -> None:
        stamp = datetime.now(timezone.utc).isoformat()
        self.events.append(f"{stamp} {ticket.ticket_id} {event} {_trust_state_value(ticket)}")

    async def record_media(
        self,
        *,
        owner_type: str,
        owner_id: UUID,
        kind: str,
        bucket: str,
        path: str,
        visibility: str,
    ) -> str:
        media_id = str(uuid4())
        self.media.append(
            {
                "id": media_id,
                "owner_type": owner_type,
                "owner_id": str(owner_id),
                "kind": kind,
                "bucket": bucket,
                "path": path,
                "visibility": visibility,
            }
        )
        return media_id


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
                "create table if not exists customers ("
                "  id uuid primary key default gen_random_uuid(),"
                "  phone text unique,"
                "  name text,"
                "  created_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists jobs ("
                "  id uuid primary key default gen_random_uuid(),"
                "  customer_id uuid references customers(id),"
                "  technician_id uuid,"
                "  trust_state text not null default 'intake',"
                "  status text not null default 'draft',"
                "  access_type text,"
                "  situation text,"
                "  urgency text,"
                "  lat double precision,"
                "  lng double precision,"
                "  address text,"
                "  detail jsonb not null default '{}',"
                "  price_quote jsonb,"
                "  final_charge jsonb,"
                "  created_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists events ("
                "  id bigserial primary key,"
                "  ticket_id uuid,"
                "  job_id uuid,"
                "  event text not null,"
                "  trust_state text,"
                "  at timestamptz not null default now()"
                ")"
            )
            await conn.execute("alter table events add column if not exists job_id uuid")
            await conn.execute(
                "create table if not exists media ("
                "  id uuid primary key default gen_random_uuid(),"
                "  owner_type text not null,"
                "  owner_id uuid not null,"
                "  kind text not null,"
                "  bucket text not null,"
                "  path text not null,"
                "  visibility text not null default 'private',"
                "  uploaded_by uuid,"
                "  uploaded_at timestamptz not null default now()"
                ")"
            )
            await conn.execute("create index if not exists idx_jobs_status on jobs (status)")
            await conn.execute(
                "create index if not exists idx_jobs_trust_state on jobs (trust_state)"
            )
            await conn.execute("create index if not exists idx_jobs_customer on jobs (customer_id)")
            await conn.execute(
                "create index if not exists idx_media_owner on media (owner_type, owner_id)"
            )

    async def get(self, ticket_id: UUID) -> Ticket | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select detail from jobs where id = %s", (str(ticket_id),)
            )
            row = await cur.fetchone()
            if row is None:
                # Compatibility for tickets created before Sprint 1's relational
                # store switch. New writes go only to jobs.
                cur = await conn.execute("select to_regclass('public.tickets')")
                has_legacy_tickets = (await cur.fetchone())[0] is not None
                if has_legacy_tickets:
                    cur = await conn.execute(
                        "select data from tickets where ticket_id = %s", (str(ticket_id),)
                    )
                    row = await cur.fetchone()
        return Ticket.model_validate(row[0]) if row else None

    async def save(self, ticket: Ticket) -> None:
        from psycopg.types.json import Jsonb

        payload = ticket.model_dump(mode="json")
        location = payload.get("location") if isinstance(payload.get("location"), dict) else {}
        assignment = (
            payload.get("technician_assignment")
            if isinstance(payload.get("technician_assignment"), dict)
            else {}
        )
        customer_phone, customer_name = _customer_from_payload(payload)
        technician_id = _uuid_or_none(assignment.get("technician_id"))

        async with await self._connect() as conn:
            customer_id = None
            if customer_phone:
                cur = await conn.execute(
                    "insert into customers (phone, name)"
                    " values (%s, %s)"
                    " on conflict (phone) do update"
                    " set name = coalesce(excluded.name, customers.name)"
                    " returning id",
                    (customer_phone, customer_name),
                )
                row = await cur.fetchone()
                customer_id = row[0] if row else None

            await conn.execute(
                "insert into jobs ("
                "  id, customer_id, technician_id, trust_state, status, access_type,"
                "  situation, urgency, lat, lng, address, detail, price_quote,"
                "  final_charge, created_at, updated_at"
                ") values ("
                "  %s, %s, %s, %s, %s, %s,"
                "  %s, %s, %s, %s, %s, %s, %s,"
                "  %s, %s, now()"
                ")"
                " on conflict (id) do update set"
                "  customer_id = coalesce(excluded.customer_id, jobs.customer_id),"
                "  technician_id = excluded.technician_id,"
                "  trust_state = excluded.trust_state,"
                "  status = excluded.status,"
                "  access_type = excluded.access_type,"
                "  situation = excluded.situation,"
                "  urgency = excluded.urgency,"
                "  lat = excluded.lat,"
                "  lng = excluded.lng,"
                "  address = excluded.address,"
                "  detail = excluded.detail,"
                "  price_quote = excluded.price_quote,"
                "  final_charge = excluded.final_charge,"
                "  updated_at = now()",
                (
                    str(ticket.ticket_id),
                    customer_id,
                    technician_id,
                    _trust_state_value(ticket),
                    _enum_value(ticket.status),
                    _enum_value(ticket.access_type),
                    _enum_value(ticket.situation),
                    _enum_value(ticket.urgency),
                    location.get("lat"),
                    location.get("lng"),
                    location.get("raw_text"),
                    Jsonb(payload),
                    Jsonb(payload.get("price_quote")) if payload.get("price_quote") else None,
                    Jsonb(payload.get("final_charge")) if payload.get("final_charge") else None,
                    ticket.created_at,
                ),
            )

    async def log_event(self, ticket: Ticket, event: str) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "insert into events (ticket_id, job_id, event, trust_state)"
                " values (%s, %s, %s, %s)",
                (
                    str(ticket.ticket_id),
                    str(ticket.ticket_id),
                    event,
                    _trust_state_value(ticket),
                ),
            )

    async def record_media(
        self,
        *,
        owner_type: str,
        owner_id: UUID,
        kind: str,
        bucket: str,
        path: str,
        visibility: str,
    ) -> str:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into media (owner_type, owner_id, kind, bucket, path, visibility)"
                " values (%s, %s, %s, %s, %s, %s)"
                " returning id",
                (owner_type, str(owner_id), kind, bucket, path, visibility),
            )
            row = await cur.fetchone()
        return str(row[0])


def make_store() -> Store:
    if DATABASE_URL:
        return PostgresStore(DATABASE_URL)
    return InMemoryStore()
