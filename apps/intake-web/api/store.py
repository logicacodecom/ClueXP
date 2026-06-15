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
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from api.auth import hash_password, verify_password
from api.dispatch import (
    STATUS_ARRIVED,
    STATUS_ASSIGNED,
    STATUS_CANCELLED,
    STATUS_COMPLETED_AUTO_CLOSED,
    STATUS_COMPLETED_CONFIRMED,
    STATUS_COMPLETED_PENDING,
    STATUS_DISPUTED,
    STATUS_EN_ROUTE,
    STATUS_IN_PROGRESS,
    STATUS_PENDING_DISPATCH,
    STATUS_TIMESTAMP_COLUMN,
    HISTORY_STATUSES,
    can_customer_cancel,
    customer_actions,
    eta_range_from_km,
    haversine_km,
    is_terminal,
    normalize_policy,
    resolve_dispatch_state,
)
from api import config
from api.schema import Ticket

DATABASE_URL = os.environ.get("DATABASE_URL")

# Demo/seed login password. Intentionally simple for the demo environment; override
# via env. The JWT signing secret (AUTH_SECRET) is separate and must still be strong.
DEMO_PASSWORD = os.environ.get("DEMO_SEED_PASSWORD", "123456")


def _new_tracking_token() -> str:
    """Secure, URL-safe customer capability token (~256 bits). Powers the
    /t/{token} tracking + confirm/review/dispute link; never logged."""
    return secrets.token_urlsafe(32)


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

    async def login_rate_limited(self, identifier: str) -> bool:  # pragma: no cover
        return False

    async def record_login_attempt(
        self, identifier: str, *, success: bool, ip: str | None
    ) -> None:  # pragma: no cover
        return None

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

    async def update_technician_profile(
        self, technician_id: UUID, data: dict
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def list_pending_registrations(self) -> list[dict]:  # pragma: no cover
        return []

    async def list_pending_documents(self) -> list[dict]:  # pragma: no cover
        return []

    async def get_provider_document(self, document_id: UUID) -> dict | None:  # pragma: no cover
        return None

    async def get_provider_workspace(self, organization_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def update_organization_profile(
        self, organization_id: UUID, data: dict
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def create_team(self, organization_id: UUID, data: dict) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def update_team(
        self, organization_id: UUID, team_id: UUID, data: dict
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def create_affiliated_technician(
        self, organization_id: UUID, data: dict
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def create_provider_document(
        self, organization_id: UUID, data: dict
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def review_provider_document(
        self, document_id: UUID, *, status: str, reviewer_id: UUID | None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def update_technician_location(
        self, technician_id: UUID, *, lat: float, lng: float
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def update_technician_availability(
        self, technician_id: UUID, *, is_available: bool
    ) -> dict | None:  # pragma: no cover
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

    # --- fulfillment cutover (Sprint 3) ---
    async def get_tracking_token(self, job_id: UUID) -> str | None:  # pragma: no cover
        raise NotImplementedError

    async def resolve_tracking_token(self, token: str) -> str | None:  # pragma: no cover
        raise NotImplementedError

    async def get_tracking_by_token(
        self, token: str, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def get_job_lifecycle(self, job_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def get_technician_active_job(self, technician_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def decline_dispatch_offer(
        self, offer_id: UUID, technician_id: UUID, reason: str | None = None
    ) -> bool:  # pragma: no cover
        raise NotImplementedError

    async def get_ops_technician(
        self, technician_id: UUID, org_id: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def ops_create_single_offer(
        self, job_id: UUID, technician_id: UUID, org_id: UUID | None, expires_at: datetime
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def set_job_status(
        self,
        job_id: UUID,
        new_status: str,
        *,
        expected_current: str | None = None,
        extra_timestamps: list[str] | None = None,
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def create_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str,
        expires_at: datetime, max_attempts: int,
    ) -> None:  # pragma: no cover
        raise NotImplementedError

    async def verify_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def get_provider_active_jobs(self, org_id: str) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def recover_job(
        self, job_id: UUID, *, target_status: str, expected_statuses: list[str],
        clear_technician: bool = False, reason: str | None = None, audit_label: str = "recover",
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def add_job_note(
        self, job_id: UUID, *, author_id: str, author_name: str | None, body: str
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def list_job_notes(self, job_id: UUID) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def list_job_events(self, job_id: UUID) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def record_customer_review(
        self,
        *,
        job_id: UUID,
        rating: int,
        comment: str | None,
        issue_reported: bool = False,
        imply_confirm: bool = False,
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def record_payment_report(
        self, *, job_id: UUID, reported_by: str, amount: float, method: str,
        currency: str = "USD",
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def get_payment_reports(self, job_id: UUID) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def get_job_review(self, job_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def get_provider_job_history(
        self, org_id: str, *, limit: int = 100
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def get_technician_job_history(
        self, technician_id: UUID, *, limit: int = 100
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def auto_close_pending(self, window_seconds: int) -> int:  # pragma: no cover
        raise NotImplementedError

    async def cancel_job(
        self, job_id: UUID, *, current_status: str, reason: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def resolve_job(
        self, job_id: UUID, *, action: str, note: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def log_event_raw(self, job_id: UUID, event: str) -> None:  # pragma: no cover
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
        self.login_attempts: list[dict] = []

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

    async def list_pending_registrations(self) -> list[dict]:
        return []

    async def list_pending_documents(self) -> list[dict]:
        return []

    async def get_provider_document(self, document_id: UUID) -> dict | None:
        return None

    async def get_provider_workspace(self, organization_id: UUID) -> dict | None:
        return {
            "organization": {"id": str(organization_id), "display_name": "Local provider"},
            "teams": [],
            "technicians": [],
            "documents": [],
        }

    async def update_organization_profile(self, organization_id: UUID, data: dict) -> dict | None:
        return {"id": str(organization_id), **data}

    async def create_team(self, organization_id: UUID, data: dict) -> dict:
        return {"id": str(uuid4()), "organization_id": str(organization_id), "status": "active", **data}

    async def update_team(self, organization_id: UUID, team_id: UUID, data: dict) -> dict | None:
        return {"id": str(team_id), "organization_id": str(organization_id), **data}

    async def create_affiliated_technician(self, organization_id: UUID, data: dict) -> dict:
        return {
            "id": str(uuid4()),
            "organization_id": str(organization_id),
            "status": "pending_vetting",
            "vetting_status": "unverified",
            **{key: value for key, value in data.items() if key != "password"},
        }

    async def create_provider_document(self, organization_id: UUID, data: dict) -> dict:
        return {
            "id": str(uuid4()),
            "organization_id": str(organization_id),
            "status": "pending_review",
            **data,
        }

    async def review_provider_document(
        self, document_id: UUID, *, status: str, reviewer_id: UUID | None
    ) -> dict | None:
        return {"id": str(document_id), "status": status}

    async def update_technician_location(
        self, technician_id: UUID, *, lat: float, lng: float
    ) -> dict | None:
        return {"id": str(technician_id), "current_lat": lat, "current_lng": lng}

    async def update_technician_availability(
        self, technician_id: UUID, *, is_available: bool
    ) -> dict | None:
        return {"id": str(technician_id), "is_available": is_available}

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
        jid = rec["job_id"]
        self._job_status = getattr(self, "_job_status", {})
        self._job_tech = getattr(self, "_job_tech", {})
        # Guard: only accept if the job is still pending_dispatch. A concurrent
        # cancellation would have changed the status, and we must not flip
        # trust_state or assign the technician on a cancelled/changed job.
        if self._job_status.get(jid) != STATUS_PENDING_DISPATCH:
            rec["status"] = "superseded"
            return {"accepted": False, "reason": "job_not_pending", "job_id": jid}
        rec["status"] = "accepted"
        for other in offers.values():
            if (
                other["job_id"] == jid
                and other["id"] != rec["id"]
                and other["status"] == "offered"
            ):
                other["status"] = "superseded"
        self._job_status[jid] = STATUS_ASSIGNED
        self._job_tech[jid] = rec["technician_id"]
        return {
            "accepted": True,
            "job_id": jid,
            "technician_id": rec["technician_id"],
            "organization_id": rec.get("organization_id"),
        }

    async def bump_dispatch_attempt(self, job_id: UUID) -> int:
        self._attempts = getattr(self, "_attempts", {})
        self._attempts[str(job_id)] = self._attempts.get(str(job_id), 0) + 1
        return self._attempts[str(job_id)]

    async def expire_stale_offers(self) -> int:
        return 0

    async def get_ops_queue(self, org_id: str | None = None) -> list[dict]:
        statuses = getattr(self, "_job_status", {})
        offers = getattr(self, "_offers", {})
        job_org = getattr(self, "_job_org", {})
        result = []
        for jid, status in statuses.items():
            if status != STATUS_PENDING_DISPATCH:
                continue
            owner_org = job_org.get(jid)
            if org_id is not None and owner_org != str(org_id):
                continue
            active_offer = next(
                (o for o in offers.values() if o.get("job_id") == jid and o.get("status") == "offered"),
                None,
            )
            declined = [
                o for o in offers.values()
                if o.get("job_id") == jid and o.get("status") == "declined"
            ]
            last_decline_reason = declined[-1].get("decline_reason") if declined else None
            result.append({
                "id": jid, "address": None, "lat": None, "lng": None,
                "access_type": None, "situation": None, "urgency": None,
                "created_at": None, "customer_owner_org_id": owner_org,
                "fulfillment_policy": None, "dispatch_attempts": 0,
                "offer_active": active_offer is not None,
                "offer_id": active_offer["id"] if active_offer else None,
                "offered_technician_id": active_offer["technician_id"] if active_offer else None,
                "offer_expires_at": None,
                "decline_count": len(declined),
                "last_decline_reason": last_decline_reason,
            })
        return result

    async def list_all_technicians_for_ops(self, org_id: str | None = None) -> list[dict]:
        techs = list(getattr(self, "_technicians", []))
        if org_id is not None:
            techs = [t for t in techs if str(t.get("primary_organization_id")) == str(org_id)]
        return techs

    async def get_fleet_state(self, org_id: str | None = None) -> list[dict]:
        return []

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
        status = (self._job_status.get(jid) if hasattr(self, "_job_status") else None)
        # Blind tracking: remove dispatch internals
        return {
            "state": state,
            "terminal": is_terminal(state, attempts=attempts, max_attempts=max_attempts, timed_out=False),
            "status": status,
            "closed": False,
            "customer_actions": customer_actions(status),
            "assignment": None,
        }

    # --- fulfillment cutover (Sprint 3) — minimal in-memory backing for tests ---
    async def get_tracking_token(self, job_id: UUID) -> str | None:
        return getattr(self, "_tokens", {}).get(str(job_id))

    async def resolve_tracking_token(self, token: str) -> str | None:
        for jid, tok in getattr(self, "_tokens", {}).items():
            if tok == token:
                return jid
        return None

    async def get_tracking_by_token(
        self, token: str, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:
        job_id = await self.resolve_tracking_token(token)
        if job_id is None:
            return None
        return await self.get_dispatch_status(
            job_id, max_attempts=max_attempts, total_timeout_seconds=total_timeout_seconds
        )

    async def get_job_lifecycle(self, job_id: UUID) -> dict | None:
        jid = str(job_id)
        statuses = getattr(self, "_job_status", {})
        if jid not in statuses:
            return None
        return {
            "status": statuses.get(jid),
            "fulfillment_technician_id": getattr(self, "_job_tech", {}).get(jid),
            "fulfillment_org_id": None,
            "customer_owner_org_id": getattr(self, "_job_org", {}).get(jid),
        }

    async def get_technician_active_job(self, technician_id: UUID) -> dict | None:
        _ACTIVE = {"assigned", "en_route", "arrived", "in_progress", "completed_pending_customer"}
        tid = str(technician_id)
        job_techs = getattr(self, "_job_tech", {})
        statuses = getattr(self, "_job_status", {})
        for jid, tech_id in job_techs.items():
            if tech_id == tid and statuses.get(jid) in _ACTIVE:
                return {"id": jid, "status": statuses[jid], "access_type": None, "situation": None, "address": None, "lat": None, "lng": None}
        return None

    async def decline_dispatch_offer(
        self, offer_id: UUID, technician_id: UUID, reason: str | None = None
    ) -> bool:
        offers = getattr(self, "_offers", {})
        offer = offers.get(str(offer_id))
        if offer and offer.get("technician_id") == str(technician_id) and offer.get("status") == "offered":
            offer["status"] = "declined"
            offer["decline_reason"] = reason
            return True
        return False

    async def get_ops_technician(self, technician_id: UUID, org_id: str | None = None) -> dict | None:
        tid = str(technician_id)
        for t in getattr(self, "_technicians", []):
            if str(t.get("id")) == tid and t.get("status") == "active" and t.get("vetting_status") == "verified":
                if org_id is not None and str(t.get("primary_organization_id")) != str(org_id):
                    return None
                return t
        return None

    async def create_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str,
        expires_at: datetime, max_attempts: int,
    ) -> None:
        pins = getattr(self, "_arrival_pins", None)
        if pins is None:
            pins = self._arrival_pins = {}
        pins[str(job_id)] = {
            "technician_id": str(technician_id),
            "pin_hash": pin_hash,
            "expires_at": expires_at,
            "attempts": 0,
            "max_attempts": max_attempts,
            "verified_at": None,
        }

    async def verify_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str
    ) -> dict:
        rec = getattr(self, "_arrival_pins", {}).get(str(job_id))
        if rec is None:
            return {"ok": False, "reason": "no_pin", "remaining": 0}
        if rec["verified_at"] is not None:
            return {"ok": False, "reason": "already_used", "remaining": 0}
        remaining = rec["max_attempts"] - rec["attempts"]
        if rec["technician_id"] != str(technician_id):
            return {"ok": False, "reason": "technician_mismatch", "remaining": remaining}
        if rec["attempts"] >= rec["max_attempts"]:
            return {"ok": False, "reason": "locked", "remaining": 0}
        if datetime.now(timezone.utc) > rec["expires_at"]:
            return {"ok": False, "reason": "expired", "remaining": remaining}
        if rec["pin_hash"] == pin_hash:
            rec["verified_at"] = datetime.now(timezone.utc)
            return {"ok": True, "reason": None, "remaining": remaining}
        rec["attempts"] += 1
        remaining = max(0, rec["max_attempts"] - rec["attempts"])
        return {"ok": False, "reason": "locked" if remaining == 0 else "incorrect", "remaining": remaining}

    async def get_provider_active_jobs(self, org_id: str) -> list[dict]:
        statuses = getattr(self, "_job_status", {})
        job_org = getattr(self, "_job_org", {})
        job_tech = getattr(self, "_job_tech", {})
        offers = getattr(self, "_offers", {})
        recoverable = {
            STATUS_PENDING_DISPATCH, STATUS_ASSIGNED, STATUS_EN_ROUTE, STATUS_ARRIVED,
            STATUS_IN_PROGRESS, STATUS_COMPLETED_PENDING, STATUS_DISPUTED,
        }
        out = []
        for jid, status in statuses.items():
            if status not in recoverable or job_org.get(jid) != str(org_id):
                continue
            active_offer = next(
                (o for o in offers.values() if o.get("job_id") == jid and o.get("status") == "offered"),
                None,
            )
            issues = [e for e in self._events_for(jid) if e["event"].startswith("tech_issue:")]
            out.append({
                "id": jid, "status": status, "address": None, "access_type": None,
                "situation": None, "urgency": None, "created_at": None,
                "fulfillment_technician_id": job_tech.get(jid),
                "offer_active": active_offer is not None,
                "offer_id": active_offer["id"] if active_offer else None,
                "last_issue": issues[-1]["event"] if issues else None,
            })
        return out

    def _events_for(self, jid: str) -> list[dict]:
        """Parse the flat in-memory event log into {at, event} for one job."""
        out = []
        for line in getattr(self, "events", []):
            parts = line.split(" ", 2)
            if len(parts) == 3 and parts[1] == jid:
                out.append({"at": parts[0], "event": parts[2]})
        return out

    async def list_job_events(self, job_id: UUID) -> list[dict]:
        return self._events_for(str(job_id))

    async def recover_job(
        self, job_id: UUID, *, target_status: str, expected_statuses: list[str],
        clear_technician: bool = False, reason: str | None = None, audit_label: str = "recover",
    ) -> dict | None:
        self._job_status = getattr(self, "_job_status", {})
        jid = str(job_id)
        if self._job_status.get(jid) not in expected_statuses:
            return None
        self._job_status[jid] = target_status
        if clear_technician:
            getattr(self, "_job_tech", {}).pop(jid, None)
        for o in getattr(self, "_offers", {}).values():
            if o.get("job_id") == jid and o.get("status") == "offered":
                o["status"] = "superseded"
        await self.log_event_raw(job_id, f"{audit_label}:{(reason or '')[:200]}")
        return {"id": jid, "status": target_status}

    async def add_job_note(
        self, job_id: UUID, *, author_id: str, author_name: str | None, body: str
    ) -> dict:
        notes = getattr(self, "_job_notes", None)
        if notes is None:
            notes = self._job_notes = {}
        rec = {
            "id": str(uuid4()), "job_id": str(job_id), "author_id": author_id,
            "author_name": author_name, "body": body,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        notes.setdefault(str(job_id), []).append(rec)
        return rec

    async def list_job_notes(self, job_id: UUID) -> list[dict]:
        return list(getattr(self, "_job_notes", {}).get(str(job_id), []))

    async def ops_create_single_offer(
        self, job_id: UUID, technician_id: UUID, org_id: UUID | None, expires_at: datetime
    ) -> dict | None:
        offers = getattr(self, "_offers", None)
        if offers is None:
            offers = self._offers = {}
        jid = str(job_id)
        # Atomic guard: job must still be pending_dispatch (not cancelled/assigned)
        statuses = getattr(self, "_job_status", {})
        if statuses.get(jid) != STATUS_PENDING_DISPATCH:
            return {"error_code": "job_not_pending"}
        if any(o.get("status") == "offered" and o.get("job_id") == jid for o in offers.values()):
            return {"error_code": "concurrent_offer"}
        rec = {
            "id": str(uuid4()),
            "job_id": jid,
            "technician_id": str(technician_id),
            "organization_id": str(org_id) if org_id else None,
            "rank": 0,
            "status": "offered",
        }
        offers[rec["id"]] = rec
        return rec

    async def set_job_status(
        self,
        job_id: UUID,
        new_status: str,
        *,
        expected_current: str | None = None,
        extra_timestamps: list[str] | None = None,
    ) -> dict | None:
        self._job_status = getattr(self, "_job_status", {})
        jid = str(job_id)
        if expected_current is not None and self._job_status.get(jid) != expected_current:
            return None
        self._job_status[jid] = new_status
        return {"id": jid, "status": new_status}

    async def cancel_job(
        self, job_id: UUID, *, current_status: str, reason: str | None = None
    ) -> dict | None:
        self._job_status = getattr(self, "_job_status", {})
        jid = str(job_id)
        if self._job_status.get(jid) != current_status:
            return None
        self._job_status[jid] = STATUS_CANCELLED
        for o in getattr(self, "_offers", {}).values():
            if o.get("job_id") == jid and o.get("status") == "offered":
                o["status"] = "superseded"
        return {"id": jid, "status": STATUS_CANCELLED}

    async def record_customer_review(
        self, *, job_id: UUID, rating: int, comment: str | None,
        issue_reported: bool = False, imply_confirm: bool = False,
    ) -> dict:
        review = {
            "id": str(uuid4()), "ticket_id": str(job_id), "rating": rating,
            "comment": comment, "issue_reported": issue_reported,
        }
        self.reviews.append(review)
        return review

    async def record_payment_report(
        self, *, job_id: UUID, reported_by: str, amount: float, method: str,
        currency: str = "USD",
    ) -> dict:
        payments = getattr(self, "_payments", None)
        if payments is None:
            payments = self._payments = {}
        rec = {
            "job_id": str(job_id), "reported_by": reported_by,
            "amount": round(float(amount), 2), "currency": currency, "method": method,
            "reported_at": datetime.now(timezone.utc).isoformat(),
        }
        payments[(str(job_id), reported_by)] = rec
        return rec

    async def get_payment_reports(self, job_id: UUID) -> dict:
        payments = getattr(self, "_payments", {})
        return {
            "technician": payments.get((str(job_id), "technician")),
            "customer": payments.get((str(job_id), "customer")),
        }

    async def get_job_review(self, job_id: UUID) -> dict | None:
        jid = str(job_id)
        for review in reversed(getattr(self, "reviews", [])):
            if review.get("ticket_id") == jid:
                return review
        return None

    async def get_provider_job_history(self, org_id: str, *, limit: int = 100) -> list[dict]:
        statuses = getattr(self, "_job_status", {})
        out = []
        for jid, status in statuses.items():
            if status not in HISTORY_STATUSES:
                continue
            if org_id is not None and str(getattr(self, "_job_org", {}).get(jid)) != str(org_id):
                continue
            out.append({
                "id": jid, "status": status,
                "fulfillment_technician_id": getattr(self, "_job_tech", {}).get(jid),
                "review": await self.get_job_review(UUID(jid)),
                "payments": await self.get_payment_reports(UUID(jid)),
            })
        return out[:limit]

    async def get_technician_job_history(
        self, technician_id: UUID, *, limit: int = 100
    ) -> list[dict]:
        tid = str(technician_id)
        statuses = getattr(self, "_job_status", {})
        out = []
        for jid, status in statuses.items():
            if status not in HISTORY_STATUSES:
                continue
            if str(getattr(self, "_job_tech", {}).get(jid)) != tid:
                continue
            out.append({
                "id": jid, "status": status,
                "review": await self.get_job_review(UUID(jid)),
                "payments": await self.get_payment_reports(UUID(jid)),
            })
        return out[:limit]

    async def auto_close_pending(self, window_seconds: int) -> int:
        return 0

    async def resolve_job(
        self, job_id: UUID, *, action: str, note: str | None = None
    ) -> dict | None:
        return {"id": str(job_id), "action": action}

    async def log_event_raw(self, job_id: UUID, event: str) -> None:
        self.events.append(f"{datetime.now(timezone.utc).isoformat()} {job_id} {event}")

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

    async def update_technician_profile(self, technician_id: UUID, data: dict) -> dict | None:
        tid = str(technician_id)
        technician = next((item for item in getattr(self, "_technicians", []) if item.get("id") == tid), None)
        if technician is None:
            return None
        technician.update(data)
        user = self.users.get(tid)
        if user:
            if data.get("display_name"):
                user["display_name"] = data["display_name"]
            if data.get("phone"):
                user["phone"] = data["phone"]
        return {"id": tid, **data}

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
            # Fulfillment cutover (migration 0010) — additive columns. Repeated here
            # as add-column-if-not-exists so the live API is resilient if it boots
            # before the migration runs (matches the fulfillment_org_id pattern above).
            for _col in (
                "tracking_token text",
                "assigned_at timestamptz",
                "en_route_at timestamptz",
                "arrived_at timestamptz",
                "in_progress_at timestamptz",
                "completed_pending_at timestamptz",
                "confirmed_at timestamptz",
                "closed_at timestamptz",
                "disputed_at timestamptz",
                "cancelled_at timestamptz",
            ):
                await conn.execute(f"alter table jobs add column if not exists {_col}")
            await conn.execute(
                "create unique index if not exists idx_jobs_tracking_token on jobs (tracking_token)"
            )
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
            # Fulfillment cutover (migration 0010) — ticket-scoped customer-safe
            # review fields; additive add-column-if-not-exists for boot resilience.
            for _col in (
                "assigned_technician_id text",
                "customer_owner_org_id uuid",
                "confirmed_at timestamptz",
                "issue_reported boolean not null default false",
            ):
                await conn.execute(f"alter table job_reviews add column if not exists {_col}")
            # Per-channel cutover flip (default OFF) — only if the channel table exists.
            await conn.execute(
                "do $$ begin"
                "  if to_regclass('public.intake_channels') is not null then"
                "    alter table intake_channels"
                "      add column if not exists dispatch_cutover_enabled boolean not null default false;"
                "  end if;"
                " end $$"
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
            await conn.execute(
                "create table if not exists login_attempts ("
                "  id uuid primary key default gen_random_uuid(),"
                "  identifier text not null,"
                "  ip text,"
                "  success boolean not null default false,"
                "  created_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists job_payment_reports ("
                "  id uuid primary key default gen_random_uuid(),"
                "  job_id uuid not null references jobs(id) on delete cascade,"
                "  reported_by text not null check (reported_by in ('technician','customer')),"
                "  amount numeric(10,2) not null check (amount >= 0),"
                "  currency text not null default 'USD',"
                "  method text not null,"
                "  reported_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now(),"
                "  unique (job_id, reported_by)"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_job_payment_reports_job"
                " on job_payment_reports (job_id)"
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
            await conn.execute(
                "create index if not exists idx_login_attempts_identifier_time"
                " on login_attempts (lower(identifier), created_at)"
            )
            if config.DEMO_SEED:
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

        async def ensure_user(
            email: str,
            display_name: str,
            roles: list[str],
            org_id=None,
            phone=None,
            membership_role: str = "provider_admin",
        ):
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
                return None
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
                    (user_id, org_id, membership_role),
                )
            return user_id

        await ensure_user("avery@cluexp.com", "Avery Knox", ["platform_admin"])
        await ensure_user(
            "dispatch@metrokey.example",
            "Nadia Reyes",
            ["provider_admin", "dispatcher"],
            provider_org_id,
            "+15550140199",
        )
        # Jordan is seeded as a MetroKey affiliate (below) so the company's dispatcher
        # can assign him during the demo — all demo technicians belong to MetroKey.
        if provider_org_id:
            cur = await conn.execute(
                "insert into organization_teams"
                " (organization_id, name, description, team_type, status)"
                " values (%s, 'Manhattan Response', 'Primary urgent-response roster', 'department', 'active')"
                " on conflict do nothing returning id",
                (provider_org_id,),
            )
            team_row = await cur.fetchone()
            if not team_row:
                cur = await conn.execute(
                    "select id from organization_teams"
                    " where organization_id = %s and name = 'Manhattan Response' limit 1",
                    (provider_org_id,),
                )
                team_row = await cur.fetchone()
            team_id = team_row[0] if team_row else None
            for email, name, phone, lat, lng, rating in [
                ("jordan@cluexp.example", "Jordan Lee", "+15550142201", 40.7580, -73.9855, 4.9),
                ("marcus@metrokey.example", "Marcus Reyes", "+15550142211", 40.7831, -73.9712, 4.9),
                ("lena@metrokey.example", "Lena Ortiz", "+15550142212", 40.7484, -73.9857, 4.7),
            ]:
                technician_id = await ensure_user(
                    email, name, ["technician"], provider_org_id, phone, "technician"
                )
                if not technician_id:
                    continue
                await conn.execute(
                    "insert into technicians"
                    " (id, display_name, email, phone, status, vetting_status, skills,"
                    " service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                    " current_lat, current_lng, location_updated_at, rating, is_available,"
                    " provider_type, primary_organization_id)"
                    " values (%s, %s, %s, %s, 'active', 'verified', '{home,business,vehicle}',"
                    " %s, %s, 25, %s, %s, now(), %s, true, 'affiliate', %s)"
                    " on conflict (id) do update set status = 'active', vetting_status = 'verified',"
                    " is_available = true, current_lat = excluded.current_lat,"
                    " current_lng = excluded.current_lng, location_updated_at = now(),"
                    " provider_type = 'affiliate',"
                    " primary_organization_id = excluded.primary_organization_id",
                    (
                        technician_id, name, email, phone, lat, lng, lat, lng,
                        rating, provider_org_id,
                    ),
                )
                await conn.execute(
                    "insert into organization_technicians"
                    " (organization_id, technician_id, role, status, activated_at)"
                    " values (%s, %s, 'affiliate_technician', 'active', now())"
                    " on conflict (organization_id, technician_id) do update set status = 'active'",
                    (provider_org_id, technician_id),
                )
                if team_id:
                    await conn.execute(
                        "insert into organization_team_technicians (team_id, technician_id)"
                        " values (%s, %s) on conflict do nothing",
                        (team_id, technician_id),
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
                "  final_charge, tracking_token, created_at, updated_at"
                ") values ("
                "  %s, %s, %s,"
                "  %s, %s, %s,"
                "  %s, %s, %s,"
                "  %s, %s, %s, %s, %s, %s, %s,"
                "  %s, %s, %s, now()"
                ")"
                " on conflict (id) do update set"
                "  customer_id = coalesce(excluded.customer_id, jobs.customer_id),"
                "  fulfillment_technician_id = excluded.fulfillment_technician_id,"
                "  origin_org_id = coalesce(jobs.origin_org_id, excluded.origin_org_id),"
                "  customer_owner_org_id = coalesce(jobs.customer_owner_org_id, excluded.customer_owner_org_id),"
                "  intake_channel_id = coalesce(jobs.intake_channel_id, excluded.intake_channel_id),"
                "  trust_state = excluded.trust_state,"
                # Never overwrite an operational status (pending_dispatch and beyond)
                # with a legacy intake status (draft/partial/complete). Once the job
                # enters the fulfillment ladder only set_job_status may advance it.
                "  status = CASE"
                "    WHEN jobs.status = ANY(ARRAY["
                "      'pending_dispatch','assigned','en_route','arrived','in_progress',"
                "      'completed_pending_customer','completed_confirmed',"
                "      'completed_auto_closed','disputed','cancelled','no_show'])"
                "    THEN jobs.status ELSE excluded.status END,"
                "  access_type = excluded.access_type,"
                "  situation = excluded.situation,"
                "  urgency = excluded.urgency,"
                "  lat = excluded.lat,"
                "  lng = excluded.lng,"
                "  address = excluded.address,"
                "  detail = excluded.detail,"
                "  price_quote = excluded.price_quote,"
                "  final_charge = excluded.final_charge,"
                # token is minted once at create and never rotated by later saves.
                "  tracking_token = coalesce(jobs.tracking_token, excluded.tracking_token),"
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
                    _new_tracking_token(),
                    ticket.created_at,
                ),
            )

    async def resolve_intake_channel(self, slug: str | None) -> dict | None:
        if not slug:
            return None
        try:
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "select id, organization_id,"
                    " coalesce(dispatch_cutover_enabled, false) from intake_channels"
                    " where slug = %s and active = true",
                    (slug,),
                )
                row = await cur.fetchone()
        except Exception:
            # Table/column not present yet (pre-0004 / pre-0010) or lookup failed
            # → public intake (legacy path).
            return None
        if not row:
            return None
        channel_id, org_id, cutover = row[0], row[1], row[2]
        return {
            "intake_channel_id": channel_id,
            "origin_org_id": org_id,
            "customer_owner_org_id": org_id,  # origin owns the customer (adr/0004 §4)
            "dispatch_cutover_enabled": bool(cutover),
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

    async def login_rate_limited(self, identifier: str) -> bool:
        normalized = identifier.strip().lower()
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select count(*) from login_attempts"
                " where lower(identifier) = %s and success = false"
                " and created_at >= now() - (%s * interval '1 second')",
                (normalized, config.LOGIN_WINDOW_SECONDS),
            )
            row = await cur.fetchone()
        return bool(row and row[0] >= config.LOGIN_MAX_FAILURES)

    async def record_login_attempt(
        self, identifier: str, *, success: bool, ip: str | None
    ) -> None:
        normalized = identifier.strip().lower()
        async with await self._connect() as conn:
            if success:
                await conn.execute(
                    "delete from login_attempts where lower(identifier) = %s",
                    (normalized,),
                )
                return
            await conn.execute(
                "insert into login_attempts (identifier, ip, success) values (%s, %s, false)",
                (normalized, ip),
            )
            await conn.execute(
                "delete from login_attempts where created_at < now() - interval '7 days'"
            )

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
            "select id, status, vetting_status, is_available, display_name, phone,"
            " skills, service_area_radius_km from technicians where id = %s",
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
                "display_name": tech_row[4],
                "phone": tech_row[5],
                "skills": list(tech_row[6] or []),
                "service_area_radius_km": tech_row[7],
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
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select fulfillment_technician_id, fulfillment_org_id from jobs where id = %s",
                (str(ticket_id),),
            )
            row = await cur.fetchone()
            technician_ref = str(row[0]) if row and row[0] else (
                ticket.technician_assignment.technician_id if ticket.technician_assignment else None
            )
            fulfillment_org_id = row[1] if row else None
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
            if technician_ref:
                await conn.execute(
                    "update technicians t set rating = s.average_rating"
                    " from rating_summaries s"
                    " where s.target_type = 'technician' and s.target_id = %s"
                    " and t.id::text = s.target_id",
                    (technician_ref,),
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
                " customer_owner_org_id, fulfillment_policy, dispatch_attempts, trust_state,"
                " status"
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
            "status": row[9],
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
            # Atomic first-accept-wins: only one accept can win. Guard on
            # status='pending_dispatch' so that a cancellation or concurrent accept
            # that changed the job status before this UPDATE causes this path to fail
            # cleanly — no technician or trust_state is set on a cancelled job.
            cur = await conn.execute(
                "update jobs set fulfillment_technician_id = %s, fulfillment_org_id = %s,"
                " trust_state = 'matched',"
                " status = %s,"
                " assigned_at = coalesce(assigned_at, now()),"
                " updated_at = now()"
                " where id = %s"
                "   and status = %s"
                "   and fulfillment_technician_id is null"
                " returning id",
                (
                    str(tech_id), str(org_id) if org_id else None,
                    STATUS_ASSIGNED,
                    str(job_id),
                    STATUS_PENDING_DISPATCH,
                ),
            )
            won = await cur.fetchone()
            if not won:
                # Revoke the offer without touching trust_state or assignment.
                await conn.execute(
                    "update dispatch_offers set status = 'superseded', responded_at = now()"
                    " where id = %s and status = 'offered'",
                    (str(offer_id),),
                )
                return {"accepted": False, "reason": "job_not_pending", "job_id": str(job_id)}
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
        """Mark past-deadline offers expired and return affected jobs to
        pending_dispatch when no active offer remains."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update dispatch_offers set status = 'expired', responded_at = now()"
                " where status = 'offered' and expires_at is not null and expires_at < now()"
                " returning job_id"
            )
            rows = await cur.fetchall()
            if rows:
                job_ids = list({str(r[0]) for r in rows})
                # Return jobs to the queue only when no sibling offer is still active.
                for jid in job_ids:
                    await conn.execute(
                        "update jobs set status = 'pending_dispatch', updated_at = now()"
                        " where id = %s and status = 'pending_dispatch'"
                        "   and not exists ("
                        "     select 1 from dispatch_offers"
                        "     where job_id = %s and status = 'offered')",
                        (jid, jid),
                    )
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
        from api.dispatch import TERMINAL_STATUSES
        # Blind tracking: remove dispatch internals (attempts, offers, expiry)
        # Customer sees only: searching / matched / failed (Uber-style)
        return {
            "state": state,
            "terminal": terminal,
            # Operational fulfillment fields (cutover). For legacy jobs these are
            # benign: status is the intake status and no customer action is offered.
            "status": job_status,
            "closed": job_status in TERMINAL_STATUSES,
            "customer_actions": customer_actions(job_status),
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

    # --- fulfillment cutover (Sprint 3) ---
    async def get_tracking_token(self, job_id: UUID) -> str | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select tracking_token from jobs where id = %s", (str(job_id),)
            )
            row = await cur.fetchone()
        return row[0] if row and row[0] else None

    async def resolve_tracking_token(self, token: str) -> str | None:
        """Resolve a customer capability token to its job id. The token is a
        ~256-bit URL-safe secret looked up via a unique index; an unknown token
        returns None (the route answers 404 — no oracle on token validity)."""
        if not token:
            return None
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id from jobs where tracking_token = %s", (token,)
            )
            row = await cur.fetchone()
        return str(row[0]) if row else None

    async def get_tracking_by_token(
        self, token: str, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:
        job_id = await self.resolve_tracking_token(token)
        if job_id is None:
            return None
        return await self.get_dispatch_status(
            UUID(job_id), max_attempts=max_attempts, total_timeout_seconds=total_timeout_seconds
        )

    async def get_job_lifecycle(self, job_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select status, fulfillment_technician_id, fulfillment_org_id,"
                " customer_owner_org_id from jobs where id = %s",
                (str(job_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "status": row[0],
            "fulfillment_technician_id": str(row[1]) if row[1] else None,
            "fulfillment_org_id": str(row[2]) if row[2] else None,
            "customer_owner_org_id": str(row[3]) if row[3] else None,
        }

    async def get_technician_active_job(self, technician_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, status, access_type, situation, address, lat, lng from jobs"
                " where fulfillment_technician_id = %s"
                " and status = any(%s)"
                " order by updated_at desc limit 1",
                (str(technician_id), ["assigned", "en_route", "arrived", "in_progress", "completed_pending_customer"]),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]),
            "status": row[1],
            "access_type": row[2],
            "situation": row[3],
            "address": row[4],
            "lat": row[5],
            "lng": row[6],
        }

    # --- ops-controlled dispatch (Sprint 3.4) ----------------------------------

    async def get_ops_queue(self, org_id: str | None = None) -> list[dict]:
        """Pending_dispatch jobs in arrival order, each annotated with any active
        offer so the dispatcher can see 'Offer sent' state inline. With org_id set,
        scoped to jobs the company owns or fulfills (provider dispatch)."""
        org_filter = ""
        params: tuple = ()
        if org_id is not None:
            org_filter = " and (j.customer_owner_org_id = %s or j.fulfillment_org_id = %s)"
            params = (str(org_id), str(org_id))
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select j.id, j.address, j.lat, j.lng, j.access_type, j.situation,"
                " j.urgency, j.created_at, j.customer_owner_org_id,"
                " j.fulfillment_policy, j.dispatch_attempts,"
                " o.id as offer_id, o.technician_id as offered_tech_id, o.expires_at,"
                " d.decline_reason, d.declined_count"
                " from jobs j"
                " left join dispatch_offers o"
                "   on o.job_id = j.id and o.status = 'offered'"
                " left join lateral ("
                "   select count(*) as declined_count,"
                "     (array_agg(decline_reason order by responded_at desc nulls last))[1]"
                "       as decline_reason"
                "   from dispatch_offers"
                "   where job_id = j.id and status = 'declined'"
                " ) d on true"
                " where j.status = 'pending_dispatch'" + org_filter +
                " order by j.created_at asc",
                params,
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]),
                "address": r[1],
                "lat": r[2],
                "lng": r[3],
                "access_type": r[4],
                "situation": r[5],
                "urgency": r[6],
                "created_at": r[7].isoformat() if r[7] else None,
                "customer_owner_org_id": str(r[8]) if r[8] else None,
                "fulfillment_policy": r[9],
                "dispatch_attempts": r[10] or 0,
                "offer_active": r[11] is not None,
                "offer_id": str(r[11]) if r[11] else None,
                "offered_technician_id": str(r[12]) if r[12] else None,
                "offer_expires_at": r[13].isoformat() if r[13] else None,
                "last_decline_reason": r[14],
                "decline_count": r[15] or 0,
            }
            for r in rows
        ]

    async def list_all_technicians_for_ops(self, org_id: str | None = None) -> list[dict]:
        """Active+verified technicians with location data — no availability filter.
        With org_id set, restricted to the company's own W-2/affiliated technicians
        (primary_organization_id = org); otherwise the full platform pool."""
        org_filter = ""
        params: tuple = ()
        if org_id is not None:
            org_filter = " and primary_organization_id = %s"
            params = (str(org_id),)
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, skills, current_lat, current_lng,"
                " service_area_center_lat, service_area_center_lng,"
                " service_area_radius_km, rating, is_available,"
                " location_updated_at, provider_type, primary_organization_id"
                " from technicians"
                " where status = 'active' and vetting_status = 'verified'" + org_filter +
                " order by display_name",
                params,
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]),
                "display_name": r[1],
                "skills": list(r[2] or []),
                "current_lat": r[3],
                "current_lng": r[4],
                "service_area_center_lat": r[5],
                "service_area_center_lng": r[6],
                "service_area_radius_km": r[7],
                "rating": float(r[8]) if r[8] is not None else 0.0,
                "is_available": r[9],
                "location_updated_at": r[10].isoformat() if r[10] else None,
                "provider_type": r[11],
                "primary_organization_id": str(r[12]) if r[12] else None,
            }
            for r in rows
        ]

    async def get_fleet_state(self, org_id: str | None = None) -> list[dict]:
        """All active+verified technicians with their current location and active
        job (if any). Single LEFT JOIN — one round trip for the fleet map. With
        org_id set, restricted to the company's own technicians."""
        org_filter = " and t.primary_organization_id = %s" if org_id is not None else ""
        active = ["assigned", "en_route", "arrived", "in_progress", "completed_pending_customer"]
        params = (active,) + ((str(org_id),) if org_id is not None else ())
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select t.id, t.display_name, t.skills, t.is_available,"
                " t.current_lat, t.current_lng, t.location_updated_at,"
                " j.id as job_id, j.status as job_status, j.address as job_address,"
                " j.lat as job_lat, j.lng as job_lng, j.access_type, j.situation"
                " from technicians t"
                " left join jobs j"
                "   on j.fulfillment_technician_id = t.id"
                "   and j.status = any(%s)"
                " where t.status = 'active' and t.vetting_status = 'verified'" + org_filter +
                " order by t.display_name",
                params,
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]),
                "display_name": r[1],
                "skills": list(r[2] or []),
                "is_available": r[3],
                "current_lat": r[4],
                "current_lng": r[5],
                "location_updated_at": r[6].isoformat() if r[6] else None,
                "active_job": {
                    "id": str(r[7]),
                    "status": r[8],
                    "address": r[9],
                    "lat": r[10],
                    "lng": r[11],
                    "access_type": r[12],
                    "situation": r[13],
                } if r[7] else None,
            }
            for r in rows
        ]

    async def decline_dispatch_offer(
        self, offer_id: UUID, technician_id: UUID, reason: str | None = None
    ) -> bool:
        """Mark offer declined (capturing the reason for Ops reassignment); return
        the job to pending_dispatch when no active offer remains."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update dispatch_offers"
                " set status = 'declined', responded_at = now(), decline_reason = %s"
                " where id = %s and technician_id = %s and status = 'offered'"
                " returning job_id",
                (reason, str(offer_id), str(technician_id)),
            )
            row = await cur.fetchone()
            if row:
                jid = str(row[0])
                await conn.execute(
                    "update jobs set status = 'pending_dispatch', updated_at = now()"
                    " where id = %s and status = 'pending_dispatch'"
                    "   and not exists ("
                    "     select 1 from dispatch_offers"
                    "     where job_id = %s and status = 'offered')",
                    (jid, jid),
                )
        return row is not None

    async def get_ops_technician(self, technician_id: UUID, org_id: str | None = None) -> dict | None:
        """Fetch one technician only if currently active and verified. With org_id
        set, also require the technician belongs to that company (provider dispatch)."""
        org_filter = " and primary_organization_id = %s" if org_id is not None else ""
        params = (str(technician_id),) + ((str(org_id),) if org_id is not None else ())
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, skills, current_lat, current_lng,"
                " service_area_center_lat, service_area_center_lng,"
                " rating, is_available, location_updated_at, primary_organization_id"
                " from technicians"
                " where id = %s and status = 'active' and vetting_status = 'verified'" + org_filter,
                params,
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {
            "id": str(row[0]),
            "display_name": row[1],
            "skills": list(row[2] or []),
            "current_lat": row[3],
            "current_lng": row[4],
            "service_area_center_lat": row[5],
            "service_area_center_lng": row[6],
            "rating": float(row[7]) if row[7] is not None else 0.0,
            "is_available": row[8],
            "location_updated_at": row[9].isoformat() if row[9] else None,
            "primary_organization_id": str(row[10]) if row[10] else None,
        }

    async def create_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str,
        expires_at: datetime, max_attempts: int,
    ) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "insert into arrival_verifications"
                " (job_id, technician_id, pin_hash, expires_at, attempts, max_attempts,"
                "  verified_at, updated_at)"
                " values (%s, %s, %s, %s, 0, %s, null, now())"
                " on conflict (job_id) do update set"
                "   technician_id = excluded.technician_id,"
                "   pin_hash = excluded.pin_hash,"
                "   expires_at = excluded.expires_at,"
                "   attempts = 0, max_attempts = excluded.max_attempts,"
                "   verified_at = null, updated_at = now()",
                (str(job_id), str(technician_id), pin_hash, expires_at, max_attempts),
            )

    async def verify_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str
    ) -> dict:
        async with await self._connect() as conn:
            # Atomic single-use claim: only a correct, live, unlocked PIN bound to
            # this technician flips verified_at — concurrent retries can't double-verify.
            cur = await conn.execute(
                "update arrival_verifications set verified_at = now(), updated_at = now()"
                " where job_id = %s and technician_id = %s and pin_hash = %s"
                "   and verified_at is null and expires_at > now() and attempts < max_attempts"
                " returning job_id",
                (str(job_id), str(technician_id), pin_hash),
            )
            if await cur.fetchone():
                return {"ok": True, "reason": None, "remaining": 0}
            cur = await conn.execute(
                "select technician_id, expires_at, attempts, max_attempts, verified_at"
                " from arrival_verifications where job_id = %s",
                (str(job_id),),
            )
            row = await cur.fetchone()
            if row is None:
                return {"ok": False, "reason": "no_pin", "remaining": 0}
            tech_id, expires_at, attempts, max_attempts, verified_at = row
            remaining = max(0, max_attempts - attempts)
            if verified_at is not None:
                return {"ok": False, "reason": "already_used", "remaining": 0}
            if str(tech_id) != str(technician_id):
                return {"ok": False, "reason": "technician_mismatch", "remaining": remaining}
            if attempts >= max_attempts:
                return {"ok": False, "reason": "locked", "remaining": 0}
            if datetime.now(timezone.utc) > expires_at:
                return {"ok": False, "reason": "expired", "remaining": remaining}
            # Wrong PIN on a live, unlocked record → count the failed attempt.
            cur = await conn.execute(
                "update arrival_verifications set attempts = attempts + 1, updated_at = now()"
                " where job_id = %s and verified_at is null"
                " returning attempts, max_attempts",
                (str(job_id),),
            )
            urow = await cur.fetchone()
            remaining = max(0, urow[1] - urow[0]) if urow else 0
            return {"ok": False, "reason": "locked" if remaining == 0 else "incorrect",
                    "remaining": remaining}

    async def ops_create_single_offer(
        self, job_id: UUID, technician_id: UUID, org_id: UUID | None, expires_at: datetime
    ) -> dict | None:
        """Atomically insert one targeted offer, guarded on the job still being
        pending_dispatch with no technician and no active offer. The INSERT ... SELECT
        is a single round-trip; the partial unique index provides final DB protection.
        Returns {"id": ...} on success, {"error_code": "job_not_pending"} when the job
        is not in the expected state (cancelled / already assigned), or
        {"error_code": "concurrent_offer"} when the unique constraint fires."""
        try:
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "insert into dispatch_offers"
                    " (id, job_id, technician_id, status, rank, offered_at, expires_at, organization_id)"
                    " select gen_random_uuid(), j.id, %s, 'offered', 0, now(), %s, %s"
                    " from jobs j"
                    " where j.id = %s"
                    "   and j.status = 'pending_dispatch'"
                    "   and j.fulfillment_technician_id is null"
                    "   and not exists ("
                    "     select 1 from dispatch_offers"
                    "     where job_id = j.id and status = 'offered')"
                    " returning id",
                    (str(technician_id), expires_at, str(org_id) if org_id else None, str(job_id)),
                )
                row = await cur.fetchone()
            if row:
                return {"id": str(row[0])}
            # Distinguish job-not-pending from concurrent-offer by re-reading job status.
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "select status from jobs where id = %s", (str(job_id),)
                )
                jrow = await cur.fetchone()
            if jrow is None or jrow[0] != "pending_dispatch":
                return {"error_code": "job_not_pending"}
            return {"error_code": "concurrent_offer"}
        except Exception as exc:
            msg = str(exc).lower()
            if "unique" in msg or "duplicate" in msg or "23505" in msg:
                return {"error_code": "concurrent_offer"}
            raise

    async def set_job_status(
        self,
        job_id: UUID,
        new_status: str,
        *,
        expected_current: str | None = None,
        extra_timestamps: list[str] | None = None,
    ) -> dict | None:
        """Optimistic forward status transition. Sets the lifecycle timestamp for
        ``new_status`` (and any ``extra_timestamps``) once. When ``expected_current``
        is given, the UPDATE is guarded on it so concurrent transitions can't race.
        Returns the new row dict, or None if the guard didn't match (conflict)."""
        cols = set(extra_timestamps or [])
        ts = STATUS_TIMESTAMP_COLUMN.get(new_status)
        if ts:
            cols.add(ts)
        # Column names come from a fixed whitelist (STATUS_TIMESTAMP_COLUMN /
        # caller constants), never user input — safe to inline.
        sets = ["status = %s", "updated_at = now()"]
        for col in sorted(cols):
            sets.append(f"{col} = coalesce({col}, now())")
        params: list = [new_status]
        where = "id = %s"
        params.append(str(job_id))
        if expected_current is not None:
            where += " and status = %s"
            params.append(expected_current)
        async with await self._connect() as conn:
            cur = await conn.execute(
                f"update jobs set {', '.join(sets)} where {where} returning id, status",
                tuple(params),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "status": row[1]}

    async def cancel_job(
        self, job_id: UUID, *, current_status: str, reason: str | None = None
    ) -> dict | None:
        """Atomically cancel a job and revoke its outstanding offers in a single
        connection. Guards on ``current_status`` so a concurrent status change
        (e.g. technician transition) is detected and returns None → 409."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update jobs set status = %s,"
                " cancelled_at = coalesce(cancelled_at, now()),"
                " closed_at = coalesce(closed_at, now()),"
                " updated_at = now()"
                " where id = %s and status = %s"
                " returning id, status",
                (STATUS_CANCELLED, str(job_id), current_status),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            await conn.execute(
                "update dispatch_offers set status = 'superseded', responded_at = now()"
                " where job_id = %s and status = 'offered'",
                (str(job_id),),
            )
        await self.log_event_raw(
            job_id,
            f"customer_cancel:{reason[:200]}" if reason else "customer_cancel",
        )
        return {"id": str(row[0]), "status": row[1]}

    async def get_provider_active_jobs(self, org_id: str) -> list[dict]:
        """The company's active/recoverable jobs (owned or fulfilled) with assigned
        technician and active-offer state — backs the provider recovery workspace."""
        recoverable = [
            "pending_dispatch", "assigned", "en_route", "arrived", "in_progress",
            "completed_pending_customer", "disputed",
        ]
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select j.id, j.status, j.address, j.access_type, j.situation, j.urgency,"
                " j.created_at, j.fulfillment_technician_id, o.id, o.expires_at, i.event"
                " from jobs j"
                " left join dispatch_offers o on o.job_id = j.id and o.status = 'offered'"
                " left join lateral ("
                "   select event from events"
                "   where job_id = j.id and event like 'tech_issue:%'"
                "   order by at desc limit 1"
                " ) i on true"
                " where (j.customer_owner_org_id = %s or j.fulfillment_org_id = %s)"
                "   and j.status = any(%s)"
                " order by j.created_at asc",
                (str(org_id), str(org_id), recoverable),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "status": r[1], "address": r[2], "access_type": r[3],
                "situation": r[4], "urgency": r[5],
                "created_at": r[6].isoformat() if r[6] else None,
                "fulfillment_technician_id": str(r[7]) if r[7] else None,
                "offer_active": r[8] is not None,
                "offer_id": str(r[8]) if r[8] else None,
                "offer_expires_at": r[9].isoformat() if r[9] else None,
                "last_issue": r[10],
            }
            for r in rows
        ]

    async def list_job_events(self, job_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select event, at from events where job_id = %s order by at asc, id asc",
                (str(job_id),),
            )
            rows = await cur.fetchall()
        return [{"event": r[0], "at": r[1].isoformat() if r[1] else None} for r in rows]

    async def recover_job(
        self, job_id: UUID, *, target_status: str, expected_statuses: list[str],
        clear_technician: bool = False, reason: str | None = None, audit_label: str = "recover",
    ) -> dict | None:
        """Atomic tenant recovery transition: guards on current status ∈
        expected_statuses (concurrent change → None → 409), optionally clears the
        assigned technician (revoking their access), and supersedes any active offer."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update jobs set status = %s,"
                " fulfillment_technician_id = case when %s then null else fulfillment_technician_id end,"
                " cancelled_at = case when %s = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,"
                " updated_at = now()"
                " where id = %s and status = any(%s)"
                " returning id, status",
                (target_status, clear_technician, target_status, str(job_id), expected_statuses),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            await conn.execute(
                "update dispatch_offers set status = 'superseded', responded_at = now()"
                " where job_id = %s and status = 'offered'",
                (str(job_id),),
            )
        await self.log_event_raw(job_id, f"{audit_label}:{(reason or '')[:200]}")
        return {"id": str(row[0]), "status": row[1]}

    async def add_job_note(
        self, job_id: UUID, *, author_id: str, author_name: str | None, body: str
    ) -> dict:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into job_notes (job_id, author_id, author_name, body)"
                " values (%s, %s, %s, %s)"
                " returning id, author_id, author_name, body, created_at",
                (str(job_id), str(author_id), author_name, body),
            )
            r = await cur.fetchone()
        return {
            "id": str(r[0]), "author_id": str(r[1]), "author_name": r[2],
            "body": r[3], "created_at": r[4].isoformat() if r[4] else None,
        }

    async def list_job_notes(self, job_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, author_id, author_name, body, created_at from job_notes"
                " where job_id = %s order by created_at asc",
                (str(job_id),),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "author_id": str(r[1]), "author_name": r[2],
                "body": r[3], "created_at": r[4].isoformat() if r[4] else None,
            }
            for r in rows
        ]

    async def record_customer_review(
        self,
        *,
        job_id: UUID,
        rating: int,
        comment: str | None,
        issue_reported: bool = False,
        imply_confirm: bool = False,
    ) -> dict:
        """Ticket-scoped, customer-safe review via the token link. Pulls the
        assigned technician / fulfillment + customer-owner orgs from the job (the
        customer may only review the tech assigned to *that* ticket) and refreshes
        rating summaries. Optionally implies confirm (sets confirmed_at)."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select fulfillment_technician_id, fulfillment_org_id, customer_owner_org_id"
                " from jobs where id = %s",
                (str(job_id),),
            )
            row = await cur.fetchone()
            if not row:
                raise KeyError(str(job_id))
            tech_ref = str(row[0]) if row[0] else None
            fulfillment_org_id = row[1]
            customer_owner_org_id = row[2]
            confirmed_at = datetime.now(timezone.utc) if imply_confirm else None
            cur = await conn.execute(
                "insert into job_reviews ("
                " job_id, rating, tags, comment, fulfillment_technician_ref, fulfillment_org_id,"
                " assigned_technician_id, customer_owner_org_id, confirmed_at, issue_reported"
                ") values (%s, %s, '{}', %s, %s, %s, %s, %s, %s, %s)"
                " returning id, created_at",
                (
                    str(job_id), rating, comment, tech_ref, fulfillment_org_id,
                    tech_ref, customer_owner_org_id, confirmed_at, issue_reported,
                ),
            )
            review_row = await cur.fetchone()
            targets = []
            if tech_ref:
                targets.append(("technician", tech_ref))
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
            if tech_ref:
                await conn.execute(
                    "update technicians t set rating = s.average_rating"
                    " from rating_summaries s"
                    " where s.target_type = 'technician' and s.target_id = %s"
                    " and t.id::text = s.target_id",
                    (tech_ref,),
                )
        return {
            "id": str(review_row[0]) if review_row else None,
            "ticket_id": str(job_id),
            "rating": rating,
            "comment": comment,
            "issue_reported": issue_reported,
            "technician_ref": tech_ref,
            "organization_id": str(fulfillment_org_id) if fulfillment_org_id else None,
        }

    # --- payment reconciliation (job history) ----------------------------------

    async def record_payment_report(
        self, *, job_id: UUID, reported_by: str, amount: float, method: str,
        currency: str = "USD",
    ) -> dict:
        """Upsert the latest payment report from one side (technician or customer)
        for a job. One row per (job_id, reported_by) — a re-report overwrites."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into job_payment_reports"
                " (job_id, reported_by, amount, currency, method)"
                " values (%s, %s, %s, %s, %s)"
                " on conflict (job_id, reported_by) do update set"
                "   amount = excluded.amount, currency = excluded.currency,"
                "   method = excluded.method, reported_at = now(), updated_at = now()"
                " returning amount, currency, method, reported_at",
                (str(job_id), reported_by, round(float(amount), 2), currency, method),
            )
            row = await cur.fetchone()
        return {
            "job_id": str(job_id), "reported_by": reported_by,
            "amount": float(row[0]), "currency": row[1], "method": row[2],
            "reported_at": row[3].isoformat() if row[3] else None,
        }

    async def _payments_for(self, conn, job_ids: list[str]) -> dict[str, dict]:
        """job_id -> {'technician': {...}|None, 'customer': {...}|None}."""
        out: dict[str, dict] = {jid: {"technician": None, "customer": None} for jid in job_ids}
        if not job_ids:
            return out
        cur = await conn.execute(
            "select job_id, reported_by, amount, currency, method, reported_at"
            " from job_payment_reports where job_id = any(%s)",
            (job_ids,),
        )
        for r in await cur.fetchall():
            out[str(r[0])][r[1]] = {
                "amount": float(r[2]), "currency": r[3], "method": r[4],
                "reported_at": r[5].isoformat() if r[5] else None,
            }
        return out

    async def get_payment_reports(self, job_id: UUID) -> dict:
        async with await self._connect() as conn:
            reports = await self._payments_for(conn, [str(job_id)])
        return reports[str(job_id)]

    async def get_job_review(self, job_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select rating, comment, issue_reported, created_at from job_reviews"
                " where job_id = %s order by created_at desc limit 1",
                (str(job_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "rating": row[0], "comment": row[1], "issue_reported": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
        }

    async def _job_history(self, where: str, params: tuple, limit: int) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select j.id, j.status, j.address, j.situation, j.urgency, j.created_at,"
                " coalesce(j.confirmed_at, j.closed_at, j.cancelled_at, j.disputed_at, j.updated_at),"
                " j.fulfillment_technician_id, t.display_name,"
                " r.rating, r.comment, r.created_at"
                " from jobs j"
                " left join technicians t on t.id = j.fulfillment_technician_id"
                " left join lateral ("
                "   select rating, comment, created_at from job_reviews"
                "   where job_id = j.id order by created_at desc limit 1"
                " ) r on true"
                " where " + where + " and j.status = any(%s)"
                " order by 7 desc nulls last limit %s",
                params + (list(HISTORY_STATUSES), limit),
            )
            rows = await cur.fetchall()
            payments = await self._payments_for(conn, [str(r[0]) for r in rows])
        return [
            {
                "id": str(r[0]), "status": r[1], "address": r[2], "situation": r[3],
                "urgency": r[4],
                "created_at": r[5].isoformat() if r[5] else None,
                "finished_at": r[6].isoformat() if r[6] else None,
                "fulfillment_technician_id": str(r[7]) if r[7] else None,
                "technician_display_name": r[8],
                "review": (
                    {"rating": r[9], "comment": r[10],
                     "created_at": r[11].isoformat() if r[11] else None}
                    if r[9] is not None else None
                ),
                "payments": payments.get(str(r[0]), {"technician": None, "customer": None}),
            }
            for r in rows
        ]

    async def get_provider_job_history(self, org_id: str, *, limit: int = 100) -> list[dict]:
        return await self._job_history(
            "(j.customer_owner_org_id = %s or j.fulfillment_org_id = %s)",
            (str(org_id), str(org_id)), limit,
        )

    async def get_technician_job_history(
        self, technician_id: UUID, *, limit: int = 100
    ) -> list[dict]:
        return await self._job_history(
            "j.fulfillment_technician_id = %s", (str(technician_id),), limit,
        )

    async def auto_close_pending(self, window_seconds: int) -> int:
        """Cron-owned: close jobs stuck in completed_pending_customer past the
        confirm window → completed_auto_closed. Returns how many were closed."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update jobs set status = %s, closed_at = now(), updated_at = now()"
                " where status = %s and completed_pending_at is not null"
                " and extract(epoch from (now() - completed_pending_at)) >= %s"
                " returning 1",
                (STATUS_COMPLETED_AUTO_CLOSED, STATUS_COMPLETED_PENDING, window_seconds),
            )
            rows = await cur.fetchall()
        return len(rows)

    async def resolve_job(
        self, job_id: UUID, *, action: str, note: str | None = None
    ) -> dict | None:
        """Dispatcher/admin resolution of an in-flight or disputed job. Actions:
        ``close`` (→ completed_auto_closed), ``cancel`` (→ cancelled),
        ``redispatch`` (→ pending_dispatch, clear assignment so the sweep retries)."""
        if action == "close":
            updated = await self.set_job_status(
                job_id, STATUS_COMPLETED_AUTO_CLOSED, extra_timestamps=["closed_at"]
            )
        elif action == "cancel":
            updated = await self.set_job_status(job_id, "cancelled")
        elif action == "redispatch":
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "update jobs set status = %s, trust_state = 'intake',"
                    " fulfillment_technician_id = null, fulfillment_org_id = null,"
                    " assigned_at = null, dispatch_attempts = 0, updated_at = now()"
                    " where id = %s returning id, status",
                    (STATUS_PENDING_DISPATCH, str(job_id)),
                )
                row = await cur.fetchone()
                if row:
                    await conn.execute(
                        "update dispatch_offers set status = 'superseded', responded_at = now()"
                        " where job_id = %s and status = 'offered'",
                        (str(job_id),),
                    )
            updated = {"id": str(row[0]), "status": row[1]} if row else None
        else:
            raise ValueError("unknown_action")
        if updated is None:
            return None
        if note:
            await self.log_event_raw(job_id, f"resolve:{action}:{note[:200]}")
        else:
            await self.log_event_raw(job_id, f"resolve:{action}")
        return updated

    async def log_event_raw(self, job_id: UUID, event: str) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "insert into events (ticket_id, job_id, event) values (%s, %s, %s)",
                (str(job_id), str(job_id), event),
            )

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

    async def update_technician_profile(self, technician_id: UUID, data: dict) -> dict | None:
        try:
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "update technicians set"
                    " display_name = coalesce(%s, display_name),"
                    " phone = coalesce(%s, phone),"
                    " skills = coalesce(%s, skills),"
                    " service_area_radius_km = coalesce(%s, service_area_radius_km)"
                    " where id = %s"
                    " returning id, display_name, phone, skills, service_area_radius_km",
                    (
                        data.get("display_name"),
                        data.get("phone"),
                        data.get("skills"),
                        data.get("service_area_radius_km"),
                        str(technician_id),
                    ),
                )
                row = await cur.fetchone()
                if row is None:
                    return None
                await conn.execute(
                    "update users set"
                    " display_name = coalesce(%s, display_name),"
                    " phone = coalesce(%s, phone), updated_at = now()"
                    " where id = %s",
                    (data.get("display_name"), data.get("phone"), str(technician_id)),
                )
        except Exception as exc:
            if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
                raise ValueError("Phone number is already in use")
            raise
        return {
            "id": str(row[0]),
            "display_name": row[1],
            "phone": row[2],
            "skills": list(row[3] or []),
            "service_area_radius_km": row[4],
        }

    async def list_pending_registrations(self) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select 'technician' as kind, t.id, t.display_name, t.email, t.phone,"
                " t.status, t.vetting_status, t.created_at"
                " from technicians t"
                " where t.status = 'pending_vetting' or t.vetting_status = 'unverified'"
                " union all"
                " select 'organization' as kind, o.id, o.display_name, o.email, o.phone,"
                " o.status, null, o.created_at"
                " from organizations o where o.status in ('pending', 'pending_vetting')"
                " order by created_at"
            )
            rows = await cur.fetchall()
        return [
            {
                "kind": row[0],
                "id": str(row[1]),
                "display_name": row[2],
                "email": row[3],
                "phone": row[4],
                "status": row[5],
                "vetting_status": row[6],
                "created_at": row[7].isoformat() if row[7] else None,
            }
            for row in rows
        ]

    async def list_pending_documents(self) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select d.id, d.owner_type, d.owner_id, d.document_type, d.document_number,"
                " d.issuing_authority, d.jurisdiction, d.expires_at, d.status, d.submitted_at,"
                " case when d.owner_type = 'organization' then o.display_name else t.display_name end"
                " from provider_documents d"
                " left join organizations o on d.owner_type = 'organization' and o.id = d.owner_id"
                " left join technicians t on d.owner_type = 'technician' and t.id = d.owner_id"
                " where d.status = 'pending_review' order by d.submitted_at"
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(row[0]), "owner_type": row[1], "owner_id": str(row[2]),
                "document_type": row[3], "document_number": row[4],
                "issuing_authority": row[5], "jurisdiction": row[6],
                "expires_at": row[7].isoformat() if row[7] else None,
                "status": row[8], "submitted_at": row[9].isoformat() if row[9] else None,
                "owner_name": row[10],
            }
            for row in rows
        ]

    async def get_provider_document(self, document_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, storage_bucket, storage_path, document_type"
                " from provider_documents where id = %s",
                (str(document_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "storage_bucket": row[1], "storage_path": row[2],
            "document_type": row[3],
        }

    async def get_provider_workspace(self, organization_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, legal_name, description, slug, status, phone, email,"
                " service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                " dispatch_mode, fulfillment_policy"
                " from organizations where id = %s",
                (str(organization_id),),
            )
            org = await cur.fetchone()
            if not org:
                return None
            cur = await conn.execute(
                "select t.id, t.parent_team_id, t.name, t.description, t.team_type, t.status,"
                " count(ott.technician_id)::integer"
                " from organization_teams t"
                " left join organization_team_technicians ott on ott.team_id = t.id"
                " where t.organization_id = %s"
                " group by t.id order by t.name",
                (str(organization_id),),
            )
            team_rows = await cur.fetchall()
            cur = await conn.execute(
                "select t.id, t.display_name, t.email, t.phone, t.status, t.vetting_status,"
                " t.skills, t.provider_type, t.is_available,"
                " coalesce(array_remove(array_agg(distinct ott.team_id), null), '{}')"
                " from technicians t"
                " join organization_technicians ot on ot.technician_id = t.id"
                " left join organization_team_technicians ott on ott.technician_id = t.id"
                " where ot.organization_id = %s"
                " group by t.id order by t.display_name",
                (str(organization_id),),
            )
            technician_rows = await cur.fetchall()
            cur = await conn.execute(
                "select id, owner_type, owner_id, document_type, document_number,"
                " issuing_authority, jurisdiction, issued_at, expires_at, status,"
                " storage_bucket, storage_path, notes, submitted_at, verified_at"
                " from provider_documents"
                " where (owner_type = 'organization' and owner_id = %s)"
                " or (owner_type = 'technician' and owner_id in ("
                "   select technician_id from organization_technicians where organization_id = %s"
                " )) order by submitted_at desc",
                (str(organization_id), str(organization_id)),
            )
            document_rows = await cur.fetchall()
        return {
            "organization": {
                "id": str(org[0]),
                "display_name": org[1],
                "legal_name": org[2],
                "description": org[3],
                "slug": org[4],
                "status": org[5],
                "phone": org[6],
                "email": org[7],
                "service_area_center_lat": org[8],
                "service_area_center_lng": org[9],
                "service_area_radius_km": org[10],
                "dispatch_mode": org[11],
                # stored as the canonical DB vocabulary; surfaced in semantic form
                # (an org is its own owner, so this is its effective default policy)
                "fulfillment_policy": normalize_policy(org[12], str(org[0])),
            },
            "teams": [
                {
                    "id": str(row[0]),
                    "parent_team_id": str(row[1]) if row[1] else None,
                    "name": row[2],
                    "description": row[3],
                    "team_type": row[4],
                    "status": row[5],
                    "member_count": row[6],
                }
                for row in team_rows
            ],
            "technicians": [
                {
                    "id": str(row[0]),
                    "display_name": row[1],
                    "email": row[2],
                    "phone": row[3],
                    "status": row[4],
                    "vetting_status": row[5],
                    "skills": row[6] or [],
                    "provider_type": row[7],
                    "is_available": row[8],
                    "team_ids": [str(team_id) for team_id in (row[9] or [])],
                }
                for row in technician_rows
            ],
            "documents": [
                {
                    "id": str(row[0]),
                    "owner_type": row[1],
                    "owner_id": str(row[2]),
                    "document_type": row[3],
                    "document_number": row[4],
                    "issuing_authority": row[5],
                    "jurisdiction": row[6],
                    "issued_at": row[7].isoformat() if row[7] else None,
                    "expires_at": row[8].isoformat() if row[8] else None,
                    "status": row[9],
                    "storage_bucket": row[10],
                    "storage_path": row[11],
                    "notes": row[12],
                    "submitted_at": row[13].isoformat() if row[13] else None,
                    "verified_at": row[14].isoformat() if row[14] else None,
                }
                for row in document_rows
            ],
        }

    async def update_organization_profile(self, organization_id: UUID, data: dict) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organizations set"
                " display_name = coalesce(%s, display_name),"
                " legal_name = coalesce(%s, legal_name),"
                " description = coalesce(%s, description),"
                " phone = coalesce(%s, phone),"
                " email = coalesce(%s, email),"
                " service_area_center_lat = coalesce(%s, service_area_center_lat),"
                " service_area_center_lng = coalesce(%s, service_area_center_lng),"
                " service_area_radius_km = coalesce(%s, service_area_radius_km),"
                " dispatch_mode = coalesce(%s, dispatch_mode),"
                " fulfillment_policy = coalesce(%s, fulfillment_policy),"
                " updated_at = now()"
                " where id = %s returning id, display_name, status",
                (
                    data.get("display_name"), data.get("legal_name"), data.get("description"),
                    data.get("phone"), data.get("email"), data.get("service_area_center_lat"),
                    data.get("service_area_center_lng"), data.get("service_area_radius_km"),
                    data.get("dispatch_mode"), data.get("fulfillment_policy"),
                    str(organization_id),
                ),
            )
            row = await cur.fetchone()
        return {"id": str(row[0]), "display_name": row[1], "status": row[2]} if row else None

    async def create_team(self, organization_id: UUID, data: dict) -> dict:
        parent_id = data.get("parent_team_id")
        async with await self._connect() as conn:
            if parent_id:
                cur = await conn.execute(
                    "select 1 from organization_teams where id = %s and organization_id = %s",
                    (parent_id, str(organization_id)),
                )
                if not await cur.fetchone():
                    raise ValueError("parent_team_not_found")
            cur = await conn.execute(
                "insert into organization_teams"
                " (organization_id, parent_team_id, name, description, team_type, status)"
                " values (%s, %s, %s, %s, %s, 'active')"
                " returning id, parent_team_id, name, description, team_type, status",
                (
                    str(organization_id), parent_id, data["name"], data.get("description"),
                    data.get("team_type") or "team",
                ),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]), "parent_team_id": str(row[1]) if row[1] else None,
            "name": row[2], "description": row[3], "team_type": row[4], "status": row[5],
            "member_count": 0,
        }

    async def update_team(
        self, organization_id: UUID, team_id: UUID, data: dict
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organization_teams set"
                " name = coalesce(%s, name), description = coalesce(%s, description),"
                " status = coalesce(%s, status), updated_at = now()"
                " where id = %s and organization_id = %s"
                " returning id, parent_team_id, name, description, team_type, status",
                (
                    data.get("name"), data.get("description"), data.get("status"),
                    str(team_id), str(organization_id),
                ),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "parent_team_id": str(row[1]) if row[1] else None,
            "name": row[2], "description": row[3], "team_type": row[4], "status": row[5],
        }

    async def create_affiliated_technician(self, organization_id: UUID, data: dict) -> dict:
        email = (data.get("email") or "").strip() or None
        phone = (data.get("phone") or "").strip() or None
        async with await self._connect() as conn:
            if email:
                cur = await conn.execute("select 1 from users where lower(email) = lower(%s)", (email,))
                if await cur.fetchone():
                    raise ValueError("email_taken")
            password_hash = hash_password(data["password"])
            cur = await conn.execute(
                "insert into users (email, phone, password_hash, display_name, status, locale)"
                " values (%s, %s, %s, %s, 'active', %s) returning id",
                (email, phone, password_hash, data["display_name"], data.get("locale")),
            )
            technician_id = (await cur.fetchone())[0]
            await conn.execute(
                "insert into user_roles (user_id, role) values (%s, 'technician') on conflict do nothing",
                (technician_id,),
            )
            await conn.execute(
                "insert into technicians"
                " (id, display_name, email, phone, status, vetting_status, skills,"
                " service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                " is_available, provider_type, primary_organization_id)"
                " values (%s, %s, %s, %s, 'pending_vetting', 'unverified', %s, %s, %s, %s,"
                " false, 'affiliate', %s)",
                (
                    technician_id, data["display_name"], email, phone, data.get("skills") or [],
                    data.get("service_area_center_lat"), data.get("service_area_center_lng"),
                    data.get("service_area_radius_km"), str(organization_id),
                ),
            )
            await conn.execute(
                "insert into organization_technicians"
                " (organization_id, technician_id, role, status, activated_at)"
                " values (%s, %s, 'affiliate_technician', 'active', now())",
                (str(organization_id), technician_id),
            )
            await conn.execute(
                "insert into user_organization_memberships"
                " (user_id, organization_id, role, status)"
                " values (%s, %s, 'technician', 'active')"
                " on conflict (user_id, organization_id) do nothing",
                (technician_id, str(organization_id)),
            )
            for team_id in data.get("team_ids") or []:
                cur = await conn.execute(
                    "select 1 from organization_teams where id = %s and organization_id = %s",
                    (team_id, str(organization_id)),
                )
                if await cur.fetchone():
                    await conn.execute(
                        "insert into organization_team_technicians (team_id, technician_id)"
                        " values (%s, %s) on conflict do nothing",
                        (team_id, technician_id),
                    )
        return {
            "id": str(technician_id), "display_name": data["display_name"],
            "email": email, "phone": phone, "status": "pending_vetting",
            "vetting_status": "unverified", "provider_type": "affiliate",
            "team_ids": data.get("team_ids") or [],
        }

    async def create_provider_document(self, organization_id: UUID, data: dict) -> dict:
        owner_type = data["owner_type"]
        owner_id = str(data.get("owner_id") or organization_id)
        async with await self._connect() as conn:
            if owner_type == "organization" and owner_id != str(organization_id):
                raise ValueError("invalid_document_owner")
            if owner_type == "technician":
                cur = await conn.execute(
                    "select 1 from organization_technicians"
                    " where organization_id = %s and technician_id = %s",
                    (str(organization_id), owner_id),
                )
                if not await cur.fetchone():
                    raise ValueError("invalid_document_owner")
            cur = await conn.execute(
                "insert into provider_documents"
                " (owner_type, owner_id, document_type, document_number, issuing_authority,"
                " jurisdiction, issued_at, expires_at, storage_bucket, storage_path, notes)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                " returning id, status, submitted_at",
                (
                    owner_type, owner_id, data["document_type"], data.get("document_number"),
                    data.get("issuing_authority"), data.get("jurisdiction"), data.get("issued_at"),
                    data.get("expires_at"), data.get("storage_bucket") or "private-verification",
                    data.get("storage_path"), data.get("notes"),
                ),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]), "owner_type": owner_type, "owner_id": owner_id,
            "document_type": data["document_type"], "status": row[1],
            "storage_bucket": data.get("storage_bucket") or "private-verification",
            "storage_path": data.get("storage_path"),
            "submitted_at": row[2].isoformat() if row[2] else None,
        }

    async def review_provider_document(
        self, document_id: UUID, *, status: str, reviewer_id: UUID | None
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update provider_documents set status = %s,"
                " verified_at = case when %s = 'verified' then now() else null end,"
                " verified_by = %s, updated_at = now() where id = %s"
                " returning id, owner_type, owner_id, document_type, status, verified_at",
                (status, status, str(reviewer_id) if reviewer_id else None, str(document_id)),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "owner_type": row[1], "owner_id": str(row[2]),
            "document_type": row[3], "status": row[4],
            "verified_at": row[5].isoformat() if row[5] else None,
        }

    async def update_technician_location(
        self, technician_id: UUID, *, lat: float, lng: float
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technicians set current_lat = %s, current_lng = %s,"
                " location_updated_at = now()"
                " where id = %s returning id, current_lat, current_lng, location_updated_at",
                (lat, lng, str(technician_id)),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "current_lat": row[1], "current_lng": row[2],
            "last_location_at": row[3].isoformat() if row[3] else None,
        }

    async def update_technician_availability(
        self, technician_id: UUID, *, is_available: bool
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technicians set is_available = %s"
                " where id = %s and status = 'active' and vetting_status = 'verified'"
                " returning id, is_available",
                (is_available, str(technician_id)),
            )
            row = await cur.fetchone()
        return {"id": str(row[0]), "is_available": row[1]} if row else None

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
