from __future__ import annotations

import asyncio
import math
import random
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from assets.schema import (
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


app = FastAPI(title="ClueXP Emergency Access API")

tickets: dict[UUID, Ticket] = {}
otp_codes: dict[UUID, str] = {}
arrival_codes: dict[UUID, str] = {}
transition_log: list[str] = []


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


def require_ticket(ticket_id: UUID) -> Ticket:
    ticket = tickets.get(ticket_id)
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


def save(ticket: Ticket) -> Ticket:
    tickets[ticket.ticket_id] = ticket
    return ticket


def log_transition(ticket: Ticket, event: str) -> None:
    transition_log.append(f"{datetime.utcnow().isoformat()} {ticket.ticket_id} {event} {ticket.trust_state}")


@app.post("/tickets", response_model=TicketEnvelope)
async def create_ticket(payload: dict[str, Any] | None = None) -> TicketEnvelope:
    await latency()
    ticket = Ticket.model_validate(payload or {})
    save(ticket)
    log_transition(ticket, "created")
    return envelope(ticket)


@app.get("/tickets/{ticket_id}", response_model=TicketEnvelope)
async def get_ticket(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    return envelope(require_ticket(ticket_id))


@app.patch("/tickets/{ticket_id}", response_model=TicketEnvelope)
async def patch_ticket(ticket_id: UUID, payload: dict[str, Any]) -> TicketEnvelope:
    await latency()
    ticket = require_ticket(ticket_id)
    merged = deep_merge(ticket.model_dump(mode="python"), payload)
    updated = Ticket.model_validate(merged)
    save(updated)
    log_transition(updated, "patched")
    return envelope(updated)


@app.post("/tickets/{ticket_id}/price-quote", response_model=TicketEnvelope)
async def price_quote(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = require_ticket(ticket_id)
    base = {
        AccessType.CAR: (115.0, 245.0),
        AccessType.HOME: (95.0, 185.0),
        AccessType.BUSINESS: (135.0, 295.0),
        AccessType.OTHER: (125.0, 260.0),
        None: (105.0, 225.0),
    }.get(ticket.access_type, (105.0, 225.0))
    ticket.price_quote = PriceQuote(estimate_min=base[0], estimate_max=base[1])
    ticket.cancellation_policy = CancellationPolicy(cancellation_fee=35.0, no_show_fee=65.0)
    save(ticket)
    log_transition(ticket, "price_quote")
    return envelope(ticket)


@app.post("/tickets/{ticket_id}/payment-method", response_model=TicketEnvelope)
async def payment_method(ticket_id: UUID, payload: dict[str, Any]) -> TicketEnvelope:
    await latency()
    token = str(payload.get("token", ""))
    if not token.startswith("tok_"):
        raise HTTPException(status_code=400, detail="Invalid processor token")
    ticket = require_ticket(ticket_id)
    ticket.payment_method = PaymentMethod(
        processor=str(payload.get("processor", "stub")),
        token=token,
        brand=payload.get("brand", "Secure wallet"),
        last4=payload.get("last4"),
        captured_at=datetime.utcnow(),
    )
    save(ticket)
    log_transition(ticket, "payment_method")
    return envelope(ticket)


@app.post("/tickets/{ticket_id}/commit", response_model=TicketEnvelope)
async def commit(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = require_ticket(ticket_id)
    if ticket.price_quote is None or not ticket.price_quote.accepted_by_customer:
        raise HTTPException(status_code=409, detail="Price acceptance required")
    if ticket.payment_method is None:
        raise HTTPException(status_code=409, detail="Payment method required")
    ticket.status = TicketStatus.PARTIAL if ticket.unresolved_fields else TicketStatus.COMPLETE
    save(ticket)
    log_transition(ticket, "committed")
    return envelope(ticket)


@app.post("/tickets/{ticket_id}/otp/send")
async def send_otp(ticket_id: UUID) -> dict[str, str]:
    await latency()
    require_ticket(ticket_id)
    code = str(random.randint(100000, 999999))
    otp_codes[ticket_id] = code
    return {"dev_code": code, "message": "Code sent"}


@app.post("/tickets/{ticket_id}/otp/verify", response_model=TicketEnvelope)
async def verify_otp(ticket_id: UUID, payload: dict[str, Any]) -> TicketEnvelope:
    await latency()
    ticket = require_ticket(ticket_id)
    if otp_codes.get(ticket_id) != str(payload.get("code", "")):
        raise HTTPException(status_code=400, detail="Code did not match")
    log_transition(ticket, "otp_verified")
    return envelope(ticket)


@app.post("/tickets/{ticket_id}/dispatch", response_model=TicketEnvelope)
async def dispatch(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = require_ticket(ticket_id)
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
        assigned_at=datetime.utcnow(),
    )
    ticket.trust_state = TrustState.MATCHED
    save(ticket)
    log_transition(ticket, "matched")
    return envelope(ticket)


@app.get("/tickets/{ticket_id}/tracking", response_model=TicketEnvelope)
async def tracking(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = require_ticket(ticket_id)
    if ticket.technician_assignment is None:
        raise HTTPException(status_code=409, detail="No technician assigned")
    ticket.trust_state = TrustState.FULFILLMENT
    minutes = int(abs(math.sin(datetime.utcnow().timestamp() / 60)) * 8) + 6
    ticket.technician_assignment.eta_minutes_min = minutes
    ticket.technician_assignment.eta_minutes_max = minutes + 4
    save(ticket)
    log_transition(ticket, "tracking")
    return envelope(ticket)


@app.post("/tickets/{ticket_id}/arrival-handshake")
async def arrival_handshake(ticket_id: UUID, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    await latency()
    require_ticket(ticket_id)
    if not payload or "code" not in payload:
        code = str(random.randint(1000, 9999))
        arrival_codes[ticket_id] = code
        return {"customer_code": code, "verified": False}
    return {"verified": str(payload["code"]) == arrival_codes.get(ticket_id)}


@app.post("/tickets/{ticket_id}/finalize", response_model=TicketEnvelope)
async def finalize(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = require_ticket(ticket_id)
    quote_max = ticket.price_quote.estimate_max if ticket.price_quote else 0
    final_amount = quote_max - 20 if quote_max else 165.0
    exceeds = bool(quote_max and final_amount > quote_max)
    ticket.final_charge = FinalCharge(
        final_amount=final_amount,
        breakdown_note="Service completed with standard labor and parts.",
        exceeds_estimate=exceeds,
        customer_approval_required=exceeds,
    )
    save(ticket)
    log_transition(ticket, "finalized")
    return envelope(ticket)


@app.post("/tickets/{ticket_id}/approve-final", response_model=TicketEnvelope)
async def approve_final(ticket_id: UUID) -> TicketEnvelope:
    await latency()
    ticket = require_ticket(ticket_id)
    if ticket.final_charge is None:
        raise HTTPException(status_code=409, detail="Final charge not ready")
    ticket.final_charge.customer_approved = True
    ticket.final_charge.customer_approved_at = datetime.utcnow()
    save(ticket)
    log_transition(ticket, "final_approved")
    return envelope(ticket)


@app.post("/tickets/{ticket_id}/charge")
async def charge(ticket_id: UUID) -> dict[str, str]:
    await latency()
    ticket = require_ticket(ticket_id)
    if ticket.final_charge is None:
        raise HTTPException(status_code=409, detail="Final charge not ready")
    if ticket.final_charge.customer_approval_required and not ticket.final_charge.customer_approved:
        raise HTTPException(status_code=409, detail="Customer approval required")
    return {"status": "captured"}


@app.post("/tickets/{ticket_id}/handoff", response_model=TicketEnvelope)
async def handoff(ticket_id: UUID, payload: dict[str, Any] | None = None) -> TicketEnvelope:
    await latency()
    ticket = require_ticket(ticket_id)
    ticket.status = TicketStatus.FALLBACK_TO_HUMAN
    save(ticket)
    log_transition(ticket, f"handoff:{(payload or {}).get('reason', 'explicit')}")
    return envelope(ticket)
