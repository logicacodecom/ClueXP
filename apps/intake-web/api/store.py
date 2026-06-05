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

from api.auth import hash_password, verify_password
from api.schema import Ticket

DATABASE_URL = os.environ.get("DATABASE_URL")

# Demo/seed login password. Intentionally simple for the demo environment; override
# via env. The JWT signing secret (AUTH_SECRET) is separate and must still be strong.
DEMO_PASSWORD = os.environ.get("DEMO_SEED_PASSWORD", "123456")


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

    async def save(self, ticket: Ticket, origin: dict | None = None) -> None:  # pragma: no cover
        raise NotImplementedError

    async def resolve_intake_channel(self, slug: str | None) -> dict | None:  # pragma: no cover
        """Trusted server-side slug -> owning-org resolution (adr/0004).

        Returns {origin_org_id, customer_owner_org_id, intake_channel_id} for a
        known active channel, else None (public ClueXP intake). A browser-supplied
        org id is never trusted — only this lookup confers tenancy."""
        return None

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

    async def authenticate_user(self, identifier: str, password: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def get_user_session(self, user_id: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def record_review(
        self,
        *,
        ticket_id: UUID,
        rating: int,
        tags: list[str],
        comment: str | None,
    ) -> dict:  # pragma: no cover
        raise NotImplementedError


class InMemoryStore(Store):
    def __init__(self) -> None:
        self._tickets: dict[UUID, Ticket] = {}
        self.events: list[str] = []
        self.media: list[dict[str, str]] = []
        password_hash = hash_password(DEMO_PASSWORD, salt="cluexp-demo-salt")
        self.users: dict[str, dict] = {
            "usr_platform_demo": {
                "id": "usr_platform_demo",
                "email": "avery@cluexp.com",
                "phone": None,
                "display_name": "Avery Knox",
                "password_hash": password_hash,
                "roles": ["platform_admin"],
                "active_organization_id": None,
                "organization_name": None,
            },
            "usr_provider_demo": {
                "id": "usr_provider_demo",
                "email": "dispatch@metrokey.example",
                "phone": "+15550140199",
                "display_name": "Nadia Reyes",
                "password_hash": password_hash,
                "roles": ["provider_admin", "dispatcher"],
                "active_organization_id": "org-metro",
                "organization_name": "Metro Key Partners",
            },
            "usr_tech_demo": {
                "id": "usr_tech_demo",
                "email": "jordan@cluexp.example",
                "phone": "+15550142201",
                "display_name": "Jordan Lee",
                "password_hash": password_hash,
                "roles": ["technician"],
                "active_organization_id": None,
                "organization_name": None,
            },
        }
        self.reviews: list[dict] = []

    async def get(self, ticket_id: UUID) -> Ticket | None:
        return self._tickets.get(ticket_id)

    async def save(self, ticket: Ticket, origin: dict | None = None) -> None:
        self._tickets[ticket.ticket_id] = ticket

    async def resolve_intake_channel(self, slug: str | None) -> dict | None:
        # No DB locally — public ClueXP intake (no owning org).
        return None

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

    async def authenticate_user(self, identifier: str, password: str) -> dict | None:
        normalized = identifier.strip().lower()
        for user in self.users.values():
            if normalized not in {str(user.get("email") or "").lower(), str(user.get("phone") or "")}:
                continue
            if not verify_password(password, user.get("password_hash")):
                return None
            return await self.get_user_session(user["id"])
        return None

    async def get_user_session(self, user_id: str) -> dict | None:
        user = self.users.get(user_id)
        if not user:
            return None
        return {
            "user": {
                "id": user["id"],
                "email": user["email"],
                "phone": user["phone"],
                "display_name": user["display_name"],
            },
            "roles": user["roles"],
            "active_organization_id": user["active_organization_id"],
            "organization_name": user["organization_name"],
        }

    async def record_review(
        self,
        *,
        ticket_id: UUID,
        rating: int,
        tags: list[str],
        comment: str | None,
    ) -> dict:
        ticket = await self.get(ticket_id)
        if ticket is None:
            raise KeyError(str(ticket_id))
        review = {
            "id": str(uuid4()),
            "ticket_id": str(ticket_id),
            "rating": rating,
            "tags": tags,
            "comment": comment,
            "technician_ref": ticket.technician_assignment.technician_id
            if ticket.technician_assignment
            else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.reviews.append(review)
        return review


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
                "  fulfillment_technician_id uuid,"
                "  fulfillment_org_id uuid,"
                "  origin_org_id uuid,"
                "  customer_owner_org_id uuid,"
                "  intake_channel_id uuid,"
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
            await conn.execute("alter table jobs add column if not exists fulfillment_org_id uuid")
            await conn.execute(
                "create table if not exists users ("
                "  id uuid primary key default gen_random_uuid(),"
                "  email text unique,"
                "  phone text unique,"
                "  password_hash text not null,"
                "  display_name text not null,"
                "  status text not null default 'active',"
                "  created_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists user_roles ("
                "  user_id uuid not null references users(id) on delete cascade,"
                "  role text not null,"
                "  created_at timestamptz not null default now(),"
                "  primary key (user_id, role)"
                ")"
            )
            await conn.execute(
                "create table if not exists user_organization_memberships ("
                "  user_id uuid not null references users(id) on delete cascade,"
                "  organization_id uuid not null,"
                "  role text not null default 'member',"
                "  status text not null default 'active',"
                "  created_at timestamptz not null default now(),"
                "  primary key (user_id, organization_id)"
                ")"
            )
            await conn.execute(
                "create table if not exists job_reviews ("
                "  id uuid primary key default gen_random_uuid(),"
                "  job_id uuid not null,"
                "  rating integer not null check (rating between 1 and 5),"
                "  tags text[] not null default '{}',"
                "  comment text,"
                "  fulfillment_technician_ref text,"
                "  fulfillment_org_id uuid,"
                "  created_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists rating_summaries ("
                "  target_type text not null,"
                "  target_id text not null,"
                "  average_rating numeric(3,2) not null default 0,"
                "  review_count integer not null default 0,"
                "  updated_at timestamptz not null default now(),"
                "  primary key (target_type, target_id)"
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
            await conn.execute("create index if not exists idx_user_roles_user on user_roles (user_id)")
            await conn.execute(
                "create index if not exists idx_user_memberships_org"
                " on user_organization_memberships (organization_id)"
            )
            await conn.execute("create index if not exists idx_job_reviews_job on job_reviews (job_id)")
            await conn.execute(
                "create index if not exists idx_job_reviews_technician"
                " on job_reviews (fulfillment_technician_ref)"
            )
            await self._seed_demo_auth(conn)

    async def _seed_demo_auth(self, conn) -> None:
        password_hash = hash_password(DEMO_PASSWORD, salt="cluexp-demo-salt")
        provider_org_id = None
        try:
            cur = await conn.execute(
                "insert into organizations (display_name, legal_name, slug, status, subscription_status, email)"
                " values (%s, %s, %s, %s, %s, %s)"
                " on conflict (slug) do update set display_name = excluded.display_name"
                " returning id",
                (
                    "Metro Key Partners",
                    "Metro Key Partners LLC",
                    "metro-key",
                    "eligible",
                    "active",
                    "dispatch@metrokey.example",
                ),
            )
            row = await cur.fetchone()
            provider_org_id = row[0] if row else None
        except Exception:
            provider_org_id = None

        async def ensure_user(email: str, display_name: str, roles: list[str], org_id=None, phone=None):
            cur = await conn.execute(
                "insert into users (email, phone, password_hash, display_name, status)"
                " values (%s, %s, %s, %s, 'active')"
                " on conflict (email) do update set"
                "  display_name = excluded.display_name,"
                "  password_hash = excluded.password_hash,"
                "  updated_at = now()"
                " returning id",
                (email, phone, password_hash, display_name),
            )
            row = await cur.fetchone()
            if not row:
                return
            user_id = row[0]
            for role in roles:
                await conn.execute(
                    "insert into user_roles (user_id, role) values (%s, %s)"
                    " on conflict do nothing",
                    (user_id, role),
                )
            if org_id:
                await conn.execute(
                    "insert into user_organization_memberships (user_id, organization_id, role, status)"
                    " values (%s, %s, %s, 'active')"
                    " on conflict (user_id, organization_id) do update"
                    " set role = excluded.role, status = 'active'",
                    (user_id, org_id, "provider_admin"),
                )

        await ensure_user("avery@cluexp.com", "Avery Knox", ["platform_admin"])
        await ensure_user(
            "dispatch@metrokey.example",
            "Nadia Reyes",
            ["provider_admin", "dispatcher"],
            provider_org_id,
            "+15550140199",
        )
        await ensure_user(
            "jordan@cluexp.example",
            "Jordan Lee",
            ["technician"],
            None,
            "+15550142201",
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

    async def save(self, ticket: Ticket, origin: dict | None = None) -> None:
        from psycopg.types.json import Jsonb

        payload = ticket.model_dump(mode="json")
        location = payload.get("location") if isinstance(payload.get("location"), dict) else {}
        assignment = (
            payload.get("technician_assignment")
            if isinstance(payload.get("technician_assignment"), dict)
            else {}
        )
        origin = origin or {}
        customer_phone, customer_name = _customer_from_payload(payload)
        customer_phone = customer_phone or origin.get("customer_phone")
        customer_name = customer_name or origin.get("customer_name")
        technician_id = _uuid_or_none(assignment.get("technician_id"))
        origin_org_id = _uuid_or_none(origin.get("origin_org_id"))
        customer_owner_org_id = _uuid_or_none(origin.get("customer_owner_org_id"))
        intake_channel_id = _uuid_or_none(origin.get("intake_channel_id"))

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
                "  id, customer_id, fulfillment_technician_id,"
                "  origin_org_id, customer_owner_org_id, intake_channel_id,"
                "  trust_state, status, access_type,"
                "  situation, urgency, lat, lng, address, detail, price_quote,"
                "  final_charge, created_at, updated_at"
                ") values ("
                "  %s, %s, %s,"
                "  %s, %s, %s,"
                "  %s, %s, %s,"
                "  %s, %s, %s, %s, %s, %s, %s,"
                "  %s, %s, now()"
                ")"
                " on conflict (id) do update set"
                "  customer_id = coalesce(excluded.customer_id, jobs.customer_id),"
                "  fulfillment_technician_id = excluded.fulfillment_technician_id,"
                "  origin_org_id = coalesce(jobs.origin_org_id, excluded.origin_org_id),"
                "  customer_owner_org_id = coalesce(jobs.customer_owner_org_id, excluded.customer_owner_org_id),"
                "  intake_channel_id = coalesce(jobs.intake_channel_id, excluded.intake_channel_id),"
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
                    origin_org_id,
                    customer_owner_org_id,
                    intake_channel_id,
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

    async def resolve_intake_channel(self, slug: str | None) -> dict | None:
        if not slug:
            return None
        try:
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "select id, organization_id from intake_channels"
                    " where slug = %s and active = true",
                    (slug,),
                )
                row = await cur.fetchone()
        except Exception:
            # Table not present yet (pre-0004) or lookup failed → public intake.
            return None
        if not row:
            return None
        channel_id, org_id = row[0], row[1]
        return {
            "intake_channel_id": channel_id,
            "origin_org_id": org_id,
            "customer_owner_org_id": org_id,  # origin owns the customer (adr/0004 §4)
        }

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

    async def authenticate_user(self, identifier: str, password: str) -> dict | None:
        normalized = identifier.strip().lower()
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, password_hash from users"
                " where status = 'active' and (lower(email) = %s or phone = %s)",
                (normalized, identifier.strip()),
            )
            row = await cur.fetchone()
            if row is None or not verify_password(password, row[1]):
                return None
            return await self._session_for_user(conn, str(row[0]))

    async def get_user_session(self, user_id: str) -> dict | None:
        async with await self._connect() as conn:
            return await self._session_for_user(conn, user_id)

    async def _session_for_user(self, conn, user_id: str) -> dict | None:
        cur = await conn.execute(
            "select id, email, phone, display_name from users where id = %s and status = 'active'",
            (user_id,),
        )
        user_row = await cur.fetchone()
        if user_row is None:
            return None
        cur = await conn.execute(
            "select role from user_roles where user_id = %s order by role",
            (user_id,),
        )
        roles = [row[0] for row in await cur.fetchall()]
        cur = await conn.execute(
            "select m.organization_id, o.display_name"
            " from user_organization_memberships m"
            " left join organizations o on o.id = m.organization_id"
            " where m.user_id = %s and m.status = 'active'"
            " order by m.created_at"
            " limit 1",
            (user_id,),
        )
        org_row = await cur.fetchone()
        return {
            "user": {
                "id": str(user_row[0]),
                "email": user_row[1],
                "phone": user_row[2],
                "display_name": user_row[3],
            },
            "roles": roles,
            "active_organization_id": str(org_row[0]) if org_row else None,
            "organization_name": org_row[1] if org_row else None,
        }

    async def record_review(
        self,
        *,
        ticket_id: UUID,
        rating: int,
        tags: list[str],
        comment: str | None,
    ) -> dict:
        from psycopg.types.json import Jsonb

        ticket = await self.get(ticket_id)
        if ticket is None:
            raise KeyError(str(ticket_id))
        technician_ref = (
            ticket.technician_assignment.technician_id if ticket.technician_assignment else None
        )
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select fulfillment_org_id from jobs where id = %s",
                (str(ticket_id),),
            )
            row = await cur.fetchone()
            fulfillment_org_id = row[0] if row else None
            cur = await conn.execute(
                "insert into job_reviews ("
                " job_id, rating, tags, comment, fulfillment_technician_ref, fulfillment_org_id"
                ") values (%s, %s, %s, %s, %s, %s)"
                " returning id, created_at",
                (str(ticket_id), rating, tags, comment, technician_ref, fulfillment_org_id),
            )
            review_row = await cur.fetchone()
            targets = []
            if technician_ref:
                targets.append(("technician", technician_ref))
            if fulfillment_org_id:
                targets.append(("organization", str(fulfillment_org_id)))
            for target_type, target_id in targets:
                await conn.execute(
                    "insert into rating_summaries (target_type, target_id, average_rating, review_count)"
                    " select %s, %s, avg(rating)::numeric(3,2), count(*)::integer"
                    " from job_reviews"
                    " where (%s = 'technician' and fulfillment_technician_ref = %s)"
                    "    or (%s = 'organization' and fulfillment_org_id::text = %s)"
                    " on conflict (target_type, target_id) do update set"
                    "  average_rating = excluded.average_rating,"
                    "  review_count = excluded.review_count,"
                    "  updated_at = now()",
                    (target_type, target_id, target_type, target_id, target_type, target_id),
                )
            payload = ticket.model_dump(mode="json")
            payload["latest_review"] = {
                "rating": rating,
                "tags": tags,
                "comment": comment,
                "created_at": review_row[1].isoformat() if review_row else None,
            }
            await conn.execute(
                "update jobs set detail = %s, updated_at = now() where id = %s",
                (Jsonb(payload), str(ticket_id)),
            )
        return {
            "id": str(review_row[0]) if review_row else None,
            "ticket_id": str(ticket_id),
            "rating": rating,
            "tags": tags,
            "comment": comment,
            "technician_ref": technician_ref,
            "organization_id": str(fulfillment_org_id) if fulfillment_org_id else None,
        }


def make_store() -> Store:
    if DATABASE_URL:
        return PostgresStore(DATABASE_URL)
    return InMemoryStore()
