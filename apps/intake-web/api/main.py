from __future__ import annotations

import asyncio
import math
import os
import random
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.geocode import geocode
from api import storage
from api.auth import create_access_token, decode_access_token
from api.dispatch import rank_candidates
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
async def login(payload: LoginRequest) -> AuthResponse:
    await latency()
    session = await store.authenticate_user(payload.identifier, payload.password)
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid email, phone, or password")
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
    return await envelope(ticket)


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
    return await envelope(await require_ticket(ticket_id))


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
    ticket.status = TicketStatus.PARTIAL if ticket.unresolved_fields else TicketStatus.COMPLETE
    await save(ticket)
    await log_transition(ticket, "committed")
    return await envelope(ticket)


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


@app.post("/tickets/{ticket_id}/offers")
async def create_offers(ticket_id: UUID) -> dict[str, Any]:
    """Dispatch engine v1: rank available technicians by rule and create
    ``dispatch_offers`` for the top candidates. **Additive** to the legacy stub
    ``/dispatch`` — this does NOT flip the job to MATCHED (that happens only on
    an accepted offer). Returns the ranked offers (identity masking is a frontend
    concern; the customer is never shown a technician before assignment)."""
    await latency()
    job = await store.get_dispatch_job(ticket_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("fulfillment_technician_id"):
        raise HTTPException(status_code=409, detail="Job already matched")
    technicians = await store.list_available_technicians()
    ranked = rank_candidates(job, technicians, top_n=3)
    if not ranked:
        return {"offers": [], "matched": False, "reason": "no_eligible_technician"}
    expires_at = now() + timedelta(seconds=90)
    offers = await store.create_dispatch_offers(ticket_id, ranked, expires_at)
    return {"offers": offers, "matched": False, "expires_at": expires_at.isoformat()}


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


@app.get("/tickets/{ticket_id}/tracking", response_model=TicketEnvelope)
async def tracking(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    if ticket.technician_assignment is None:
        raise HTTPException(status_code=409, detail="No technician assigned")
    ticket.trust_state = TrustState.FULFILLMENT
    minutes = int(abs(math.sin(now().timestamp() / 60)) * 8) + 6
    ticket.technician_assignment.eta_minutes_min = minutes
    ticket.technician_assignment.eta_minutes_max = minutes + 4
    await save(ticket)
    await log_transition(ticket, "tracking")
    return await envelope(ticket)


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
