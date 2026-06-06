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
from api.dispatch import (
    eta_range_from_km,
    haversine_km,
    is_terminal,
    resolve_dispatch_state,
)
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


def _slugify(name: str) -> str:
    out = []
    for ch in (name or "").strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in " -_":
            out.append("-")
    slug = "".join(out).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "org"


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

    async def register_technician(self, data: dict) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def register_organization(self, data: dict) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def approve_technician(self, technician_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def approve_organization(self, organization_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def reject_technician(self, technician_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def reject_organization(self, organization_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def update_user_locale(self, user_id: str, locale: str) -> None:  # pragma: no cover
        raise NotImplementedError

    async def list_technician_offers(self, technician_id: UUID) -> list[dict]:  # pragma: no cover
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

    async def get_dispatch_job(self, job_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def list_available_technicians(self) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def create_dispatch_offers(
        self, job_id: UUID, ranked: list[dict], expires_at: datetime
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def accept_dispatch_offer(self, offer_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def bump_dispatch_attempt(self, job_id: UUID) -> int:  # pragma: no cover
        raise NotImplementedError

    async def expire_stale_offers(self) -> int:  # pragma: no cover
        raise NotImplementedError

    async def list_dispatchable_jobs(
        self, *, max_attempts: int, total_timeout_seconds: int, limit: int = 100
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def get_dispatch_status(
        self, ticket_id: UUID, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:  # pragma: no cover
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

    async def get_dispatch_job(self, job_id: UUID) -> dict | None:
        ticket = await self.get(job_id)
        if ticket is None:
            return None
        loc = getattr(ticket, "location", None)
        return {
            "id": str(job_id),
            "lat": getattr(loc, "lat", None),
            "lng": getattr(loc, "lng", None),
            "access_type": ticket.access_type.value if ticket.access_type else None,
            "fulfillment_technician_id": None,
        }

    async def list_available_technicians(self) -> list[dict]:
        return list(getattr(self, "_technicians", []))

    async def create_dispatch_offers(
        self, job_id: UUID, ranked: list[dict], expires_at: datetime
    ) -> list[dict]:
        offers = getattr(self, "_offers", None)
        if offers is None:
            offers = self._offers = {}
        created = []
        for rank, tech in enumerate(ranked):
            rec = {
                "id": str(uuid4()),
                "job_id": str(job_id),
                "technician_id": str(tech["id"]),
                "organization_id": tech.get("primary_organization_id"),
                "rank": rank,
                "status": "offered",
                "dist_km": tech.get("dist_km"),
            }
            offers[rec["id"]] = rec
            created.append(rec)
        return created

    async def accept_dispatch_offer(self, offer_id: UUID) -> dict | None:
        offers = getattr(self, "_offers", {})
        rec = offers.get(str(offer_id))
        if rec is None:
            return None
        if rec["status"] != "offered":
            return {"accepted": False, "reason": rec["status"], "job_id": rec["job_id"]}
        rec["status"] = "accepted"
        for other in offers.values():
            if (
                other["job_id"] == rec["job_id"]
                and other["id"] != rec["id"]
                and other["status"] == "offered"
            ):
                other["status"] = "superseded"
        return {
            "accepted": True,
            "job_id": rec["job_id"],
            "technician_id": rec["technician_id"],
            "organization_id": rec.get("organization_id"),
        }

    async def bump_dispatch_attempt(self, job_id: UUID) -> int:
        self._attempts = getattr(self, "_attempts", {})
        self._attempts[str(job_id)] = self._attempts.get(str(job_id), 0) + 1
        return self._attempts[str(job_id)]

    async def expire_stale_offers(self) -> int:
        return 0

    async def list_dispatchable_jobs(
        self, *, max_attempts: int, total_timeout_seconds: int, limit: int = 100
    ) -> list[dict]:
        return []

    async def get_dispatch_status(
        self, ticket_id: UUID, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:
        offers = getattr(self, "_offers", {})
        jid = str(ticket_id)
        active = sum(1 for o in offers.values() if o["job_id"] == jid and o["status"] == "offered")
        total = sum(1 for o in offers.values() if o["job_id"] == jid)
        matched = any(o["job_id"] == jid and o["status"] == "accepted" for o in offers.values())
        attempts = getattr(self, "_attempts", {}).get(jid, 0)
        state = resolve_dispatch_state(
            matched=matched, active_offers=active, total_offers=total,
            attempts=attempts, max_attempts=max_attempts, timed_out=False,
        )
        return {
            "state": state,
            "terminal": is_terminal(state, attempts=attempts, max_attempts=max_attempts, timed_out=False),
            "attempts": attempts,
            "max_attempts": max_attempts,
            "offers_pending": active,
            "offer_expires_at": None,
            "assignment": None,
        }

    async def register_technician(self, data: dict) -> dict:
        raise NotImplementedError("registration requires the Postgres store")

    async def register_organization(self, data: dict) -> dict:
        raise NotImplementedError("registration requires the Postgres store")

    async def approve_technician(self, technician_id: UUID) -> dict | None:
        return None

    async def approve_organization(self, organization_id: UUID) -> dict | None:
        return None

    async def reject_technician(self, technician_id: UUID) -> dict | None:
        return None

    async def reject_organization(self, organization_id: UUID) -> dict | None:
        return None

    async def update_user_locale(self, user_id: str, locale: str) -> None:
        return None

    async def list_technician_offers(self, technician_id: UUID) -> list[dict]:
        return []


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
            "select id, email, phone, display_name, locale from users"
            " where id = %s and status = 'active'",
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
        # Technician profile is 1:1 with the user (same id) when self-registered.
        cur = await conn.execute(
            "select id, status, vetting_status, is_available from technicians where id = %s",
            (user_id,),
        )
        tech_row = await cur.fetchone()
        return {
            "user": {
                "id": str(user_row[0]),
                "email": user_row[1],
                "phone": user_row[2],
                "display_name": user_row[3],
                "locale": user_row[4],
            },
            "roles": roles,
            "active_organization_id": str(org_row[0]) if org_row else None,
            "organization_name": org_row[1] if org_row else None,
            "technician": {
                "id": str(tech_row[0]),
                "status": tech_row[1],
                "vetting_status": tech_row[2],
                "is_available": tech_row[3],
                "approved": tech_row[1] == "active" and tech_row[2] == "verified",
            }
            if tech_row
            else None,
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

    async def get_dispatch_job(self, job_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, lat, lng, access_type, fulfillment_technician_id,"
                " customer_owner_org_id, fulfillment_policy, dispatch_attempts, trust_state"
                " from jobs where id = %s",
                (str(job_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]),
            "lat": row[1],
            "lng": row[2],
            "access_type": row[3],
            "fulfillment_technician_id": str(row[4]) if row[4] else None,
            "customer_owner_org_id": str(row[5]) if row[5] else None,
            "fulfillment_policy": row[6],
            "dispatch_attempts": row[7] or 0,
            "trust_state": row[8],
        }

    async def list_available_technicians(self) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select t.id, t.display_name, t.skills, t.service_area_center_lat,"
                " t.service_area_center_lng, t.service_area_radius_km, t.rating,"
                " t.is_available, t.provider_type, t.primary_organization_id,"
                " coalesce(array_remove(array_agg(distinct ot.organization_id)"
                "   filter (where ot.status = 'active'), null), '{}') as affiliated"
                " from technicians t"
                " left join organization_technicians ot on ot.technician_id = t.id"
                " where t.status = 'active' and t.vetting_status = 'verified'"
                " and t.is_available = true"
                " group by t.id"
            )
            rows = await cur.fetchall()
        result = []
        for r in rows:
            primary = str(r[9]) if r[9] else None
            affiliated = [str(o) for o in (r[10] or [])]
            org_ids = list({oid for oid in ([primary] + affiliated) if oid})
            result.append(
                {
                    "id": str(r[0]),
                    "display_name": r[1],
                    "skills": list(r[2] or []),
                    "service_area_center_lat": r[3],
                    "service_area_center_lng": r[4],
                    "service_area_radius_km": r[5],
                    "rating": float(r[6]) if r[6] is not None else 0.0,
                    "is_available": r[7],
                    "provider_type": r[8],
                    "primary_organization_id": primary,
                    "org_ids": org_ids,
                }
            )
        return result

    async def create_dispatch_offers(
        self, job_id: UUID, ranked: list[dict], expires_at: datetime
    ) -> list[dict]:
        offers: list[dict] = []
        async with await self._connect() as conn:
            # Re-dispatch is idempotent: retire any still-open offers first.
            await conn.execute(
                "update dispatch_offers set status = 'superseded', responded_at = now()"
                " where job_id = %s and status = 'offered'",
                (str(job_id),),
            )
            for rank, tech in enumerate(ranked):
                org_id = tech.get("primary_organization_id")
                cur = await conn.execute(
                    "insert into dispatch_offers"
                    " (id, job_id, technician_id, status, rank, offered_at, expires_at, organization_id)"
                    " values (gen_random_uuid(), %s, %s, 'offered', %s, now(), %s, %s)"
                    " returning id",
                    (str(job_id), str(tech["id"]), rank, expires_at, org_id),
                )
                row = await cur.fetchone()
                offers.append(
                    {
                        "id": str(row[0]),
                        "job_id": str(job_id),
                        "technician_id": str(tech["id"]),
                        "organization_id": org_id,
                        "rank": rank,
                        "status": "offered",
                        "dist_km": tech.get("dist_km"),
                    }
                )
        return offers

    async def accept_dispatch_offer(self, offer_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select job_id, technician_id, organization_id, status"
                " from dispatch_offers where id = %s",
                (str(offer_id),),
            )
            offer = await cur.fetchone()
            if not offer:
                return None
            job_id, tech_id, org_id, status = offer[0], offer[1], offer[2], offer[3]
            if status != "offered":
                return {"accepted": False, "reason": status, "job_id": str(job_id)}
            # Atomic first-accept-wins: only one accept can flip the null job.
            cur = await conn.execute(
                "update jobs set fulfillment_technician_id = %s, fulfillment_org_id = %s,"
                " trust_state = 'matched', updated_at = now()"
                " where id = %s and fulfillment_technician_id is null"
                " returning id",
                (str(tech_id), str(org_id) if org_id else None, str(job_id)),
            )
            won = await cur.fetchone()
            if not won:
                await conn.execute(
                    "update dispatch_offers set status = 'superseded', responded_at = now()"
                    " where id = %s and status = 'offered'",
                    (str(offer_id),),
                )
                return {"accepted": False, "reason": "already_matched", "job_id": str(job_id)}
            await conn.execute(
                "update dispatch_offers set status = 'accepted', responded_at = now() where id = %s",
                (str(offer_id),),
            )
            await conn.execute(
                "update dispatch_offers set status = 'superseded', responded_at = now()"
                " where job_id = %s and id <> %s and status = 'offered'",
                (str(job_id), str(offer_id)),
            )
        return {
            "accepted": True,
            "job_id": str(job_id),
            "technician_id": str(tech_id),
            "organization_id": str(org_id) if org_id else None,
        }

    async def bump_dispatch_attempt(self, job_id: UUID) -> int:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update jobs set dispatch_attempts = dispatch_attempts + 1, updated_at = now()"
                " where id = %s returning dispatch_attempts",
                (str(job_id),),
            )
            row = await cur.fetchone()
        return row[0] if row else 0

    async def expire_stale_offers(self) -> int:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update dispatch_offers set status = 'expired', responded_at = now()"
                " where status = 'offered' and expires_at is not null and expires_at < now()"
                " returning 1"
            )
            rows = await cur.fetchall()
        return len(rows)

    async def list_dispatchable_jobs(
        self, *, max_attempts: int, total_timeout_seconds: int, limit: int = 100
    ) -> list[dict]:
        """Unmatched jobs already in the dispatch pipeline whose offers have all
        lapsed, that are not exhausted (attempts<max) and within the total window.
        These are the jobs the sweep re-dispatches."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, lat, lng, access_type, customer_owner_org_id,"
                " fulfillment_policy, dispatch_attempts"
                " from jobs j"
                " where j.fulfillment_technician_id is null"
                "   and j.dispatch_attempts > 0"
                "   and j.dispatch_attempts < %s"
                "   and extract(epoch from (now() - j.created_at)) < %s"
                "   and not exists ("
                "     select 1 from dispatch_offers o where o.job_id = j.id"
                "       and o.status = 'offered' and (o.expires_at is null or o.expires_at > now()))"
                " order by j.created_at asc limit %s",
                (max_attempts, total_timeout_seconds, limit),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]),
                "lat": r[1],
                "lng": r[2],
                "access_type": r[3],
                "customer_owner_org_id": str(r[4]) if r[4] else None,
                "fulfillment_policy": r[5],
                "dispatch_attempts": r[6] or 0,
            }
            for r in rows
        ]

    async def get_dispatch_status(
        self, ticket_id: UUID, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:
        """Customer-safe tracking read. Pure relational; never creates offers and
        never exposes candidates, scoring, rosters, or internal IDs."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select fulfillment_technician_id, fulfillment_org_id, customer_owner_org_id,"
                " status, dispatch_attempts, lat, lng,"
                " extract(epoch from (now() - created_at))::int"
                " from jobs where id = %s",
                (str(ticket_id),),
            )
            job = await cur.fetchone()
            if not job:
                return None
            tech_id, org_id, owner_org_id, job_status, attempts, lat, lng, age = job
            attempts = attempts or 0
            cur = await conn.execute(
                "select"
                " count(*) filter (where status='offered' and (expires_at is null or expires_at > now())),"
                " count(*),"
                " max(expires_at) filter (where status='offered' and (expires_at is null or expires_at > now()))"
                " from dispatch_offers where job_id = %s",
                (str(ticket_id),),
            )
            orow = await cur.fetchone()
            active, total, next_expiry = orow[0] or 0, orow[1] or 0, orow[2]
            matched = tech_id is not None
            timed_out = (age or 0) >= total_timeout_seconds
            state = resolve_dispatch_state(
                matched=matched,
                active_offers=active,
                total_offers=total,
                attempts=attempts,
                max_attempts=max_attempts,
                timed_out=timed_out,
            )
            terminal = is_terminal(
                state, attempts=attempts, max_attempts=max_attempts, timed_out=timed_out
            )
            assignment = None
            if matched:
                assignment = await self._safe_assignment(
                    conn, tech_id, org_id, owner_org_id, lat, lng, ticket_id, job_status
                )
        return {
            "state": state,
            "terminal": terminal,
            "attempts": attempts,
            "max_attempts": max_attempts,
            "offers_pending": active,
            "offer_expires_at": next_expiry.isoformat() if next_expiry else None,
            "assignment": assignment,
        }

    async def _safe_assignment(
        self, conn, tech_id, fulfillment_org_id, owner_org_id, job_lat, job_lng, job_id, job_status
    ) -> dict | None:
        cur = await conn.execute(
            "select display_name, rating, provider_type, current_lat, current_lng,"
            " service_area_center_lat, service_area_center_lng"
            " from technicians where id = %s",
            (str(tech_id),),
        )
        t = await cur.fetchone()
        if not t:
            return None
        display_name, rating, _provider_type, cur_lat, cur_lng, sa_lat, sa_lng = t

        async def _org_name(oid):
            if not oid:
                return None
            c = await conn.execute("select display_name from organizations where id = %s", (str(oid),))
            r = await c.fetchone()
            return r[0] if r else None

        customer_owner = await _org_name(owner_org_id)
        provider_company = await _org_name(fulfillment_org_id)
        if fulfillment_org_id:
            fulfillment_type = (
                "company_technician"
                if str(fulfillment_org_id) == str(owner_org_id)
                else "network_provider"
            )
        else:
            fulfillment_type = "independent_technician"

        t_lat = cur_lat if cur_lat is not None else sa_lat
        t_lng = cur_lng if cur_lng is not None else sa_lng
        eta_min, eta_max = eta_range_from_km(haversine_km(job_lat, job_lng, t_lat, t_lng))

        cur = await conn.execute(
            "select responded_at from dispatch_offers"
            " where job_id = %s and technician_id = %s and status = 'accepted'"
            " order by responded_at desc limit 1",
            (str(job_id), str(tech_id)),
        )
        ar = await cur.fetchone()
        assigned_at = ar[0] if ar else None

        return {
            "customer_owner": customer_owner,
            "fulfillment_type": fulfillment_type,
            "provider_company": provider_company,
            "technician_display_name": display_name,
            "role": "Verified Technician",
            "rating": float(rating) if rating is not None else None,
            "eta_min": eta_min,
            "eta_max": eta_max,
            "eta_is_estimate": True,
            "assigned_at": assigned_at.isoformat() if assigned_at else None,
            "job_status": job_status or "assigned",
        }

    async def register_technician(self, data: dict) -> dict:
        email = (data.get("email") or "").strip() or None
        phone = (data.get("phone") or "").strip() or None
        pw_hash = hash_password(data["password"])
        async with await self._connect() as conn:
            if email:
                cur = await conn.execute("select 1 from users where lower(email) = lower(%s)", (email,))
                if await cur.fetchone():
                    raise ValueError("email_taken")
            if phone:
                cur = await conn.execute("select 1 from users where phone = %s", (phone,))
                if await cur.fetchone():
                    raise ValueError("phone_taken")
            cur = await conn.execute(
                "insert into users (email, phone, password_hash, display_name, status, locale)"
                " values (%s, %s, %s, %s, 'active', %s) returning id",
                (email, phone, pw_hash, data["display_name"], data.get("locale")),
            )
            user_id = (await cur.fetchone())[0]
            await conn.execute(
                "insert into user_roles (user_id, role) values (%s, 'technician') on conflict do nothing",
                (user_id,),
            )
            # 1:1 technician profile, same id; PENDING approval (dispatch excludes it).
            await conn.execute(
                "insert into technicians (id, display_name, email, phone, status, vetting_status,"
                " skills, service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                " is_available, provider_type)"
                " values (%s, %s, %s, %s, 'pending_vetting', 'unverified', %s, %s, %s, %s, false, 'individual')",
                (
                    user_id, data["display_name"], email, phone, data.get("skills") or [],
                    data.get("service_area_center_lat"), data.get("service_area_center_lng"),
                    data.get("service_area_radius_km"),
                ),
            )
            return await self._session_for_user(conn, str(user_id))

    async def register_organization(self, data: dict) -> dict:
        email = (data.get("admin_email") or "").strip() or None
        pw_hash = hash_password(data["password"])
        org_name = data["organization_name"]
        async with await self._connect() as conn:
            if email:
                cur = await conn.execute("select 1 from users where lower(email) = lower(%s)", (email,))
                if await cur.fetchone():
                    raise ValueError("email_taken")
            base = _slugify(org_name)
            slug, n = base, 1
            while True:
                cur = await conn.execute("select 1 from organizations where slug = %s", (slug,))
                if not await cur.fetchone():
                    break
                n += 1
                slug = f"{base}-{n}"
            cur = await conn.execute(
                "insert into organizations (display_name, legal_name, slug, status, subscription_status,"
                " email, service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                " dispatch_mode, organization_type)"
                " values (%s, %s, %s, 'pending_vetting', 'none', %s, %s, %s, %s,"
                " 'organization_managed', 'company') returning id",
                (
                    org_name, data.get("legal_name") or org_name, slug, email,
                    data.get("service_area_center_lat"), data.get("service_area_center_lng"),
                    data.get("service_area_radius_km"),
                ),
            )
            org_id = (await cur.fetchone())[0]
            cur = await conn.execute(
                "insert into users (email, phone, password_hash, display_name, status, locale)"
                " values (%s, %s, %s, %s, 'active', %s) returning id",
                (email, data.get("phone"), pw_hash, data["admin_display_name"], data.get("locale")),
            )
            user_id = (await cur.fetchone())[0]
            await conn.execute(
                "insert into user_roles (user_id, role) values (%s, 'provider_admin') on conflict do nothing",
                (user_id,),
            )
            await conn.execute(
                "insert into user_organization_memberships (user_id, organization_id, role, status)"
                " values (%s, %s, 'provider_admin', 'active')"
                " on conflict (user_id, organization_id) do nothing",
                (user_id, org_id),
            )
            return await self._session_for_user(conn, str(user_id))

    async def approve_technician(self, technician_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technicians set vetting_status = 'verified', status = 'active'"
                " where id = %s returning id, display_name, status, vetting_status",
                (str(technician_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2], "vetting_status": row[3]}

    async def approve_organization(self, organization_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organizations set status = 'active', updated_at = now()"
                " where id = %s returning id, display_name, status",
                (str(organization_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2]}

    async def reject_technician(self, technician_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technicians set vetting_status = 'rejected', status = 'rejected', is_available = false"
                " where id = %s returning id, display_name, status, vetting_status",
                (str(technician_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2], "vetting_status": row[3]}

    async def reject_organization(self, organization_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organizations set status = 'rejected', updated_at = now()"
                " where id = %s returning id, display_name, status",
                (str(organization_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2]}

    async def update_user_locale(self, user_id: str, locale: str) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "update users set locale = %s, updated_at = now() where id = %s",
                (locale, str(user_id)),
            )

    async def list_technician_offers(self, technician_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select o.id, o.job_id, o.status, o.rank, o.offered_at, o.expires_at,"
                " j.access_type, j.lat, j.lng"
                " from dispatch_offers o join jobs j on j.id = o.job_id"
                " where o.technician_id = %s and o.status = 'offered'"
                " and (o.expires_at is null or o.expires_at > now())"
                " order by o.offered_at desc",
                (str(technician_id),),
            )
            rows = await cur.fetchall()
        # Masked: coarse area only (~1km) — no exact address / customer before acceptance.
        return [
            {
                "id": str(r[0]),
                "job_id": str(r[1]),
                "status": r[2],
                "rank": r[3],
                "offered_at": r[4].isoformat() if r[4] else None,
                "expires_at": r[5].isoformat() if r[5] else None,
                "access_type": r[6],
                "area_lat": round(r[7], 2) if r[7] is not None else None,
                "area_lng": round(r[8], 2) if r[8] is not None else None,
            }
            for r in rows
        ]


def make_store() -> Store:
    if DATABASE_URL:
        return PostgresStore(DATABASE_URL)
    return InMemoryStore()
