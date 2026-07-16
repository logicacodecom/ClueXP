from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import math
import os
import random
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.geocode import geocode, places_autocomplete
from api import storage
from api.auth import create_access_token, decode_access_token
from api import config
from api.service_catalog import active_skill_codes, normalize_skill_code
from api import settings as runtime_settings
from api.dispatch import (
    STATUS_ARRIVED,
    STATUS_ASSIGNED,
    STATUS_CANCELLED,
    STATUS_COMPLETED_CONFIRMED,
    STATUS_COMPLETED_PENDING,
    STATUS_DISPUTED,
    STATUS_EN_ROUTE,
    STATUS_IN_PROGRESS,
    STATUS_NO_SHOW,
    STATUS_PENDING_DISPATCH,
    can_customer_cancel,
    can_report_collection,
    can_technician_transition,
    eta_range_from_km,
    haversine_km,
    may_show_live_tracking,
    normalize_payment_method,
    normalize_policy,
    select_candidates,
    to_db_policy,
)
from api.store import make_store
from api.schema import (
    AccessType,
    CancellationPolicy,
    FinalCharge,
    PaymentMethod,
    Photo,
    PriceQuote,
    Situation,
    TechnicianAssignment,
    Ticket,
    TicketStatus,
    TrustState,
    Urgency,
)


store = make_store()
logger = logging.getLogger(__name__)

# Env-driven CORS. Set ALLOWED_ORIGINS to a comma-separated list in production;
# unset falls back to "*" for local dev. (In prod the Next.js rewrite proxies
# /api server-side, so cross-origin CORS is rarely exercised — this is belt-and-
# suspenders for any direct API calls.)
_origins_env = os.environ.get("ALLOWED_ORIGINS", "").strip()
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()] or ["*"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    await store.startup()
    yield


app = FastAPI(title="ClueXP Emergency Access API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def strip_vercel_api_prefix(request, call_next):
    """Let the same FastAPI routes work locally and behind Vercel's /api path."""
    if request.scope["path"].startswith("/api/"):
        request.scope["path"] = request.scope["path"][4:]
    return await call_next(request)


# OTP is deferred this sprint (no frontend gate); best-effort, demo-only.
otp_codes: dict[UUID, str] = {}


def _arrival_pin_hash(job_id: UUID, pin: str) -> str:
    """Keyed HMAC of the PIN, bound to the job. Only this hash is persisted, so a
    DB leak never exposes a usable PIN without the server-side secret."""
    msg = f"{job_id}:{pin}".encode()
    return hmac.new(config.ARRIVAL_PIN_SECRET.encode(), msg, hashlib.sha256).hexdigest()


class TicketEnvelope(BaseModel):
    ticket: Ticket
    guards: dict[str, bool]
    # Customer capability link (cutover). Populated only when intake runs on a
    # cutover-enabled channel; the legacy path leaves these null.
    tracking_token: str | None = None
    tracking_path: str | None = None


class PhotoIntentRequest(BaseModel):
    filename: str
    content_type: str
    size: int


class PhotoIntentResponse(BaseModel):
    bucket: str
    path: str
    upload_url: str
    token: str | None = None
    expires_in: int
    max_bytes: int


class PhotoCompleteRequest(BaseModel):
    bucket: str
    path: str
    content_type: str
    size: int


class LoginRequest(BaseModel):
    identifier: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    session: dict[str, Any]


class ManualIntakeRequest(BaseModel):
    customer_name: str | None = None
    customer_phone: str | None = None
    address: str
    source_channel: str | None = None
    access_type: str = "home"
    situation: str = "locked_out"
    urgency: str = "urgent"
    notes: str | None = None


class JobReviewRequest(BaseModel):
    rating: int
    tags: list[str] = []
    comment: str | None = None


class TechnicianRegisterRequest(BaseModel):
    display_name: str
    password: str
    email: str | None = None
    phone: str | None = None
    skills: list[str] = []
    service_area_center_lat: float | None = None
    service_area_center_lng: float | None = None
    service_area_radius_km: float | None = None
    locale: str | None = None
    # Optional company-invite token: links the new technician to the inviting
    # company as a pending affiliation on signup (Part 4 invite flow).
    invite_token: str | None = None


CATALOG_STATUS_VALUES = {"draft", "active", "deprecated"}


class ServiceCategoryPayload(BaseModel):
    code: str
    label: str
    status: str = "draft"
    sort_order: int = 100


class ServiceSkillPayload(BaseModel):
    code: str
    label: str
    category_code: str
    status: str = "draft"
    requires_verification: bool = False
    sort_order: int = 100


def _validate_catalog_code(code: str) -> str:
    normalized = code.strip().lower()
    if not normalized:
        raise HTTPException(status_code=422, detail="Catalog code is required.")
    allowed = set("abcdefghijklmnopqrstuvwxyz0123456789_-.")
    if any(ch not in allowed for ch in normalized):
        raise HTTPException(status_code=422, detail="Catalog code may only contain lowercase letters, numbers, dots, underscores, and hyphens.")
    return normalized


def _validate_catalog_status(status: str) -> str:
    normalized = status.strip().lower()
    if normalized not in CATALOG_STATUS_VALUES:
        raise HTTPException(status_code=422, detail="Catalog status must be draft, active, or deprecated.")
    return normalized


def _category_payload(payload: ServiceCategoryPayload) -> dict:
    return {
        "code": _validate_catalog_code(payload.code),
        "label": payload.label.strip(),
        "status": _validate_catalog_status(payload.status),
        "sort_order": payload.sort_order,
    }


def _skill_payload(payload: ServiceSkillPayload) -> dict:
    code = _validate_catalog_code(payload.code)
    category_code = _validate_catalog_code(payload.category_code)
    if not code.startswith(f"{category_code}."):
        raise HTTPException(status_code=422, detail="Skill code must be namespaced under its category, e.g. locksmith.rekey.")
    return {
        "code": code,
        "label": payload.label.strip(),
        "category_code": category_code,
        "status": _validate_catalog_status(payload.status),
        "requires_verification": payload.requires_verification,
        "sort_order": payload.sort_order,
    }


def normalize_technician_skills(skills: list[str]) -> list[str]:
    catalog_codes = active_skill_codes()
    normalized = sorted({normalize_skill_code(skill) for skill in skills if skill.strip()})
    unknown = [skill for skill in normalized if skill not in catalog_codes]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid technician skill: {', '.join(unknown)}",
        )
    return normalized


async def validate_technician_skills(skills: list[str]) -> list[str]:
    catalog = await store.list_service_catalog(active_only=True)
    catalog_codes = active_skill_codes(catalog)
    normalized = sorted({normalize_skill_code(skill) for skill in skills if skill.strip()})
    unknown = [skill for skill in normalized if skill not in catalog_codes]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid technician skill: {', '.join(unknown)}",
        )
    return normalized


class TechnicianInviteRequest(BaseModel):
    email: str | None = None


class OrganizationRegisterRequest(BaseModel):
    organization_name: str
    admin_display_name: str
    admin_email: str
    password: str
    legal_name: str | None = None
    phone: str | None = None
    service_area_center_lat: float | None = None
    service_area_center_lng: float | None = None
    service_area_radius_km: float | None = None
    locale: str | None = None


class LocaleUpdateRequest(BaseModel):
    locale: str


class AccountUpdateRequest(BaseModel):
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class OrganizationProfileUpdateRequest(BaseModel):
    display_name: str | None = None
    legal_name: str | None = None
    description: str | None = None
    phone: str | None = None
    email: str | None = None
    service_area_center_lat: float | None = None
    service_area_center_lng: float | None = None
    service_area_radius_km: float | None = None
    dispatch_mode: str | None = None
    fulfillment_policy: str | None = None


class TeamCreateRequest(BaseModel):
    name: str
    description: str | None = None
    parent_team_id: UUID | None = None
    team_type: str = "team"


class TeamUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None


class AffiliatedTechnicianRequest(BaseModel):
    display_name: str
    email: str | None = None
    phone: str | None = None
    password: str
    skills: list[str] = []
    team_ids: list[UUID] = []
    affiliation_type: str = "unknown"
    exclusivity: str = "unknown"
    dispatch_allowed: bool = True
    service_area_center_lat: float | None = None
    service_area_center_lng: float | None = None
    service_area_radius_km: float | None = None
    locale: str | None = None


class ProviderUserCreateRequest(BaseModel):
    display_name: str
    password: str
    email: str | None = None
    phone: str | None = None
    role: str = "dispatcher"


class OrganizationLimitsUpdate(BaseModel):
    # Absent = leave unchanged; null = clear the override (revert to platform
    # default); an int = set this org's override.
    max_users: int | None = None
    max_technicians: int | None = None


class ProviderDocumentRequest(BaseModel):
    owner_type: str
    owner_id: UUID | None = None
    document_type: str
    document_number: str | None = None
    issuing_authority: str | None = None
    jurisdiction: str | None = None
    issued_at: str | None = None
    expires_at: str | None = None
    storage_bucket: str = storage.PRIVATE_BUCKET
    storage_path: str | None = None
    notes: str | None = None


class DocumentReviewRequest(BaseModel):
    status: str


class TechnicianLocationRequest(BaseModel):
    lat: float
    lng: float


class TechnicianAvailabilityRequest(BaseModel):
    is_available: bool


class TechnicianProfileUpdateRequest(BaseModel):
    display_name: str | None = None
    phone: str | None = None
    skills: list[str] | None = None
    service_area_radius_km: float | None = None


class AdminActionRequest(BaseModel):
    reason: str | None = None


class AdminUserProfileUpdateRequest(BaseModel):
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    role: str | None = None  # organization-membership role; ignored for platform admins


class PlatformAdminCreateRequest(BaseModel):
    display_name: str
    password: str
    email: str | None = None
    phone: str | None = None


class JobStatusUpdateRequest(BaseModel):
    status: str


class ArrivalVerifyRequest(BaseModel):
    pin: str


class IssueReportRequest(BaseModel):
    kind: str
    reason: str | None = None


class ArrivalOverrideRequest(BaseModel):
    reason: str


class RecoveryRequest(BaseModel):
    reason: str


class NoteRequest(BaseModel):
    body: str


class DeclineAffiliationRequest(BaseModel):
    decline_reason: str | None = None


class AffiliationEndRequest(BaseModel):
    reason: str | None = None


class PhotoReviewRequest(BaseModel):
    status: str  # approved | rejected


class TechDocReviewRequest(BaseModel):
    status: str  # approved | rejected
    rejected_reason: str | None = None


class CustomerReviewRequest(BaseModel):
    rating: int
    comment: str | None = None


class PaymentReportRequest(BaseModel):
    amount: float
    method: str
    # MVP is USD-only: advisory totals are summed/displayed as a single dollar figure.
    # The field is fixed server-side; a client-supplied value is ignored.

class CancelRequest(BaseModel):
    reason: str | None = None


class DisputeRequest(BaseModel):
    reason: str | None = None


class ResolveJobRequest(BaseModel):
    action: str
    note: str | None = None


def _provider_organization_id(session: dict[str, Any]) -> UUID:
    require_any_role(session, {"provider_admin", "dispatcher"})
    organization_id = session.get("active_organization_id")
    if not organization_id:
        raise HTTPException(status_code=409, detail="Provider organization is required")
    return UUID(str(organization_id))


async def envelope(ticket: Ticket) -> TicketEnvelope:
    response_ticket = ticket.model_copy(deep=True)
    for photo in response_ticket.photos:
        if photo.url.startswith("http://") or photo.url.startswith("https://"):
            continue
        try:
            photo.url = await storage.create_signed_download_url(storage.PRIVATE_BUCKET, photo.url)
        except RuntimeError:
            # Keep the durable storage path if signing is unavailable; callers
            # still receive the ticket instead of losing the whole response.
            pass
    return TicketEnvelope(
        ticket=response_ticket,
        guards={
            "may_show_technician": ticket.may_show_technician(),
            "may_show_eta": ticket.may_show_eta(),
            "may_show_live_tracking": ticket.may_show_live_tracking(),
        },
    )


async def latency() -> None:
    await asyncio.sleep(random.uniform(0.2, 0.8))


def now() -> datetime:
    return datetime.now(timezone.utc)


async def require_ticket(ticket_id: UUID) -> Ticket:
    ticket = await store.get(ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


def deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


# Fields a public client may set on POST/PATCH. Everything else (trust_state,
# status, technician_assignment, final_charge, payment_method, price/fee amounts,
# dispatch signals, ids/timestamps) is server-owned and stripped from input.
CLIENT_FIELDS = frozenset(
    {
        "access_type",
        "situation",
        "urgency",
        "safety_flag",
        "location",
        "automotive",
        "property",
        "identity",
        "additional_details",
        "channel",
    }
)
# On these objects the client may only flip acceptance; the amounts come from the
# pricing engine (POST /price-quote), never from the browser.
CLIENT_ACCEPTANCE_ONLY = {
    "price_quote": frozenset({"accepted_by_customer", "accepted_at"}),
    "cancellation_policy": frozenset({"accepted_by_customer", "accepted_at"}),
}


def sanitize_client_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only client-editable fields; drop server-owned ones so the browser
    cannot forge trust_state, technician data, charges, or prices."""
    clean: dict[str, Any] = {}
    for key, value in (payload or {}).items():
        if key in CLIENT_FIELDS:
            clean[key] = value
        elif key in CLIENT_ACCEPTANCE_ONLY and isinstance(value, dict):
            allowed = {k: v for k, v in value.items() if k in CLIENT_ACCEPTANCE_ONLY[key]}
            if allowed:
                clean[key] = allowed
    return clean


async def save(ticket: Ticket, origin: dict | None = None) -> Ticket:
    await store.save(ticket, origin)
    return ticket


async def log_transition(ticket: Ticket, event: str) -> None:
    await store.log_event(ticket, event)


def _extension_for_content_type(content_type: str) -> str:
    return {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }.get(content_type, "")


async def require_session(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    claims = decode_access_token(authorization.split(" ", 1)[1].strip())
    if claims is None or not claims.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid session")
    session = await store.get_user_session(str(claims["sub"]))
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid session")
    return session


def require_any_role(session: dict[str, Any], allowed: set[str]) -> None:
    if not allowed.intersection(set(session.get("roles", []))):
        raise HTTPException(status_code=403, detail="Insufficient role")


def _enum_or_default(enum_type, value: str, default):
    try:
        return enum_type(value)
    except ValueError:
        return default


def _manual_origin(session: dict[str, Any], payload: ManualIntakeRequest) -> dict[str, Any]:
    org_id = session.get("active_organization_id")
    if not org_id:
        raise HTTPException(status_code=409, detail="Provider organization is required")
    return {
        "origin_org_id": org_id,
        "customer_owner_org_id": org_id,
        "customer_name": payload.customer_name,
        "customer_phone": payload.customer_phone,
    }


@app.post("/auth/login", response_model=AuthResponse)
async def login(payload: LoginRequest, request: Request) -> AuthResponse:
    await latency()
    if await store.login_rate_limited(payload.identifier):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")
    session = await store.authenticate_user(payload.identifier, payload.password)
    if session is None:
        await store.record_login_attempt(
            payload.identifier,
            success=False,
            ip=request.client.host if request.client else None,
        )
        raise HTTPException(status_code=401, detail="Invalid email, phone, or password")
    await store.record_login_attempt(
        payload.identifier,
        success=True,
        ip=request.client.host if request.client else None,
    )
    token = create_access_token(
        {
            "sub": session["user"]["id"],
            "roles": session.get("roles", []),
            "org": session.get("active_organization_id"),
        }
    )
    return AuthResponse(access_token=token, session=session)


@app.get("/auth/me")
async def me(session: dict[str, Any] = Depends(require_session)) -> dict[str, Any]:
    return session


@app.post("/auth/register/technician", response_model=AuthResponse)
async def register_technician(payload: TechnicianRegisterRequest) -> AuthResponse:
    """Self-service individual-technician signup. The technician owns the global
    profile; company membership is accepted later through affiliation rows."""
    await latency()
    if not payload.email and not payload.phone:
        raise HTTPException(status_code=422, detail="Email or phone is required")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    data = payload.model_dump()
    data["skills"] = await validate_technician_skills(payload.skills)
    try:
        session = await store.register_technician(data)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    token = create_access_token(
        {"sub": session["user"]["id"], "roles": session.get("roles", []), "org": None}
    )
    return AuthResponse(access_token=token, session=session)


@app.post("/auth/register/organization", response_model=AuthResponse)
async def register_organization(payload: OrganizationRegisterRequest) -> AuthResponse:
    """Self-service company signup. Creates a PENDING organization + its first
    provider-admin user. Pending until a platform admin approves."""
    await latency()
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    try:
        session = await store.register_organization(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    token = create_access_token(
        {
            "sub": session["user"]["id"],
            "roles": session.get("roles", []),
            "org": session.get("active_organization_id"),
        }
    )
    return AuthResponse(access_token=token, session=session)


@app.patch("/auth/me/locale")
async def update_locale(
    payload: LocaleUpdateRequest, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    await store.update_user_locale(session["user"]["id"], payload.locale)
    return {"locale": payload.locale}


@app.patch("/auth/me")
async def update_account(
    payload: AccountUpdateRequest, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    """Self-service identity update — the signed-in user only, no admin path.
    Any field left unset is untouched; an empty string is rejected rather than
    silently clearing a login identifier."""
    sent = payload.model_dump(exclude_unset=True)
    for field in ("display_name", "email", "phone"):
        if field in sent and sent[field] is not None and not sent[field].strip():
            raise HTTPException(status_code=422, detail=f"{field} cannot be empty")
    result = await store.update_user_profile(session["user"]["id"], sent)
    if result == "email_taken":
        raise HTTPException(status_code=409, detail="Email is already in use")
    if result == "phone_taken":
        raise HTTPException(status_code=409, detail="Phone is already in use")
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    return result


@app.post("/auth/me/password")
async def change_password(
    payload: PasswordChangeRequest, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    """Self-service password change — requires the current password, so a
    hijacked session alone can't lock the real owner out."""
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    changed = await store.change_user_password(
        session["user"]["id"], payload.current_password, payload.new_password
    )
    if not changed:
        raise HTTPException(status_code=422, detail="Current password is incorrect")
    return {"status": "updated"}


async def _record_admin_governance_event(
    session: dict[str, Any],
    *,
    entity_type: str,
    entity_id: UUID,
    action: str,
    reason: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    actor_user_id = str(session["user"].get("id") or "")
    try:
        actor_id: UUID | None = UUID(actor_user_id)
    except ValueError:
        actor_id = None
    event_metadata = {"actor_user_id": actor_user_id, **(metadata or {})}
    await store.record_governance_event(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        reason=reason,
        actor_id=actor_id,
        metadata=event_metadata,
    )


@app.post("/admin/technicians/{technician_id}/approve")
async def approve_technician(
    technician_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.approve_technician(technician_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    reason = (payload.reason if payload else None) or None
    await _record_admin_governance_event(
        session, entity_type="technician", entity_id=technician_id, action="approve",
        reason=reason.strip()[:280] if reason else None, metadata={"status": result.get("status")},
    )
    return result


@app.post("/admin/organizations/{organization_id}/approve")
async def approve_organization(
    organization_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.approve_organization(organization_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    reason = (payload.reason if payload else None) or None
    await _record_admin_governance_event(
        session, entity_type="organization", entity_id=organization_id, action="approve",
        reason=reason.strip()[:280] if reason else None, metadata={"status": result.get("status")},
    )
    return result


@app.post("/admin/technicians/{technician_id}/reject")
async def reject_technician(
    technician_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    reason = (payload.reason if payload else None) or ""
    if len(reason.strip()) < 3:
        raise HTTPException(status_code=422, detail="A rejection reason is required.")
    result = await store.reject_technician(technician_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    result["reason"] = reason.strip()[:280]
    await _record_admin_governance_event(
        session, entity_type="technician", entity_id=technician_id, action="reject",
        reason=result["reason"], metadata={"status": result.get("status")},
    )
    return result


@app.post("/admin/technicians/{technician_id}/suspend")
async def suspend_technician(
    technician_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Ops suspends a technician globally, making them unavailable for dispatch."""
    require_any_role(session, {"platform_admin"})
    reason = (payload.reason if payload else None) or ""
    if len(reason.strip()) < 3:
        raise HTTPException(status_code=422, detail="A suspension reason is required.")
    result = await store.set_technician_status(technician_id, "suspended")
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    result["reason"] = reason.strip()[:280]
    await _record_admin_governance_event(
        session, entity_type="technician", entity_id=technician_id, action="suspend",
        reason=result["reason"], metadata={"status": result.get("status")},
    )
    return result


@app.post("/admin/technicians/{technician_id}/reactivate")
async def reactivate_technician(
    technician_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.set_technician_status(technician_id, "active")
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    reason = (payload.reason if payload else None) or None
    await _record_admin_governance_event(
        session, entity_type="technician", entity_id=technician_id, action="reactivate",
        reason=reason.strip()[:280] if reason else None, metadata={"status": result.get("status")},
    )
    return result


@app.post("/admin/organizations/{organization_id}/reject")
async def reject_organization(
    organization_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    reason = (payload.reason if payload else None) or ""
    if len(reason.strip()) < 3:
        raise HTTPException(status_code=422, detail="A rejection reason is required.")
    result = await store.reject_organization(organization_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    result["reason"] = reason.strip()[:280]
    await _record_admin_governance_event(
        session, entity_type="organization", entity_id=organization_id, action="reject",
        reason=result["reason"], metadata={"status": result.get("status")},
    )
    return result


@app.post("/admin/organizations/{organization_id}/suspend")
async def suspend_organization(
    organization_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Ops suspends an active company (company-wide; distinct from a provider
    suspending one technician affiliation)."""
    require_any_role(session, {"platform_admin"})
    reason = (payload.reason if payload else None) or ""
    if len(reason.strip()) < 3:
        raise HTTPException(status_code=422, detail="A suspension reason is required.")
    result = await store.set_organization_status(organization_id, "suspended")
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    result["reason"] = reason.strip()[:280]
    await _record_admin_governance_event(
        session, entity_type="organization", entity_id=organization_id, action="suspend",
        reason=result["reason"], metadata={"status": result.get("status")},
    )
    return result


@app.post("/admin/organizations/{organization_id}/reactivate")
async def reactivate_organization(
    organization_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.set_organization_status(organization_id, "active")
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    reason = (payload.reason if payload else None) or None
    await _record_admin_governance_event(
        session, entity_type="organization", entity_id=organization_id, action="reactivate",
        reason=reason.strip()[:280] if reason else None, metadata={"status": result.get("status")},
    )
    return result


@app.get("/admin/organizations")
async def admin_list_organizations(
    status: str | None = None, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    """Platform console: the full company directory (any status), for the
    network-management screens — distinct from /admin/registrations, which is
    the pending-only approval queue."""
    require_any_role(session, {"platform_admin"})
    return {"organizations": await store.list_organizations(status)}


@app.get("/admin/organizations/{organization_id}")
async def admin_get_organization(
    organization_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    detail = await store.get_organization_admin_detail(organization_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    detail["limits"] = await _resolve_org_limits(str(organization_id))
    return detail


@app.patch("/admin/organizations/{organization_id}")
async def admin_update_organization(
    organization_id: UUID,
    payload: OrganizationProfileUpdateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.update_organization_profile(organization_id, payload.model_dump(exclude_unset=True))
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return result


@app.delete("/admin/organizations/{organization_id}")
async def admin_delete_or_archive_organization(
    organization_id: UUID,
    payload: AdminActionRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A delete/archive reason is required.")
    result = await store.delete_or_archive_organization(organization_id, reason=reason[:280])
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    action = {"deleted": "delete", "archived": "archive"}.get(str(result.get("action")), str(result.get("action")))
    await _record_admin_governance_event(
        session, entity_type="organization", entity_id=organization_id, action=action,
        reason=result.get("reason"), metadata={"status": result.get("status"), "references": result.get("references")},
    )
    return result


@app.post("/admin/organizations")
async def admin_create_organization(
    payload: OrganizationRegisterRequest, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    """Console-initiated company registration. Lands PENDING, same as
    self-signup — an admin vouching for a company does not skip approval."""
    require_any_role(session, {"platform_admin"})
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    try:
        return await store.register_organization(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.get("/admin/technicians")
async def admin_list_technicians(
    status: str | None = None, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    return {"technicians": await store.list_technicians_admin(status)}


@app.patch("/admin/technicians/{technician_id}")
async def admin_update_technician(
    technician_id: UUID,
    payload: TechnicianProfileUpdateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    data = payload.model_dump(exclude_unset=True)
    if data.get("skills") is not None:
        data["skills"] = await validate_technician_skills(data["skills"])
    try:
        result = await store.update_technician_profile(technician_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    return result


@app.delete("/admin/technicians/{technician_id}")
async def admin_delete_or_archive_technician(
    technician_id: UUID,
    payload: AdminActionRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A delete/archive reason is required.")
    result = await store.delete_or_archive_technician(technician_id, reason=reason[:280])
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    action = {"deleted": "delete", "archived": "archive"}.get(str(result.get("action")), str(result.get("action")))
    await _record_admin_governance_event(
        session, entity_type="technician", entity_id=technician_id, action=action,
        reason=result.get("reason"), metadata={"status": result.get("status"), "references": result.get("references")},
    )
    return result


@app.post("/admin/technicians")
async def admin_create_technician(
    payload: TechnicianRegisterRequest, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    """Console-initiated technician registration (no invite token — a standalone
    signup the admin is entering on the technician's behalf). Lands
    pending_vetting, same as self-signup."""
    require_any_role(session, {"platform_admin"})
    if not payload.email and not payload.phone:
        raise HTTPException(status_code=422, detail="Email or phone is required")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    data = payload.model_dump()
    data["skills"] = await validate_technician_skills(payload.skills)
    data["invite_token"] = None
    try:
        return await store.register_technician(data)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.get("/admin/registrations")
async def pending_registrations(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    return {"registrations": await store.list_pending_registrations()}


@app.patch("/admin/documents/{document_id}")
async def review_document(
    document_id: UUID,
    payload: DocumentReviewRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    if payload.status not in {"verified", "rejected", "expired"}:
        raise HTTPException(status_code=422, detail="Invalid document status")
    result = await store.review_provider_document(
        document_id,
        status=payload.status,
        reviewer_id=UUID(session["user"]["id"]),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return result


@app.get("/admin/documents")
async def pending_documents(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    return {"documents": await store.list_pending_documents()}


@app.get("/admin/technicians/photos")
async def pending_technician_photos(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    return {"photos": await store.list_pending_technician_photos()}


@app.patch("/admin/technicians/{technician_id}/photo")
async def review_technician_photo(
    technician_id: UUID,
    payload: PhotoReviewRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Ops/platform approves or rejects a technician's profile photo. Only an
    `approved` photo is exposed to customers (Slice E). Providers may view a
    technician's photo but cannot approve/replace it (global profile is Ops-owned)."""
    require_any_role(session, {"platform_admin"})
    if payload.status not in {"approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Photo status must be 'approved' or 'rejected'")
    result = await store.set_technician_photo_status(technician_id, payload.status)
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    return result


@app.get("/admin/technician-documents")
async def pending_technician_documents(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Technician compliance documents awaiting Ops review."""
    require_any_role(session, {"platform_admin"})
    return {"documents": await store.list_pending_technician_documents()}


@app.patch("/admin/technician-documents/{document_id}")
async def review_technician_document(
    document_id: UUID,
    payload: TechDocReviewRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Ops approves or rejects a technician compliance document."""
    require_any_role(session, {"platform_admin"})
    if payload.status not in {"approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Status must be 'approved' or 'rejected'")
    result = await store.review_technician_document(
        document_id, status=payload.status,
        reviewer_id=UUID(session["user"]["id"]),
        reason=payload.rejected_reason if payload.status == "rejected" else None,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return result


@app.get("/admin/technician-documents/{document_id}/download")
async def admin_download_technician_document(
    document_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Issue a short-lived signed download URL for a technician compliance
    document so Ops can review the file. Platform-admin only."""
    require_any_role(session, {"platform_admin"})
    doc = await store.get_technician_document_admin(document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if not storage.storage_configured():
        raise HTTPException(status_code=503, detail="Document storage is not configured")
    try:
        url = await storage.create_signed_download_url(doc["storage_bucket"], doc["storage_path"])
    except Exception:
        raise HTTPException(status_code=502, detail="Could not issue a download URL")
    return {"download_url": url}


async def _guard_platform_admin_self_and_last(
    session: dict[str, Any], user_id: UUID, *, action: str
) -> None:
    """A platform_admin may never suspend/delete their own account (avoids
    accidental or malicious self-lockout), and the platform must always keep
    at least one active platform_admin able to sign in."""
    if str(session["user"].get("id")) == str(user_id):
        raise HTTPException(status_code=409, detail=f"You cannot {action} your own account.")
    detail = await store.get_user_admin_detail(user_id)
    if detail and "platform_admin" in (detail.get("roles") or []) and detail.get("status") == "active":
        remaining = await store.count_active_platform_admins()
        if remaining <= 1:
            raise HTTPException(status_code=409, detail="At least one active platform admin must remain.")


@app.get("/admin/users")
async def admin_list_users(
    scope: str = "company",
    organization_id: UUID | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Platform console directory. scope=company is dispatcher/provider_admin
    company staff (optionally filtered to one organization); scope=platform is
    the platform_admin roster — a distinct role, not org-scoped."""
    require_any_role(session, {"platform_admin"})
    if scope == "platform":
        return {"users": await store.list_platform_admins()}
    if scope != "company":
        raise HTTPException(status_code=422, detail="scope must be 'company' or 'platform'")
    return {"users": await store.list_company_users_admin(organization_id)}


@app.get("/admin/users/{user_id}")
async def admin_get_user(
    user_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    detail = await store.get_user_admin_detail(user_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="User not found")
    return detail


@app.patch("/admin/users/{user_id}")
async def admin_update_user(
    user_id: UUID,
    payload: AdminUserProfileUpdateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    data = payload.model_dump(exclude_unset=True, exclude={"role"})
    result = await store.update_user_profile(str(user_id), data)
    if result == "email_taken":
        raise HTTPException(status_code=409, detail="Email is already in use")
    if result == "phone_taken":
        raise HTTPException(status_code=409, detail="Phone is already in use")
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.role is not None:
        detail = await store.get_user_admin_detail(user_id)
        memberships = (detail or {}).get("memberships") or []
        if not memberships:
            raise HTTPException(status_code=409, detail="This account has no company membership to assign a role to")
        if payload.role not in PROVIDER_USER_ROLES:
            raise HTTPException(status_code=422, detail=f"role must be one of {sorted(PROVIDER_USER_ROLES)}")
        await store.update_organization_member_role(user_id, UUID(memberships[0]["organization_id"]), payload.role)
    return await store.get_user_admin_detail(user_id)


@app.post("/admin/users/{user_id}/suspend")
async def suspend_user(
    user_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    reason = (payload.reason if payload else None) or ""
    if len(reason.strip()) < 3:
        raise HTTPException(status_code=422, detail="A suspension reason is required.")
    await _guard_platform_admin_self_and_last(session, user_id, action="suspend")
    result = await store.set_user_account_status(user_id, "suspended")
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    result["reason"] = reason.strip()[:280]
    await _record_admin_governance_event(
        session, entity_type="user", entity_id=user_id, action="suspend",
        reason=result["reason"], metadata={"status": result.get("status")},
    )
    return result


@app.post("/admin/users/{user_id}/reactivate")
async def reactivate_user(
    user_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.set_user_account_status(user_id, "active")
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    reason = (payload.reason if payload else None) or None
    await _record_admin_governance_event(
        session, entity_type="user", entity_id=user_id, action="reactivate",
        reason=reason.strip()[:280] if reason else None, metadata={"status": result.get("status")},
    )
    return result


@app.delete("/admin/users/{user_id}")
async def admin_delete_or_archive_user(
    user_id: UUID,
    payload: AdminActionRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A delete/archive reason is required.")
    await _guard_platform_admin_self_and_last(session, user_id, action="delete")
    result = await store.delete_or_archive_user(user_id, reason=reason[:280])
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    action = {"deleted": "delete", "archived": "archive"}.get(str(result.get("action")), str(result.get("action")))
    await _record_admin_governance_event(
        session, entity_type="user", entity_id=user_id, action=action,
        reason=result.get("reason"), metadata={"status": result.get("status"), "references": result.get("references")},
    )
    return result


@app.post("/admin/users")
async def admin_create_platform_admin(
    payload: PlatformAdminCreateRequest, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    """Console-initiated platform-admin account creation. There is no
    self-signup for this role — an existing platform_admin is the only way a
    new one gets created."""
    require_any_role(session, {"platform_admin"})
    if not payload.email and not payload.phone:
        raise HTTPException(status_code=422, detail="Email or phone is required")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    try:
        return await store.create_platform_admin(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


# Registered after the literal /admin/technicians/... routes above (photos,
# photo review) so this catch-all {technician_id} path can't shadow them —
# Starlette matches path routes in registration order.
@app.get("/admin/technicians/{technician_id}")
async def admin_get_technician(
    technician_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    detail = await store.get_technician_admin_detail(technician_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    return detail


@app.get("/admin/documents/{document_id}/download")
async def download_document(
    document_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    document = await store.get_provider_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if not document.get("storage_path"):
        raise HTTPException(status_code=409, detail="Document file is not available")
    try:
        url = await storage.create_signed_download_url(
            document["storage_bucket"], document["storage_path"]
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"download_url": url, "expires_in": storage.DOWNLOAD_TTL_SECONDS}


@app.get("/provider/workspace")
async def provider_workspace(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    organization_id = _provider_organization_id(session)
    workspace = await store.get_provider_workspace(organization_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return workspace


@app.patch("/provider/organization")
async def update_provider_organization(
    payload: OrganizationProfileUpdateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    organization_id = _provider_organization_id(session)
    if payload.dispatch_mode and payload.dispatch_mode not in {
        "organization_managed", "platform_managed"
    }:
        raise HTTPException(status_code=422, detail="Invalid dispatch mode")
    data = payload.model_dump(exclude_none=True)
    if payload.fulfillment_policy:
        db_policy = to_db_policy(payload.fulfillment_policy)
        if db_policy is None:
            raise HTTPException(status_code=422, detail="Invalid fulfillment policy")
        data["fulfillment_policy"] = db_policy  # store the canonical DB vocabulary
    result = await store.update_organization_profile(organization_id, data)
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return result


@app.post("/provider/teams")
async def create_provider_team(
    payload: TeamCreateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    organization_id = _provider_organization_id(session)
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Team name is required")
    try:
        return await store.create_team(organization_id, payload.model_dump(mode="json"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.patch("/provider/teams/{team_id}")
async def update_provider_team(
    team_id: UUID,
    payload: TeamUpdateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    organization_id = _provider_organization_id(session)
    if payload.status and payload.status not in {"active", "inactive"}:
        raise HTTPException(status_code=422, detail="Invalid team status")
    result = await store.update_team(
        organization_id, team_id, payload.model_dump(exclude_none=True)
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return result


class TeamTechnicianRequest(BaseModel):
    technician_id: UUID
    role: str | None = None


@app.delete("/provider/teams/{team_id}")
async def delete_provider_team(
    team_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Safe-delete a team. Tenant-scoped (foreign/unknown team → 404). Refuses with 409
    while the team still has sub-teams; otherwise removes its memberships and the team
    (technician profiles and affiliations are untouched — only team structure)."""
    organization_id = _provider_organization_id(session)
    try:
        result = await store.delete_team(organization_id, team_id)
    except ValueError:
        raise HTTPException(
            status_code=409,
            detail="Reassign or remove sub-teams before deleting this team.",
        )
    if result is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return {"deleted": True, "team_id": str(team_id)}


@app.post("/provider/teams/{team_id}/technicians")
async def add_provider_team_technician(
    team_id: UUID,
    payload: TeamTechnicianRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Add one of the company's already-affiliated technicians to a team. Both the team
    and the technician must belong to the caller's org (else 404/422). Idempotent."""
    organization_id = _provider_organization_id(session)
    result = await store.add_team_technician(
        organization_id, team_id, payload.technician_id, role=payload.role
    )
    if result.get("error_code") == "team_not_found":
        raise HTTPException(status_code=404, detail="Team not found")
    if result.get("error_code") == "not_affiliated":
        raise HTTPException(
            status_code=422,
            detail="Only technicians actively affiliated with your company can join a team.",
        )
    return result


@app.delete("/provider/teams/{team_id}/technicians/{technician_id}")
async def remove_provider_team_technician(
    team_id: UUID,
    technician_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Remove a technician from a team (team structure only; the affiliation is untouched).
    Tenant-scoped to the caller's org."""
    organization_id = _provider_organization_id(session)
    removed = await store.remove_team_technician(organization_id, team_id, technician_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Team membership not found")
    return {"removed": True, "team_id": str(team_id), "technician_id": str(technician_id)}


@app.post("/provider/technicians")
async def create_provider_technician(
    payload: AffiliatedTechnicianRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    _provider_organization_id(session)
    raise HTTPException(
        status_code=410,
        detail=(
            "Provider-created technician profiles are retired. "
            "Use POST /provider/technicians/invite so the person signs up as a technician "
            "and accepts the company affiliation."
        ),
    )


@app.get("/provider/technicians")
async def list_provider_technicians(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Operational directory of the company's affiliated technicians. Tenant-scoped:
    derives from the org's open affiliation periods only — never another company's
    roster. Includes status, availability, completed jobs, rating, affiliation date,
    skills, and a per-technician compliance summary (real data, no mock)."""
    organization_id = _provider_organization_id(session)
    return {"technicians": await store.list_affiliated_technicians_directory(organization_id)}


@app.post("/provider/technicians/invite")
async def invite_provider_technician(
    payload: TechnicianInviteRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Invite a technician by email. If a ClueXP technician already exists for that
    email, attach them to this company as a PENDING invite (they accept in their own
    portal). Otherwise mint a one-time signup invite token and return a copyable link
    (email delivery is a follow-up) — on signup the technician is linked to this
    company. Consent is always required; nothing is silently activated."""
    organization_id = _provider_organization_id(session)
    email = (payload.email or "").strip() or None
    if not email:
        raise HTTPException(status_code=422, detail="A technician email is required")
    limit = await _resolve_max_technicians(str(organization_id))
    occupied = await store.count_organization_technician_slots(organization_id)
    if occupied >= limit:
        raise HTTPException(
            status_code=409,
            detail=f"This company has reached its technician limit ({limit}).",
        )
    # Existing account → attach directly as a pending affiliation.
    existing = await store.find_technician_by_email(email)
    if existing is not None:
        try:
            result = await store.add_affiliation(
                organization_id, UUID(existing["id"]), status="pending_invite",
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        return {
            "mode": "existing_technician",
            "technician_id": existing["id"],
            "display_name": existing.get("display_name"),
            "affiliation": result,
        }
    invite = await store.create_technician_invite(
        organization_id, email=email, invited_by=str(session.get("user", {}).get("id")),
    )
    return {"mode": "invite_link", "invite": invite}


@app.get("/technician-invites/{token}")
async def resolve_technician_invite(token: str) -> dict[str, Any]:
    """Public: resolve a company invite token so the technician signup page can show
    the inviting company. Returns 404 for unknown/expired/used tokens."""
    invite = await store.resolve_technician_invite(token)
    if invite is None or invite.get("status") != "pending":
        raise HTTPException(status_code=404, detail="Invite not found or no longer valid")
    return {
        "organization_id": invite["organization_id"],
        "organization_name": invite.get("organization_name"),
        "email": invite.get("email"),
        "expires_at": invite.get("expires_at"),
    }


@app.post("/provider/intake-channel")
async def ensure_provider_intake_channel(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Ensure the company has a branded intake slug, generating a unique one from its
    name if missing. Tenant-scoped to the caller's org. Returns {slug}."""
    organization_id = _provider_organization_id(session)
    result = await store.ensure_intake_channel(organization_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return result


@app.post("/provider/technicians/{technician_id}/affiliation/end")
async def provider_end_affiliation(
    technician_id: UUID,
    payload: AffiliationEndRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """End this company's affiliation with one of its technicians (leave/remove).
    Tenant-scoped: only touches the open affiliation period for the caller's org, so a
    provider can never end another company's affiliation. Closing the period preserves
    history and allows a later rejoin."""
    organization_id = _provider_organization_id(session)
    reason = ((payload.reason if payload else None) or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A reason for ending the affiliation is required.")
    result = await store.end_affiliation(organization_id, technician_id, reason=reason[:280], status="ended")
    if result is None:
        raise HTTPException(status_code=404, detail="No active affiliation with this technician")
    return result


@app.post("/provider/technicians/{technician_id}/affiliation/suspend")
async def provider_suspend_affiliation(
    technician_id: UUID,
    payload: AffiliationEndRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Temporarily suspend this company's affiliation with a technician (dispatch-
    ineligible, period stays open so it can be reactivated). Tenant-scoped."""
    organization_id = _provider_organization_id(session)
    reason = ((payload.reason if payload else None) or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A reason for suspending the affiliation is required.")
    result = await store.end_affiliation(organization_id, technician_id, reason=reason[:280], status="suspended")
    if result is None:
        raise HTTPException(status_code=404, detail="No active affiliation with this technician")
    return result


@app.get("/provider/technicians/{technician_id}")
async def get_provider_technician(
    technician_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Tenant-scoped, **read-only** profile of one affiliated technician: base profile,
    affiliation, team memberships, company + global review summaries, and compliance
    documents. The technician owns the global profile — there are no edit actions here.
    A technician not affiliated with the caller's org returns 404 (no cross-tenant leak)."""
    organization_id = _provider_organization_id(session)
    detail = await store.get_provider_technician_detail(organization_id, technician_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Technician is not affiliated with your company")
    return detail


@app.post("/provider/documents/upload-intent", response_model=PhotoIntentResponse)
async def provider_document_upload_intent(
    payload: PhotoIntentRequest,
    session: dict[str, Any] = Depends(require_session),
) -> PhotoIntentResponse:
    organization_id = _provider_organization_id(session)
    try:
        storage.validate_upload_claim(payload.content_type, payload.size, allow_pdf=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    safe_name = "".join(
        char if char.isalnum() or char in "._-" else "-" for char in payload.filename
    ).strip(".-") or "document"
    path = f"providers/{organization_id}/{uuid4()}-{safe_name}"
    try:
        intent = await storage.create_signed_upload_url(storage.PRIVATE_BUCKET, path)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return PhotoIntentResponse(
        bucket=intent.bucket,
        path=intent.path,
        upload_url=intent.upload_url,
        token=intent.token,
        expires_in=intent.expires_in,
        max_bytes=storage.MAX_UPLOAD_BYTES,
    )


@app.post("/provider/documents")
async def create_provider_document(
    payload: ProviderDocumentRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    organization_id = _provider_organization_id(session)
    # Document ownership (Part 5): a provider company owns and maintains ONLY its own
    # company credentials. Technician documents are the technician's / ClueXP ops'
    # responsibility — a provider may never upload or edit them through this surface.
    if payload.owner_type != "organization":
        raise HTTPException(
            status_code=403,
            detail="Provider companies can only manage their own company documents, not technician documents.",
        )
    try:
        return await store.create_provider_document(
            organization_id, payload.model_dump(mode="json")
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.patch("/technicians/me/location")
async def update_my_location(
    payload: TechnicianLocationRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"technician"})
    technician = session.get("technician")
    if not technician:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    if not (-90 <= payload.lat <= 90 and -180 <= payload.lng <= 180):
        raise HTTPException(status_code=422, detail="Invalid coordinates")
    result = await store.update_technician_location(
        UUID(technician["id"]), lat=payload.lat, lng=payload.lng
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    return result


@app.patch("/technicians/me/availability")
async def update_my_availability(
    payload: TechnicianAvailabilityRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"technician"})
    technician = session.get("technician")
    if not technician or not technician.get("approved"):
        raise HTTPException(status_code=409, detail="Technician approval is required")
    result = await store.update_technician_availability(
        UUID(technician["id"]), is_available=payload.is_available
    )
    if result is None:
        raise HTTPException(status_code=409, detail="Technician is not eligible for dispatch")
    return result


# --- technician self-service: affiliations + profile photo (Slice D backend) ---
def _me_technician_id(session: dict[str, Any]) -> UUID:
    require_any_role(session, {"technician"})
    technician = session.get("technician")
    if not technician or not technician.get("id"):
        raise HTTPException(status_code=409, detail="Technician profile is required")
    return UUID(technician["id"])


@app.get("/technicians/me/affiliations")
async def my_affiliations(session: dict[str, Any] = Depends(require_session)) -> dict[str, Any]:
    """The signed-in technician's own provider affiliations (invites + active +
    history). Self-scoped: only ever this technician's rows."""
    tid = _me_technician_id(session)
    return {"affiliations": await store.list_technician_affiliations(tid)}


@app.get("/technicians/me/organizations")
async def my_organizations(session: dict[str, Any] = Depends(require_session)) -> dict[str, Any]:
    tid = _me_technician_id(session)
    return {"organizations": await store.list_technician_organizations(tid)}


@app.post("/technicians/me/affiliations/{affiliation_id}/accept")
async def accept_my_affiliation(
    affiliation_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Accept a pending invite → activate it, enforcing exclusivity at activation."""
    tid = _me_technician_id(session)
    try:
        result = await store.accept_affiliation(affiliation_id, tid)
    except ValueError as exc:
        if str(exc) == "exclusive_conflict":
            raise HTTPException(
                status_code=409,
                detail="You already have an active exclusive affiliation with another provider.",
            )
        raise HTTPException(status_code=409, detail="This invite can no longer be accepted.")
    if result is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"affiliation": result, "message": "Affiliation accepted"}


@app.post("/technicians/me/affiliations/{affiliation_id}/decline")
async def decline_my_affiliation(
    affiliation_id: UUID, payload: DeclineAffiliationRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    tid = _me_technician_id(session)
    reason = (payload.decline_reason if payload else None) or None
    try:
        result = await store.decline_affiliation(affiliation_id, tid, reason=reason)
    except ValueError:
        raise HTTPException(status_code=409, detail="This invite can no longer be declined.")
    if result is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"affiliation": result, "message": "Affiliation declined"}


@app.post("/technicians/me/photo")
async def upload_my_photo(
    file: UploadFile = File(...), session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Upload a profile headshot to the public technician-media bucket and mark it
    `pending` review. Customer exposure stays gated on approval (Slice E)."""
    tid = _me_technician_id(session)
    content = await file.read()
    try:
        storage.validate_upload_claim(file.content_type or "", len(content))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not storage.storage_configured():
        raise HTTPException(status_code=503, detail="Photo storage is not configured")
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(file.content_type or "", "jpg")
    path = f"technicians/{tid}/headshot-{uuid4()}.{ext}"
    try:
        url = await storage.upload_object(storage.PUBLIC_TECH_BUCKET, path, content, file.content_type or "image/jpeg")
    except Exception:
        raise HTTPException(status_code=502, detail="Photo upload failed")
    result = await store.set_technician_photo(tid, url)
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    return {"photo_url": result["photo_url"], "photo_status": result["photo_status"], "message": "Photo uploaded"}


@app.get("/technicians/me/documents")
async def list_my_documents(session: dict[str, Any] = Depends(require_session)) -> list[dict]:
    """List current user's compliance documents."""
    tid = _me_technician_id(session)
    return await store.list_technician_documents(tid)


@app.post("/technicians/me/documents")
async def upload_my_document(
    file: UploadFile = File(...),
    document_type: str = Form(...),
    document_number: str | None = Form(None),
    expiration_date: str | None = Form(None),
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Upload a compliance document for the current technician.
    
    Documents are stored in Supabase Storage and tracked with status 'pending_review'.
    """
    tid = _me_technician_id(session)
    
    # Validate file type
    content_type = file.content_type or ""
    allowed_types = {"image/png", "image/jpeg", "image/webp", "application/pdf"}
    if content_type not in allowed_types:
        raise HTTPException(
            status_code=422,
            detail="Invalid file type. Allowed: PNG, JPEG, WebP, PDF",
        )
    
    # Validate file size (10MB limit)
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=422,
            detail="File size exceeds 10MB limit",
        )
    
    if not storage.storage_configured():
        raise HTTPException(status_code=503, detail="Document storage is not configured")
    
    # Determine file extension
    ext_map = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "application/pdf": "pdf",
    }
    ext = ext_map.get(content_type, "pdf")
    # Compliance documents are PII → a dedicated PRIVATE bucket; never a public URL. The
    # client gets a short-lived signed download URL (here + via the download endpoint).
    bucket = storage.TECHNICIAN_DOCS_BUCKET
    path = f"technicians/{tid}/documents/{uuid4()}.{ext}"

    try:
        await storage.upload_object(bucket, path, content, content_type)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Document upload failed: {str(exc)}")

    data = {
        "document_type": document_type,
        "document_number": document_number,
        "storage_bucket": bucket,
        "storage_path": path,
        "expiration_date": expiration_date,
    }
    result = await store.create_technician_document(tid, data)
    try:
        download_url = await storage.create_signed_download_url(bucket, path)
    except Exception:
        download_url = None
    return {**result, "message": "Document uploaded", "download_url": download_url}


@app.get("/technicians/me/documents/{document_id}/download")
async def download_my_document(
    document_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Issue a short-lived signed download URL for one of the technician's own
    (private) compliance documents. Self-scoped."""
    tid = _me_technician_id(session)
    doc = await store.get_technician_document(document_id, tid)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if not storage.storage_configured():
        raise HTTPException(status_code=503, detail="Document storage is not configured")
    try:
        url = await storage.create_signed_download_url(doc["storage_bucket"], doc["storage_path"])
    except Exception:
        raise HTTPException(status_code=502, detail="Could not issue a download URL")
    return {"download_url": url}


@app.patch("/technicians/me/profile")
async def update_my_profile(
    payload: TechnicianProfileUpdateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"technician"})
    technician = session.get("technician")
    if not technician:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    data = payload.model_dump(exclude_none=True)
    if "display_name" in data:
        data["display_name"] = data["display_name"].strip()
        if len(data["display_name"]) < 2:
            raise HTTPException(status_code=422, detail="Display name is too short")
    if "phone" in data:
        data["phone"] = data["phone"].strip()
        if len(data["phone"]) < 7:
            raise HTTPException(status_code=422, detail="Enter a valid phone number")
    if "skills" in data:
        data["skills"] = await validate_technician_skills(data["skills"])
    radius = data.get("service_area_radius_km")
    if radius is not None and not 1 <= radius <= 250:
        raise HTTPException(status_code=422, detail="Service radius must be between 1 and 250 km")
    try:
        result = await store.update_technician_profile(UUID(technician["id"]), data)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    return result


@app.get("/geocode")
async def geocode_address(q: str) -> dict[str, Any]:
    """Resolve an address to coordinates using the server Maps key.

    The intake location step calls this so the browser never sees the server
    credential. Returns {resolved: false} when unconfigured or unresolved rather
    than an error, so the flow degrades gracefully to a raw-text address.
    """
    await latency()
    result = await geocode(q)
    if result is None:
        return {"resolved": False}
    return {"resolved": True, **result}


@app.get("/places/autocomplete")
async def places_autocomplete_endpoint(q: str) -> dict[str, Any]:
    """Server-proxied Places Autocomplete — browser never sees the Maps key.

    Requires Places API (New) enabled on GOOGLE_MAPS_API_KEY in Google Cloud
    Console (Geocoding API alone is not sufficient).
    Returns {"predictions": [{"description": str, "place_id": str}, ...]}.
    Empty predictions list when unconfigured or no matches.
    """
    await latency()
    predictions = await places_autocomplete(q)
    return {"predictions": predictions}


@app.get("/channels/{slug}")
async def channel_info(slug: str) -> dict[str, Any]:
    """Customer-safe branded-channel info for the intake UI: the owning
    provider's display name and its own dispatch phone (organizations.phone,
    provider-editable in Settings). Never exposes internal IDs or flags.
    Unknown/inactive slug → 404."""
    await latency()
    origin = await store.resolve_intake_channel(slug)
    if origin is None:
        raise HTTPException(status_code=404, detail="Unknown channel")
    return {
        "slug": slug,
        "organization_name": origin.get("organization_name"),
        "dispatch_phone": origin.get("dispatch_phone"),
    }


@app.post("/tickets", response_model=TicketEnvelope)
async def create_ticket(payload: dict[str, Any] | None = None) -> TicketEnvelope:
    await latency()
    # Trusted intake-channel resolution (SYSTEM-DESIGN §20.4): the browser supplies only a channel
    # slug (attribution, dropped by sanitize); the owning org is resolved server-side and
    # is never trusted from the client. Absent/unknown slug => public ClueXP intake.
    raw_slug = (payload or {}).get("intake_channel")
    origin = await store.resolve_intake_channel(raw_slug if isinstance(raw_slug, str) else None)
    ticket = Ticket.model_validate(sanitize_client_payload(payload))
    await save(ticket, origin)
    await log_transition(ticket, "created")
    env = await envelope(ticket)

    # ClueXP is a SaaS platform — it does not dispatch. A request only enters the
    # operational ladder when it belongs to a provider company via a branded intake
    # channel whose per-channel flag is on (and the global kill-switch is off). The
    # public/channelless path is intentionally disabled: a request with no owning
    # company is never made dispatchable.
    channel_on = bool(origin and origin.get("dispatch_cutover_enabled"))
    global_off = await runtime_settings.resolve(store, "dispatch_cutover_global_off")
    cutover = channel_on and not global_off
    if cutover:
        # Put the job on the company's operational ladder. No offer is created
        # here — the company's dispatcher assigns via POST /provider/queue/{id}/assign.
        await store.set_job_status(ticket.ticket_id, "pending_dispatch")
        await log_transition(ticket, "dispatch_cutover")
        token = await store.get_tracking_token(ticket.ticket_id)
        if token:
            env.tracking_token = token
            env.tracking_path = f"/t/{token}"
    return env


@app.post("/provider/requests", response_model=TicketEnvelope)
async def create_provider_request(
    payload: ManualIntakeRequest,
    session: dict[str, Any] = Depends(require_session),
) -> TicketEnvelope:
    await latency()
    require_any_role(session, {"provider_admin", "dispatcher"})
    ticket = Ticket(
        channel="voice",
        status=TicketStatus.PARTIAL,
        access_type=_enum_or_default(AccessType, payload.access_type, AccessType.HOME),
        situation=_enum_or_default(Situation, payload.situation, Situation.LOCKED_OUT),
        urgency=_enum_or_default(Urgency, payload.urgency, Urgency.URGENT),
        location={"raw_text": payload.address, "geocode_confidence": "none"},
        additional_details=payload.notes,
    )
    origin = _manual_origin(session, payload)
    await save(ticket, origin)
    source = payload.source_channel or "manual"
    await log_transition(ticket, f"manual_intake_created:{source}")
    return await envelope(ticket)


@app.get("/tickets/{ticket_id}", response_model=TicketEnvelope)
async def get_ticket(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    env = await envelope(await require_ticket(ticket_id))
    token = await store.get_tracking_token(ticket_id)
    if token:
        env.tracking_token = token
        env.tracking_path = f"/t/{token}"
    return env


@app.patch("/tickets/{ticket_id}", response_model=TicketEnvelope)
async def patch_ticket(ticket_id: UUID, payload: dict[str, Any]) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    merged = deep_merge(ticket.model_dump(mode="python"), sanitize_client_payload(payload))
    updated = Ticket.model_validate(merged)
    await save(updated)
    await log_transition(updated, "patched")
    return await envelope(updated)


@app.post("/tickets/{ticket_id}/photo-intent", response_model=PhotoIntentResponse)
async def photo_intent(ticket_id: UUID, payload: PhotoIntentRequest) -> PhotoIntentResponse:
    await latency()
    await require_ticket(ticket_id)
    try:
        storage.validate_upload_claim(payload.content_type, payload.size)
        ext = _extension_for_content_type(payload.content_type)
        path = f"tickets/{ticket_id}/{uuid4()}{ext}"
        intent = await storage.create_signed_upload_url(storage.PRIVATE_BUCKET, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return PhotoIntentResponse(
        bucket=intent.bucket,
        path=intent.path,
        upload_url=intent.upload_url,
        token=intent.token,
        expires_in=intent.expires_in,
        max_bytes=storage.MAX_UPLOAD_BYTES,
    )


@app.post("/tickets/{ticket_id}/photo-complete", response_model=TicketEnvelope)
async def photo_complete(ticket_id: UUID, payload: PhotoCompleteRequest) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    if payload.bucket != storage.PRIVATE_BUCKET:
        raise HTTPException(status_code=400, detail="Invalid storage bucket")
    if not payload.path.startswith(f"tickets/{ticket_id}/"):
        raise HTTPException(status_code=400, detail="Invalid storage path")
    try:
        storage.validate_upload_claim(payload.content_type, payload.size)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    media_id = await store.record_media(
        owner_type="job",
        owner_id=ticket_id,
        kind="intake_photo",
        bucket=payload.bucket,
        path=payload.path,
        visibility="private",
    )
    ticket.photos.append(Photo(id=media_id, url=payload.path, uploaded_at=now()))
    await save(ticket)
    await log_transition(ticket, "photo_uploaded")
    return await envelope(ticket)


@app.post("/tickets/{ticket_id}/price-quote", response_model=TicketEnvelope)
async def price_quote(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    base = {
        AccessType.CAR: (115.0, 245.0),
        AccessType.HOME: (95.0, 185.0),
        AccessType.BUSINESS: (135.0, 295.0),
        AccessType.OTHER: (125.0, 260.0),
        None: (105.0, 225.0),
    }.get(ticket.access_type, (105.0, 225.0))
    ticket.price_quote = PriceQuote(estimate_min=base[0], estimate_max=base[1])
    ticket.cancellation_policy = CancellationPolicy(cancellation_fee=35.0, no_show_fee=65.0)
    await save(ticket)
    await log_transition(ticket, "price_quote")
    return await envelope(ticket)


@app.post("/tickets/{ticket_id}/payment-method", response_model=TicketEnvelope)
async def payment_method(ticket_id: UUID, payload: dict[str, Any]) -> TicketEnvelope:
    await latency()
    token = str(payload.get("token", ""))
    if not token.startswith("tok_"):
        raise HTTPException(status_code=400, detail="Invalid processor token")
    ticket = await require_ticket(ticket_id)
    ticket.payment_method = PaymentMethod(
        processor=str(payload.get("processor", "stub")),
        token=token,
        brand=payload.get("brand", "Secure wallet"),
        last4=payload.get("last4"),
        captured_at=now(),
    )
    await save(ticket)
    await log_transition(ticket, "payment_method")
    return await envelope(ticket)


@app.post("/tickets/{ticket_id}/commit", response_model=TicketEnvelope)
async def commit(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    # Sprint 1: payment-on-file is deferred, so price acceptance is the sole
    # commercial-consent gate. Restore the payment-method check before launch.
    if ticket.price_quote is None or not ticket.price_quote.accepted_by_customer:
        raise HTTPException(status_code=409, detail="Price acceptance required")
    token = await store.get_tracking_token(ticket_id)
    if not token:
        # Legacy path only: status column tracks ticket lifecycle. On the cutover
        # path the operational status owns this column — don't overwrite it.
        ticket.status = TicketStatus.PARTIAL if ticket.unresolved_fields else TicketStatus.COMPLETE
        await save(ticket)
    await log_transition(ticket, "committed")
    env = await envelope(ticket)
    if token:
        env.tracking_token = token
        env.tracking_path = f"/t/{token}"
    return env


@app.post("/tickets/{ticket_id}/otp/send")
async def send_otp(ticket_id: UUID) -> dict[str, str]:
    await latency()
    await require_ticket(ticket_id)
    code = str(random.randint(100000, 999999))
    otp_codes[ticket_id] = code
    return {"dev_code": code, "message": "Code sent"}


@app.post("/tickets/{ticket_id}/otp/verify", response_model=TicketEnvelope)
async def verify_otp(ticket_id: UUID, payload: dict[str, Any]) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    if otp_codes.get(ticket_id) != str(payload.get("code", "")):
        raise HTTPException(status_code=400, detail="Code did not match")
    await log_transition(ticket, "otp_verified")
    return await envelope(ticket)


@app.post("/tickets/{ticket_id}/dispatch")
async def dispatch(ticket_id: UUID) -> None:
    raise HTTPException(
        status_code=410,
        detail="Removed. Use POST /ops/queue/{job_id}/assign via the ops console.",
    )


async def _dispatch_write(ticket_id: UUID, job: dict[str, Any]) -> dict[str, Any]:
    """Shared dispatch WRITE: rank eligible technicians per policy and create
    ``dispatch_offers`` for the top candidates. Owns offer creation (the customer
    poll never calls this). Does NOT flip the job to MATCHED — that happens only on
    an accepted offer. Used by both the explicit ``/offers`` endpoint and the
    cutover-enabled intake create."""
    if job.get("fulfillment_technician_id"):
        return {"state": "matched", "offers": [], "attempts": job.get("dispatch_attempts", 0)}
    attempts = job.get("dispatch_attempts", 0)
    if attempts >= config.MAX_REDISPATCH_ROUNDS:
        return {"state": "no_eligible", "offers": [], "attempts": attempts, "reason": "max_rounds_reached"}
    owner_org_id = job.get("customer_owner_org_id")
    policy = normalize_policy(job.get("fulfillment_policy"), owner_org_id)
    technicians = await store.list_available_technicians()
    ranked = select_candidates(
        job, technicians, policy=policy, owner_org_id=owner_org_id,
        round_index=attempts, top_n=config.TOP_N_OFFERS,
    )
    # Only consume a dispatch round when there were technicians to evaluate.
    # If zero techs are online the job is not "tried" — preserve rounds for
    # when someone goes available, rather than exhausting the job in minutes.
    if technicians:
        new_attempts = await store.bump_dispatch_attempt(ticket_id)
    else:
        new_attempts = attempts
    if not ranked:
        return {"state": "no_eligible", "offers": [], "attempts": new_attempts, "policy": policy}
    expires_at = now() + timedelta(seconds=config.OFFER_TTL_SECONDS)
    offers = await store.create_dispatch_offers(ticket_id, ranked, expires_at)
    return {
        "state": "waiting", "offers": offers, "attempts": new_attempts,
        "policy": policy, "expires_at": expires_at.isoformat(),
    }


@app.post("/tickets/{ticket_id}/offers")
async def create_offers(ticket_id: UUID) -> None:
    raise HTTPException(
        status_code=410,
        detail="Removed. Use POST /ops/queue/{job_id}/assign via the ops console.",
    )


@app.api_route("/cron/dispatch-sweep", methods=["GET", "POST"])
async def dispatch_sweep(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Cleanup-only sweep — no re-dispatch. Secret-protected via
    ``Authorization: Bearer ${CRON_SECRET}``. Expires stale offers (returning
    affected jobs to pending_dispatch) and auto-closes unconfirmed jobs. The
    same cleanup runs inline on GET /ops/queue; this cron is a safety net."""
    if not config.CRON_SECRET:
        raise HTTPException(status_code=503, detail="Sweep disabled: CRON_SECRET unset")
    presented = authorization.split(" ", 1)[1].strip() if (
        authorization and authorization.lower().startswith("bearer ")
    ) else ""
    if not hmac.compare_digest(presented, config.CRON_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")
    expired = await store.expire_stale_offers()
    auto_closed = await store.auto_close_pending(config.AUTO_CLOSE_WINDOW_SECONDS)
    return {"expired_offers": expired, "auto_closed": auto_closed}


class OpsAssignPayload(BaseModel):
    technician_id: UUID
    override_reason: str | None = None


class DeclineOfferPayload(BaseModel):
    reason: str | None = None


# --- shared dispatch core (used by both platform /ops/* and company /provider/*) ---

async def _enriched_candidates(job: dict[str, Any], techs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Annotate a technician pool with advisory signals for a job and sort
    nearest-first (unknown distance last), rating as tie-breaker."""
    now_dt = datetime.now(tz=timezone.utc)
    threshold = timedelta(minutes=config.LOCATION_ONLINE_THRESHOLD_MINUTES)
    enriched = []
    for tech in techs:
        _raw_dist = haversine_km(
            job.get("lat"), job.get("lng"),
            tech.get("current_lat") or tech.get("service_area_center_lat"),
            tech.get("current_lng") or tech.get("service_area_center_lng"),
        )
        dist = _raw_dist if math.isfinite(_raw_dist) else None
        eta_min, eta_max = eta_range_from_km(dist)
        loc_updated = tech.get("location_updated_at")
        if loc_updated and not isinstance(loc_updated, datetime):
            loc_updated = datetime.fromisoformat(str(loc_updated).replace("Z", "+00:00"))
        is_online = bool(loc_updated and (now_dt - loc_updated) < threshold) if loc_updated else False
        active_job = await store.get_technician_active_job(tech["id"])
        skills = tech.get("skills") or []
        access_type = job.get("access_type")
        skill_needed = normalize_skill_code(access_type) if access_type else None
        enriched.append({
            "id": tech["id"],
            "display_name": tech.get("display_name"),
            "skills": skills,
            "skills_match": (skill_needed in skills or access_type in skills) if skill_needed else True,
            "dist_km": round(dist, 2) if dist is not None else None,
            "eta_min": eta_min,
            "eta_max": eta_max,
            "is_online": is_online,
            "is_busy": active_job is not None,
            "rating": tech.get("rating"),
            "active_job": {
                "id": active_job["id"],
                "status": active_job.get("status"),
                "address": active_job.get("address"),
                "lat": active_job.get("lat"),
                "lng": active_job.get("lng"),
            } if active_job else None,
            "current_lat": tech.get("current_lat"),
            "current_lng": tech.get("current_lng"),
            "service_area_center_lat": tech.get("service_area_center_lat"),
            "service_area_center_lng": tech.get("service_area_center_lng"),
        })
    enriched.sort(key=lambda c: (
        c["dist_km"] is None,
        c["dist_km"] if c["dist_km"] is not None else 0.0,
        -(c.get("rating") or 0.0),
    ))
    return enriched


async def _send_targeted_offer(
    *, job: dict[str, Any], job_id: UUID, technician_id: UUID, tech: dict[str, Any],
    override_reason: str | None, session: dict[str, Any], audit_prefix: str,
) -> dict[str, Any]:
    """Advisory-flag check + single-offer creation + audit. Raises HTTPException on
    override-required (422) or job/offer conflict (409). Shared by ops + provider."""
    now_dt = datetime.now(tz=timezone.utc)
    threshold = timedelta(minutes=config.LOCATION_ONLINE_THRESHOLD_MINUTES)
    loc_updated = tech.get("location_updated_at")
    if loc_updated and not isinstance(loc_updated, datetime):
        loc_updated = datetime.fromisoformat(str(loc_updated).replace("Z", "+00:00"))
    is_online = bool(loc_updated and (now_dt - loc_updated) < threshold) if loc_updated else False
    is_busy = (await store.get_technician_active_job(tech["id"])) is not None
    skills = tech.get("skills") or []
    access_type = job.get("access_type")
    skill_needed = normalize_skill_code(access_type) if access_type else None
    skills_match = (skill_needed in skills or access_type in skills) if skill_needed else True
    override_flags: list[str] = []
    if not is_online:
        override_flags.append("offline or location stale")
    if is_busy:
        override_flags.append("has an active job")
    if not skills_match:
        override_flags.append(f"skill mismatch (job needs '{access_type}')")
    if override_flags and not override_reason:
        raise HTTPException(
            status_code=422,
            detail=f"Override required: technician {', '.join(override_flags)}. "
                   f"Supply override_reason to proceed.",
        )
    org_id_str = tech.get("primary_organization_id")
    org_id = UUID(org_id_str) if org_id_str else None
    # TTL resolved at offer-creation time: global_settings → env → 300 (safe under
    # DB failure). Stamped onto this offer only; existing offers are never changed.
    ttl_seconds = await runtime_settings.resolve_offer_ttl_seconds(store)
    expires_at = now() + timedelta(seconds=ttl_seconds)
    offer = await store.ops_create_single_offer(job_id, technician_id, org_id, expires_at)
    if offer is None or "error_code" in offer:
        error_code = (offer or {}).get("error_code", "concurrent_offer")
        if error_code == "job_not_pending":
            raise HTTPException(
                status_code=409,
                detail="Job is no longer pending dispatch (cancelled or already assigned).",
            )
        raise HTTPException(
            status_code=409,
            detail="Concurrent assignment — another offer was just created for this job.",
        )
    actor_id = session.get("user", {}).get("id", "unknown")
    audit = f"{audit_prefix}:assign:tech={technician_id}:by={actor_id}"
    if override_reason:
        audit += f":override={override_reason[:100]}"
    await store.log_event_raw(job_id, audit)
    return {
        "offer_id": offer.get("id"),
        "technician_id": str(technician_id),
        "expires_at": expires_at.isoformat(),
    }


@app.get("/ops/queue")
async def ops_get_queue(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """Return all pending_dispatch jobs ordered by arrival. Runs cleanup inline
    (expire stale offers + auto-close) so the queue is always fresh."""
    require_any_role(session, {"platform_admin"})
    await store.expire_stale_offers()
    await store.auto_close_pending(config.AUTO_CLOSE_WINDOW_SECONDS)
    return await store.get_ops_queue()


@app.get("/ops/queue/{job_id}/candidates")
async def ops_get_candidates(
    job_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Return the job plus all active+verified technicians with advisory signals."""
    require_any_role(session, {"platform_admin"})
    jobs = await store.get_ops_queue()
    job = next((j for j in jobs if str(j["id"]) == str(job_id)), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in dispatch queue")
    techs = await store.list_all_technicians_for_ops()
    return {"job": job, "candidates": await _enriched_candidates(job, techs)}


# NOTE: ClueXP is a SaaS platform and does NOT dispatch. There is intentionally no
# platform assign mutation — dispatch is the owning company's responsibility via
# POST /provider/queue/{job_id}/assign. The /ops/* queue/candidates/fleet endpoints
# below are read-only platform oversight only. (Future: a separate "ClueXP Direct"
# dispatcher for independent technicians — out of scope for this MVP.)


@app.get("/ops/fleet")
async def ops_fleet(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """Read-only oversight: all active+verified technicians with location and active
    job data across the platform. No mutation."""
    require_any_role(session, {"platform_admin"})
    return await store.get_fleet_state()


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    """Unauthenticated liveness/deploy smoke check. A 200 here confirms the app
    booted — which in production also means the fail-secure ARRIVAL_PIN_SECRET
    check passed (startup raises otherwise). Exposes no secrets or tenant data."""
    return {"status": "ok"}


@app.get("/ops/flags")
async def ops_flags(session: dict[str, Any] = Depends(require_session)) -> dict[str, Any]:
    """Read-only oversight: the effective dispatch flags on the running deployment,
    so an operator can verify runtime state (e.g. DISPATCH_CUTOVER_GLOBAL_OFF) without
    a DB query. Reports whether the arrival-PIN secret is configured — never its value."""
    require_any_role(session, {"platform_admin"})
    return {
        "dispatch_cutover_global_off": await runtime_settings.resolve(
            store, "dispatch_cutover_global_off"
        ),
        "dispatch_cutover_public": config.DISPATCH_CUTOVER_PUBLIC,
        "arrival_pin_configured": config.ARRIVAL_PIN_SECRET != "dev-arrival-pin-secret",
        "is_production": config.IS_PRODUCTION,
    }


class GlobalSettingUpdate(BaseModel):
    value: Any


@app.get("/admin/global-settings")
async def admin_list_global_settings(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """platform_admin: list runtime operational settings. The table never holds
    secrets (DB CHECK), so every row is safe to return."""
    require_any_role(session, {"platform_admin"})
    return {"settings": await store.list_global_settings()}


@app.get("/service-catalog")
async def public_service_catalog() -> dict[str, Any]:
    """Active service catalog for signup/profile selectors."""
    return {"categories": await store.list_service_catalog(active_only=True)}


@app.get("/admin/service-catalog")
async def admin_service_catalog(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    return {"categories": await store.list_service_catalog(active_only=False)}


@app.put("/admin/service-catalog/categories/{category_code}")
async def admin_upsert_service_category(
    category_code: str,
    payload: ServiceCategoryPayload,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    data = _category_payload(payload)
    if data["code"] != _validate_catalog_code(category_code):
        raise HTTPException(status_code=422, detail="Category code in path and body must match.")
    return await store.upsert_service_category(data, updated_by=session.get("user", {}).get("id"))


@app.put("/admin/service-catalog/skills/{skill_code:path}")
async def admin_upsert_service_skill(
    skill_code: str,
    payload: ServiceSkillPayload,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    data = _skill_payload(payload)
    if data["code"] != _validate_catalog_code(skill_code):
        raise HTTPException(status_code=422, detail="Skill code in path and body must match.")
    try:
        return await store.upsert_service_skill(data, updated_by=session.get("user", {}).get("id"))
    except KeyError:
        raise HTTPException(status_code=404, detail="Category does not exist.") from None


@app.patch("/admin/global-settings/{key}")
async def admin_update_global_setting(
    key: str,
    payload: GlobalSettingUpdate,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """platform_admin only: update one allowlisted runtime setting. Unknown keys →
    404; bad type/range → 422 (via the per-key contract). Records updated_by/at and
    clears the resolver cache so the change applies immediately."""
    require_any_role(session, {"platform_admin"})
    if not runtime_settings.is_known_key(key):
        raise HTTPException(status_code=404, detail=f"Unknown setting '{key}'")
    try:
        value = runtime_settings.coerce_and_validate(key, payload.value)
    except runtime_settings.SettingValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    spec = runtime_settings.SETTINGS[key]
    actor_id = session.get("user", {}).get("id")
    row = await store.upsert_global_setting(key, value, spec.value_type, actor_id)
    runtime_settings.clear_cache()
    return row


# --- console: per-organization tenant-limit overrides (0026) ---
# Mirrors the provider dispatch-settings override pattern (below): an unset
# field inherits the platform-wide default from global_settings, editable via
# /admin/global-settings, so a newly approved company needs no setup.
_ORG_LIMIT_FIELDS = {
    "max_users": "max_users_per_org",
    "max_technicians": "max_technicians_per_org",
}


async def _resolve_org_limits(organization_id: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for field, key in _ORG_LIMIT_FIELDS.items():
        override = await store.get_organization_setting(organization_id, key)
        platform_default = await runtime_settings.resolve(store, key)
        result[field] = {
            "value": override["value"] if override else platform_default,
            "is_override": override is not None,
            "platform_default": platform_default,
        }
    return result


@app.get("/admin/organizations/{organization_id}/limits")
async def admin_get_organization_limits(
    organization_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    return await _resolve_org_limits(str(organization_id))


@app.patch("/admin/organizations/{organization_id}/limits")
async def admin_update_organization_limits(
    organization_id: UUID,
    payload: OrganizationLimitsUpdate,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    org_id = str(organization_id)
    sent = payload.model_dump(exclude_unset=True)
    if not sent:
        raise HTTPException(status_code=422, detail="No limits provided")
    actor_id = session.get("user", {}).get("id")
    for field, value in sent.items():
        key = _ORG_LIMIT_FIELDS[field]
        if value is None:
            await store.delete_organization_setting(org_id, key)
            continue
        try:
            runtime_settings.coerce_and_validate(key, value)
        except runtime_settings.SettingValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        spec = runtime_settings.SETTINGS[key]
        await store.upsert_organization_setting(org_id, key, value, spec.value_type, actor_id)
    return await _resolve_org_limits(org_id)


async def _resolve_max_technicians(organization_id: str) -> int:
    return await runtime_settings.resolve_org(store, organization_id, "max_technicians_per_org")


async def _resolve_max_users(organization_id: str) -> int:
    return await runtime_settings.resolve_org(store, organization_id, "max_users_per_org")


# --- provider self-service: company users (dispatchers, additional admins) ---
# Add-only, tenant-scoped. No edit/delete in this slice — a mis-added user is a
# console/support matter, not a self-service one yet.
PROVIDER_USER_ROLES = {"dispatcher", "provider_admin"}


@app.get("/provider/settings/limits")
async def get_provider_limits(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Read-only: the effective (console-set or platform-default) tenant caps for
    the caller's own company, so provider-web can show usage against the limit.
    Providers cannot edit these — only the console can."""
    organization_id = _provider_organization_id(session)
    org_id = str(organization_id)
    return {
        "max_users": await _resolve_max_users(org_id),
        "max_technicians": await _resolve_max_technicians(org_id),
    }


@app.get("/provider/users")
async def list_provider_users(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    organization_id = _provider_organization_id(session)
    return {"users": await store.list_organization_members(organization_id)}


@app.post("/provider/users")
async def create_provider_user(
    payload: ProviderUserCreateRequest, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    organization_id = _provider_organization_id(session)
    if payload.role not in PROVIDER_USER_ROLES:
        raise HTTPException(status_code=422, detail=f"role must be one of {sorted(PROVIDER_USER_ROLES)}")
    if not payload.email and not payload.phone:
        raise HTTPException(status_code=422, detail="Email or phone is required")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    limit = await _resolve_max_users(str(organization_id))
    occupied = await store.count_organization_members(organization_id)
    if occupied >= limit:
        raise HTTPException(
            status_code=409, detail=f"This company has reached its user limit ({limit})."
        )
    try:
        return await store.create_organization_member(
            organization_id, payload.model_dump(exclude={"role"}), role=payload.role
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


# --- company (provider-managed) dispatch: org-scoped clones of the ops console ---
# ClueXP is SaaS — the company's own dispatcher assigns the company's own
# technicians. Everything is scoped to session.active_organization_id; a
# dispatcher can never see another company's jobs or technicians.

def _require_dispatch_org(session: dict[str, Any]) -> str:
    require_any_role(session, {"dispatcher", "provider_admin"})
    org_id = session.get("active_organization_id")
    if not org_id:
        raise HTTPException(status_code=409, detail="A provider organization is required")
    return str(org_id)


# --- per-provider overrides of org_overridable runtime settings (0025) ---
# Each provider can tune its own dispatch acknowledgement SLA / stalled threshold;
# an unset field inherits the platform-wide default (global_settings, admin-
# editable via /admin/global-settings) so a newly registered provider needs no
# setup to get sane behavior.
_DISPATCH_SETTING_FIELDS = {
    "ack_sla_minutes": "dispatch_ack_sla_minutes",
    "stalled_minutes": "dispatch_stalled_minutes",
}


async def _resolve_dispatch_settings(org_id: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for field, key in _DISPATCH_SETTING_FIELDS.items():
        override = await store.get_organization_setting(org_id, key)
        platform_default = await runtime_settings.resolve(store, key)
        result[field] = {
            "value": override["value"] if override else platform_default,
            "is_override": override is not None,
            "platform_default": platform_default,
        }
    return result


@app.get("/provider/settings/dispatch")
async def get_provider_dispatch_settings(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """The company's dispatch queue thresholds (ack SLA / stalled), each resolved
    from this org's override or the platform-wide default, with enough shape for
    a settings UI to show "using platform default (Nm)" vs. "overridden"."""
    org_id = _require_dispatch_org(session)
    return await _resolve_dispatch_settings(org_id)


class ProviderDispatchSettingsUpdate(BaseModel):
    # Absent = leave unchanged; null = clear the override (revert to platform
    # default); an int = set this org's override. Uses exclude_unset to tell
    # "absent" from "sent as null".
    ack_sla_minutes: int | None = None
    stalled_minutes: int | None = None


@app.patch("/provider/settings/dispatch")
async def update_provider_dispatch_settings(
    payload: ProviderDispatchSettingsUpdate,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    sent = payload.model_dump(exclude_unset=True)
    if not sent:
        raise HTTPException(status_code=422, detail="No settings provided")

    current = await _resolve_dispatch_settings(org_id)
    effective = {field: current[field]["value"] for field in _DISPATCH_SETTING_FIELDS}
    for field, value in sent.items():
        key = _DISPATCH_SETTING_FIELDS[field]
        effective[field] = value if value is not None else await runtime_settings.resolve(store, key)
    if effective["ack_sla_minutes"] > effective["stalled_minutes"]:
        raise HTTPException(
            status_code=422, detail="ack_sla_minutes cannot exceed stalled_minutes"
        )

    actor_id = session.get("user", {}).get("id")
    for field, value in sent.items():
        key = _DISPATCH_SETTING_FIELDS[field]
        if value is None:
            await store.delete_organization_setting(org_id, key)
            continue
        try:
            runtime_settings.coerce_and_validate(key, value)
        except runtime_settings.SettingValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        spec = runtime_settings.SETTINGS[key]
        await store.upsert_organization_setting(org_id, key, value, spec.value_type, actor_id)
    return await _resolve_dispatch_settings(org_id)


@app.get("/provider/queue")
async def provider_get_queue(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """The company's pending_dispatch jobs (owned or fulfilled by this org)."""
    org_id = _require_dispatch_org(session)
    await store.expire_stale_offers()
    await store.auto_close_pending(config.AUTO_CLOSE_WINDOW_SECONDS)
    return await store.get_ops_queue(org_id=org_id)


@app.get("/provider/queue/{job_id}/candidates")
async def provider_get_candidates(
    job_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """The job plus the company's own active+verified technicians, advisory-scored."""
    org_id = _require_dispatch_org(session)
    jobs = await store.get_ops_queue(org_id=org_id)
    job = next((j for j in jobs if str(j["id"]) == str(job_id)), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in your dispatch queue")
    techs = await store.list_all_technicians_for_ops(org_id=org_id)
    return {"job": job, "candidates": await _enriched_candidates(job, techs)}


@app.post("/provider/queue/{job_id}/assign")
async def provider_assign(
    job_id: UUID,
    payload: OpsAssignPayload,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """The company's dispatcher sends a targeted offer to one of its own
    technicians. Tenant-scoped: the job must be in this org's queue and the
    technician must belong to this org."""
    org_id = _require_dispatch_org(session)
    jobs = await store.get_ops_queue(org_id=org_id)
    job = next((j for j in jobs if str(j["id"]) == str(job_id)), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in your dispatch queue")
    if job.get("offer_active"):
        raise HTTPException(
            status_code=409,
            detail="An active offer already exists for this job. Wait for it to expire or be declined.",
        )
    tech = await store.get_ops_technician(payload.technician_id, org_id=org_id)
    if tech is None:
        raise HTTPException(
            status_code=422,
            detail="Technician not found or not eligible (must be your active, verified technician).",
        )
    return await _send_targeted_offer(
        job=job, job_id=job_id, technician_id=payload.technician_id, tech=tech,
        override_reason=payload.override_reason, session=session, audit_prefix="provider",
    )


@app.get("/provider/fleet")
async def provider_fleet(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """The company's own technicians with location and active-job data."""
    org_id = _require_dispatch_org(session)
    return await store.get_fleet_state(org_id=org_id)


@app.post("/offers/{offer_id}/accept")
async def accept_offer(offer_id: UUID) -> dict[str, Any]:
    """First-accept-wins: atomically claim the job for the offer's technician,
    set ``fulfillment_technician_id``/``fulfillment_org_id``, flip
    ``trust_state=matched``, and supersede the sibling offers. Enforced in the
    backend (not UI timing); a losing or stale accept gets 409."""
    await latency()
    result = await store.accept_dispatch_offer(offer_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    if not result.get("accepted"):
        raise HTTPException(status_code=409, detail=result.get("reason", "not_accepted"))
    return result


@app.post("/offers/{offer_id}/decline")
async def decline_offer(
    offer_id: UUID,
    payload: DeclineOfferPayload | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Technician declines an offer — marks it declined (recording an optional
    reason for Ops reassignment) so it stops appearing in the feed."""
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=403, detail="Technician session required")
    reason = payload.reason.strip()[:280] if payload and payload.reason else None
    declined = await store.decline_dispatch_offer(offer_id, UUID(tech["id"]), reason)
    if not declined:
        raise HTTPException(status_code=404, detail="Offer not found or not eligible to decline")
    return {"declined": True}


@app.get("/technicians/{technician_id}/active-job")
async def technician_active_job(
    technician_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    """Return the technician's currently-active job (assigned/en_route/arrived/in_progress).

    A technician may only read their own; platform_admin/dispatcher may read any.
    Returns {} when there is no active job (HTTP 200, not 404).
    """
    roles = set(session.get("roles", []))
    if not ({"platform_admin", "dispatcher"} & roles):
        tech = session.get("technician")
        if not tech or tech.get("id") != str(technician_id):
            raise HTTPException(status_code=403, detail="Not your active job")
    result = await store.get_technician_active_job(technician_id)
    if result is None:
        return {}
    lifecycle = await store.get_job_lifecycle(UUID(result["id"]))
    return {**result, **(lifecycle or {})}


@app.get("/technicians/{technician_id}/offers")
async def technician_offers(
    technician_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    """Offer-delivery read: a technician's currently-pending offers (masked to a
    coarse area — no exact address / customer before acceptance). A technician may
    only read their own; platform_admin/dispatcher may read any."""
    roles = set(session.get("roles", []))
    if not ({"platform_admin", "dispatcher"} & roles):
        tech = session.get("technician")
        if not tech or tech.get("id") != str(technician_id):
            raise HTTPException(status_code=403, detail="Not your offers")
    offers = await store.list_technician_offers(technician_id)
    return {"offers": offers}


@app.get("/tickets/{ticket_id}/tracking")
async def tracking(ticket_id: UUID) -> dict[str, Any]:
    """Customer-safe dispatch tracking READ. Returns an explicit ``state``
    (``waiting`` | ``matched`` | ``no_eligible`` | ``expired_retry`` | ``error``)
    and, only when matched, a customer-safe ``assignment`` (owner/fulfillment
    names, technician display name, role, rating, coarse ETA estimate,
    assigned_at, job status). Never 409s for a normal dispatch state, never
    exposes candidates/scoring/rosters/internal IDs, and never creates offers
    (pure read — offer creation is owned by the dispatch write + scheduled sweep)."""
    await latency()
    try:
        status = await store.get_dispatch_status(
            ticket_id,
            max_attempts=config.MAX_REDISPATCH_ROUNDS,
            total_timeout_seconds=config.TOTAL_TIMEOUT_SECONDS,
        )
    except Exception:
        return {"state": "error", "terminal": False, "assignment": None}
    if status is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return status


# --- customer token-gated fulfillment (cutover, Sprint 3) -------------------
# The customer link is the ~256-bit `tracking_token`, never the raw ticket id.
# These routes grant only ticket-scoped, customer-safe reads/actions (no account
# auth). They never expose candidates / rejected offers / scoring / internal IDs.

_NO_GUARDS = {"may_show_technician": False, "may_show_eta": False, "may_show_live_tracking": False}


@app.get("/t/{token}")
async def tracking_by_token(token: str) -> dict[str, Any]:
    """Token-resolved tracking read: the dispatch state + (once matched) the safe
    assignment + the operational fulfillment status and the customer affordance
    (confirm / review / dispute / cancel). Pure read — never creates offers.
    Dispatch-internal fields (attempts, offers_pending, etc.) are stripped so
    the customer sees only searching / matched / failed — no process internals."""
    await latency()
    try:
        status = await store.get_tracking_by_token(
            token,
            max_attempts=config.MAX_REDISPATCH_ROUNDS,
            total_timeout_seconds=config.TOTAL_TIMEOUT_SECONDS,
        )
    except Exception:
        return {"state": "error", "terminal": False, "assignment": None, "guards": _NO_GUARDS}
    if status is None:
        raise HTTPException(status_code=404, detail="Not found")
    for _f in ("attempts", "max_attempts", "offers_pending", "offer_expires_at"):
        status.pop(_f, None)
    # Guard booleans the tracking UI consumes instead of re-deriving visibility
    # itself (SPEC §"Guard helpers"). Derived from the operational status so both
    # store backends and legacy jobs carry the same contract — the page reads
    # `guards.may_show_technician` / `guards.may_show_live_tracking`.
    assignment = status.get("assignment")
    has_assignment = assignment is not None
    # Live tracking requires BOTH a fulfillment status AND a fresh exposed location.
    # The store nulls `live_lat`/`live_lng` when the position is missing or stale, so
    # the guard follows the data: no fresh point -> UI shows "temporarily unavailable".
    has_live_location = bool(
        assignment
        and assignment.get("live_lat") is not None
        and assignment.get("live_lng") is not None
    )
    status["guards"] = {
        "may_show_technician": has_assignment,
        "may_show_eta": has_assignment,
        "may_show_live_tracking": may_show_live_tracking(status.get("status")) and has_live_location,
    }
    # The owning provider's own dispatch line for the "Call dispatch" affordance —
    # each provider has its own number (organizations.phone); null on public intake.
    job_id = await store.resolve_tracking_token(token)
    status["dispatch_phone"] = (
        await store.get_customer_owner_phone(UUID(job_id)) if job_id else None
    )
    return status


# Per-token sliding-window rate limit for capability-link mutations. In-process
# (per-instance) — a first abuse layer for a leaked tracking link; reads are not gated.
_token_action_hits: dict[str, list[float]] = {}


async def _rate_limit_token_action(token: str) -> None:
    # Runtime-tunable via global_settings (falls back to env → hardcoded default).
    window = await runtime_settings.resolve(store, "token_action_window_seconds")
    max_hits = await runtime_settings.resolve(store, "token_action_max")
    now_t = time.monotonic()
    hits = [t for t in _token_action_hits.get(token, []) if now_t - t < window]
    if len(hits) >= max_hits:
        _token_action_hits[token] = hits
        raise HTTPException(status_code=429, detail="Too many requests — please slow down.")
    hits.append(now_t)
    _token_action_hits[token] = hits


async def _require_token_job(token: str) -> UUID:
    await _rate_limit_token_action(token)
    job_id = await store.resolve_tracking_token(token)
    if job_id is None:
        raise HTTPException(status_code=404, detail="Not found")
    return UUID(job_id)


@app.post("/t/{token}/confirm")
async def confirm_by_token(token: str) -> dict[str, Any]:
    """Customer confirms completion: completed_pending_customer → completed_confirmed."""
    await latency()
    job_id = await _require_token_job(token)
    updated = await store.set_job_status(
        job_id, STATUS_COMPLETED_CONFIRMED,
        expected_current=STATUS_COMPLETED_PENDING, extra_timestamps=["closed_at"],
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Job is not awaiting customer confirmation")
    return {"status": updated["status"]}


@app.post("/t/{token}/review")
async def review_by_token(token: str, payload: CustomerReviewRequest) -> dict[str, Any]:
    """Customer rates the assigned technician for THIS ticket (tenant-safe,
    ticket-scoped). Allowed while completion is pending or within the closed grace
    window; a review submitted while pending implies confirm."""
    await latency()
    if payload.rating < 1 or payload.rating > 5:
        raise HTTPException(status_code=422, detail="Rating must be between 1 and 5")
    job_id = await _require_token_job(token)
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Not found")
    from api.dispatch import customer_actions as _actions
    if not _actions(lifecycle["status"]).get("can_review"):
        raise HTTPException(status_code=409, detail="Review is not available for this job yet")
    imply_confirm = lifecycle["status"] == STATUS_COMPLETED_PENDING
    review = await store.record_customer_review(
        job_id=job_id, rating=payload.rating, comment=payload.comment,
        issue_reported=False, imply_confirm=imply_confirm,
    )
    if imply_confirm:
        await store.set_job_status(
            job_id, STATUS_COMPLETED_CONFIRMED,
            expected_current=STATUS_COMPLETED_PENDING, extra_timestamps=["closed_at"],
        )
    return {"status": "recorded", "review": review}


def _validate_payment(payload: PaymentReportRequest) -> tuple[float, str]:
    """Shared validation for both sides of a payment report. Returns the rounded
    amount + canonical method, or raises 422."""
    if payload.amount is None or payload.amount < 0:
        raise HTTPException(status_code=422, detail="Amount must be zero or greater")
    if payload.amount > 1_000_000:
        raise HTTPException(status_code=422, detail="Amount is implausibly large")
    method = normalize_payment_method(payload.method)
    if method is None:
        raise HTTPException(status_code=422, detail="Unknown payment method")
    return round(float(payload.amount), 2), method


@app.post("/t/{token}/dispute")
async def dispute_by_token(token: str, payload: DisputeRequest) -> dict[str, Any]:
    """Customer reports an issue: completed_pending_customer → disputed. A human
    operator resolves it (POST /admin/jobs/{id}/resolve)."""
    await latency()
    job_id = await _require_token_job(token)
    updated = await store.set_job_status(
        job_id, STATUS_DISPUTED, expected_current=STATUS_COMPLETED_PENDING,
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Job is not awaiting customer confirmation")
    if payload.reason:
        await store.log_event_raw(job_id, f"customer_dispute:{payload.reason[:200]}")
    return {"status": updated["status"]}


@app.post("/t/{token}/cancel")
async def cancel_by_token(token: str, payload: CancelRequest) -> dict[str, Any]:
    """Customer cancels the job. Allowed from pending_dispatch through en_route;
    blocked (409) from arrived onward. A customer-provided reason is required and
    recorded. Atomically revokes outstanding offers so no technician can accept
    after cancellation."""
    await latency()
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A reason for cancelling is required.")
    job_id = await _require_token_job(token)
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    current_status = lifecycle.get("status")
    if not can_customer_cancel(current_status):
        raise HTTPException(status_code=409, detail="Job cannot be cancelled at this stage")
    updated = await store.cancel_job(
        job_id, current_status=current_status, reason=reason
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Status changed concurrently")
    return {"status": updated["status"]}


@app.patch("/tickets/{ticket_id}/status")
async def technician_update_status(
    ticket_id: UUID,
    payload: JobStatusUpdateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Assigned-technician forward status transition (en_route | arrived |
    in_progress | completed_pending_customer). Forward-only; the technician may
    set completed_pending_customer but NEVER completed_confirmed (customer-only)."""
    await latency()
    require_any_role(session, {"technician"})
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    if payload.status == STATUS_COMPLETED_CONFIRMED:
        raise HTTPException(status_code=403, detail="Only the customer can confirm completion")
    if payload.status == STATUS_ARRIVED:
        raise HTTPException(
            status_code=409,
            detail="Arrival requires customer PIN verification (POST /jobs/{id}/arrival/verify).",
        )
    lifecycle = await store.get_job_lifecycle(ticket_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if lifecycle.get("fulfillment_technician_id") != tech.get("id"):
        raise HTTPException(status_code=403, detail="Not your job")
    if not can_technician_transition(lifecycle["status"], payload.status):
        raise HTTPException(status_code=409, detail="Illegal status transition")
    updated = await store.set_job_status(
        ticket_id, payload.status, expected_current=lifecycle["status"]
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Status changed concurrently")
    return {"status": updated["status"]}


@app.post("/admin/jobs/{job_id}/resolve")
async def resolve_job(
    job_id: UUID,
    payload: ResolveJobRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Company recovery: the owning org's dispatcher/provider_admin closes, cancels,
    or redispatches a job their organization owns or fulfills. Tenant-scoped for every
    caller — ClueXP is SaaS and does not recover other companies' jobs, so there is no
    cross-tenant platform override."""
    require_any_role(session, {"dispatcher", "provider_admin"})
    if payload.action not in {"close", "cancel", "redispatch"}:
        raise HTTPException(status_code=422, detail="Invalid resolve action")
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    org_id = session.get("active_organization_id")
    owned = {lifecycle.get("customer_owner_org_id"), lifecycle.get("fulfillment_org_id")}
    if not org_id or org_id not in owned:
        raise HTTPException(status_code=404, detail="Job not found in your organization")
    try:
        result = await store.resolve_job(job_id, action=payload.action, note=payload.note)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid resolve action")
    if result is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return result


@app.post("/tickets/{ticket_id}/arrival-handshake")
async def arrival_handshake(ticket_id: UUID, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    raise HTTPException(
        status_code=410,
        detail="Removed. Customer issues a PIN via POST /t/{token}/arrival-pin; "
               "the technician verifies via POST /jobs/{job_id}/arrival/verify.",
    )


@app.post("/t/{token}/arrival-pin")
async def issue_arrival_pin(token: str) -> dict[str, Any]:
    """Customer (tracking-token holder only) issues a fresh six-digit arrival PIN
    bound to the job's assigned technician. Returned once for display; only a
    keyed hash is stored. Issuing invalidates any prior PIN and resets attempts.
    The technician — who has no tracking token — cannot reach this route."""
    await latency()
    job_id = await _require_token_job(token)
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Not found")
    tech_id = lifecycle.get("fulfillment_technician_id")
    if not tech_id:
        raise HTTPException(status_code=409, detail="No technician is assigned yet.")
    if lifecycle["status"] != STATUS_EN_ROUTE:
        raise HTTPException(
            status_code=409,
            detail="A PIN is available once your technician is en route.",
        )
    pin = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=config.ARRIVAL_PIN_TTL_SECONDS)
    await store.create_arrival_pin(
        job_id, UUID(tech_id), _arrival_pin_hash(job_id, pin),
        expires_at, config.ARRIVAL_PIN_MAX_ATTEMPTS,
    )
    return {"pin": pin, "expires_at": expires_at.isoformat()}


@app.post("/jobs/{job_id}/arrival/verify")
async def verify_arrival(
    job_id: UUID,
    payload: ArrivalVerifyRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Assigned technician enters the customer-held PIN to move en_route -> arrived.
    The PIN is single-use, expiring, and attempt-limited; failures never advance
    the job."""
    await latency()
    require_any_role(session, {"technician"})
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if lifecycle.get("fulfillment_technician_id") != tech.get("id"):
        raise HTTPException(status_code=403, detail="Not your job")
    if lifecycle["status"] != STATUS_EN_ROUTE:
        raise HTTPException(status_code=409, detail="Job is not en route")
    pin = (payload.pin or "").strip()
    result = await store.verify_arrival_pin(job_id, UUID(tech["id"]), _arrival_pin_hash(job_id, pin))
    if not result.get("ok"):
        reason = result.get("reason")
        if reason in {"locked", "already_used"}:
            code = 429
        elif reason in {"no_pin", "expired"}:
            code = 409
        else:
            code = 422
        detail = {
            "no_pin": "No active PIN — ask the customer to generate one.",
            "expired": "The PIN expired — ask the customer to generate a new one.",
            "locked": "Too many incorrect attempts — ask the customer to generate a new PIN.",
            "already_used": "This PIN was already used.",
            "technician_mismatch": "This PIN is not bound to you.",
            "incorrect": f"Incorrect PIN. {result.get('remaining', 0)} attempt(s) left.",
        }.get(reason, "Verification failed.")
        raise HTTPException(status_code=code, detail=detail)
    updated = await store.set_job_status(
        job_id, STATUS_ARRIVED, expected_current=STATUS_EN_ROUTE
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Status changed concurrently")
    await store.log_event_raw(job_id, f"arrival:pin_verified:tech={tech['id']}")
    return {"status": updated["status"]}


_ISSUE_KINDS = {"cannot_complete", "customer_unavailable", "unsafe"}


@app.post("/jobs/{job_id}/report-issue")
async def report_issue(
    job_id: UUID,
    payload: IssueReportRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Assigned technician reports a field problem (cannot_complete / customer_unavailable
    / unsafe). Records an audited event surfaced to the company's recovery workspace;
    it does not change the job status — the company's dispatcher decides recovery."""
    require_any_role(session, {"technician"})
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    kind = (payload.kind or "").strip()
    if kind not in _ISSUE_KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {sorted(_ISSUE_KINDS)}")
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if lifecycle.get("fulfillment_technician_id") != tech.get("id"):
        raise HTTPException(status_code=403, detail="Not your job")
    reason = (payload.reason or "").strip()[:280]
    await store.log_event_raw(job_id, f"tech_issue:{kind}:by={tech['id']}:{reason}")
    return {"reported": True, "kind": kind}


@app.post("/jobs/{job_id}/collection")
async def report_collection(
    job_id: UUID,
    payload: PaymentReportRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Assigned technician reports how much they collected and by what method.
    Allowed once service is underway (in_progress / completed_pending_customer).
    Advisory record for the job history — no real charge is processed here."""
    await latency()
    require_any_role(session, {"technician"})
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    amount, method = _validate_payment(payload)
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if lifecycle.get("fulfillment_technician_id") != tech.get("id"):
        raise HTTPException(status_code=403, detail="Not your job")
    if not can_report_collection(lifecycle["status"]):
        raise HTTPException(
            status_code=409,
            detail="Collection can only be reported while the job is in progress or completed.",
        )
    report = await store.record_payment_report(
        job_id=job_id, reported_by="technician", amount=amount, method=method,
        currency="USD",
    )
    return {"status": "recorded", "payment": report}


@app.get("/technician/jobs/history")
async def technician_job_history(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """The signed-in technician's finished jobs (closed/confirmed/cancelled/no-show),
    each with the customer review received and both reported payment amounts/methods."""
    require_any_role(session, {"technician"})
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    return await store.get_technician_job_history(UUID(tech["id"]))


@app.post("/provider/jobs/{job_id}/arrival/override")
async def provider_override_arrival(
    job_id: UUID,
    payload: ArrivalOverrideRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """The owning company's dispatcher forces en_route -> arrived without a PIN
    (e.g. the customer can't read it). Tenant-scoped: the job must belong to the
    dispatcher's active organization. Reason is mandatory and audited."""
    org_id = _require_dispatch_org(session)
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="An override reason is required.")
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    owned = {lifecycle.get("customer_owner_org_id"), lifecycle.get("fulfillment_org_id")}
    if org_id not in owned:
        raise HTTPException(status_code=404, detail="Job not found in your organization")
    if lifecycle["status"] != STATUS_EN_ROUTE:
        raise HTTPException(status_code=409, detail="Job is not en route")
    updated = await store.set_job_status(
        job_id, STATUS_ARRIVED, expected_current=STATUS_EN_ROUTE
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Status changed concurrently")
    actor_id = session.get("user", {}).get("id", "unknown")
    await store.log_event_raw(
        job_id, f"arrival:provider_override:by={actor_id}:org={org_id}:reason={reason[:140]}"
    )
    return {"status": updated["status"]}


# --- company recovery workspace (Gate 3): tenant-scoped, expected-status, audited ---

async def _require_org_job(org_id: str, job_id: UUID) -> dict[str, Any]:
    """Fetch a job's lifecycle and assert it belongs to the dispatcher's org.
    Returns 404 (not 403) for a foreign/missing job — no cross-tenant existence leak."""
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    owned = {lifecycle.get("customer_owner_org_id"), lifecycle.get("fulfillment_org_id")}
    if org_id not in owned:
        raise HTTPException(status_code=404, detail="Job not found in your organization")
    return lifecycle


@app.get("/provider/jobs")
async def provider_active_jobs(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """The company's active/recoverable jobs (live recovery workspace)."""
    org_id = _require_dispatch_org(session)
    return await store.get_provider_active_jobs(org_id)


@app.get("/provider/jobs/history")
async def provider_job_history(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """The company's finished jobs (confirmed / auto-closed / cancelled / no-show),
    each with the customer review and both reported payment amounts/methods —
    the technician's collection and the customer's payment. Tenant-scoped."""
    org_id = _require_dispatch_org(session)
    return await store.get_provider_job_history(org_id)


_ASSIGNED_LADDER = [STATUS_ASSIGNED, STATUS_EN_ROUTE, STATUS_ARRIVED, STATUS_IN_PROGRESS]


async def _provider_recover(
    *, job_id: UUID, payload: RecoveryRequest, session: dict[str, Any],
    target_status: str, expected_statuses: list[str], audit_label: str,
    clear_technician: bool = True,
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, job_id)  # tenant gate first — foreign job is 404, not 422
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A reason is required.")
    actor_id = session.get("user", {}).get("id", "unknown")
    updated = await store.recover_job(
        job_id, target_status=target_status, expected_statuses=expected_statuses,
        clear_technician=clear_technician, reason=f"by={actor_id}:org={org_id}:{reason[:160]}",
        audit_label=audit_label,
    )
    if updated is None:
        raise HTTPException(
            status_code=409,
            detail="Job is not in a state this action can be applied to (it changed concurrently).",
        )
    return {"status": updated["status"]}


@app.post("/provider/jobs/{job_id}/cancel")
async def provider_cancel_job(
    job_id: UUID, payload: RecoveryRequest, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Cancel one of the company's jobs (any pre-completion state). Revokes the
    assigned technician's access and supersedes any active offer."""
    return await _provider_recover(
        job_id=job_id, payload=payload, session=session, target_status=STATUS_CANCELLED,
        expected_statuses=[STATUS_PENDING_DISPATCH, *_ASSIGNED_LADDER],
        audit_label="provider_cancel",
    )


@app.post("/provider/jobs/{job_id}/release")
async def provider_release_job(
    job_id: UUID, payload: RecoveryRequest, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Release the assigned technician and return the job to the company's queue.
    Revokes the prior technician's access; reassign via POST /provider/queue/{id}/assign."""
    return await _provider_recover(
        job_id=job_id, payload=payload, session=session, target_status=STATUS_PENDING_DISPATCH,
        expected_statuses=list(_ASSIGNED_LADDER), audit_label="provider_release",
    )


@app.post("/provider/jobs/{job_id}/no-show")
async def provider_no_show(
    job_id: UUID, payload: RecoveryRequest, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Mark a job no-show (technician dispatched but the visit could not complete).
    Revokes the technician's access and supersedes any active offer."""
    return await _provider_recover(
        job_id=job_id, payload=payload, session=session, target_status=STATUS_NO_SHOW,
        expected_statuses=[STATUS_ASSIGNED, STATUS_EN_ROUTE, STATUS_ARRIVED],
        audit_label="provider_no_show",
    )


@app.post("/provider/jobs/{job_id}/recall-offer")
async def provider_recall_offer(
    job_id: UUID, payload: RecoveryRequest, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Recall the active offer on a still-pending job (the offered technician hasn't
    accepted). Supersedes the offer; the job stays in the company's queue to re-assign.
    No technician is assigned at this point, so none is cleared."""
    return await _provider_recover(
        job_id=job_id, payload=payload, session=session, target_status=STATUS_PENDING_DISPATCH,
        expected_statuses=[STATUS_PENDING_DISPATCH], audit_label="provider_recall_offer",
        clear_technician=False,
    )


@app.get("/provider/jobs/{job_id}/notes")
async def provider_list_notes(
    job_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """Internal notes on one of the company's jobs (dispatcher coordination /
    audit trail). Tenant-scoped; never exposed to customers or technicians."""
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, job_id)
    return await store.list_job_notes(job_id)


@app.post("/provider/jobs/{job_id}/notes")
async def provider_add_note(
    job_id: UUID, payload: NoteRequest, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Append an internal note (author + timestamp) to one of the company's jobs."""
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, job_id)
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Note text is required.")
    user = session.get("user", {})
    return await store.add_job_note(
        job_id, author_id=user.get("id", "unknown"),
        author_name=user.get("display_name"), body=body[:2000],
    )


@app.get("/provider/jobs/{job_id}/timeline")
async def provider_job_timeline(
    job_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """Append-only audit timeline (events) for one of the company's jobs — assignment,
    arrival, recovery, technician-reported issues, etc. Tenant-scoped."""
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, job_id)
    return await store.list_job_events(job_id)


@app.get("/provider/audit")
async def provider_audit(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """Org-wide audit log: recent events across all of the company's jobs (owned or
    fulfilled), newest first. Tenant-scoped — never exposes another company's events."""
    org_id = _require_dispatch_org(session)
    return await store.list_org_events(org_id, limit=200)


# Demo payment/finalize chain — gated OFF the MVP path (no real payment in MVP).
# The customer's real review path is the token-gated POST /t/{token}/review.
_DEMO_GONE = "Removed from the MVP — no production payment/finalize flow. (Customer review: POST /t/{token}/review.)"


@app.post("/tickets/{ticket_id}/finalize")
async def finalize(ticket_id: UUID) -> dict[str, Any]:
    raise HTTPException(status_code=410, detail=_DEMO_GONE)


@app.post("/tickets/{ticket_id}/approve-final")
async def approve_final(ticket_id: UUID) -> dict[str, Any]:
    raise HTTPException(status_code=410, detail=_DEMO_GONE)


@app.post("/tickets/{ticket_id}/charge")
async def charge(ticket_id: UUID) -> dict[str, Any]:
    raise HTTPException(status_code=410, detail=_DEMO_GONE)


@app.post("/tickets/{ticket_id}/review")
async def review_ticket(ticket_id: UUID) -> dict[str, Any]:
    raise HTTPException(status_code=410, detail=_DEMO_GONE)


@app.post("/tickets/{ticket_id}/handoff", response_model=TicketEnvelope)
async def handoff(ticket_id: UUID, payload: dict[str, Any] | None = None) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    ticket.status = TicketStatus.FALLBACK_TO_HUMAN
    await save(ticket)
    await log_transition(ticket, f"handoff:{(payload or {}).get('reason', 'explicit')}")
    return await envelope(ticket)
