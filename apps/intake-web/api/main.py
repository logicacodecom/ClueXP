from __future__ import annotations

import asyncio
import math
import os
import random
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.geocode import geocode
from api.store import make_store
from api.schema import (
    AccessType,
    CancellationPolicy,
    FinalCharge,
    PaymentMethod,
    PriceQuote,
    TechnicianAssignment,
    Ticket,
    TicketStatus,
    TrustState,
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


def envelope(ticket: Ticket) -> TicketEnvelope:
    return TicketEnvelope(
        ticket=ticket,
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


async def save(ticket: Ticket) -> Ticket:
    await store.save(ticket)
    return ticket


async def log_transition(ticket: Ticket, event: str) -> None:
    await store.log_event(ticket, event)


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
    ticket = Ticket.model_validate(sanitize_client_payload(payload))
    await save(ticket)
    await log_transition(ticket, "created")
    return envelope(ticket)


@app.get("/tickets/{ticket_id}", response_model=TicketEnvelope)
async def get_ticket(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    return envelope(await require_ticket(ticket_id))


@app.patch("/tickets/{ticket_id}", response_model=TicketEnvelope)
async def patch_ticket(ticket_id: UUID, payload: dict[str, Any]) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    merged = deep_merge(ticket.model_dump(mode="python"), sanitize_client_payload(payload))
    updated = Ticket.model_validate(merged)
    await save(updated)
    await log_transition(updated, "patched")
    return envelope(updated)


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
    return envelope(ticket)


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
    return envelope(ticket)


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
    return envelope(ticket)


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
    return envelope(ticket)


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
    return envelope(ticket)


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
    return envelope(ticket)


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
    return envelope(ticket)


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
    return envelope(ticket)


@app.post("/tickets/{ticket_id}/charge")
async def charge(ticket_id: UUID) -> dict[str, str]:
    await latency()
    ticket = await require_ticket(ticket_id)
    if ticket.final_charge is None:
        raise HTTPException(status_code=409, detail="Final charge not ready")
    if ticket.final_charge.customer_approval_required and not ticket.final_charge.customer_approved:
        raise HTTPException(status_code=409, detail="Customer approval required")
    return {"status": "captured"}


@app.post("/tickets/{ticket_id}/handoff", response_model=TicketEnvelope)
async def handoff(ticket_id: UUID, payload: dict[str, Any] | None = None) -> TicketEnvelope:
    await latency()
    ticket = await require_ticket(ticket_id)
    ticket.status = TicketStatus.FALLBACK_TO_HUMAN
    await save(ticket)
    await log_transition(ticket, f"handoff:{(payload or {}).get('reason', 'explicit')}")
    return envelope(ticket)
