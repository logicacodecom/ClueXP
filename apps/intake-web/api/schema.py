"""
ClueXP Emergency Access — Ticket Schema

This is the single source of truth that the intake front-end POSTs into and that
the ADK graph mutates as state. It carries the full trust-state through the
system (INTAKE → MATCHED → FULFILLMENT) so the UI never has to fabricate
operational values.

Conventions:
- Pydantic v2 (recommended for ADK 2.x). `pip install pydantic>=2`.
- Every field that the UI is told to render from "backend" lives here.
- `status` and `trust_state` together drive what the UI is allowed to show.
- Anything the dispatch engine produces (tech, ETA, live tracking, final price)
  comes back on this same object — the graph emits it, dispatch fills it.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, ConfigDict


# ─────────────────────────────────────────────────────────────────────────────
# Enums — closed sets the graph routes on
# ─────────────────────────────────────────────────────────────────────────────

class TrustState(str, Enum):
    """The three operational states from the build brief.
    The UI must NEVER show data that only becomes real in a later state.
    """
    INTAKE = "intake"          # gathering + commercial consent; no tech committed
    MATCHED = "matched"        # backend has assigned a verified technician
    FULFILLMENT = "fulfillment"  # live operational data available


class TicketStatus(str, Enum):
    """Lifecycle of the intake graph itself. Distinct from TrustState:
    TrustState describes what the system has committed to externally;
    TicketStatus describes where the intake graph is internally.
    """
    DRAFT = "draft"                      # being collected
    COMPLETE = "complete"                # all required fields captured
    PARTIAL = "partial"                  # dispatchable but with fail-safe defaults
    FALLBACK_TO_HUMAN = "fallback_to_human"  # routed to human dispatcher


class Channel(str, Enum):
    MOBILE_WEB = "mobile_web"
    VOICE = "voice"


class AccessType(str, Enum):
    CAR = "vehicle"
    HOME = "home"
    BUSINESS = "business"
    OTHER = "other"


class Situation(str, Enum):
    LOCKED_OUT = "locked_out"
    LOST_KEY = "lost_key"
    BROKEN_KEY = "broken_key"
    KEY_IN_CAR = "key_in_car"
    MALFUNCTION = "malfunction"
    REKEY = "rekey"


class Urgency(str, Enum):
    EMERGENCY = "emergency"
    URGENT = "urgent"
    STANDARD = "standard"
    SCHEDULED = "scheduled"


class KeyType(str, Enum):
    MECHANICAL = "mechanical"
    TRANSPONDER = "transponder"
    SMART_KEY = "smart_key"
    UNKNOWN = "unknown"  # surfaced as "Not sure" in the UI; fail-safe = programmer-capable tech


class KeyTypeSource(str, Enum):
    STATED = "stated"          # user explicitly selected
    INFERRED = "inferred"      # derived from make/model/year
    UNVERIFIED = "unverified"  # unknown — fail-safe loadout


class LockClass(str, Enum):
    RESIDENTIAL = "residential"
    COMMERCIAL = "commercial"
    HIGH_SECURITY = "high_security"
    SAFE = "safe"
    ACCESS_CONTROL = "access_control"


class SafetyType(str, Enum):
    PERSON_INSIDE = "person_inside"
    PET_INSIDE = "pet_inside"
    MEDICAL = "medical"
    UNSAFE_LOCATION = "unsafe_location"
    NONE = "none"


class AuthorityRole(str, Enum):
    OWNER = "owner"
    TENANT = "tenant"
    MANAGER = "manager"
    EMPLOYEE = "employee"
    OTHER = "other"


# ─────────────────────────────────────────────────────────────────────────────
# Sub-objects
# ─────────────────────────────────────────────────────────────────────────────

class SafetyFlag(BaseModel):
    present: bool = False
    type: SafetyType = SafetyType.NONE
    advised_emergency_services: bool = False


class Location(BaseModel):
    raw_text: Optional[str] = None     # as spoken/typed
    lat: Optional[float] = None
    lng: Optional[float] = None
    geocode_confidence: str = "none"   # "high" | "low" | "none"


class Automotive(BaseModel):
    """Populated only when access_type == CAR."""
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    key_type: KeyType = KeyType.UNKNOWN
    key_type_source: KeyTypeSource = KeyTypeSource.UNVERIFIED


class Property(BaseModel):
    """Populated when access_type == HOME or BUSINESS."""
    lock_type: Optional[str] = None
    lock_class: Optional[LockClass] = None


class Identity(BaseModel):
    claims_ownership: bool = False
    authority_role: Optional[AuthorityRole] = None
    verification_method: str = "on_arrival_id"


# ─── Sections added per addendum (sections 11–15) ────────────────────────────

class Photo(BaseModel):
    """Reference to an uploaded photo — the file itself lives in object storage."""
    id: str
    url: str
    uploaded_at: datetime


class PaymentMethod(BaseModel):
    """Payment method ON FILE — never charged at intake.
    The processor token is the only thing we hold; no card data in our schema.
    """
    processor: str                    # e.g. "stripe", "adyen"
    token: str                        # opaque token from the processor
    brand: Optional[str] = None       # for display only: "Visa", "Apple Pay", ...
    last4: Optional[str] = None       # for display only
    captured_at: Optional[datetime] = None


class CancellationPolicy(BaseModel):
    """Backend-supplied amounts; the UI is forbidden from hardcoding fees.
    Currency follows ISO 4217 (e.g. 'USD').
    """
    currency: str = "USD"
    free_until: str = "before_technician_assignment"
    cancellation_fee: Optional[float] = None   # applies after assignment
    no_show_fee: Optional[float] = None
    accepted_by_customer: bool = False
    accepted_at: Optional[datetime] = None


class PriceQuote(BaseModel):
    """Estimate range supplied by the pricing engine — never hardcoded in UI."""
    currency: str = "USD"
    estimate_min: Optional[float] = None
    estimate_max: Optional[float] = None
    accepted_by_customer: bool = False
    accepted_at: Optional[datetime] = None


class TechnicianAssignment(BaseModel):
    """First populated when TrustState transitions to MATCHED.
    Until then this object must be None — the UI relies on this to know
    whether it may show technician data.
    """
    technician_id: str
    display_name: str
    role: str = "Specialist"          # NEVER "Officer" or law-enforcement framing
    photo_url: Optional[str] = None
    rating: Optional[float] = None
    verified: bool = True
    eta_minutes_min: Optional[int] = None
    eta_minutes_max: Optional[int] = None
    assigned_at: datetime


class FinalCharge(BaseModel):
    """Populated in FULFILLMENT, post-service.
    If final_amount falls outside the original estimate range, the UI MUST
    require explicit customer approval before any charge is processed.
    """
    currency: str = "USD"
    final_amount: float
    breakdown_note: Optional[str] = None
    exceeds_estimate: bool = False
    customer_approval_required: bool = False
    customer_approved: bool = False
    customer_approved_at: Optional[datetime] = None


# ─────────────────────────────────────────────────────────────────────────────
# The Ticket — the spine of the whole system
# ─────────────────────────────────────────────────────────────────────────────

class Ticket(BaseModel):
    """The single mutable state object the ADK graph operates on, and the
    contract the UI POSTs into / reads from. Carries the full journey from
    INTAKE through FULFILLMENT.
    """

    model_config = ConfigDict(use_enum_values=False, validate_assignment=True)

    # ─── Identity / lifecycle ────────────────────────────────────────────────
    ticket_id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    channel: Channel = Channel.MOBILE_WEB
    status: TicketStatus = TicketStatus.DRAFT
    trust_state: TrustState = TrustState.INTAKE  # gates what the UI may render

    # ─── Core disambiguation (sections 1–10 of the brief) ────────────────────
    access_type: Optional[AccessType] = None
    situation: Optional[Situation] = None
    urgency: Urgency = Urgency.URGENT  # default per spec when unspecified

    safety_flag: SafetyFlag = Field(default_factory=SafetyFlag)
    location: Location = Field(default_factory=Location)
    automotive: Automotive = Field(default_factory=Automotive)
    property: Property = Field(default_factory=Property)
    identity: Identity = Field(default_factory=Identity)

    # ─── Customer contact (collected at identity step) ───────────────────────
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None

    # ─── Addendum sections 11–15 ─────────────────────────────────────────────
    additional_details: Optional[str] = None     # free-text, optional
    photos: list[Photo] = Field(default_factory=list)
    payment_method: Optional[PaymentMethod] = None
    cancellation_policy: Optional[CancellationPolicy] = None
    price_quote: Optional[PriceQuote] = None

    # ─── Dispatch-engine outputs (populated outside the intake graph) ────────
    technician_assignment: Optional[TechnicianAssignment] = None
    final_charge: Optional[FinalCharge] = None

    # ─── Signals for the deterministic dispatch engine ───────────────────────
    equipment_hints: list[str] = Field(default_factory=list)
    specialist_required: bool = False
    confidence: float = 0.0                       # 0.0–1.0
    unresolved_fields: list[str] = Field(default_factory=list)
    transcript_ref: Optional[str] = None          # pointer to conversation log

    # ─── Guard helpers ──────────────────────────────────────────────────────
    def may_show_technician(self) -> bool:
        """UI helper: technician data is only legitimate at MATCHED or later."""
        return self.trust_state in (TrustState.MATCHED, TrustState.FULFILLMENT)

    def may_show_live_tracking(self) -> bool:
        """UI helper: live tracking is FULFILLMENT only."""
        return self.trust_state == TrustState.FULFILLMENT

    def may_show_eta(self) -> bool:
        """UI helper: any ETA must come from a real assignment."""
        return (
            self.technician_assignment is not None
            and self.may_show_technician()
        )

    def is_dispatchable(self) -> bool:
        """Minimum bar for handing off to the dispatch engine.
        Partial tickets with fail-safe defaults still qualify; the engine
        receives equipment_hints/specialist_required to compensate.
        """
        return (
            self.status in (TicketStatus.COMPLETE, TicketStatus.PARTIAL)
            and self.access_type is not None
            and self.situation is not None
            and self.location.raw_text is not None
            and (self.price_quote is not None and self.price_quote.accepted_by_customer)
            # Sprint 1: payment-on-file is deferred. Restore this precondition
            # (`and self.payment_method is not None`) before any real launch.
        )
