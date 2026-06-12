from __future__ import annotations

import asyncio
import hmac
import logging
import math
import os
import random
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.geocode import geocode, places_autocomplete
from api import storage
from api.auth import create_access_token, decode_access_token
from api import config
from api.dispatch import (
    STATUS_CANCELLED,
    STATUS_COMPLETED_CONFIRMED,
    STATUS_COMPLETED_PENDING,
    STATUS_DISPUTED,
    can_customer_cancel,
    can_technician_transition,
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


# OTP is deferred this sprint (no frontend gate); arrival codes back the
# fulfillment demo and are best-effort — they may not survive a serverless cold
# start, which is acceptable for a demo-only path.
otp_codes: dict[UUID, str] = {}
arrival_codes: dict[UUID, str] = {}


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
    service_area_center_lat: float | None = None
    service_area_center_lng: float | None = None
    service_area_radius_km: float | None = None
    locale: str | None = None


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


class JobStatusUpdateRequest(BaseModel):
    status: str


class CustomerReviewRequest(BaseModel):
    rating: int
    comment: str | None = None

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
    """Self-service individual-technician signup. Creates the login + a PENDING
    technician profile (cannot receive offers until a platform admin approves —
    the dispatch engine already filters active+verified)."""
    await latency()
    if not payload.email and not payload.phone:
        raise HTTPException(status_code=422, detail="Email or phone is required")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    try:
        session = await store.register_technician(payload.model_dump())
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


@app.post("/admin/technicians/{technician_id}/approve")
async def approve_technician(
    technician_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.approve_technician(technician_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    return result


@app.post("/admin/organizations/{organization_id}/approve")
async def approve_organization(
    organization_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.approve_organization(organization_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return result


@app.post("/admin/technicians/{technician_id}/reject")
async def reject_technician(
    technician_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.reject_technician(technician_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Technician not found")
    return result


@app.post("/admin/organizations/{organization_id}/reject")
async def reject_organization(
    organization_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    result = await store.reject_organization(organization_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return result


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


@app.post("/provider/technicians")
async def create_provider_technician(
    payload: AffiliatedTechnicianRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    organization_id = _provider_organization_id(session)
    if not payload.email and not payload.phone:
        raise HTTPException(status_code=422, detail="Email or phone is required")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Temporary password must be at least 8 characters")
    try:
        return await store.create_affiliated_technician(
            organization_id, payload.model_dump(mode="json")
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


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
    if payload.owner_type not in {"organization", "technician"}:
        raise HTTPException(status_code=422, detail="Invalid document owner")
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


@app.post("/tickets", response_model=TicketEnvelope)
async def create_ticket(payload: dict[str, Any] | None = None) -> TicketEnvelope:
    await latency()
    # Trusted intake-channel resolution (adr/0004): the browser supplies only a channel
    # slug (attribution, dropped by sanitize); the owning org is resolved server-side and
    # is never trusted from the client. Absent/unknown slug => public ClueXP intake.
    raw_slug = (payload or {}).get("intake_channel")
    origin = await store.resolve_intake_channel(raw_slug if isinstance(raw_slug, str) else None)
    ticket = Ticket.model_validate(sanitize_client_payload(payload))
    await save(ticket, origin)
    await log_transition(ticket, "created")
    env = await envelope(ticket)

    # Cutover fires when (a) the resolved channel has its per-channel flag on, OR
    # (b) no channel was resolved (public intake) and DISPATCH_CUTOVER_PUBLIC is set —
    # AND the global kill-switch is off.
    channel_on = bool(origin and origin.get("dispatch_cutover_enabled"))
    public_on = bool(not origin and config.DISPATCH_CUTOVER_PUBLIC)
    cutover = (channel_on or public_on) and not config.DISPATCH_CUTOVER_GLOBAL_OFF
    if cutover:
        # Put the job on the operational ladder, then run the dispatch WRITE so the
        # offer→accept loop drives fulfillment instead of the instant-match stub.
        await store.set_job_status(ticket.ticket_id, "pending_dispatch")
        job = await store.get_dispatch_job(ticket.ticket_id)
        if job is not None:
            try:
                await _dispatch_write(ticket.ticket_id, job)
            except Exception:
                logger.exception("dispatch_write failed at create for job %s", ticket.ticket_id)
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


@app.post("/tickets/{ticket_id}/dispatch", response_model=TicketEnvelope)
async def dispatch(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    if not ticket.is_dispatchable():
        raise HTTPException(status_code=409, detail="Ticket is not dispatchable")
    ticket.technician_assignment = TechnicianAssignment(
        technician_id="tech_stub_247",
        display_name="Sam Reyes",
        role="Specialist",
        photo_url=None,
        rating=4.9,
        eta_minutes_min=18,
        eta_minutes_max=24,
        assigned_at=now(),
    )
    ticket.trust_state = TrustState.MATCHED
    await save(ticket)
    await log_transition(ticket, "matched")
    return await envelope(ticket)


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
async def create_offers(ticket_id: UUID) -> dict[str, Any]:
    """Dispatch engine v1 (explicit write). **Additive** to the legacy stub
    ``/dispatch`` — returns the ranked offers; the customer is never shown a
    technician before assignment."""
    await latency()
    job = await store.get_dispatch_job(ticket_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return await _dispatch_write(ticket_id, job)


@app.api_route("/cron/dispatch-sweep", methods=["GET", "POST"])
async def dispatch_sweep(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Scheduler-driven sweep — callable by Vercel Cron OR Supabase pg_cron/pg_net
    OR any external scheduler. Secret-protected via ``Authorization: Bearer
    ${CRON_SECRET}``. Expires stale offers and re-dispatches unmatched jobs per
    their fulfillment policy (owner pool first, then network as rounds advance),
    enforcing max rounds + total timeout so a customer never waits forever. This
    is a WRITE owned by the scheduler — the customer tracking poll never triggers it."""
    if not config.CRON_SECRET:
        raise HTTPException(status_code=503, detail="Sweep disabled: CRON_SECRET unset")
    presented = authorization.split(" ", 1)[1].strip() if (
        authorization and authorization.lower().startswith("bearer ")
    ) else ""
    if not hmac.compare_digest(presented, config.CRON_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")
    expired = await store.expire_stale_offers()
    jobs = await store.list_dispatchable_jobs(
        max_attempts=config.MAX_REDISPATCH_ROUNDS,
        total_timeout_seconds=config.TOTAL_TIMEOUT_SECONDS,
    )
    technicians = await store.list_available_technicians() if jobs else []
    redispatched = 0
    for job in jobs:
        owner_org_id = job.get("customer_owner_org_id")
        policy = normalize_policy(job.get("fulfillment_policy"), owner_org_id)
        ranked = select_candidates(
            job, technicians, policy=policy, owner_org_id=owner_org_id,
            round_index=job.get("dispatch_attempts", 0), top_n=config.TOP_N_OFFERS,
        )
        if technicians:
            await store.bump_dispatch_attempt(job["id"])
        if ranked:
            expires_at = now() + timedelta(seconds=config.OFFER_TTL_SECONDS)
            await store.create_dispatch_offers(job["id"], ranked, expires_at)
            redispatched += 1
    # Cutover: auto-close jobs the customer never confirmed within the window
    # (completed_pending_customer → completed_auto_closed). Cron-owned.
    auto_closed = await store.auto_close_pending(config.AUTO_CLOSE_WINDOW_SECONDS)
    return {
        "expired_offers": expired,
        "dispatchable_jobs": len(jobs),
        "redispatched": redispatched,
        "auto_closed": auto_closed,
    }


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
    offer_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    """Technician declines an offer — marks it declined so it stops appearing in the feed."""
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=403, detail="Technician session required")
    declined = await store.decline_dispatch_offer(offer_id, UUID(tech["id"]))
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
        return {"state": "error", "terminal": False, "assignment": None}
    if status is None:
        raise HTTPException(status_code=404, detail="Not found")
    for _f in ("attempts", "max_attempts", "offers_pending", "offer_expires_at"):
        status.pop(_f, None)
    return status


async def _require_token_job(token: str) -> UUID:
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
    blocked (409) from arrived onward. Atomically revokes outstanding offers so
    no technician can accept after cancellation."""
    await latency()
    job_id = await _require_token_job(token)
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    current_status = lifecycle.get("status")
    if not can_customer_cancel(current_status):
        raise HTTPException(status_code=409, detail="Job cannot be cancelled at this stage")
    updated = await store.cancel_job(
        job_id, current_status=current_status, reason=payload.reason
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
    """Dispatcher/admin resolution: close, cancel, or redispatch. platform_admin
    may resolve any job; a dispatcher may resolve only jobs their org owns or
    fulfills (tenant-safe)."""
    require_any_role(session, {"platform_admin", "dispatcher"})
    if payload.action not in {"close", "cancel", "redispatch"}:
        raise HTTPException(status_code=422, detail="Invalid resolve action")
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if "platform_admin" not in set(session.get("roles", [])):
        org_id = session.get("active_organization_id")
        owned = {lifecycle.get("customer_owner_org_id"), lifecycle.get("fulfillment_org_id")}
        if not org_id or org_id not in owned:
            raise HTTPException(status_code=403, detail="Not your job")
    try:
        result = await store.resolve_job(job_id, action=payload.action, note=payload.note)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid resolve action")
    if result is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return result


@app.post("/tickets/{ticket_id}/arrival-handshake")
async def arrival_handshake(ticket_id: UUID, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    await latency()
    await require_ticket(ticket_id)
    if not payload or "code" not in payload:
        code = str(random.randint(1000, 9999))
        arrival_codes[ticket_id] = code
        return {"customer_code": code, "verified": False}
    return {"verified": str(payload["code"]) == arrival_codes.get(ticket_id)}


@app.post("/tickets/{ticket_id}/finalize", response_model=TicketEnvelope)
async def finalize(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    quote_max = ticket.price_quote.estimate_max if ticket.price_quote else 0
    final_amount = quote_max - 20 if quote_max else 165.0
    exceeds = bool(quote_max and final_amount > quote_max)
    ticket.final_charge = FinalCharge(
        final_amount=final_amount,
        breakdown_note="Service completed with standard labor and parts.",
        exceeds_estimate=exceeds,
        customer_approval_required=exceeds,
    )
    await save(ticket)
    await log_transition(ticket, "finalized")
    return await envelope(ticket)


@app.post("/tickets/{ticket_id}/approve-final", response_model=TicketEnvelope)
async def approve_final(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    if ticket.final_charge is None:
        raise HTTPException(status_code=409, detail="Final charge not ready")
    ticket.final_charge.customer_approved = True
    ticket.final_charge.customer_approved_at = now()
    await save(ticket)
    await log_transition(ticket, "final_approved")
    return await envelope(ticket)


@app.post("/tickets/{ticket_id}/charge")
async def charge(ticket_id: UUID) -> dict[str, str]:
    await latency()
    ticket = await require_ticket(ticket_id)
    if ticket.final_charge is None:
        raise HTTPException(status_code=409, detail="Final charge not ready")
    if ticket.final_charge.customer_approval_required and not ticket.final_charge.customer_approved:
        raise HTTPException(status_code=409, detail="Customer approval required")
    await log_transition(ticket, "charge_captured")
    return {"status": "captured"}


@app.post("/tickets/{ticket_id}/review")
async def review_ticket(ticket_id: UUID, payload: JobReviewRequest) -> dict[str, Any]:
    await latency()
    ticket = await require_ticket(ticket_id)
    if ticket.final_charge is None:
        raise HTTPException(status_code=409, detail="Job must be finalized before review")
    if payload.rating < 1 or payload.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    review = await store.record_review(
        ticket_id=ticket_id,
        rating=payload.rating,
        tags=payload.tags[:12],
        comment=payload.comment,
    )
    await log_transition(ticket, "review_submitted")
    return {"status": "recorded", "review": review}


@app.post("/tickets/{ticket_id}/handoff", response_model=TicketEnvelope)
async def handoff(ticket_id: UUID, payload: dict[str, Any] | None = None) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    ticket.status = TicketStatus.FALLBACK_TO_HUMAN
    await save(ticket)
    await log_transition(ticket, f"handoff:{(payload or {}).get('reason', 'explicit')}")
    return await envelope(ticket)
