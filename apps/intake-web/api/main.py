from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import math
import os
import random
import re
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from starlette.concurrency import run_in_threadpool

from api.geocode import geocode, places_autocomplete, reverse_geocode
from api import storage
from api.auth import create_access_token, decode_access_token
from api.communications import (
    get_communications_provider,
    inbound_forward_twiml,
    normalize_e164,
    public_request_url,
    redact_phone,
    verify_twilio_signature,
)
from api import config
from api.job_text_parser import MAX_INPUT_LENGTH, PARSER_VERSION, parse_job_text
from api.service_catalog import active_skill_codes, normalize_skill_code
from api import settings as runtime_settings
from api import push as push_service
from api.dispatch import (
    CARD_PAYMENT_METHODS,
    STATUS_ARRIVED,
    STATUS_ASSIGNED,
    STATUS_CANCELLED,
    STATUS_COMPLETED_AUTO_CLOSED,
    STATUS_COMPLETED_CONFIRMED,
    STATUS_COMPLETED_PENDING,
    STATUS_DISPUTED,
    STATUS_EN_ROUTE,
    STATUS_IN_PROGRESS,
    STATUS_NO_SHOW,
    STATUS_PARTNER_REQUESTED,
    STATUS_PENDING_DISPATCH,
    STATUS_SCHEDULED_CONFIRMED,
    STATUS_SCHEDULED_REQUESTED,
    can_customer_cancel,
    can_report_collection,
    can_technician_transition,
    eta_range_from_km,
    haversine_km,
    may_show_live_tracking,
    normalize_payment_method,
    normalize_settlement_payment_method,
    normalize_policy,
    select_candidates,
    to_db_policy,
)
from api.store import (
    aggregate_settlements_by_technician,
    compute_settlement_payment_balance,
    make_store,
)
from api.schema import (
    AccessType,
    CancellationPolicy,
    FinalCharge,
    PaymentMethod,
    Photo,
    PriceQuote,
    ServiceAppointment,
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
    request.scope.setdefault("state", {})["original_path"] = request.scope["path"]
    if request.scope["path"].startswith("/api/"):
        request.scope["path"] = request.scope["path"][4:]
    return await call_next(request)


# Every BFF route in every frontend does `await response.json().catch(() => ({}))`
# and then renders `body.detail`. So any error body that isn't JSON-with-a-detail
# reaches the browser as a blank generic message. These two handlers guarantee the
# shape for the cases FastAPI/Starlette would otherwise answer differently.
@app.exception_handler(RequestValidationError)
async def validation_error_detail(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Default 422 detail is a list of error objects; flatten to one string."""
    fields = [
        f"{'.'.join(str(p) for p in err['loc'][1:]) or 'body'}: {err['msg']}"
        for err in exc.errors()
    ]
    return JSONResponse({"detail": "; ".join(fields)}, status_code=422)


@app.exception_handler(Exception)
async def unhandled_error_detail(request: Request, exc: Exception) -> JSONResponse:
    """Default 500 body is the plain text "Internal Server Error"."""
    error_id = secrets.token_hex(8)
    logger.error(
        "Unhandled request error id=%s method=%s path=%s error_type=%s",
        error_id,
        request.method,
        request.url.path,
        type(exc).__name__,
    )
    return JSONResponse(
        {"detail": "An unexpected error occurred.", "error_id": error_id},
        status_code=500,
    )


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
    # Friendly public reference (docs/JOB-OPERATIONAL-ID-SCOPE.md) — the id
    # clients should show/search on. jobs.id (the UUID) stays internal-only.
    operational_id: str | None = None


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
    # Native clients (no BFF cookie) opt in to also receive a long-lived, rotating
    # refresh token so they don't need to re-login when the access token expires.
    # Web/BFF logins omit this and are unaffected.
    want_refresh_token: bool = False


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    session: dict[str, Any]
    refresh_token: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class RevokeRefreshRequest(BaseModel):
    refresh_token: str


class ManualIntakeRequest(BaseModel):
    customer_name: str | None = None
    customer_phone: str | None = None
    address: str
    source_channel: str | None = None
    access_type: str = "home"
    situation: str = "locked_out"
    urgency: str = "urgent"
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    scheduled_timezone: str | None = None
    notes: str | None = None

    @field_validator("notes")
    @classmethod
    def _cap_notes(cls, value: str | None) -> str | None:
        if value is not None and len(value) > _MAX_DESC:
            raise ValueError(f"Notes exceed {_MAX_DESC} characters")
        return value


class PartnerJobTextParseRequest(BaseModel):
    text: str


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


def _closeout_item_type_payload(payload: CloseoutItemTypePayload) -> dict:
    return {
        "code": _validate_catalog_code(payload.code),
        "label": payload.label.strip(),
        "status": _validate_catalog_status(payload.status),
        "default_taxable": payload.default_taxable,
        "default_compensation_eligible": payload.default_compensation_eligible,
        "default_reimbursement_eligible": payload.default_reimbursement_eligible,
        "requires_provided_by": payload.requires_provided_by,
        "requires_note": payload.requires_note,
        "requires_receipt": payload.requires_receipt,
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


def required_skill_for_job(job: dict[str, Any]) -> str | None:
    access_type = job.get("access_type")
    if not access_type or access_type == "other":
        return None
    return normalize_skill_code(str(access_type))


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


async def validate_active_skill_selection(skills: list[str]) -> list[str]:
    catalog = await store.list_service_catalog(active_only=True)
    catalog_codes = active_skill_codes(catalog)
    normalized = sorted({normalize_skill_code(skill) for skill in skills if skill.strip()})
    unknown = [skill for skill in normalized if skill not in catalog_codes]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid service capability: {', '.join(unknown)}",
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


class ProviderCapabilitiesUpdate(BaseModel):
    skills: list[str]


class AccountUpdateRequest(BaseModel):
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class PasswordResetRequest(BaseModel):
    token: str
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


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^\+?[0-9][0-9\s().\-]{5,19}$")
_POSTAL_RE = re.compile(r"^[A-Z0-9][A-Z0-9 \-]{1,9}$")


def _generate_temporary_password() -> str:
    # Avoid punctuation so the one-time handoff password is easier to read aloud.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(14))


def _console_reset_base_url() -> str:
    return os.environ.get("CONSOLE_RESET_BASE_URL") or os.environ.get("CLUEXP_CONSOLE_BASE_URL") or "https://console.cluexp.com"
def _provider_reset_base_url() -> str:
    return os.environ.get("PROVIDER_RESET_BASE_URL") or os.environ.get("CLUEXP_PROVIDER_BASE_URL") or "https://partners.cluexp.com"
_COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
_MAX_TEXT = 200
_MAX_URL = 500
_MAX_DESC = 2000
_MAX_POSTAL_CODES = 200


def _blank_to_none(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return value


def _require_email(value: str | None) -> str | None:
    if value is None:
        return None
    if len(value) > _MAX_TEXT or not _EMAIL_RE.match(value):
        raise ValueError("Invalid email address")
    return value.lower()


def _require_phone(value: str | None) -> str | None:
    if value is None:
        return None
    if not _PHONE_RE.match(value):
        raise ValueError("Invalid phone number")
    return value


def _require_https_url(value: str | None) -> str | None:
    if value is None:
        return None
    if len(value) > _MAX_URL or not value.lower().startswith("https://"):
        raise ValueError("URL must start with https://")
    return value


def _normalize_postal_list(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    seen: set[str] = set()
    out: list[str] = []
    for raw in value:
        if not isinstance(raw, str):
            raise ValueError("Postal codes must be text")
        code = raw.strip().upper()
        if not code:
            continue
        if not _POSTAL_RE.match(code):
            raise ValueError(f"Invalid postal code: {raw}")
        if code in seen:
            continue
        seen.add(code)
        out.append(code)
    if len(out) > _MAX_POSTAL_CODES:
        raise ValueError(f"At most {_MAX_POSTAL_CODES} postal codes")
    return out


class ProviderCompanyProfileUpdateRequest(BaseModel):
    """Provider-editable company profile. Deliberately excludes operational fields
    (dispatch_mode / fulfillment_policy — set only by ClueXP admins via the console
    admin endpoint) and logo_url (set only via the dedicated logo-upload endpoint).
    Only fields the client actually sends are written (endpoint uses exclude_unset);
    a sent null or blank string clears the column."""

    display_name: str | None = None
    legal_name: str | None = None
    description: str | None = None
    contact_name: str | None = None
    contact_title: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    region: str | None = None
    postal_code: str | None = None
    country_code: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    customer_care_phone: str | None = None
    google_profile_url: str | None = None
    google_review_url: str | None = None
    service_postal_codes: list[str] | None = None
    service_area_center_lat: float | None = None
    service_area_center_lng: float | None = None
    service_area_radius_km: float | None = None

    @field_validator(
        "display_name", "legal_name", "description", "contact_name", "contact_title",
        "contact_email", "contact_phone", "address_line1", "address_line2", "city",
        "region", "postal_code", "country_code", "phone", "email", "website",
        "customer_care_phone", "google_profile_url", "google_review_url",
        mode="before",
    )
    @classmethod
    def _strip_blanks(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @field_validator(
        "display_name", "legal_name", "contact_name", "contact_title",
        "address_line1", "address_line2", "city", "region",
    )
    @classmethod
    def _cap_text(cls, value: str | None) -> str | None:
        if value is not None and len(value) > _MAX_TEXT:
            raise ValueError(f"Value exceeds {_MAX_TEXT} characters")
        return value

    @field_validator("description")
    @classmethod
    def _cap_description(cls, value: str | None) -> str | None:
        if value is not None and len(value) > _MAX_DESC:
            raise ValueError(f"Description exceeds {_MAX_DESC} characters")
        return value

    @field_validator("contact_email", "email")
    @classmethod
    def _check_emails(cls, value: str | None) -> str | None:
        return _require_email(value)

    @field_validator("contact_phone", "phone", "customer_care_phone")
    @classmethod
    def _check_phones(cls, value: str | None) -> str | None:
        return _require_phone(value)

    @field_validator("website", "google_profile_url", "google_review_url")
    @classmethod
    def _check_urls(cls, value: str | None) -> str | None:
        return _require_https_url(value)

    @field_validator("postal_code")
    @classmethod
    def _check_postal(cls, value: str | None) -> str | None:
        if value is None:
            return None
        code = value.strip().upper()
        if not _POSTAL_RE.match(code):
            raise ValueError("Invalid postal code")
        return code

    @field_validator("country_code")
    @classmethod
    def _check_country(cls, value: str | None) -> str | None:
        if value is None:
            return None
        code = value.strip().upper()
        if not _COUNTRY_RE.match(code):
            raise ValueError("country_code must be a 2-letter ISO code")
        return code

    @field_validator("service_postal_codes")
    @classmethod
    def _check_postal_list(cls, value: list[str] | None) -> list[str] | None:
        return _normalize_postal_list(value)

    @field_validator("service_area_center_lat")
    @classmethod
    def _check_lat(cls, value: float | None) -> float | None:
        if value is not None and not -90 <= value <= 90:
            raise ValueError("Latitude out of range")
        return value

    @field_validator("service_area_center_lng")
    @classmethod
    def _check_lng(cls, value: float | None) -> float | None:
        if value is not None and not -180 <= value <= 180:
            raise ValueError("Longitude out of range")
        return value

    @field_validator("service_area_radius_km")
    @classmethod
    def _check_radius(cls, value: float | None) -> float | None:
        if value is not None and not 0 < value <= 500:
            raise ValueError("Radius must be between 0 and 500 km")
        return value


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


class ProviderFinancialSettingsUpdate(BaseModel):
    # Absent = leave unchanged; null = clear the override (revert to platform
    # default); an int = set this org's override. Percentage rates are basis
    # points: 725 = 7.25%.
    max_line_items: int | None = None
    tax_rate_basis_points: int | None = None
    card_fee_basis_points: int | None = None
    card_fee_fixed_cents: int | None = None


class ProviderPhoneSettingsUpdate(BaseModel):
    twilio_number: str | None = None
    primary_forwarding_number: str | None = None
    backup_forwarding_number: str | None = None
    ring_timeout_seconds: int | None = None
    business_hours_behavior: str | None = None
    voicemail_enabled: bool | None = None
    sms_enabled: bool | None = None
    masked_calling_enabled: bool | None = None
    a2p_registered: bool | None = None


class TransactionalSmsRequest(BaseModel):
    job_id: UUID
    purpose: str
    recipient_type: str = "customer"
    client_message_id: str | None = None


class ProviderCrmCustomerUpdate(BaseModel):
    email: str | None = None
    newsletter_status: str | None = None
    warranty_days: int | None = None
    callback_at: datetime | None = None
    follow_up_at: datetime | None = None
    last_contacted_at: datetime | None = None
    notes: str | None = None

    @field_validator("newsletter_status")
    @classmethod
    def validate_newsletter_status(cls, value: str | None) -> str | None:
        if value is not None and value not in {"unknown", "subscribed", "unsubscribed"}:
            raise ValueError("newsletter_status must be unknown, subscribed, or unsubscribed")
        return value

    @field_validator("warranty_days")
    @classmethod
    def validate_warranty_days(cls, value: int | None) -> int | None:
        if value is not None and not 0 <= value <= 3650:
            raise ValueError("warranty_days must be between 0 and 3650")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        value = value.strip().lower() if value else None
        if value and (len(value) > 254 or not re.fullmatch(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+", value)):
            raise ValueError("Enter a valid email address")
        return value

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, value: str | None) -> str | None:
        value = value.strip() if value else None
        if value and len(value) > 4000:
            raise ValueError("notes must be 4000 characters or fewer")
        return value


class ProviderTechnicianAgreementUpdate(BaseModel):
    status: str = "draft"
    effective_from: str | None = None
    effective_until: str | None = None
    default_labor_cut_basis_points: int = 5000
    tip_policy: str = "tech_keeps"
    tip_cut_basis_points: int = 10000
    card_fee_policy: str = "company_pays"
    minimum_payout_cents: int = 0
    flat_job_bonus_cents: int = 0
    service_area_counties: list[str] = []
    service_area_zipcodes: list[str] = []
    service_hours: dict[str, Any] = {}
    rules: dict[str, Any] = {}


class SettlementPeriodCreateRequest(BaseModel):
    label: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    technician_id: UUID | None = None
    note: str | None = None


class SettlementActionRequest(BaseModel):
    note: str | None = None


class SettlementAdjustmentRequest(BaseModel):
    amount_cents: int
    reason: str


class SettlementPaymentCreateRequest(BaseModel):
    technician_id: UUID
    direction: str
    amount_cents: int
    payment_method: str
    paid_on: str | None = None
    reference_number: str | None = None
    note: str | None = None
    settlement_period_id: UUID | None = None
    source_period_start: str | None = None
    source_period_end: str | None = None


class TechnicianPaymentCreateRequest(BaseModel):
    organization_id: UUID
    amount_cents: int
    payment_method: str
    paid_on: str | None = None
    reference_number: str | None = None
    note: str | None = None


class SettlementPaymentReasonRequest(BaseModel):
    reason: str


class CloseoutItemTypePayload(BaseModel):
    code: str
    label: str
    status: str = "active"
    default_taxable: bool = True
    default_compensation_eligible: bool = False
    default_reimbursement_eligible: bool = False
    requires_provided_by: bool = False
    requires_note: bool = False
    requires_receipt: bool = False
    sort_order: int = 100


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


class DeviceRegisterRequest(BaseModel):
    platform: str
    push_token: str
    environment: str = "production"
    app_version: str | None = None
    # Stable per-install device id. When present, token rotation replaces the
    # token on this device instead of registering a second active device.
    installation_id: str | None = None


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


class AdminPasswordResetRequest(BaseModel):
    mode: str
    password: str | None = None


class PlatformAdminCreateRequest(BaseModel):
    display_name: str
    password: str
    email: str | None = None
    phone: str | None = None


class JobStatusUpdateRequest(BaseModel):
    status: str
    # Optional optimistic-concurrency guard: the active-job snapshot version the
    # client acted on. If it no longer matches, the transition is rejected with a
    # structured 409 version_conflict before any mutation or side effect.
    expected_version: str | None = None


class ArrivalVerifyRequest(BaseModel):
    pin: str | None = None
    method: str = "pin"
    reason: str | None = None
    dispatcher_name: str | None = None
    client_mutation_id: str | None = None
    expected_version: str | None = None


class IssueReportRequest(BaseModel):
    kind: str
    reason: str | None = None
    # Optional client-generated idempotency key for offline/native replay. When
    # sent, an exact retry replays the same result; the same key with a different
    # request is a structured 409 conflict.
    client_mutation_id: str | None = None
    # Optional optimistic-concurrency guard: the active-job snapshot version the
    # client acted on. If it no longer matches, the command is rejected with a
    # structured 409 version_conflict before any work or idempotency reservation.
    expected_version: str | None = None


class ArrivalOverrideRequest(BaseModel):
    reason: str


class RecoveryRequest(BaseModel):
    reason: str


class NoteRequest(BaseModel):
    body: str


class JobMessageRequest(BaseModel):
    channel: str = "operations"
    body: str | None = None
    template_code: str | None = None
    template_params: dict[str, Any] | None = None
    client_message_id: str | None = None


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
    amount: float | None = None
    method: str
    line_items: list[dict[str, Any]] | None = None
    tip_amount: float = 0
    no_tax_reason: str | None = None
    # Optional client-generated idempotency key for offline/native replay. When
    # sent, an exact retry replays the same result; the same key with a different
    # normalized closeout request is a structured 409 conflict.
    client_mutation_id: str | None = None
    # Optional optimistic-concurrency guard: the active-job snapshot version the
    # client acted on. If it no longer matches, the command is rejected before
    # closeout/payment writes or idempotency reservation.
    expected_version: str | None = None
    # MVP is USD-only: advisory totals are summed/displayed as a single dollar figure.
    # The field is fixed server-side; a client-supplied value is ignored.

class CancelRequest(BaseModel):
    reason: str | None = None


class RescheduleRequest(BaseModel):
    requested_start: datetime
    requested_end: datetime | None = None
    timezone: str | None = None
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
            # A durable private storage path is sensitive metadata and is not a
            # usable customer URL. Fail closed instead of returning it.
            photo.url = ""
    return TicketEnvelope(
        ticket=response_ticket,
        guards={
            "may_show_technician": ticket.may_show_technician(),
            "may_show_eta": ticket.may_show_eta(),
            "may_show_live_tracking": ticket.may_show_live_tracking(),
        },
        operational_id=await store.get_operational_id(ticket.ticket_id),
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


INTAKE_CAPABILITY_COOKIE = "cluexp_intake_capability"


async def require_intake_ticket(ticket_id: UUID, request: Request) -> Ticket:
    """Authorize public intake reads/mutations with the per-job capability.

    Return the same 404 for a missing job, missing cookie, or wrong cookie so a
    raw UUID never becomes an existence oracle.
    """
    presented = request.cookies.get(INTAKE_CAPABILITY_COOKIE, "")
    expected = await store.get_tracking_token(ticket_id)
    if not presented or not expected or not hmac.compare_digest(presented, expected):
        raise HTTPException(status_code=404, detail="Ticket not found")
    return await require_ticket(ticket_id)


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
        "customer_name",
        "customer_phone",
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
CLIENT_NESTED_FIELDS = {
    "service_appointment": frozenset({
        "requested_start",
        "requested_end",
        "timezone",
        "partner_dispatch_allowed",
    }),
}


def sanitize_client_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only client-editable fields; drop server-owned ones so the browser
    cannot forge trust_state, technician data, charges, or prices."""
    clean: dict[str, Any] = {}
    for key, value in (payload or {}).items():
        if key in CLIENT_FIELDS:
            clean[key] = value
        elif key in CLIENT_NESTED_FIELDS:
            if value is None:
                clean[key] = None
            elif isinstance(value, dict):
                allowed = {k: v for k, v in value.items() if k in CLIENT_NESTED_FIELDS[key]}
                if allowed:
                    clean[key] = allowed
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
    refresh_token = (
        await store.issue_refresh_token(session["user"]["id"])
        if payload.want_refresh_token else None
    )
    return AuthResponse(access_token=token, session=session, refresh_token=refresh_token)


@app.post("/auth/refresh", response_model=AuthResponse)
async def refresh(payload: RefreshRequest) -> AuthResponse:
    """Native session refresh: exchange a refresh token for a new access token
    AND a new refresh token (single-use rotation). The old refresh token is
    consumed by this call and cannot be used again; presenting an already-used
    one revokes the whole chain for that user (theft signal) and 401s."""
    await latency()
    result = await store.rotate_refresh_token(payload.refresh_token)
    if result["state"] in ("invalid", "reused", "expired"):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    session = await store.get_user_session(result["user_id"])
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid session")
    token = create_access_token(
        {
            "sub": session["user"]["id"],
            "roles": session.get("roles", []),
            "org": session.get("active_organization_id"),
        }
    )
    return AuthResponse(access_token=token, session=session, refresh_token=result["token"])


@app.post("/auth/logout")
async def logout(payload: RevokeRefreshRequest) -> dict[str, Any]:
    """Native sign-out: revoke this refresh token so a stolen/lost device can't
    silently keep the session alive. The still-live access token simply expires
    on its own (~24h) — it is not separately revocable by design (stateless JWT)."""
    await latency()
    revoked = await store.revoke_refresh_token(payload.refresh_token)
    return {"revoked": revoked}


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


@app.post("/auth/password/reset")
async def reset_password(payload: PasswordResetRequest) -> dict[str, Any]:
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    claims = decode_access_token(payload.token)
    if not claims or claims.get("purpose") != "password_reset" or not claims.get("sub"):
        raise HTTPException(status_code=422, detail="Reset link is invalid or expired")
    result = await store.set_user_password(UUID(str(claims["sub"])), payload.new_password)
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
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
    # Dispatch policy (dispatch_mode / fulfillment_policy) is set ONLY here by
    # ClueXP admins — providers can't edit it. Validate + map to DB vocabulary.
    if payload.dispatch_mode and payload.dispatch_mode not in {
        "organization_managed", "platform_managed"
    }:
        raise HTTPException(status_code=422, detail="Invalid dispatch mode")
    data = payload.model_dump(exclude_unset=True)
    if payload.fulfillment_policy is not None:
        db_policy = to_db_policy(payload.fulfillment_policy)
        if db_policy is None:
            raise HTTPException(status_code=422, detail="Invalid fulfillment policy")
        data["fulfillment_policy"] = db_policy  # store the canonical DB vocabulary
    result = await store.update_organization_profile(organization_id, data)
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


@app.post("/admin/users/{user_id}/password")
async def admin_reset_user_password(
    user_id: UUID,
    payload: AdminPasswordResetRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    mode = payload.mode.strip()
    if mode not in {"set_temp_password", "generate_temp_password", "reset_link"}:
        raise HTTPException(status_code=422, detail="mode must be set_temp_password, generate_temp_password, or reset_link")

    detail = await store.get_user_admin_detail(user_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="User not found")

    if mode == "reset_link":
        token = create_access_token(
            {"sub": str(user_id), "purpose": "password_reset", "jti": str(uuid4())},
            expires_in=60 * 60 * 24,
        )
        reset_url = f"{_console_reset_base_url().rstrip('/')}/reset-password?token={token}"
        await _record_admin_governance_event(
            session, entity_type="user", entity_id=user_id, action="generate_password_reset_link",
            reason=None, metadata={"expires_in_seconds": 60 * 60 * 24},
        )
        return {
            "mode": mode,
            "reset_url": reset_url,
            "expires_in_seconds": 60 * 60 * 24,
            "user": detail,
        }

    password = payload.password if mode == "set_temp_password" else _generate_temporary_password()
    if not password or len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    result = await store.set_user_password(user_id, password)
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    await _record_admin_governance_event(
        session, entity_type="user", entity_id=user_id,
        action="set_temp_password" if mode == "set_temp_password" else "generate_temp_password",
        reason=None, metadata={"delivery": "manual"},
    )
    response: dict[str, Any] = {"mode": mode, "user": result}
    if mode == "generate_temp_password":
        response["temporary_password"] = password
    return response


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
    except RuntimeError:
        logger.error("provider_document_signing_failed")
        raise HTTPException(status_code=503, detail="Document download is temporarily unavailable")
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
    payload: ProviderCompanyProfileUpdateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Save the provider-editable company profile. provider_admin only. Operational
    fields (dispatch_mode / fulfillment_policy) and logo_url are NOT writable here."""
    require_any_role(session, {"provider_admin"})
    organization_id = _provider_organization_id(session)
    # exclude_unset: only fields the client actually sent are written, so a sent
    # null/blank clears that column while untouched fields are left intact.
    data = payload.model_dump(exclude_unset=True)
    result = await store.update_company_profile(organization_id, data)
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return result


@app.post("/provider/organization/logo")
async def upload_provider_logo(
    file: UploadFile = File(...),
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Upload the organization logo to the public org-media bucket. provider_admin
    only; validates real image bytes, size, and dimensions before storing. The
    resulting URL is saved server-side — clients cannot set logo_url directly."""
    require_any_role(session, {"provider_admin"})
    organization_id = _provider_organization_id(session)
    content = await file.read()
    try:
        mime = storage.validate_logo_upload(content, file.content_type or "")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not storage.storage_configured():
        raise HTTPException(status_code=503, detail="Logo storage is not configured")
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
    path = f"organizations/{organization_id}/logo-{uuid4()}.{ext}"
    try:
        url = await storage.upload_object(storage.ORG_MEDIA_BUCKET, path, content, mime)
    except Exception:
        raise HTTPException(status_code=502, detail="Logo upload failed")
    result = await store.set_organization_logo(organization_id, url)
    if result is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return {"logo_url": url, "message": "Logo uploaded"}


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
            raise HTTPException(
                status_code=409,
                detail=(
                    "This technician holds an exclusive affiliation with another company."
                    if str(exc) == "exclusive_conflict"
                    else "That technician's affiliation just changed — try the invite again."
                ),
            )
        # add_affiliation never rewrites an open period, so a re-invite reports the
        # real state instead of silently demoting an active technician to a pending
        # invite (or resetting a suspension). Re-inviting a pending invite is a no-op.
        if result.get("status") == "active":
            raise HTTPException(
                status_code=409, detail="This technician is already affiliated with your company.",
            )
        if result.get("status") == "suspended":
            raise HTTPException(
                status_code=409,
                detail="This technician's affiliation is suspended. Reactivate it instead of re-inviting.",
            )
        return {
            "mode": "existing_technician",
            "technician_id": existing["id"],
            "display_name": existing.get("display_name"),
            "affiliation": result,
            "already_invited": result.get("created") is False,
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


@app.post("/provider/technicians/{technician_id}/affiliation/reactivate")
async def provider_reactivate_affiliation(
    technician_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Lift a suspension this company placed: the open period goes back to active.
    Tenant-scoped, and the only way back from `suspend` — re-inviting a suspended
    technician is refused rather than silently resetting their affiliation."""
    organization_id = _provider_organization_id(session)
    try:
        result = await store.reactivate_affiliation(organization_id, technician_id)
    except ValueError:
        raise HTTPException(
            status_code=409,
            detail="This technician now holds an exclusive affiliation with another company.",
        )
    if result is None:
        raise HTTPException(status_code=404, detail="No suspended affiliation with this technician")
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


def _agreement_payload(payload: ProviderTechnicianAgreementUpdate) -> dict[str, Any]:
    status = payload.status.strip().lower()
    if status not in {"draft", "active", "paused", "archived"}:
        raise HTTPException(status_code=422, detail="Agreement status must be draft, active, paused, or archived.")
    if not (0 <= payload.default_labor_cut_basis_points <= 10000):
        raise HTTPException(status_code=422, detail="Default cut must be between 0 and 10000 basis points.")
    if payload.tip_policy not in {"tech_keeps", "company_keeps", "split"}:
        raise HTTPException(status_code=422, detail="Invalid tip policy.")
    if not (0 <= payload.tip_cut_basis_points <= 10000):
        raise HTTPException(status_code=422, detail="Tip cut must be between 0 and 10000 basis points.")
    if payload.card_fee_policy not in {"company_pays", "deduct_from_company", "split"}:
        raise HTTPException(status_code=422, detail="Invalid card fee policy.")
    if payload.minimum_payout_cents < 0 or payload.flat_job_bonus_cents < 0:
        raise HTTPException(status_code=422, detail="Payout floors and bonuses must be zero or greater.")
    rules = payload.rules or {}
    for group in ("skill_cuts", "category_cuts"):
        cuts = rules.get(group) or {}
        if not isinstance(cuts, dict):
            raise HTTPException(status_code=422, detail=f"{group} must be an object.")
        for code, bps in cuts.items():
            _validate_catalog_code(str(code))
            if not isinstance(bps, int) or not (0 <= bps <= 10000):
                raise HTTPException(status_code=422, detail=f"{group}.{code} must be 0-10000 basis points.")
    return {
        "status": status,
        "effective_from": payload.effective_from,
        "effective_until": payload.effective_until,
        "default_labor_cut_basis_points": payload.default_labor_cut_basis_points,
        "tip_policy": payload.tip_policy,
        "tip_cut_basis_points": payload.tip_cut_basis_points,
        "card_fee_policy": payload.card_fee_policy,
        "minimum_payout_cents": payload.minimum_payout_cents,
        "flat_job_bonus_cents": payload.flat_job_bonus_cents,
        "service_area_counties": [item.strip() for item in payload.service_area_counties if item.strip()],
        "service_area_zipcodes": [item.strip() for item in payload.service_area_zipcodes if item.strip()],
        "service_hours": payload.service_hours or {},
        "rules": rules,
    }


@app.get("/provider/technicians/{technician_id}/agreement")
async def get_provider_technician_agreement(
    technician_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    organization_id = _provider_organization_id(session)
    agreement = await store.get_provider_technician_agreement(organization_id, technician_id)
    if agreement is None:
        raise HTTPException(status_code=404, detail="Technician is not affiliated with your company")
    return agreement


@app.patch("/provider/technicians/{technician_id}/agreement")
async def update_provider_technician_agreement(
    technician_id: UUID,
    payload: ProviderTechnicianAgreementUpdate,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    organization_id = _provider_organization_id(session)
    agreement = await store.upsert_provider_technician_agreement(
        organization_id,
        technician_id,
        _agreement_payload(payload),
        updated_by=session.get("user", {}).get("id"),
    )
    if agreement is None:
        raise HTTPException(status_code=404, detail="Technician is not affiliated with your company")
    return agreement


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
    except RuntimeError:
        logger.error("provider_document_upload_signing_failed")
        raise HTTPException(status_code=503, detail="Document upload is temporarily unavailable")
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


# --- technician self-service: native push-device registry ---
@app.post("/technicians/me/devices")
async def register_my_device(
    payload: DeviceRegisterRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Register (or refresh) this technician's device push token. Idempotent on
    the token: re-registering rotates it to this technician and refreshes it."""
    tid = _me_technician_id(session)
    platform = payload.platform.strip().lower()
    if platform not in {"ios", "android"}:
        raise HTTPException(status_code=422, detail="platform must be 'ios' or 'android'")
    environment = payload.environment.strip().lower()
    if environment not in {"development", "production"}:
        raise HTTPException(status_code=422, detail="environment must be 'development' or 'production'")
    if not payload.push_token.strip():
        raise HTTPException(status_code=422, detail="push_token is required")
    installation_id = (payload.installation_id or "").strip() or None
    return await store.register_technician_device(
        tid, platform=platform, push_token=payload.push_token.strip(),
        environment=environment, app_version=payload.app_version,
        installation_id=installation_id,
    )


@app.get("/technicians/me/devices")
async def list_my_devices(session: dict[str, Any] = Depends(require_session)) -> dict[str, Any]:
    tid = _me_technician_id(session)
    return {"devices": await store.list_technician_devices(tid)}


@app.delete("/technicians/me/devices/{device_id}")
async def revoke_my_device(
    device_id: UUID, session: dict[str, Any] = Depends(require_session)
) -> dict[str, Any]:
    tid = _me_technician_id(session)
    result = await store.revoke_technician_device(tid, device_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return result


@app.get("/technicians/me/readiness")
async def my_readiness(session: dict[str, Any] = Depends(require_session)) -> dict[str, Any]:
    """One composed 'can I take work right now' snapshot for the native app:
    account/approval, location freshness, active-job (busy) and push-device state.
    Every field is server-derived truth; `connection` is deliberately absent —
    only the device knows its own connectivity, so we never guess it here."""
    tid = _me_technician_id(session)
    tech = session.get("technician") or {}
    now_dt = datetime.now(tz=timezone.utc)
    threshold = timedelta(minutes=config.LOCATION_ONLINE_THRESHOLD_MINUTES)
    loc_updated = tech.get("location_updated_at")
    if loc_updated and not isinstance(loc_updated, datetime):
        loc_updated = datetime.fromisoformat(str(loc_updated).replace("Z", "+00:00"))
    location_fresh = bool(loc_updated and (now_dt - loc_updated) < threshold)
    active_job = await store.get_technician_active_job(tid)
    devices = await store.list_technician_devices(tid)
    approved = bool(tech.get("approved"))
    available = bool(tech.get("is_available"))

    blocking: list[str] = []
    if not approved:
        blocking.append("not_approved")
    if not available:
        blocking.append("unavailable")
    if not location_fresh:
        blocking.append("location_stale")
    if active_job is not None:
        blocking.append("busy")
    if not devices:
        # No registered push device: the tech can't be reliably reached with an
        # offer, so they are not offer-ready even if everything else passes.
        blocking.append("push_not_ready")

    return {
        "can_receive_offers": not blocking,
        "blocking_reasons": blocking,
        "account": {
            "status": tech.get("status"),
            "vetting_status": tech.get("vetting_status"),
            "approved": approved,
            "available": available,
        },
        "location": {
            "fresh": location_fresh,
            "updated_at": loc_updated.isoformat() if loc_updated else None,
            "threshold_minutes": config.LOCATION_ONLINE_THRESHOLD_MINUTES,
        },
        "active_job": {
            "busy": active_job is not None,
            "id": active_job.get("id") if active_job else None,
            "status": active_job.get("status") if active_job else None,
        },
        "push": {
            "registered_devices": len(devices),
            "push_ready": bool(devices),
        },
    }


@app.get("/technicians/me/active-job/snapshot")
async def my_active_job_snapshot(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Versioned snapshot of the signed-in technician's current active job for the
    native client. Read-only and self-scoped (only ever this technician's own
    job). `version` is an ETag over the job lifecycle marker — see `_job_version`; the
    client echoes it back as `expected_version` on lifecycle-scoped commands.
    When idle, returns {active_job: null}, mirroring get_technician_active_job.
    Only context the assigned technician already receives is exposed (no org ids
    or other tenant-internal fields)."""
    tid = _me_technician_id(session)
    job = await store.get_technician_active_job(tid)
    if job is None:
        return {"active_job": None, "version": None, "allowed_actions": []}
    status = job.get("status")
    return {
        "active_job": {
            "id": job["id"],
            "operational_id": job.get("operational_id"),
            "status": status,
            "access_type": job.get("access_type"),
            "situation": job.get("situation"),
            "address": job.get("address"),
            "lat": job.get("lat"),
            "lng": job.get("lng"),
            "detail": job.get("detail"),
            "distance_km": job.get("distance_km"),
            "distance_mi": job.get("distance_mi"),
            "eta_min": job.get("eta_min"),
            "eta_max": job.get("eta_max"),
            "eta_is_estimate": job.get("eta_is_estimate"),
            "location_requirements": {
                "location_is_fresh": job.get("technician_location_is_fresh"),
                "location_updated_at": job.get("technician_location_updated_at"),
            },
        },
        "version": _job_version(job["id"], status, job.get("lifecycle_version")),
        "allowed_actions": _allowed_active_job_actions(status),
    }


@app.get("/technicians/me/notifications")
async def my_notifications(
    unacknowledged_only: bool = False,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Self-scoped notification history for the native client. `provider_status`
    is honest about delivery: 'sent'/'failed' once Expo answers (with
    `provider_ticket_id` / `provider_error_code`), and 'skipped_no_provider'
    while no push provider is configured — see api/push.py."""
    tid = _me_technician_id(session)
    return {
        "notifications": await store.list_technician_notifications(
            tid, unacknowledged_only=unacknowledged_only)
    }


@app.post("/technicians/me/notifications/{notification_id}/ack")
async def acknowledge_notification(
    notification_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Explicit acknowledgement — the one first-class client signal in the
    ADR-0001 SS6 delivery model besides provider receipt. Idempotent: acking an
    already-acked notification just returns it unchanged."""
    tid = _me_technician_id(session)
    result = await store.acknowledge_technician_notification(tid, notification_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Notification not found")
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


@app.post("/technicians/me/affiliations/{affiliation_id}/leave")
async def leave_my_affiliation(
    affiliation_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Leave a company. Closes the technician's OWN active or suspended affiliation
    period (`status='ended'`, reason `technician_left`) so history is preserved and a
    later rejoin starts a new period. Self-scoped: another technician's affiliation is
    a 404. A pending invite is declined, not left."""
    tid = _me_technician_id(session)
    try:
        result = await store.leave_affiliation(affiliation_id, tid)
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail=(
                "This is a pending invite — decline it instead of leaving."
                if str(exc) == "pending_invite"
                else "This affiliation is already ended."
            ),
        )
    if result is None:
        raise HTTPException(status_code=404, detail="Affiliation not found")
    return {"affiliation": result, "message": "You have left this company"}


@app.post("/technicians/me/photo")
async def upload_my_photo(
    file: UploadFile = File(...), session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Upload a profile headshot to the public technician-media bucket. Self-service
    photos are auto-approved for now (a real Ops/admin review workflow is deferred;
    the /admin/technicians/*/photo routes remain for that later work)."""
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
    except Exception:
        logger.error("technician_document_upload_failed")
        raise HTTPException(status_code=502, detail="Document upload failed")

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


@app.get("/reverse-geocode")
async def reverse_geocode_coordinates(lat: float, lng: float) -> dict[str, Any]:
    """Resolve browser GPS coordinates to a dispatch-friendly address label."""
    await latency()
    result = await reverse_geocode(lat, lng)
    if result is None:
        return {"resolved": False}
    return {"resolved": True, "lat": lat, "lng": lng, **result}


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
    org_id = origin.get("customer_owner_org_id") or origin.get("origin_org_id")
    show_estimate = True
    if org_id:
        show_estimate = bool(await runtime_settings.resolve_org(store, str(org_id), "intake_show_estimate"))
    return {
        "slug": slug,
        "organization_name": origin.get("organization_name"),
        "dispatch_phone": origin.get("dispatch_phone"),
        "show_estimate": show_estimate,
    }


async def _create_alert_best_effort(
    organization_id: str | None,
    *,
    alert_type: str,
    severity: str,
    job_id: UUID,
    payload: dict[str, Any] | None = None,
    log_name: str = "alert_create_failed",
) -> None:
    if not organization_id:
        return
    try:
        await store.create_alert(
            str(organization_id),
            alert_type=alert_type,
            severity=severity,
            job_id=job_id,
            payload=payload or {},
        )
    except Exception:
        logger.exception(log_name, extra={"job_id": str(job_id), "alert_type": alert_type})


@app.post("/tickets", response_model=TicketEnvelope)
async def create_ticket(response: Response, payload: dict[str, Any] | None = None) -> TicketEnvelope:
    await latency()
    # Trusted intake-channel resolution (SYSTEM-DESIGN §20.4): the browser supplies only a channel
    # slug (attribution, dropped by sanitize); the owning org is resolved server-side and
    # is never trusted from the client. Absent/unknown slug is rejected: ClueXP is
    # a SaaS platform, not the dispatching provider.
    raw_slug = (payload or {}).get("intake_channel")
    origin = await store.resolve_intake_channel(raw_slug if isinstance(raw_slug, str) else None)
    if origin is None:
        raise HTTPException(
            status_code=403,
            detail="Intake must be opened from a provider company link.",
        )
    ticket = Ticket.model_validate(sanitize_client_payload(payload))
    await save(ticket, origin)
    await log_transition(ticket, "created")
    env = await envelope(ticket)
    capability = await store.get_tracking_token(ticket.ticket_id)
    if not capability:
        raise HTTPException(status_code=503, detail="Could not secure the intake session")
    response.set_cookie(
        INTAKE_CAPABILITY_COOKIE,
        capability,
        httponly=True,
        secure=config.IS_PRODUCTION,
        samesite="strict",
        max_age=12 * 60 * 60,
        path="/",
    )

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
        await _create_alert_best_effort(
            origin.get("customer_owner_org_id") or origin.get("origin_org_id"),
            alert_type="new_job",
            severity="info",
            job_id=ticket.ticket_id,
            payload={"source": "branded_intake"},
            log_name="alert_new_job_failed",
        )
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
    try:
        geocoded = await geocode(payload.address)
    except Exception:
        logger.exception("Provider manual request geocoding failed")
        geocoded = None
    location = (
        {
            "raw_text": geocoded.get("formatted_address") or payload.address,
            "lat": geocoded.get("lat"),
            "lng": geocoded.get("lng"),
            "geocode_confidence": geocoded.get("geocode_confidence") or "low",
        }
        if geocoded and geocoded.get("lat") is not None and geocoded.get("lng") is not None
        else {"raw_text": payload.address, "geocode_confidence": "none"}
    )
    ticket = Ticket(
        channel="voice",
        status=TicketStatus.PARTIAL,
        access_type=_enum_or_default(AccessType, payload.access_type, AccessType.HOME),
        situation=_enum_or_default(Situation, payload.situation, Situation.LOCKED_OUT),
        urgency=_enum_or_default(Urgency, payload.urgency, Urgency.URGENT),
        location=location,
        additional_details=payload.notes,
    )
    if ticket.urgency == Urgency.SCHEDULED:
        if payload.scheduled_start is None:
            raise HTTPException(status_code=409, detail="Scheduled start is required")
        requested_end = payload.scheduled_end or (payload.scheduled_start + timedelta(hours=1))
        if requested_end <= payload.scheduled_start:
            raise HTTPException(status_code=409, detail="Scheduled end must be after scheduled start")
        ticket.service_appointment = ServiceAppointment(
            requested_start=payload.scheduled_start,
            requested_end=requested_end,
            timezone=(payload.scheduled_timezone or "America/New_York"),
            status="requested",
            partner_dispatch_allowed=True,
        )
    origin = _manual_origin(session, payload)
    await save(ticket, origin)
    # Provider call-center intake is already inside the dispatch surface. Once
    # the authenticated dispatcher creates it, immediate jobs appear in the
    # provider queue for assignment. Scheduled jobs wait for confirmation and
    # activation before any technician offer is created.
    if ticket.urgency == Urgency.SCHEDULED:
        await store.set_job_status(ticket.ticket_id, STATUS_SCHEDULED_REQUESTED)
        await _record_customer_system_message(
            ticket.ticket_id,
            body=(
                "Your appointment request was recorded for "
                f"{_format_appointment_window(ticket.service_appointment)}. "
                "The provider will confirm the window before assigning a technician."
            ),
            event="schedule_requested",
            organization_id=origin.get("origin_org_id"),
        )
    else:
        await store.set_job_status(ticket.ticket_id, "pending_dispatch")
        await _create_alert_best_effort(
            origin.get("origin_org_id") or origin.get("customer_owner_org_id"),
            alert_type="new_job",
            severity="info",
            job_id=ticket.ticket_id,
            payload={"source": payload.source_channel or "manual"},
            log_name="alert_new_job_failed",
        )
    source = payload.source_channel or "manual"
    await log_transition(ticket, f"manual_intake_created:{source}")
    return await envelope(ticket)


@app.post("/provider/jobs/parse-text")
async def parse_provider_job_text(
    payload: PartnerJobTextParseRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    await latency()
    require_any_role(session, {"provider_admin", "dispatcher"})
    org_id = _require_dispatch_org(session)
    text = payload.text
    if not text or not text.strip():
        raise HTTPException(status_code=422, detail="Pasted job text is required.")
    if len(text) > MAX_INPUT_LENGTH:
        raise HTTPException(status_code=413, detail=f"Pasted job text must be {MAX_INPUT_LENGTH} characters or fewer.")
    started = time.perf_counter()
    try:
        result = parse_job_text(text)
    except Exception:
        logger.exception("Partner job text parser failed")
        raise HTTPException(status_code=500, detail="Could not parse pasted job text.")
    logger.info(
        "partner_job_text_parse",
        extra={
            "parser_version": PARSER_VERSION,
            "detected_source": result.get("detectedSource"),
            "warning_count": len(result.get("warnings") or []),
            "conflict_count": len(result.get("conflicts") or []),
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            "partner_organization_id": org_id,
            "user_id": session.get("user", {}).get("id"),
        },
    )
    return {"success": True, "result": result}


@app.get("/tickets/{ticket_id}", response_model=TicketEnvelope)
async def get_ticket(ticket_id: UUID, request: Request) -> TicketEnvelope:
    await latency()
    return await envelope(await require_intake_ticket(ticket_id, request))


@app.patch("/tickets/{ticket_id}", response_model=TicketEnvelope)
async def patch_ticket(ticket_id: UUID, payload: dict[str, Any], request: Request) -> TicketEnvelope:
    await latency()
    ticket = await require_intake_ticket(ticket_id, request)
    merged = deep_merge(ticket.model_dump(mode="python"), sanitize_client_payload(payload))
    updated = Ticket.model_validate(merged)
    await save(updated)
    await log_transition(updated, "patched")
    return await envelope(updated)


@app.post("/tickets/{ticket_id}/photo-intent", response_model=PhotoIntentResponse)
async def photo_intent(
    ticket_id: UUID, payload: PhotoIntentRequest, request: Request
) -> PhotoIntentResponse:
    await latency()
    await require_intake_ticket(ticket_id, request)
    try:
        storage.validate_upload_claim(payload.content_type, payload.size)
        ext = _extension_for_content_type(payload.content_type)
        path = f"tickets/{ticket_id}/{uuid4()}{ext}"
        intent = await storage.create_signed_upload_url(storage.PRIVATE_BUCKET, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError:
        logger.error("intake_photo_upload_signing_failed")
        raise HTTPException(status_code=503, detail="Photo upload is temporarily unavailable")
    return PhotoIntentResponse(
        bucket=intent.bucket,
        path=intent.path,
        upload_url=intent.upload_url,
        token=intent.token,
        expires_in=intent.expires_in,
        max_bytes=storage.MAX_UPLOAD_BYTES,
    )


@app.post("/tickets/{ticket_id}/photo-complete", response_model=TicketEnvelope)
async def photo_complete(
    ticket_id: UUID, payload: PhotoCompleteRequest, request: Request
) -> TicketEnvelope:
    await latency()
    ticket = await require_intake_ticket(ticket_id, request)
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


async def _intake_show_estimate_for_ticket(ticket_id: UUID) -> bool:
    lifecycle = await store.get_job_lifecycle(ticket_id)
    org_id = (lifecycle or {}).get("customer_owner_org_id") or (lifecycle or {}).get("origin_org_id")
    if not org_id:
        return True
    return bool(await runtime_settings.resolve_org(store, str(org_id), "intake_show_estimate"))


@app.post("/tickets/{ticket_id}/price-quote", response_model=TicketEnvelope)
async def price_quote(ticket_id: UUID, request: Request) -> TicketEnvelope:
    await latency()
    ticket = await require_intake_ticket(ticket_id, request)
    if not await _intake_show_estimate_for_ticket(ticket_id):
        raise HTTPException(status_code=409, detail="Estimate step is disabled for this provider")
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
async def payment_method(
    ticket_id: UUID, payload: dict[str, Any], request: Request
) -> TicketEnvelope:
    await latency()
    token = str(payload.get("token", ""))
    if not token.startswith("tok_"):
        raise HTTPException(status_code=400, detail="Invalid processor token")
    ticket = await require_intake_ticket(ticket_id, request)
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
async def commit(ticket_id: UUID, request: Request) -> TicketEnvelope:
    await latency()
    ticket = await require_intake_ticket(ticket_id, request)
    # Sprint 1: payment-on-file is deferred, so price acceptance is the sole
    # commercial-consent gate. Restore the payment-method check before launch.
    estimate_required = await _intake_show_estimate_for_ticket(ticket_id)
    price_accepted = ticket.price_quote is not None and ticket.price_quote.accepted_by_customer
    terms_accepted = (
        ticket.cancellation_policy is not None
        and ticket.cancellation_policy.accepted_by_customer
    )
    if estimate_required and not price_accepted:
        raise HTTPException(status_code=409, detail="Price acceptance required")
    if not estimate_required and not terms_accepted:
        raise HTTPException(status_code=409, detail="Request terms acceptance required")
    if ticket.urgency == Urgency.SCHEDULED:
        if ticket.service_appointment is None or ticket.service_appointment.requested_start is None:
            raise HTTPException(status_code=409, detail="Requested appointment window required")
        ticket.service_appointment.status = "requested"
        await save(ticket)
        await store.set_job_status(ticket_id, STATUS_SCHEDULED_REQUESTED)
        await _record_customer_system_message(
            ticket_id,
            body=(
                "Your appointment request was received for "
                f"{_format_appointment_window(ticket.service_appointment)}. "
                "The provider will confirm the window before assigning a technician."
            ),
            event="schedule_requested",
        )
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
async def send_otp(ticket_id: UUID, request: Request) -> dict[str, str]:
    await latency()
    await require_intake_ticket(ticket_id, request)
    code = str(random.randint(100000, 999999))
    otp_codes[ticket_id] = code
    return {"dev_code": code, "message": "Code sent"}


@app.post("/tickets/{ticket_id}/otp/verify", response_model=TicketEnvelope)
async def verify_otp(
    ticket_id: UUID, payload: dict[str, Any], request: Request
) -> TicketEnvelope:
    await latency()
    ticket = await require_intake_ticket(ticket_id, request)
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


async def _evaluate_dispatch_alerts() -> dict[str, int]:
    """Alert (0054): stalled_job / stuck_offer are threshold-based, so they need
    the sweep (unlike new_job/safety_flag/customer_help_request/delivery_failure,
    which fire inline at their own mutation). Reuses the dispatch queue's own
    scan (get_ops_queue) instead of a second job-table query.

    ponytail: no separate offer-age field to key stuck_offer off of, so both
    checks use the job's created_at age against the same org-configured
    stalled_minutes threshold. Upgrade to a real offer-accepted-at timestamp
    if stuck_offer needs its own SLA distinct from stalled_job.
    """
    counts = {"stalled_job": 0, "stuck_offer": 0}
    jobs = await store.get_ops_queue(org_id=None)
    now_dt = datetime.now(tz=timezone.utc)
    settings_cache: dict[str, int] = {}
    for job in jobs:
        # Scheduled/partner rows also appear in the provider queue, but their
        # age is not a dispatch-stall signal. Alert only on immediate jobs that
        # are actually waiting in the dispatch ladder.
        if job.get("status") != "pending_dispatch":
            continue
        org_id = job.get("fulfillment_org_id") or job.get("customer_owner_org_id")
        if not org_id:
            continue
        org_id = str(org_id)
        created_at = job.get("created_at")
        if not created_at:
            continue
        if isinstance(created_at, str):
            try:
                created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError:
                continue
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age_minutes = (now_dt - created_at).total_seconds() / 60
        if org_id not in settings_cache:
            override = await store.get_organization_setting(org_id, "dispatch_stalled_minutes")
            platform_default = await runtime_settings.resolve(store, "dispatch_stalled_minutes")
            settings_cache[org_id] = int(override["value"]) if override else int(platform_default)
        threshold = settings_cache[org_id]
        if age_minutes < threshold:
            continue
        alert_type = "stuck_offer" if job.get("offer_active") else "stalled_job"
        try:
            await store.create_alert(
                org_id, alert_type=alert_type, severity="warning", job_id=UUID(str(job["id"])),
                payload={"age_minutes": int(age_minutes), "status": job.get("status")},
            )
            counts[alert_type] += 1
        except Exception:
            logger.exception("alert_dispatch_sweep_failed", extra={"job_id": job.get("id"), "alert_type": alert_type})
    return counts


@app.api_route("/cron/dispatch-sweep", methods=["GET", "POST"])
async def dispatch_sweep(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Cleanup-only sweep — no re-dispatch. Secret-protected via
    ``Authorization: Bearer ${CRON_SECRET}``. Expires stale offers (returning
    affected jobs to pending_dispatch), auto-closes unconfirmed jobs, and signs
    off technicians whose presence heartbeat has gone stale. The offer/job
    cleanup also runs inline on GET /ops/queue; this cron is a safety net."""
    if not config.CRON_SECRET:
        raise HTTPException(status_code=503, detail="Sweep disabled: CRON_SECRET unset")
    presented = authorization.split(" ", 1)[1].strip() if (
        authorization and authorization.lower().startswith("bearer ")
    ) else ""
    if not hmac.compare_digest(presented, config.CRON_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")
    expired = await store.expire_stale_offers()
    auto_closed = await store.auto_close_pending(config.AUTO_CLOSE_WINDOW_SECONDS)
    stale_hours = await runtime_settings.resolve(store, "technician_stale_hours")
    signed_off = await store.reap_stale_technicians(stale_hours=int(stale_hours))
    activated_scheduled = await store.activate_due_scheduled_jobs()
    for row in activated_scheduled:
        org_id = row.get("fulfillment_org_id") or row.get("customer_owner_org_id")
        try:
            await _offer_activated_scheduled_reservation(
                job_id=UUID(str(row["id"])),
                job=None,
                reservation=row.get("reservation"),
                org_id=str(org_id) if org_id else None,
                session={"user": {"id": "system:dispatch-sweep"}},
                source="auto",
            )
        except Exception:
            logger.exception("scheduled_activation_reserved_offer_failed", extra={"job_id": row.get("id")})
        try:
            await _record_customer_system_message(
                UUID(str(row["id"])),
                body="Your scheduled appointment is now being dispatched. The provider is selecting an available technician.",
                event="schedule_activated",
                organization_id=org_id,
            )
        except Exception:
            logger.exception("scheduled_activation_customer_message_failed", extra={"job_id": row.get("id")})
    # Push delivery event 2: resolve outstanding provider receipts and retire
    # permanently dead device tokens. No-op without a configured provider.
    try:
        receipts = await push_service.poll_push_receipts(store)
    except Exception:
        logger.exception("push_receipt_sweep_failed")
        receipts = {"checked": 0, "delivered": 0, "failed": 0, "devices_deactivated": 0}
    try:
        alert_counts = await _evaluate_dispatch_alerts()
    except Exception:
        logger.exception("dispatch_alert_sweep_failed")
        alert_counts = {"stalled_job": 0, "stuck_offer": 0}
    return {
        "expired_offers": expired,
        "auto_closed": auto_closed,
        "activated_scheduled": len(activated_scheduled),
        "signed_off_technicians": len(signed_off),
        "push_receipts": receipts,
        "alerts": alert_counts,
    }


class OpsAssignPayload(BaseModel):
    technician_id: UUID
    override_reason: str | None = None


class ConfirmSchedulePayload(BaseModel):
    note: str | None = None


class PartnerDispatchRequestPayload(BaseModel):
    partner_org_id: UUID
    note: str | None = None


class OrganizationPartnershipRequestPayload(BaseModel):
    partner_org_id: UUID
    note: str | None = None


class DeclineOfferPayload(BaseModel):
    reason: str | None = None


# --- shared dispatch core (used by both platform /ops/* and company /provider/*) ---

def _job_belongs_to_org(job: dict[str, Any], org_id: str | None) -> bool:
    """Tenant test for a job, matching the dispatch queue's own scoping
    (`customer_owner_org_id` or `fulfillment_org_id`). `org_id=None` is the ops
    viewer — platform oversight sees every job."""
    if org_id is None:
        return True
    return str(org_id) in {
        str(job.get("customer_owner_org_id") or ""), str(job.get("fulfillment_org_id") or ""),
    }


async def _enriched_candidates(
    job: dict[str, Any], techs: list[dict[str, Any]], viewer_org_id: str | None,
) -> list[dict[str, Any]]:
    """Annotate a technician pool with advisory signals for a job and sort
    nearest-first (unknown distance last), rating as tie-breaker.

    `is_busy` is global — a technician shared with another company is busy no matter
    whose job it is — but the `active_job` detail is masked unless the job belongs to
    `viewer_org_id`, so a dispatcher never reads another company's customer address
    off their own candidate list."""
    now_dt = datetime.now(tz=timezone.utc)
    threshold = timedelta(minutes=config.LOCATION_ONLINE_THRESHOLD_MINUTES)
    access_type = job.get("access_type")
    skill_needed = required_skill_for_job(job)
    owner_org_id = job.get("customer_owner_org_id") or job.get("origin_org_id") or job.get("fulfillment_org_id")
    org_capabilities = (
        set(await store.list_organization_capabilities(str(owner_org_id)))
        if owner_org_id and skill_needed
        else set()
    )
    organization_supports_skill = skill_needed is None or not owner_org_id or skill_needed in org_capabilities
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
        own_active_job = active_job if _job_belongs_to_org(active_job or {}, viewer_org_id) else None
        skills = tech.get("skills") or []
        technician_supports_skill = (skill_needed in skills or access_type in skills) if skill_needed else True
        radius = tech.get("service_area_radius_km")
        within_service_area = dist is None or radius is None or radius <= 0 or dist <= float(radius)
        enriched.append({
            "id": tech["id"],
            "display_name": tech.get("display_name"),
            "skills": skills,
            "required_skill": skill_needed,
            "organization_supports_skill": organization_supports_skill,
            "technician_supports_skill": technician_supports_skill,
            "skills_match": organization_supports_skill and technician_supports_skill,
            "dist_km": round(dist, 2) if dist is not None else None,
            "distance_km": round(dist, 2) if dist is not None else None,
            "distance_mi": round(dist * 0.621371, 2) if dist is not None else None,
            "eta_min": eta_min,
            "eta_max": eta_max,
            "is_available": bool(tech.get("is_available")),
            "is_online": is_online,
            "is_busy": active_job is not None,
            "within_service_area": within_service_area,
            "rating": tech.get("rating"),
            "active_job": {
                "id": own_active_job["id"],
                "operational_id": own_active_job.get("operational_id"),
                "status": own_active_job.get("status"),
                "address": own_active_job.get("address"),
                "lat": own_active_job.get("lat"),
                "lng": own_active_job.get("lng"),
            } if own_active_job else None,
            "current_lat": tech.get("current_lat"),
            "current_lng": tech.get("current_lng"),
            "service_area_center_lat": tech.get("service_area_center_lat"),
            "service_area_center_lng": tech.get("service_area_center_lng"),
            "service_area_radius_km": radius,
        })
    enriched.sort(key=lambda c: (
        c["dist_km"] is None,
        c["dist_km"] if c["dist_km"] is not None else 0.0,
        -(c.get("rating") or 0.0),
    ))
    return enriched


async def _attach_queue_photo_urls(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach signed intake photo URLs for dispatch views when storage is online."""
    for row in rows:
        urls: list[str] = []
        for path in row.get("photo_paths") or []:
            if not isinstance(path, str):
                continue
            if path.startswith(("http://", "https://")):
                urls.append(path)
                continue
            try:
                urls.append(await storage.create_signed_download_url(storage.PRIVATE_BUCKET, path))
            except RuntimeError:
                pass
        row["photo_urls"] = urls
    return rows


def _scheduled_reservation_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        candidate for candidate in candidates
        if candidate.get("is_available")
        and not candidate.get("is_busy")
        and candidate.get("skills_match")
        and candidate.get("within_service_area")
    ]


async def _signed_photo_urls(paths: list[Any]) -> list[str]:
    urls: list[str] = []
    for path in paths:
        if not isinstance(path, str):
            continue
        if path.startswith(("http://", "https://")):
            urls.append(path)
            continue
        try:
            urls.append(await storage.create_signed_download_url(storage.PRIVATE_BUCKET, path))
        except RuntimeError:
            pass
    return urls


def _mask_customer_service_appointment(payload: dict[str, Any]) -> None:
    appointment = payload.get("service_appointment")
    if isinstance(appointment, dict):
        appointment.pop("reserved_technician_id", None)
        appointment.pop("reservation_id", None)
        if appointment.get("status") == "technician_reserved":
            appointment["status"] = "confirmed_unassigned"


def _closeout_collection_items(closeout: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not closeout:
        return []
    items: list[dict[str, Any]] = []
    for item in closeout.get("line_items") or []:
        if not isinstance(item, dict):
            continue
        cents = item.get("line_total_cents")
        amount = round(float(cents) / 100, 2) if cents is not None else None
        items.append({
            "description": item.get("description") or item.get("item_type_code") or "Service item",
            "amount": amount,
            "provided_by": item.get("provided_by"),
            "quantity": item.get("quantity"),
            "taxable": item.get("taxable"),
        })
    return items


async def _send_targeted_offer(
    *, job: dict[str, Any], job_id: UUID, technician_id: UUID, tech: dict[str, Any],
    override_reason: str | None, session: dict[str, Any], audit_prefix: str,
    dispatch_org_id: str | None,
) -> dict[str, Any]:
    """Advisory-flag check + single-offer creation + audit. Raises HTTPException on
    override-required (422) or job/offer conflict (409).

    `dispatch_org_id` is the company doing the dispatching and is what the offer is
    stamped with — never the technician's denormalized `primary_organization_id`, which
    for a technician affiliated with two companies books company B's offer to company A.
    Provider dispatch passes its own org; a platform-managed path (ClueXP Direct, not
    shipped — Ops has no assign mutation) would pass None for an unowned offer."""
    now_dt = datetime.now(tz=timezone.utc)
    threshold = timedelta(minutes=config.LOCATION_ONLINE_THRESHOLD_MINUTES)
    loc_updated = tech.get("location_updated_at")
    if loc_updated and not isinstance(loc_updated, datetime):
        loc_updated = datetime.fromisoformat(str(loc_updated).replace("Z", "+00:00"))
    is_online = bool(loc_updated and (now_dt - loc_updated) < threshold) if loc_updated else False
    is_busy = (await store.get_technician_active_job(tech["id"])) is not None
    if is_busy:
        # P0 global capacity: the immediate-offer path never overrides busy, with
        # or without a reason. Creating a doomed offer against a technician who is
        # already provably busy elsewhere is misleading (looks like an assignment
        # succeeded) and wastes the offer TTL; the atomic accept-time guard would
        # reject it anyway, but rejecting at creation gives the dispatcher an
        # honest, immediate signal instead of a silently-stuck offer.
        raise HTTPException(
            status_code=409,
            detail="Technician already has an active job. Wait for it to finish or "
                    "choose another technician.",
        )
    skills = tech.get("skills") or []
    access_type = job.get("access_type")
    skill_needed = required_skill_for_job(job)
    owner_org_id = job.get("customer_owner_org_id") or job.get("origin_org_id") or job.get("fulfillment_org_id")
    org_capabilities = (
        set(await store.list_organization_capabilities(str(owner_org_id)))
        if owner_org_id and skill_needed
        else set()
    )
    organization_supports_skill = skill_needed is None or not owner_org_id or skill_needed in org_capabilities
    technician_supports_skill = (skill_needed in skills or access_type in skills) if skill_needed else True
    skills_match = organization_supports_skill and technician_supports_skill
    override_flags: list[str] = []
    if not is_online:
        override_flags.append("offline or location stale")
    if not skills_match:
        if not organization_supports_skill:
            override_flags.append(f"company does not offer '{skill_needed}'")
        elif not technician_supports_skill:
            override_flags.append(f"skill mismatch (job needs '{skill_needed}')")
    if override_flags and not override_reason:
        raise HTTPException(
            status_code=422,
            detail=f"Override required: technician {', '.join(override_flags)}. "
                   f"Supply override_reason to proceed.",
        )
    org_id = UUID(dispatch_org_id) if dispatch_org_id else None
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
    # Alert (0054): new_job is created when a job first enters pending_dispatch.
    # This duplicate-safe fallback covers older/manual paths that might have
    # sent an offer before the queue-entry alert existed.
    if dispatch_org_id:
        await _create_alert_best_effort(
            dispatch_org_id,
            alert_type="new_job",
            severity="info",
            job_id=job_id,
            payload={"offer_id": offer.get("id"), "source": "offer_fallback"},
            log_name="alert_new_job_failed",
        )
    # Best-effort: a new offer is exactly ADR-0001 §6's "critical alert" class.
    # Never let a push failure block a real offer — notify_technician already
    # swallows per-device send errors; this guards the store call itself too.
    try:
        await push_service.notify_technician(
            store, technician_id, alert_class="offer",
            envelope={
                "title": "New job offer",
                "body": "A new job offer is available. Tap to review before it expires.",
                # Drives the native incoming-offer countdown/alarm; the server
                # timer stays authoritative — the client only mirrors it.
                "expires_at": expires_at.isoformat(),
            },
            job_id=job_id, offer_id=UUID(offer["id"]) if offer.get("id") else None,
        )
    except Exception:
        pass
    return {
        "offer_id": offer.get("id"),
        "technician_id": str(technician_id),
        "expires_at": expires_at.isoformat(),
    }


async def _offer_activated_scheduled_reservation(
    *,
    job_id: UUID,
    job: dict[str, Any] | None,
    reservation: dict[str, Any] | None,
    org_id: str | None,
    session: dict[str, Any],
    source: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """Convert a legacy/accepted held reservation through the normal offer path.

    Both manual and cron activation use this helper so scheduled jobs cannot skip
    the technician offer. New window confirmations remain unassigned until a real
    future-reservation offer/acceptance flow is implemented.
    """
    if not reservation or not reservation.get("technician_id"):
        return None, None
    if not org_id:
        await store.release_job_reservation(
            job_id,
            status="released",
            reason=f"scheduled appointment {source}-activated without an owning organization",
        )
        return None, "missing_dispatch_organization"
    if job is None:
        rows = await store.get_ops_queue(org_id=org_id)
        job = next((row for row in rows if str(row.get("id")) == str(job_id)), None)
    technician_id = UUID(str(reservation["technician_id"]))
    tech = await store.get_ops_technician(technician_id, org_id=org_id)
    offer: dict[str, Any] | None = None
    error: str | None = None
    if job is None:
        error = "activated_job_unavailable"
    elif tech is None:
        error = "reserved_technician_unavailable"
    else:
        try:
            offer = await _send_targeted_offer(
                job=job,
                job_id=job_id,
                technician_id=technician_id,
                tech=tech,
                override_reason=None,
                session=session,
                audit_prefix=f"scheduled_reserved_{source}_activation",
                dispatch_org_id=org_id,
            )
        except HTTPException as exc:
            error = str(exc.detail)
    await store.release_job_reservation(
        job_id,
        status="converted" if offer else "released",
        reason=(
            f"scheduled appointment {source}-activated with reserved technician offer"
            if offer
            else f"scheduled appointment {source}-activated without reserved offer: {error or 'unavailable'}"
        ),
    )
    if error:
        await store.log_event_raw(job_id, f"scheduled_reserved_offer_fallback:{error[:160]}")
    return offer, error


@app.get("/ops/queue")
async def ops_get_queue(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """Return all pending_dispatch jobs ordered by arrival. Runs cleanup inline
    (expire stale offers + auto-close) so the queue is always fresh."""
    require_any_role(session, {"platform_admin"})
    await store.expire_stale_offers()
    await store.auto_close_pending(config.AUTO_CLOSE_WINDOW_SECONDS)
    return await _attach_queue_photo_urls(await store.get_ops_queue())


@app.get("/ops/queue/{job_id}/candidates")
async def ops_get_candidates(
    job_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Return the job plus all active+verified technicians with advisory signals."""
    require_any_role(session, {"platform_admin"})
    jobs = await _attach_queue_photo_urls(await store.get_ops_queue())
    job = next((j for j in jobs if str(j["id"]) == str(job_id)), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in dispatch queue")
    techs = await store.list_all_technicians_for_ops()
    # Platform oversight: no tenant to scope to, so active-job detail is not masked.
    return {"job": job, "candidates": await _enriched_candidates(job, techs, None)}


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


@app.get("/closeout-item-types")
async def public_closeout_item_types() -> dict[str, Any]:
    """Active closeout line-item taxonomy for future receipt builders."""
    return {"item_types": await store.list_closeout_item_types(active_only=True)}


@app.get("/admin/service-catalog")
async def admin_service_catalog(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    return {"categories": await store.list_service_catalog(active_only=False)}


@app.get("/admin/closeout-item-types")
async def admin_closeout_item_types(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    return {"item_types": await store.list_closeout_item_types(active_only=False)}


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


@app.put("/admin/closeout-item-types/{item_type_code}")
async def admin_upsert_closeout_item_type(
    item_type_code: str,
    payload: CloseoutItemTypePayload,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"platform_admin"})
    data = _closeout_item_type_payload(payload)
    if data["code"] != _validate_catalog_code(item_type_code):
        raise HTTPException(status_code=422, detail="Item type code in path and body must match.")
    return await store.upsert_closeout_item_type(data, updated_by=session.get("user", {}).get("id"))


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


@app.get("/provider/settings/capabilities")
async def get_provider_capabilities(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    return {
        "skills": await store.list_organization_capabilities(org_id),
        "catalog": await store.list_service_catalog(active_only=True),
    }


@app.patch("/provider/settings/capabilities")
async def update_provider_capabilities(
    payload: ProviderCapabilitiesUpdate,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    skills = await validate_active_skill_selection(payload.skills)
    saved = await store.replace_organization_capabilities(
        org_id,
        skills,
        updated_by=session.get("user", {}).get("id"),
    )
    return {"skills": saved, "catalog": await store.list_service_catalog(active_only=True)}


# --- provider financial closeout settings -----------------------------------
# These are intentionally org-overridable runtime settings. Platform admins set
# sane defaults in global_settings; a provider_admin may tune their company's tax
# rate and maximum closeout detail without changing code.
_FINANCIAL_SETTING_FIELDS = {
    "max_line_items": "closeout_max_line_items",
    "tax_rate_basis_points": "closeout_default_tax_rate_basis_points",
    "card_fee_basis_points": "closeout_card_fee_basis_points",
    "card_fee_fixed_cents": "closeout_card_fee_fixed_cents",
}


async def _resolve_financial_settings(org_id: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for field, key in _FINANCIAL_SETTING_FIELDS.items():
        override = await store.get_organization_setting(org_id, key)
        platform_default = await runtime_settings.resolve(store, key)
        result[field] = {
            "value": override["value"] if override else platform_default,
            "is_override": override is not None,
            "platform_default": platform_default,
        }
    return result


@app.get("/provider/settings/financial")
async def get_provider_financial_settings(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    return await _resolve_financial_settings(org_id)


@app.patch("/provider/settings/financial")
async def update_provider_financial_settings(
    payload: ProviderFinancialSettingsUpdate,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    sent = payload.model_dump(exclude_unset=True)
    if not sent:
        raise HTTPException(status_code=422, detail="No financial settings provided")

    actor_id = session.get("user", {}).get("id")
    for field, value in sent.items():
        key = _FINANCIAL_SETTING_FIELDS[field]
        if value is None:
            await store.delete_organization_setting(org_id, key)
            continue
        try:
            runtime_settings.coerce_and_validate(key, value)
        except runtime_settings.SettingValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        spec = runtime_settings.SETTINGS[key]
        await store.upsert_organization_setting(org_id, key, value, spec.value_type, actor_id)
    return await _resolve_financial_settings(org_id)


# --- provider intake-flow settings ------------------------------------------
_INTAKE_SETTING_FIELDS = {
    "show_estimate": "intake_show_estimate",
}


class ProviderIntakeSettingsUpdate(BaseModel):
    show_estimate: bool | None = None


async def _resolve_intake_settings(org_id: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for field, key in _INTAKE_SETTING_FIELDS.items():
        override = await store.get_organization_setting(org_id, key)
        platform_default = await runtime_settings.resolve(store, key)
        result[field] = {
            "value": override["value"] if override else platform_default,
            "is_override": override is not None,
            "platform_default": platform_default,
        }
    return result


@app.get("/provider/settings/intake")
async def get_provider_intake_settings(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    return await _resolve_intake_settings(org_id)


@app.patch("/provider/settings/intake")
async def update_provider_intake_settings(
    payload: ProviderIntakeSettingsUpdate,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    sent = payload.model_dump(exclude_unset=True)
    if not sent:
        raise HTTPException(status_code=422, detail="No intake settings provided")

    actor_id = session.get("user", {}).get("id")
    for field, value in sent.items():
        key = _INTAKE_SETTING_FIELDS[field]
        if value is None:
            await store.delete_organization_setting(org_id, key)
            continue
        try:
            runtime_settings.coerce_and_validate(key, value)
        except runtime_settings.SettingValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        spec = runtime_settings.SETTINGS[key]
        await store.upsert_organization_setting(org_id, key, value, spec.value_type, actor_id)
    return await _resolve_intake_settings(org_id)


@app.get("/provider/settings/communications")
async def get_provider_communications_settings(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    return {"settings": _safe_phone_settings(await store.get_organization_phone_settings(org_id))}


@app.patch("/provider/settings/communications")
async def update_provider_communications_settings(
    payload: ProviderPhoneSettingsUpdate,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    data = _validate_phone_settings_payload(payload)
    if not data:
        raise HTTPException(status_code=422, detail="No communications settings provided")
    current = await store.get_organization_phone_settings(org_id) or {}
    merged = {**current, **data}
    saved = await store.upsert_organization_phone_settings(
        org_id,
        merged,
        updated_by=session.get("user", {}).get("id"),
    )
    return {"settings": _safe_phone_settings(saved)}


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


async def _require_provider_user_in_org(user_id: UUID, organization_id: UUID) -> dict[str, Any]:
    """404s (not 403) for a user outside the caller's own company, so a
    provider_admin can never learn that a given id exists in another tenant.
    The returned detail is narrowed to just this company's membership — a
    user's affiliation with other companies must never leak cross-tenant.
    Membership role must be dispatcher/provider_admin: technicians also get a
    membership row here when they sign up via a company invite (see
    register_technician's dual-write into user_organization_memberships), but
    their global account must never be reachable through these company-staff
    endpoints — that's the /provider/technicians affiliation surface, not
    this one."""
    detail = await store.get_user_admin_detail(user_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="User not found")
    memberships = [
        m for m in detail.get("memberships") or []
        if str(m.get("organization_id")) == str(organization_id) and m.get("role") in PROVIDER_USER_ROLES
    ]
    if not memberships:
        raise HTTPException(status_code=404, detail="User not found")
    return {**detail, "memberships": memberships}


async def _guard_provider_admin_self_and_last(
    session: dict[str, Any], user_id: UUID, organization_id: UUID, *, action: str
) -> None:
    """Mirrors _guard_platform_admin_self_and_last, scoped to one company: a
    provider_admin may never suspend/delete their own account, and every
    company must always keep at least one active provider_admin able to sign in."""
    if str(session["user"].get("id")) == str(user_id):
        raise HTTPException(status_code=409, detail=f"You cannot {action} your own account.")
    members = await store.list_company_users_admin(organization_id)
    target = next((m for m in members if m["id"] == str(user_id)), None)
    if target and target.get("role") == "provider_admin" and target.get("status") == "active":
        remaining = sum(1 for m in members if m.get("role") == "provider_admin" and m.get("status") == "active")
        if remaining <= 1:
            raise HTTPException(status_code=409, detail="At least one active admin must remain for this company.")


@app.get("/provider/users/{user_id}")
async def get_provider_user(
    user_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    organization_id = _provider_organization_id(session)
    return await _require_provider_user_in_org(user_id, organization_id)


@app.patch("/provider/users/{user_id}")
async def update_provider_user(
    user_id: UUID,
    payload: AdminUserProfileUpdateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    organization_id = _provider_organization_id(session)
    await _require_provider_user_in_org(user_id, organization_id)
    data = payload.model_dump(exclude_unset=True, exclude={"role"})
    result = await store.update_user_profile(str(user_id), data)
    if result == "email_taken":
        raise HTTPException(status_code=409, detail="Email is already in use")
    if result == "phone_taken":
        raise HTTPException(status_code=409, detail="Phone is already in use")
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.role is not None:
        if payload.role not in PROVIDER_USER_ROLES:
            raise HTTPException(status_code=422, detail=f"role must be one of {sorted(PROVIDER_USER_ROLES)}")
        await store.update_organization_member_role(user_id, organization_id, payload.role)
    return await _require_provider_user_in_org(user_id, organization_id)


@app.post("/provider/users/{user_id}/suspend")
async def suspend_provider_user(
    user_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    organization_id = _provider_organization_id(session)
    await _require_provider_user_in_org(user_id, organization_id)
    reason = (payload.reason if payload else None) or ""
    if len(reason.strip()) < 3:
        raise HTTPException(status_code=422, detail="A suspension reason is required.")
    await _guard_provider_admin_self_and_last(session, user_id, organization_id, action="suspend")
    result = await store.set_user_account_status(user_id, "suspended")
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    result["reason"] = reason.strip()[:280]
    await _record_admin_governance_event(
        session, entity_type="user", entity_id=user_id, action="suspend",
        reason=result["reason"], metadata={"status": result.get("status"), "organization_id": str(organization_id)},
    )
    return result


@app.post("/provider/users/{user_id}/reactivate")
async def reactivate_provider_user(
    user_id: UUID,
    payload: AdminActionRequest | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    organization_id = _provider_organization_id(session)
    await _require_provider_user_in_org(user_id, organization_id)
    result = await store.set_user_account_status(user_id, "active")
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    reason = (payload.reason if payload else None) or None
    await _record_admin_governance_event(
        session, entity_type="user", entity_id=user_id, action="reactivate",
        reason=reason.strip()[:280] if reason else None,
        metadata={"status": result.get("status"), "organization_id": str(organization_id)},
    )
    return result


@app.post("/provider/users/{user_id}/password")
async def reset_provider_user_password(
    user_id: UUID,
    payload: AdminPasswordResetRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    organization_id = _provider_organization_id(session)
    detail = await _require_provider_user_in_org(user_id, organization_id)
    mode = payload.mode.strip()
    if mode not in {"set_temp_password", "generate_temp_password", "reset_link"}:
        raise HTTPException(status_code=422, detail="mode must be set_temp_password, generate_temp_password, or reset_link")

    if mode == "reset_link":
        token = create_access_token(
            {"sub": str(user_id), "purpose": "password_reset", "jti": str(uuid4())},
            expires_in=60 * 60 * 24,
        )
        reset_url = f"{_provider_reset_base_url().rstrip('/')}/reset-password?token={token}"
        await _record_admin_governance_event(
            session, entity_type="user", entity_id=user_id, action="generate_password_reset_link",
            reason=None, metadata={"expires_in_seconds": 60 * 60 * 24, "organization_id": str(organization_id)},
        )
        return {
            "mode": mode,
            "reset_url": reset_url,
            "expires_in_seconds": 60 * 60 * 24,
            "user": detail,
        }

    password = payload.password if mode == "set_temp_password" else _generate_temporary_password()
    if not password or len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    result = await store.set_user_password(user_id, password)
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    await _record_admin_governance_event(
        session, entity_type="user", entity_id=user_id,
        action="set_temp_password" if mode == "set_temp_password" else "generate_temp_password",
        reason=None, metadata={"delivery": "manual", "organization_id": str(organization_id)},
    )
    response: dict[str, Any] = {"mode": mode, "user": result}
    if mode == "generate_temp_password":
        response["temporary_password"] = password
    return response


@app.delete("/provider/users/{user_id}")
async def delete_or_archive_provider_user(
    user_id: UUID,
    payload: AdminActionRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    organization_id = _provider_organization_id(session)
    await _require_provider_user_in_org(user_id, organization_id)
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A delete/archive reason is required.")
    await _guard_provider_admin_self_and_last(session, user_id, organization_id, action="delete")
    result = await store.delete_or_archive_user(user_id, reason=reason[:280])
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    action = {"deleted": "delete", "archived": "archive"}.get(str(result.get("action")), str(result.get("action")))
    await _record_admin_governance_event(
        session, entity_type="user", entity_id=user_id, action=action,
        reason=result.get("reason"),
        metadata={"status": result.get("status"), "references": result.get("references"), "organization_id": str(organization_id)},
    )
    return result


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
    "distance_unit": "dispatch_distance_unit",
    "operations_refresh_seconds": "dispatch_operations_refresh_seconds",
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
    distance_unit: str | None = None
    operations_refresh_seconds: int | None = None


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
    return await _attach_queue_photo_urls(await store.get_ops_queue(org_id=org_id))


@app.get("/provider/queue/{job_id}/candidates")
async def provider_get_candidates(
    job_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """The job plus the company's own active+verified technicians, advisory-scored."""
    org_id = _require_dispatch_org(session)
    jobs = await _attach_queue_photo_urls(await store.get_ops_queue(org_id=org_id))
    job = next((j for j in jobs if str(j["id"]) == str(job_id)), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in your dispatch queue")
    techs = await store.list_all_technicians_for_ops(org_id=org_id)
    return {
        "job": job,
        "candidates": await _enriched_candidates(job, techs, org_id),
        "distance_unit": await runtime_settings.resolve_org(store, org_id, "dispatch_distance_unit"),
    }


@app.get("/provider/partners")
async def provider_list_partner_targets(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    org_id = _require_dispatch_org(session)
    return await store.list_partner_dispatch_targets(org_id)


@app.get("/provider/partnerships")
async def provider_list_partnerships(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    return await store.list_organization_partnerships(org_id)


@app.post("/provider/partners")
async def provider_request_partnership(
    payload: OrganizationPartnershipRequestPayload,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    if str(payload.partner_org_id) == str(org_id):
        raise HTTPException(status_code=422, detail="Choose a different partner organization")
    result = await store.request_organization_partnership(
        org_id,
        str(payload.partner_org_id),
        requested_by=session.get("user", {}).get("id"),
        note=(payload.note or "").strip()[:280] or None,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Partner organization not found or inactive")
    return result


@app.post("/provider/partners/{requester_org_id}/accept")
async def provider_accept_partnership(
    requester_org_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    result = await store.accept_organization_partnership(
        str(requester_org_id),
        org_id,
        approved_by=session.get("user", {}).get("id"),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Partnership request not found")
    return result


@app.post("/provider/partners/{requester_org_id}/reject")
async def provider_reject_partnership(
    requester_org_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    result = await store.reject_organization_partnership(
        str(requester_org_id),
        org_id,
        rejected_by=session.get("user", {}).get("id"),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Partnership request not found")
    return result


@app.post("/provider/partners/{other_org_id}/end")
async def provider_end_partnership(
    other_org_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    result = await store.end_organization_partnership(
        org_id,
        str(other_org_id),
        ended_by=session.get("user", {}).get("id"),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Partnership not found")
    return result


@app.post("/provider/queue/{job_id}/confirm-schedule")
async def provider_confirm_schedule(
    job_id: UUID,
    payload: ConfirmSchedulePayload | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Confirm the requested window without silently holding a technician.

    A named future reservation requires a technician offer/acceptance flow.
    Until that exists, the honest state is confirmed and unassigned.
    """
    org_id = _require_dispatch_org(session)
    jobs = await store.get_ops_queue(org_id=org_id)
    job = next((j for j in jobs if str(j["id"]) == str(job_id)), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in your dispatch queue")
    if job.get("status") != STATUS_SCHEDULED_REQUESTED:
        raise HTTPException(status_code=409, detail="Job is not awaiting schedule confirmation")
    ticket = await require_ticket(job_id)
    if ticket.service_appointment is None or ticket.service_appointment.requested_start is None:
        raise HTTPException(status_code=409, detail="Requested appointment window required")
    requested_end = ticket.service_appointment.requested_end or (
        ticket.service_appointment.requested_start + timedelta(hours=1)
    )
    ticket.service_appointment.status = "confirmed_unassigned"
    ticket.service_appointment.requested_end = requested_end
    ticket.service_appointment.reservation_id = None
    ticket.service_appointment.reserved_technician_id = None
    await save(ticket)
    updated = await store.set_job_status(
        job_id, STATUS_SCHEDULED_CONFIRMED, expected_current=STATUS_SCHEDULED_REQUESTED
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Schedule confirmation conflicted; refresh the queue.")
    actor_id = session.get("user", {}).get("id")
    note = (payload.note if payload else None) or ""
    await log_transition(ticket, f"schedule_confirmed:by={actor_id}:org={org_id}")
    if note.strip():
        await store.log_event_raw(job_id, f"schedule_note:{note.strip()[:180]}")
    await _record_customer_system_message(
        job_id,
        body=(
            "The provider confirmed your appointment window for "
            f"{_format_appointment_window(ticket.service_appointment)}. "
            "A technician will be assigned when the job is activated for dispatch."
        ),
        event="schedule_confirmed",
        organization_id=org_id,
    )
    return {"confirmed": True, "job_id": str(job_id), "status": STATUS_SCHEDULED_CONFIRMED}


@app.post("/provider/queue/{job_id}/activate-schedule")
async def provider_activate_schedule(
    job_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    jobs = await store.get_ops_queue(org_id=org_id)
    job = next((j for j in jobs if str(j["id"]) == str(job_id)), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in your dispatch queue")
    if job.get("status") != STATUS_SCHEDULED_CONFIRMED:
        raise HTTPException(status_code=409, detail="Job is not a confirmed scheduled appointment")
    reservation = await store.get_job_reservation(job_id)
    updated = await store.set_job_status(
        job_id, STATUS_PENDING_DISPATCH, expected_current=STATUS_SCHEDULED_CONFIRMED
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Schedule activation conflicted; refresh the queue.")
    reserved_offer, reserved_offer_error = await _offer_activated_scheduled_reservation(
        job_id=job_id,
        job=job,
        reservation=reservation,
        org_id=org_id,
        session=session,
        source="manual",
    )
    await store.log_event_raw(job_id, f"scheduled_activated:manual:by={session.get('user', {}).get('id')}")
    await _record_customer_system_message(
        job_id,
        body="Your scheduled appointment is now being dispatched. The provider is selecting an available technician.",
        event="schedule_activated",
        organization_id=org_id,
    )
    return {
        "activated": True,
        "job_id": str(job_id),
        "status": STATUS_PENDING_DISPATCH,
        "reserved_offer": reserved_offer,
        "reserved_offer_error": reserved_offer_error,
    }


@app.post("/provider/queue/{job_id}/partner-request")
async def provider_request_partner_dispatch(
    job_id: UUID,
    payload: PartnerDispatchRequestPayload,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    jobs = await store.get_ops_queue(org_id=org_id)
    job = next((j for j in jobs if str(j["id"]) == str(job_id)), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in your dispatch queue")
    if str(payload.partner_org_id) == str(org_id):
        raise HTTPException(status_code=422, detail="Choose a different partner organization")
    if job.get("offer_active"):
        raise HTTPException(status_code=409, detail="Recall or wait for the active technician offer before requesting a partner")
    if job.get("status") == STATUS_PARTNER_REQUESTED:
        raise HTTPException(status_code=409, detail="Partner dispatch has already been requested")
    ticket = await store.get(job_id)
    appointment = ticket.service_appointment if ticket else None
    detail_appointment = (job.get("detail") or {}).get("service_appointment")
    partner_dispatch_allowed = (
        appointment.partner_dispatch_allowed
        if appointment is not None
        else detail_appointment.get("partner_dispatch_allowed")
        if isinstance(detail_appointment, dict)
        else False
    )
    if partner_dispatch_allowed is not True:
        raise HTTPException(
            status_code=409,
            detail="Customer consent is required before requesting partner dispatch",
        )
    result = await store.request_partner_dispatch(
        job_id,
        origin_org_id=org_id,
        partner_org_id=str(payload.partner_org_id),
        note=(payload.note or "").strip()[:280] or None,
    )
    if result is None:
        raise HTTPException(status_code=409, detail="Partner request could not be created")
    await _record_customer_system_message(
        job_id,
        body="The provider requested help from an approved partner company for this job. Your original provider still owns the customer relationship.",
        event="partner_dispatch_requested",
        organization_id=org_id,
    )
    return result


@app.post("/provider/queue/{job_id}/partner-accept")
async def provider_accept_partner_dispatch(
    job_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    jobs = await store.get_ops_queue(org_id=org_id)
    job = next((j for j in jobs if str(j["id"]) == str(job_id)), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found in your dispatch queue")
    if job.get("status") != STATUS_PARTNER_REQUESTED:
        raise HTTPException(status_code=409, detail="Job is not awaiting partner acceptance")
    if str(job.get("fulfillment_org_id") or "") != str(org_id):
        raise HTTPException(status_code=403, detail="Only the requested partner can accept this dispatch request")
    updated = await store.set_job_status(
        job_id, STATUS_PENDING_DISPATCH, expected_current=STATUS_PARTNER_REQUESTED
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Partner request changed; refresh the queue")
    await store.log_event_raw(job_id, f"partner_dispatch_accepted:partner={org_id}:by={session.get('user', {}).get('id')}")
    await _record_customer_system_message(
        job_id,
        body="An approved partner company accepted the dispatch request. Technician assignment can now continue.",
        event="partner_dispatch_accepted",
        organization_id=org_id,
    )
    return {"accepted": True, "job_id": str(job_id), "status": STATUS_PENDING_DISPATCH}


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
    if job.get("status") == STATUS_SCHEDULED_REQUESTED:
        raise HTTPException(status_code=409, detail="Confirm the appointment window before assigning a technician")
    if job.get("status") == STATUS_SCHEDULED_CONFIRMED:
        raise HTTPException(status_code=409, detail="Activate the scheduled appointment before assigning a technician")
    if job.get("status") == STATUS_PARTNER_REQUESTED:
        raise HTTPException(status_code=409, detail="Partner must accept the dispatch request before assigning a technician")
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
        dispatch_org_id=org_id,
    )


@app.get("/provider/fleet")
async def provider_fleet(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """The company's own technicians with location and active-job data."""
    org_id = _require_dispatch_org(session)
    return await store.get_fleet_state(org_id=org_id)


@app.post("/offers/{offer_id}/accept")
async def accept_offer(
    offer_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """First-accept-wins: atomically claim the job for the offer's technician,
    set ``fulfillment_technician_id``/``fulfillment_org_id``, flip
    ``trust_state=matched``, and supersede the sibling offers. Enforced in the
    backend (not UI timing); a losing or stale accept gets 409.

    The same statement enforces the GLOBAL active-job lock — a technician on a job
    for company A cannot accept company B's offer (409, offer left open).

    Self-scoped: only the signed-in technician the offer was made to may accept
    it — someone else's offer_id (even if guessed) 404s exactly like an unknown
    one, never revealing that it exists for a different technician."""
    await latency()
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=403, detail="Technician session required")
    result = await store.accept_dispatch_offer(offer_id, UUID(tech["id"]))
    if result is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    if not result.get("accepted"):
        reason = result.get("reason", "not_accepted")
        if reason == "technician_busy":
            raise HTTPException(
                status_code=409,
                detail="You already have an active job. Finish it before accepting another.",
            )
        raise HTTPException(status_code=409, detail=reason)
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
    job_id = UUID(result["id"])
    closeout = await store.get_job_closeout(job_id)
    payments = await store.get_payment_reports(job_id)
    tracking_token = await store.get_tracking_token(job_id)
    status = (lifecycle or {}).get("status") or result.get("status")
    service_type = required_skill_for_job(result)
    approval_url = f"{config.CUSTOMER_INTAKE_BASE_URL}/t/{tracking_token}" if tracking_token else None
    approval_status = (
        "pending" if status == STATUS_COMPLETED_PENDING
        else "approved" if status == STATUS_COMPLETED_CONFIRMED
        else "expired" if status == STATUS_COMPLETED_AUTO_CLOSED
        else "disputed" if status == STATUS_DISPUTED
        else None
    )
    photo_urls = await _signed_photo_urls(result.get("photo_paths") or [])
    enriched = {
        **result,
        **(lifecycle or {}),
        "service_type": service_type,
        "collection_items": _closeout_collection_items(closeout),
        "collection_total": round(float(closeout["total_cents"]) / 100, 2) if closeout and closeout.get("total_cents") is not None else None,
        "collection_currency": closeout.get("currency") if closeout else None,
        "collection_closeout": closeout,
        "payment": payments.get("technician") if isinstance(payments, dict) else None,
        "approval_status": approval_status,
        "approval_url": approval_url,
        "tracking_token": tracking_token,
        "arrival_verification": {
            "pin_required": status == STATUS_EN_ROUTE,
            "dispatcher_fallback_allowed": (result.get("detail") or {}).get("channel") == "voice",
        },
        "intake_photos": [{"url": url} for url in photo_urls],
    }
    return enriched


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
async def tracking(ticket_id: UUID, request: Request) -> dict[str, Any]:
    """Customer-safe dispatch tracking READ. Returns an explicit ``state``
    (``waiting`` | ``matched`` | ``no_eligible`` | ``expired_retry`` | ``error``)
    and, only when matched, a customer-safe ``assignment`` (owner/fulfillment
    names, technician display name, role, rating, coarse ETA estimate,
    assigned_at, job status). Never 409s for a normal dispatch state, never
    exposes candidates/scoring/rosters/internal IDs, and never creates offers
    (pure read — offer creation is owned by the dispatch write + scheduled sweep)."""
    await latency()
    await require_intake_ticket(ticket_id, request)
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
    _mask_customer_service_appointment(status)
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
    _mask_customer_service_appointment(status)
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


async def _resolve_token_job(token: str) -> UUID:
    job_id = await store.resolve_tracking_token(token)
    if job_id is None:
        raise HTTPException(status_code=404, detail="Not found")
    return UUID(job_id)


async def _require_customer_message_job(token: str, *, rate_limit: bool) -> UUID:
    job_id = await (_require_token_job(token) if rate_limit else _resolve_token_job(token))
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Not found")
    if rate_limit and lifecycle.get("status") not in _MESSAGE_WRITABLE_STATUSES:
        raise HTTPException(status_code=409, detail="Messaging is closed for this job.")
    return job_id


@app.get("/t/{token}/messages")
async def customer_list_job_messages(token: str) -> dict[str, Any]:
    """Tracking-token customer reads only the customer-visible thread. Operations
    messages and provider internal notes are never exposed on this capability link."""
    job_id = await _require_customer_message_job(token, rate_limit=False)
    rows = await store.list_job_messages(job_id, channel="customer")
    unread = await store.count_unread_job_messages(job_id, channel="customer", recipient_type="customer")
    return _message_read_result(rows, unread)


@app.post("/t/{token}/messages/read")
async def customer_mark_job_messages_read(token: str) -> dict[str, Any]:
    job_id = await _require_customer_message_job(token, rate_limit=False)
    return await store.mark_job_messages_read(job_id, channel="customer", recipient_type="customer")


@app.post("/t/{token}/calls/technician")
async def customer_start_technician_call(token: str) -> dict[str, Any]:
    job_id = await _require_customer_message_job(token, rate_limit=True)
    lifecycle = await store.get_job_lifecycle(job_id)
    tech_id = (lifecycle or {}).get("fulfillment_technician_id")
    return await _start_masked_call(
        job_id,
        caller_type="customer",
        caller_user_id=None,
        callee_type="technician",
        callee_technician_id=str(tech_id) if tech_id else None,
    )


@app.post("/t/{token}/messages")
async def customer_send_job_message(token: str, payload: JobMessageRequest) -> dict[str, Any]:
    """Tracking-token customer sends a template-only customer-channel message.
    No account is required; the tracking token is the job capability."""
    job_id = await _require_customer_message_job(token, rate_limit=True)
    channel = _message_channel(payload.channel)
    if channel != "customer":
        raise HTTPException(status_code=404, detail="Not found")
    cmid = _validated_client_message_id(payload.client_message_id)
    body, template_code, template_params = _message_content(payload, channel=channel)
    req_hash = _mutation_request_hash(
        "job-message", str(job_id), channel, "customer", body, template_code, template_params)
    row = await store.create_job_message(
        job_id,
        channel=channel,
        sender_type="customer",
        sender_user_id=None,
        body=body,
        template_code=template_code,
        template_params=template_params,
        client_message_id=cmid,
        request_hash=req_hash,
    )
    if row.get("error_code") == "idempotency_key_reuse":
        raise HTTPException(status_code=409, detail={
            "code": "idempotency_key_reuse",
            "message": "This client_message_id was already used with a different message.",
        })
    await _notify_technician_message(job_id, row)
    if template_code == "need_more_details":
        lifecycle = await store.get_job_lifecycle(job_id)
        org_id = (lifecycle or {}).get("fulfillment_org_id") or (lifecycle or {}).get("customer_owner_org_id")
        await _create_alert_best_effort(
            str(org_id) if org_id else None,
            alert_type="customer_help_request",
            severity="warning",
            job_id=job_id,
            payload={"template_code": template_code},
            log_name="alert_customer_help_request_failed",
        )
    return {"message": _public_message(row)}


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


def _money_cents(value: Any, field: str) -> int:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be a valid amount")
    if numeric < 0:
        raise HTTPException(status_code=422, detail=f"{field} must be zero or greater")
    if numeric > 1_000_000:
        raise HTTPException(status_code=422, detail=f"{field} is implausibly large")
    return int(round(numeric * 100))


async def _effective_financial_settings(org_id: str | None) -> dict[str, int]:
    keys = {
        "max_line_items": "closeout_max_line_items",
        "tax_rate_basis_points": "closeout_default_tax_rate_basis_points",
        "card_fee_basis_points": "closeout_card_fee_basis_points",
        "card_fee_fixed_cents": "closeout_card_fee_fixed_cents",
    }
    result: dict[str, int] = {}
    for field, key in keys.items():
        value = (
            await runtime_settings.resolve_org(store, org_id, key)
            if org_id
            else await runtime_settings.resolve(store, key)
        )
        result[field] = int(value)
    return result


async def _build_closeout_report(
    *,
    job_id: UUID,
    payload: PaymentReportRequest,
    lifecycle: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    method = normalize_payment_method(payload.method)
    if method is None:
        raise HTTPException(status_code=422, detail="Unknown payment method")
    org_id = lifecycle.get("fulfillment_org_id") or lifecycle.get("customer_owner_org_id")
    settings = await _effective_financial_settings(str(org_id) if org_id else None)
    item_types = {
        item["code"]: item
        for item in await store.list_closeout_item_types(active_only=True)
    }
    raw_items = payload.line_items
    if not raw_items:
        if payload.amount is None:
            raise HTTPException(status_code=422, detail="Closeout requires at least one line item or amount")
        raw_items = [{
            "item_type_code": "service_fee",
            "description": "Service",
            "quantity": 1,
            "unit_amount": payload.amount,
        }]
    if len(raw_items) < 1:
        raise HTTPException(status_code=422, detail="Closeout requires at least one line item")
    if len(raw_items) > settings["max_line_items"]:
        raise HTTPException(status_code=422, detail=f"Closeout allows at most {settings['max_line_items']} line items")

    lines: list[dict[str, Any]] = []
    subtotal_cents = 0
    taxable_subtotal_cents = 0
    for idx, raw in enumerate(raw_items, start=1):
        item_type_code = _validate_catalog_code(str(raw.get("item_type_code") or raw.get("type") or "service_fee"))
        item_type = item_types.get(item_type_code)
        if item_type is None:
            raise HTTPException(status_code=422, detail=f"Invalid closeout item type: {item_type_code}")
        description = str(raw.get("description") or item_type["label"]).strip()
        if not description:
            raise HTTPException(status_code=422, detail="Line item description is required")
        try:
            quantity = float(raw.get("quantity", 1))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Line item quantity must be numeric")
        if quantity <= 0 or quantity > 999:
            raise HTTPException(status_code=422, detail="Line item quantity must be greater than zero")
        unit_cents = _money_cents(raw.get("unit_amount", raw.get("unit_price", raw.get("amount"))), "Line item amount")
        line_cents = int(round(unit_cents * quantity))
        taxable = bool(raw.get("taxable", item_type.get("default_taxable", True)))
        provided_by = raw.get("provided_by")
        if item_type.get("requires_provided_by") and provided_by not in {"company", "technician", "customer", "third_party"}:
            raise HTTPException(status_code=422, detail=f"{item_type['label']} requires provided_by")
        note = (str(raw.get("note") or "").strip() or None)
        subtotal_cents += line_cents
        if taxable:
            taxable_subtotal_cents += line_cents
        lines.append({
            "line_number": idx,
            "item_type_code": item_type_code,
            "description": description[:160],
            "quantity": quantity,
            "unit_amount_cents": unit_cents,
            "line_total_cents": line_cents,
            "taxable": taxable,
            "provided_by": provided_by,
            "compensation_eligible": bool(item_type.get("default_compensation_eligible", False)),
            "reimbursement_eligible": bool(item_type.get("default_reimbursement_eligible", False)),
            "note": note[:280] if note else None,
        })

    tip_cents = _money_cents(payload.tip_amount or 0, "Tip")
    tax_cents = int(round(taxable_subtotal_cents * settings["tax_rate_basis_points"] / 10_000))
    if taxable_subtotal_cents > 0 and settings["tax_rate_basis_points"] == 0 and payload.no_tax_reason:
        no_tax_reason = payload.no_tax_reason.strip()[:200]
    else:
        no_tax_reason = None
    card_fee_base_cents = subtotal_cents + tax_cents + tip_cents
    card_fee_cents = (
        int(round(card_fee_base_cents * settings["card_fee_basis_points"] / 10_000))
        + settings["card_fee_fixed_cents"]
        if method in CARD_PAYMENT_METHODS
        else 0
    )
    total_cents = subtotal_cents + tax_cents + tip_cents + card_fee_cents
    return {
        "job_id": str(job_id),
        "reported_by": "technician",
        "currency": "USD",
        "method": method,
        "line_items": lines,
        "subtotal_cents": subtotal_cents,
        "taxable_subtotal_cents": taxable_subtotal_cents,
        "tax_rate_basis_points": settings["tax_rate_basis_points"],
        "tax_cents": tax_cents,
        "tip_cents": tip_cents,
        "card_fee_basis_points": settings["card_fee_basis_points"] if method in CARD_PAYMENT_METHODS else 0,
        "card_fee_fixed_cents": settings["card_fee_fixed_cents"] if method in CARD_PAYMENT_METHODS else 0,
        "card_fee_cents": card_fee_cents,
        "total_cents": total_cents,
        "no_tax_reason": no_tax_reason,
        "settings_snapshot": settings,
    }, method


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


@app.post("/t/{token}/reschedule")
async def reschedule_by_token(token: str, payload: RescheduleRequest) -> dict[str, Any]:
    """Customer requests a new window for a scheduled job before dispatch.
    If the provider already confirmed the prior window, the job returns to
    scheduled_requested so capacity must be confirmed again.
    """
    await latency()
    job_id = await _require_token_job(token)
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    current_status = lifecycle.get("status")
    if current_status not in {STATUS_SCHEDULED_REQUESTED, STATUS_SCHEDULED_CONFIRMED}:
        raise HTTPException(status_code=409, detail="Only scheduled jobs awaiting dispatch can be rescheduled")
    requested_end = payload.requested_end or (payload.requested_start + timedelta(hours=1))
    if requested_end <= payload.requested_start:
        raise HTTPException(status_code=422, detail="requested_end must be after requested_start")
    ticket = await require_ticket(job_id)
    if ticket.urgency != Urgency.SCHEDULED:
        raise HTTPException(status_code=409, detail="Job is not a scheduled appointment")
    await store.release_job_reservation(
        job_id,
        status="released",
        reason="customer requested a new appointment window",
    )
    ticket.service_appointment = ServiceAppointment(
        requested_start=payload.requested_start,
        requested_end=requested_end,
        timezone=(payload.timezone or (ticket.service_appointment.timezone if ticket.service_appointment else None) or "America/New_York"),
        status="requested",
        partner_dispatch_allowed=(
            ticket.service_appointment.partner_dispatch_allowed
            if ticket.service_appointment is not None else True
        ),
    )
    await save(ticket)
    if current_status != STATUS_SCHEDULED_REQUESTED:
        updated = await store.set_job_status(
            job_id, STATUS_SCHEDULED_REQUESTED, expected_current=current_status
        )
        if updated is None:
            raise HTTPException(status_code=409, detail="Status changed concurrently")
    reason = (payload.reason or "").strip()
    await log_transition(ticket, f"schedule_reschedule_requested:from={current_status}")
    if reason:
        await store.log_event_raw(job_id, f"schedule_reschedule_reason:{reason[:180]}")
    await _record_customer_system_message(
        job_id,
        body=(
            "A new appointment window was requested for "
            f"{_format_appointment_window(ticket.service_appointment)}. "
            "The provider will confirm the updated window before assigning a technician."
        ),
        event="schedule_reschedule_requested",
        organization_id=lifecycle.get("customer_owner_org_id"),
    )
    return {
        "status": STATUS_SCHEDULED_REQUESTED,
        "service_appointment": ticket.service_appointment.model_dump(mode="json"),
    }


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
    # Optimistic-concurrency precondition against the client's last-read snapshot
    # version — checked before transition-legality and before any mutation, same
    # ordering as the report-issue guard. Distinct from the expected_current
    # status-equality check below, which protects against a race between this
    # request's own fetch and its own write.
    current_version = _job_version(
        ticket_id, lifecycle.get("status"), lifecycle.get("lifecycle_version"))
    if payload.expected_version is not None and payload.expected_version != current_version:
        raise HTTPException(status_code=409, detail={
            "code": "version_conflict",
            "current_version": current_version,
        })
    if not can_technician_transition(lifecycle["status"], payload.status):
        raise HTTPException(status_code=409, detail="Illegal status transition")
    updated = await store.set_job_status(
        ticket_id, payload.status, expected_current=lifecycle["status"]
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Status changed concurrently")
    purpose_by_status = {
        STATUS_EN_ROUTE: "technician_en_route",
        STATUS_COMPLETED_PENDING: "completion_awaiting_customer_confirmation",
    }
    if payload.status in purpose_by_status:
        try:
            await _send_transactional_sms(ticket_id, purpose_by_status[payload.status], "customer")
        except Exception:
            logger.exception("transactional_sms_lifecycle_failed", extra={"job_id": str(ticket_id), "status": payload.status})
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

    method = (payload.method or "pin").strip()
    cmid = _validated_client_mutation_id(payload.client_mutation_id)

    async def _fail(status_code: int, detail: Any) -> None:
        if cmid:
            await store.complete_technician_mutation(
                UUID(tech["id"]), cmid, status_code=status_code, response=detail)
        raise HTTPException(status_code=status_code, detail=detail)

    if cmid:
        # One reservation point covers BOTH the state preconditions below and the
        # method-specific outcome, so an exact retry — including one made AFTER
        # the job already transitioned out of en_route as a result of the first
        # call — replays the recorded outcome instead of re-evaluating state that
        # has since legitimately moved on (arrival is a state TRANSITION: success
        # changes lifecycle_version/status, so a naive "check state, then check
        # idempotency" ordering would make the retry of a success look like a
        # fresh, now-invalid request). expected_version IS included in the hash
        # here — unlike report-issue/collection/lifecycle-transition, where it's
        # a precondition checked before any reservation exists. Here the
        # reservation exists first, so a retry with a materially different
        # expected_version must be treated as a new logical attempt against
        # different observed state (idempotency_key_reuse, prompting a new key),
        # not a silent replay of a now-stale conflict.
        req_hash = _mutation_request_hash(
            "arrival-verify", str(job_id), method, payload.pin,
            payload.reason, payload.dispatcher_name, payload.expected_version,
        )
        rec = await store.begin_or_get_technician_mutation(UUID(tech["id"]), cmid, req_hash)
        if rec["state"] == "done":
            if rec["status_code"] != 200:
                raise HTTPException(status_code=rec["status_code"], detail=rec["response"])
            return rec["response"]
        if rec["state"] == "conflict":
            raise HTTPException(status_code=409, detail={
                "code": "idempotency_key_reuse",
                "message": "This client_mutation_id was already used with a different request.",
            })
        if rec["state"] == "pending":
            raise HTTPException(status_code=409, detail={
                "code": "idempotency_in_progress",
                "message": "A mutation with this client_mutation_id is still being processed.",
            })
        # state == "new": a reservation now exists. Every exit below must
        # complete it (via _fail, or directly on success) so it never gets
        # stuck "pending" — including the everyday wrong-PIN/stale-state cases.

    if lifecycle["status"] != STATUS_EN_ROUTE:
        await _fail(409, "Job is not en route")
    current_version = _job_version(
        job_id, lifecycle.get("status"), lifecycle.get("lifecycle_version"))
    if payload.expected_version is not None and payload.expected_version != current_version:
        await _fail(409, {"code": "version_conflict", "current_version": current_version})

    if method == "dispatcher_verified":
        ticket = await require_ticket(job_id)
        ticket_channel = getattr(ticket.channel, "value", str(ticket.channel))
        if ticket_channel != "voice":
            await _fail(409, "Dispatcher verification is only available for call-center intake jobs.")
        reason = (payload.reason or "").strip()
        dispatcher_name = (payload.dispatcher_name or "").strip()
        if len(dispatcher_name) < 2:
            await _fail(422, "Dispatcher name or initials are required.")
        if len(reason) < 3:
            await _fail(422, "A verification note is required.")
        updated = await store.set_job_status(
            job_id, STATUS_ARRIVED, expected_current=STATUS_EN_ROUTE
        )
        if updated is None:
            await _fail(409, "Status changed concurrently")
        await store.log_event_raw(
            job_id,
            f"arrival:dispatcher_verified_by_tech:tech={tech['id']}:dispatcher={dispatcher_name[:80]}:reason={reason[:140]}",
        )
        try:
            await _send_transactional_sms(job_id, "technician_arrived", "customer")
        except Exception:
            logger.exception("transactional_sms_arrival_failed", extra={"job_id": str(job_id), "method": method})
        result = {"status": updated["status"], "verification_method": method}
        if cmid:
            await store.complete_technician_mutation(
                UUID(tech["id"]), cmid, status_code=200, response=result)
        return result

    if method != "pin":
        await _fail(422, "Unsupported arrival verification method.")
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
        await _fail(code, detail)
    updated = await store.set_job_status(
        job_id, STATUS_ARRIVED, expected_current=STATUS_EN_ROUTE
    )
    if updated is None:
        await _fail(409, "Status changed concurrently")
    await store.log_event_raw(job_id, f"arrival:pin_verified:tech={tech['id']}")
    try:
        await _send_transactional_sms(job_id, "technician_arrived", "customer")
    except Exception:
        logger.exception("transactional_sms_arrival_failed", extra={"job_id": str(job_id), "method": method})
    success = {"status": updated["status"]}
    if cmid:
        await store.complete_technician_mutation(
            UUID(tech["id"]), cmid, status_code=200, response=success)
    return success


_ISSUE_KINDS = {"cannot_complete", "customer_unavailable", "unsafe"}


def _mutation_request_hash(*parts: Any) -> str:
    """Stable hash of a mutation's identity + payload so an idempotency-key retry
    with a materially different request is detectable as a conflict."""
    canonical = json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _job_version(job_id: Any, status: str | None, lifecycle_version: Any = None) -> str:
    """Deterministic opaque ETag for a job's lifecycle state. Prefer the durable
    jobs.lifecycle_version counter; fall back to status for any unstamped row."""
    marker = lifecycle_version if lifecycle_version is not None else status or ""
    return hashlib.sha256(f"{job_id}|{marker}".encode("utf-8")).hexdigest()[:16]


# Forward lifecycle targets a technician may advance an active job to, in order.
_FORWARD_TARGETS = (STATUS_EN_ROUTE, STATUS_ARRIVED, STATUS_IN_PROGRESS, STATUS_COMPLETED_PENDING)


def _allowed_active_job_actions(status: str | None) -> list[str]:
    """Actions the assigned technician can take from this status. Uses the real
    transition guard (can_technician_transition), so at most one forward
    transition is offered; issue reporting is always available on an active job."""
    actions: list[str] = []
    nxt = next((t for t in _FORWARD_TARGETS if can_technician_transition(status or "", t)), None)
    if nxt:
        actions.append(f"advance_to:{nxt}")
    actions.append("report_issue")
    return actions


_CLIENT_MUTATION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def _validated_client_mutation_id(raw: str | None) -> str | None:
    """Normalize/validate a client idempotency key. Absent -> None (the key is
    optional). Present -> 8-128 chars of [A-Za-z0-9_-] (covers UUID/ULID/nanoid),
    else 422 — so a client can't store oversized or junk keys."""
    cmid = (raw or "").strip()
    if not cmid:
        return None
    if not _CLIENT_MUTATION_ID_RE.fullmatch(cmid):
        raise HTTPException(status_code=422, detail=(
            "client_mutation_id must be 8-128 characters of letters, digits, '-', or '_'"))
    return cmid


def _validated_client_message_id(raw: str | None) -> str | None:
    cmid = (raw or "").strip()
    if not cmid:
        return None
    if not _CLIENT_MUTATION_ID_RE.fullmatch(cmid):
        raise HTTPException(status_code=422, detail=(
            "client_message_id must be 8-128 characters of letters, digits, '-', or '_'"))
    return cmid


_MESSAGE_WRITABLE_STATUSES = {
    STATUS_ASSIGNED,
    STATUS_EN_ROUTE,
    STATUS_ARRIVED,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED_PENDING,
    STATUS_DISPUTED,
}

_MESSAGE_CHANNELS = {"operations", "customer"}
_CUSTOMER_MESSAGE_TEMPLATES = {
    "on_my_way",
    "arrived",
    "running_late",
    "need_more_details",
    "customer_unavailable",
    "work_complete",
    "please_confirm",
}


def _message_body(payload: JobMessageRequest) -> str | None:
    body = (payload.body or "").strip()
    if body:
        return body[:2000]
    if (payload.template_code or "").strip():
        return None
    raise HTTPException(status_code=422, detail="Message body or template_code is required.")


def _message_channel(channel: str | None) -> str:
    value = (channel or "operations").strip()
    if value not in _MESSAGE_CHANNELS:
        raise HTTPException(status_code=422, detail=f"channel must be one of {sorted(_MESSAGE_CHANNELS)}")
    return value


def _message_content(payload: JobMessageRequest, *, channel: str) -> tuple[str | None, str | None, dict[str, Any]]:
    template_code = (payload.template_code or "").strip() or None
    template_params = payload.template_params or {}
    if not isinstance(template_params, dict):
        raise HTTPException(status_code=422, detail="template_params must be an object.")
    if len(template_params) > 12:
        raise HTTPException(status_code=422, detail="template_params has too many fields.")
    if channel == "customer":
        if not template_code:
            raise HTTPException(status_code=422, detail={
                "code": "template_required",
                "message": "Customer messaging is template-only in this slice.",
            })
        if template_code not in _CUSTOMER_MESSAGE_TEMPLATES:
            raise HTTPException(status_code=422, detail={
                "code": "unknown_template",
                "message": f"template_code must be one of {sorted(_CUSTOMER_MESSAGE_TEMPLATES)}",
            })
        return None, template_code, template_params
    return _message_body(payload), template_code, template_params


def _public_message(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "job_id": row.get("job_id"),
        "channel": row.get("channel"),
        "sender_type": row.get("sender_type"),
        "sender_user_id": row.get("sender_user_id"),
        "sender_technician_id": row.get("sender_technician_id"),
        "sender_organization_id": row.get("sender_organization_id"),
        "body": row.get("body"),
        "template_code": row.get("template_code"),
        "template_params": row.get("template_params") or {},
        "client_message_id": row.get("client_message_id"),
        "created_at": row.get("created_at"),
        "delivery_state": "sent",
    }


def _appointment_local_datetime(value: datetime, timezone_name: str | None) -> datetime:
    try:
        target_timezone = ZoneInfo(timezone_name or "UTC")
    except ZoneInfoNotFoundError:
        target_timezone = timezone.utc
    if value.tzinfo is None:
        return value.replace(tzinfo=target_timezone)
    return value.astimezone(target_timezone)


def _format_dt_for_customer(value: datetime) -> str:
    hour = value.hour % 12 or 12
    suffix = "AM" if value.hour < 12 else "PM"
    return f"{value:%b} {value.day}, {value.year} {hour}:{value.minute:02d} {suffix}"


def _format_time_for_customer(value: datetime) -> str:
    hour = value.hour % 12 or 12
    suffix = "AM" if value.hour < 12 else "PM"
    return f"{hour}:{value.minute:02d} {suffix}"


def _format_appointment_window(appointment: ServiceAppointment | None) -> str:
    if appointment is None or appointment.requested_start is None:
        return "the requested appointment window"
    tz = appointment.timezone or "local time"
    start = _appointment_local_datetime(appointment.requested_start, appointment.timezone)
    end = (
        _appointment_local_datetime(appointment.requested_end, appointment.timezone)
        if appointment.requested_end is not None
        else None
    )
    if end is not None:
        if start.date() == end.date():
            return f"{_format_dt_for_customer(start)}–{_format_time_for_customer(end)} {tz}"
        return f"{_format_dt_for_customer(start)}–{_format_dt_for_customer(end)} {tz}"
    return f"{_format_dt_for_customer(start)} {tz}"


async def _record_customer_system_message(
    job_id: UUID,
    *,
    body: str,
    event: str,
    organization_id: str | None = None,
) -> dict[str, Any]:
    """Add a customer-visible breadcrumb to the secure job thread.

    This is not an SMS sender. New transactional SMS purposes need separate
    compliance/product review; the secure customer thread can still explain
    what changed on the job.
    """
    return await store.create_job_message(
        job_id,
        channel="customer",
        sender_type="system",
        sender_user_id=None,
        sender_organization_id=organization_id,
        body=body[:2000],
        metadata={"event": event},
    )


async def _notify_technician_message(job_id: UUID, row: dict[str, Any]) -> None:
    """Privacy-safe message push hint for the assigned technician. Push is still
    best-effort/nullable through api.push; the server thread remains source of truth."""
    if row.get("sender_type") == "technician":
        return
    lifecycle = await store.get_job_lifecycle(job_id)
    tech_id = (lifecycle or {}).get("fulfillment_technician_id")
    if not tech_id:
        return
    thread_id: UUID | None = None
    if row.get("thread_id"):
        try:
            thread_id = UUID(str(row["thread_id"]))
        except ValueError:
            thread_id = None
    try:
        await push_service.notify_technician(
            store,
            UUID(str(tech_id)),
            alert_class="message",
            job_id=job_id,
            thread_id=thread_id,
            envelope={
                "type": "job_message",
                "job_id": str(job_id),
                "channel": row.get("channel"),
                "message_id": row.get("id"),
                "title": "New message about your active job",
                "body": "Open ClueXP to view the secure job thread.",
            },
        )
    except Exception:
        logger.exception("message_push_notify_failed", extra={"job_id": str(job_id), "message_id": row.get("id")})


async def _require_technician_message_job(job_id: UUID, session: dict[str, Any]) -> dict[str, Any]:
    require_any_role(session, {"technician"})
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None or lifecycle.get("fulfillment_technician_id") != tech.get("id"):
        raise HTTPException(status_code=404, detail="Job not found")
    if lifecycle.get("status") not in _MESSAGE_WRITABLE_STATUSES:
        raise HTTPException(status_code=409, detail="Messaging is closed for this job.")
    return lifecycle


def _message_read_result(messages: list[dict[str, Any]], unread_count: int) -> dict[str, Any]:
    return {"messages": [_public_message(row) for row in messages], "unread_count": unread_count}


def _public_call_session(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "job_id": row.get("job_id"),
        "caller_type": row.get("caller_type"),
        "callee_type": row.get("callee_type"),
        "provider": row.get("provider"),
        "status": row.get("status"),
        "provider_status": row.get("provider_status"),
        "masked_number": row.get("masked_number"),
        "created_at": row.get("created_at"),
    }


def _call_unavailable_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "available": False,
        "message": "Masked calling provider is not configured.",
        "call": _public_call_session(row),
    }


_CALL_ALLOWED_STATUSES = {
    STATUS_ASSIGNED,
    STATUS_EN_ROUTE,
    STATUS_ARRIVED,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED_PENDING,
}
_PROVIDER_CUSTOMER_CALL_ALLOWED_STATUSES = {
    *_CALL_ALLOWED_STATUSES,
    STATUS_COMPLETED_CONFIRMED,
    STATUS_COMPLETED_AUTO_CLOSED,
    STATUS_DISPUTED,
    STATUS_CANCELLED,
    STATUS_NO_SHOW,
}
_SMS_PURPOSES = {
    "intake_confirmation",
    "technician_assigned",
    "technician_en_route",
    "technician_arrived",
    "completion_awaiting_customer_confirmation",
    "tracking_link_reminder",
    "provider_missed_call_callback_notice",
    "crm_callback_confirmation",
    "crm_service_follow_up",
    "crm_warranty_reminder",
}


def _twilio_status_callback_url(path: str) -> str | None:
    base = os.environ.get("TWILIO_WEBHOOK_BASE_URL", "").strip().rstrip("/")
    if not base:
        return None
    if base.endswith("/api") and path.startswith("/api/"):
        path = path[4:]
    return f"{base}{path}"


def _safe_phone_settings(row: dict | None) -> dict[str, Any]:
    row = row or {}
    return {
        "twilio_number": row.get("twilio_number"),
        "primary_forwarding_number": row.get("primary_forwarding_number"),
        "backup_forwarding_number": row.get("backup_forwarding_number"),
        "ring_timeout_seconds": row.get("ring_timeout_seconds", 20),
        "business_hours_behavior": row.get("business_hours_behavior", "always_forward"),
        "voicemail_enabled": bool(row.get("voicemail_enabled", True)),
        "sms_enabled": bool(row.get("sms_enabled", False)),
        "masked_calling_enabled": bool(row.get("masked_calling_enabled", False)),
        "a2p_registered": bool(row.get("a2p_registered", False)),
        "updated_at": row.get("updated_at"),
    }


def _validate_phone_settings_payload(payload: ProviderPhoneSettingsUpdate) -> dict[str, Any]:
    raw = payload.model_dump(exclude_unset=True)
    out: dict[str, Any] = {}
    ops_only_fields = {"twilio_number", "a2p_registered"}
    requested_ops_fields = sorted(field for field in ops_only_fields if field in raw)
    if requested_ops_fields:
        raise HTTPException(
            status_code=403,
            detail=f"{', '.join(requested_ops_fields)} can only be managed by ClueXP ops.",
        )
    phone_fields = {"primary_forwarding_number", "backup_forwarding_number"}
    for field, value in raw.items():
        if field in phone_fields:
            if value is None:
                out[field] = None
            else:
                normalized = normalize_e164(value)
                if not normalized:
                    raise HTTPException(status_code=422, detail=f"{field} must be a valid E.164-capable phone number")
                out[field] = normalized
        elif field == "ring_timeout_seconds":
            if value is None:
                out[field] = 20
            elif int(value) < 5 or int(value) > 60:
                raise HTTPException(status_code=422, detail="ring_timeout_seconds must be between 5 and 60")
            else:
                out[field] = int(value)
        elif field == "business_hours_behavior":
            if value not in {"always_forward", "voicemail_after_hours", None}:
                raise HTTPException(status_code=422, detail="Invalid business_hours_behavior")
            out[field] = value or "always_forward"
        else:
            out[field] = bool(value)
    return out


async def _start_masked_call(
    job_id: UUID,
    *,
    caller_type: str,
    callee_type: str,
    caller_user_id: str | None = None,
    caller_technician_id: str | None = None,
    caller_organization_id: str | None = None,
    callee_technician_id: str | None = None,
    callee_organization_id: str | None = None,
    allowed_statuses: set[str] | None = None,
) -> dict[str, Any]:
    context = await store.get_job_call_context(job_id)
    if context is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if context.get("status") not in (allowed_statuses or _CALL_ALLOWED_STATUSES):
        raise HTTPException(status_code=409, detail="Calling is closed for this job.")
    org_id = caller_organization_id or callee_organization_id or context.get("fulfillment_org_id") or context.get("customer_owner_org_id")
    settings = await store.get_organization_phone_settings(str(org_id)) if org_id else None
    from_number = normalize_e164((settings or {}).get("twilio_number") or os.environ.get("TWILIO_DEFAULT_FROM_NUMBER"))
    if not from_number:
        result_row = await store.create_job_call_session(
            job_id,
            caller_type=caller_type,
            caller_user_id=caller_user_id,
            caller_technician_id=caller_technician_id,
            caller_organization_id=caller_organization_id,
            callee_type=callee_type,
            callee_technician_id=callee_technician_id,
            callee_organization_id=callee_organization_id,
            status="unavailable",
            provider_status="skipped_no_provider",
            metadata={"reason": "missing_provider_number"},
        )
        return _call_unavailable_response(result_row)
    if not (settings or {}).get("masked_calling_enabled"):
        result_row = await store.create_job_call_session(
            job_id,
            caller_type=caller_type,
            caller_user_id=caller_user_id,
            caller_technician_id=caller_technician_id,
            caller_organization_id=caller_organization_id,
            callee_type=callee_type,
            callee_technician_id=callee_technician_id,
            callee_organization_id=callee_organization_id,
            status="unavailable",
            provider_status="skipped_no_provider",
            metadata={"reason": "masked_calling_disabled"},
        )
        return {"available": False, "message": "Masked calling is disabled for this provider.", "call": _public_call_session(result_row)}
    caller_number = {
        "technician": context.get("technician_phone"),
        "customer": context.get("customer_phone"),
        "dispatcher": (settings or {}).get("primary_forwarding_number") or context.get("organization_phone"),
        "provider_admin": (settings or {}).get("primary_forwarding_number") or context.get("organization_phone"),
    }.get(caller_type)
    callee_number = {
        "customer": context.get("customer_phone"),
        "technician": context.get("technician_phone"),
        "operations": (settings or {}).get("primary_forwarding_number") or context.get("organization_phone"),
    }.get(callee_type)
    caller_e164 = normalize_e164(caller_number)
    callee_e164 = normalize_e164(callee_number)
    if not caller_e164 or not callee_e164:
        row = await store.create_job_call_session(
            job_id,
            caller_type=caller_type,
            caller_user_id=caller_user_id,
            caller_technician_id=caller_technician_id,
            caller_organization_id=caller_organization_id,
            callee_type=callee_type,
            callee_technician_id=callee_technician_id,
            callee_organization_id=callee_organization_id,
            status="failed",
            provider_status="failed",
            masked_number=from_number,
            metadata={"reason": "call_party_unreachable"},
        )
        raise HTTPException(status_code=409, detail={"code": "call_party_unreachable", "message": "A verified phone number is missing for this call.", "call": _public_call_session(row)})
    row = await store.create_job_call_session(
        job_id,
        caller_type=caller_type,
        caller_user_id=caller_user_id,
        caller_technician_id=caller_technician_id,
        caller_organization_id=caller_organization_id,
        callee_type=callee_type,
        callee_technician_id=callee_technician_id,
        callee_organization_id=callee_organization_id,
        provider=None,
        provider_call_sid=None,
        masked_number=None,
        status="requested",
        provider_status="queued",
        metadata={"caller_redacted": redact_phone(caller_e164), "callee_redacted": redact_phone(callee_e164)},
    )
    result = await run_in_threadpool(
        get_communications_provider().start_masked_call,
        caller_number=caller_e164,
        callee_number=callee_e164,
        from_number=from_number,
        status_callback_url=_twilio_status_callback_url("/api/twilio/voice/status"),
    )
    updated = await store.update_job_call_session(
        row["id"],
        provider=result.provider,
        provider_call_sid=result.provider_call_sid,
        masked_number=result.masked_number,
        status=result.status,
        provider_status=result.provider_status,
        metadata=result.metadata,
    )
    row = updated or row
    return {"available": result.available, "message": result.message, "call": _public_call_session(row)}


def _twilio_call_status_to_internal(status: str | None) -> str:
    value = (status or "").strip().lower()
    return {
        "queued": "requested",
        "initiated": "initiated",
        "ringing": "ringing",
        "in-progress": "connected",
        "answered": "answered",
        "completed": "completed",
        "busy": "busy",
        "failed": "failed",
        "no-answer": "no_answer",
        "canceled": "failed",
    }.get(value, "requested")


async def _verified_twilio_form(request: Request) -> tuple[dict[str, Any], str]:
    form = await request.form()
    params = {str(k): str(v) for k, v in form.items()}
    original_path = getattr(request.state, "original_path", None)
    url = public_request_url(
        str(request.url),
        {k.lower(): v for k, v in request.headers.items()},
        original_path=original_path,
    )
    signature = request.headers.get("x-twilio-signature")
    if not verify_twilio_signature(url, params, signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")
    return params, url


@app.post("/twilio/voice/incoming")
async def twilio_voice_incoming(request: Request) -> Response:
    params, _ = await _verified_twilio_form(request)
    to_number = normalize_e164(params.get("To"))
    from_number = normalize_e164(params.get("From"))
    call_sid = params.get("CallSid")
    if not to_number or not call_sid:
        return Response(
            content=inbound_forward_twiml(
                primary_number=None,
                backup_number=None,
                caller_id=None,
                timeout_seconds=20,
                voicemail_enabled=False,
                fallback_message="We could not route this call. Please try again later.",
            ),
            media_type="application/xml",
        )
    org = await store.find_organization_by_twilio_number(to_number)
    if not org:
        return Response(
            content=inbound_forward_twiml(
                primary_number=None,
                backup_number=None,
                caller_id=None,
                timeout_seconds=20,
                voicemail_enabled=False,
                fallback_message="This ClueXP number is not assigned to a provider.",
            ),
            media_type="application/xml",
        )
    org_id = str(org["organization_id"])
    matched = await store.find_active_job_by_customer_phone(org_id, from_number) if from_number else None
    status = _twilio_call_status_to_internal(params.get("CallStatus") or "initiated")
    await store.create_job_call_session(
        UUID(matched["job_id"]) if matched and matched.get("job_id") else None,
        caller_type="customer",
        callee_type="operations",
        callee_organization_id=org_id,
        provider="twilio",
        provider_call_sid=call_sid,
        masked_number=to_number,
        status=status,
        provider_status=params.get("CallStatus") or "initiated",
        metadata={
            "direction": "inbound",
            "organization_id": org_id,
            "caller_redacted": redact_phone(from_number),
            "called_number": to_number,
            "matched_job": bool(matched),
        },
    )
    return Response(
        content=inbound_forward_twiml(
            primary_number=org.get("primary_forwarding_number"),
            backup_number=org.get("backup_forwarding_number"),
            caller_id=to_number,
            timeout_seconds=int(org.get("ring_timeout_seconds") or 20),
            voicemail_enabled=bool(org.get("voicemail_enabled", True)),
            fallback_message=f"{(org.get('organization') or {}).get('display_name') or 'This provider'} is unavailable right now. Please call again later.",
            action_url=_twilio_status_callback_url("/api/twilio/voice/after-dial"),
        ),
        media_type="application/xml",
    )


@app.post("/twilio/voice/after-dial")
async def twilio_voice_after_dial(request: Request) -> Response:
    params, _ = await _verified_twilio_form(request)
    status = (params.get("DialCallStatus") or "").strip().lower()
    if status == "completed":
        return Response(content="<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Hangup/></Response>", media_type="application/xml")
    to_number = normalize_e164(params.get("To"))
    org = await store.find_organization_by_twilio_number(to_number) if to_number else None
    name = ((org or {}).get("organization") or {}).get("display_name") or "This provider"
    voicemail_enabled = bool((org or {}).get("voicemail_enabled", True))
    return Response(
        content=inbound_forward_twiml(
            primary_number=None,
            backup_number=None,
            caller_id=to_number,
            timeout_seconds=int((org or {}).get("ring_timeout_seconds") or 20),
            voicemail_enabled=voicemail_enabled,
            fallback_message=f"{name} is unavailable right now. Please call again later.",
        ),
        media_type="application/xml",
    )


@app.post("/twilio/voice/status")
async def twilio_voice_status(request: Request) -> dict[str, Any]:
    params, _ = await _verified_twilio_form(request)
    sid = params.get("CallSid")
    if not sid:
        raise HTTPException(status_code=422, detail="CallSid is required")
    duration = None
    if params.get("CallDuration"):
        try:
            duration = int(params["CallDuration"])
        except ValueError:
            duration = None
    row = await store.update_job_call_session_by_provider_sid(
        "twilio",
        sid,
        status=_twilio_call_status_to_internal(params.get("CallStatus")),
        provider_status=params.get("CallStatus"),
        duration_seconds=duration,
        metadata={
            "twilio_sequence": params.get("SequenceNumber"),
            "twilio_error_code": params.get("ErrorCode"),
        },
    )
    if not row:
        raise HTTPException(status_code=404, detail="Call session not found")
    return {"status": "ok"}


@app.post("/twilio/sms/status")
async def twilio_sms_status(request: Request) -> dict[str, Any]:
    params, _ = await _verified_twilio_form(request)
    sid = params.get("MessageSid") or params.get("SmsSid")
    if not sid:
        raise HTTPException(status_code=422, detail="MessageSid is required")
    row = await store.update_sms_delivery_by_provider_sid(
        "twilio",
        sid,
        provider_status=params.get("MessageStatus") or params.get("SmsStatus") or "sent",
        error_code=params.get("ErrorCode"),
    )
    if not row:
        raise HTTPException(status_code=404, detail="SMS delivery not found")
    if row.get("provider_status") in {"failed", "undelivered"} and row.get("organization_id"):
        try:
            await store.create_alert(
                str(row["organization_id"]), alert_type="delivery_failure", severity="warning",
                job_id=row.get("job_id"),
                payload={"channel": "sms", "purpose": row.get("purpose"), "error_code": row.get("error_code")},
            )
        except Exception:
            logger.exception("alert_delivery_failure_failed", extra={"provider_message_sid": sid})
    return {"status": "ok"}


@app.post("/twilio/sms/incoming")
async def twilio_sms_incoming(request: Request) -> Response:
    params, _ = await _verified_twilio_form(request)
    from_number = normalize_e164(params.get("From"))
    to_number = normalize_e164(params.get("To"))
    org = await store.find_organization_by_twilio_number(to_number) if to_number else None
    org_id = str(org["organization_id"]) if org else None
    body = (params.get("Body") or "").strip().upper()
    if from_number and body in {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"}:
        await store.set_sms_opt_out(from_number, organization_id=org_id, source="sms_stop")
        response = "You are unsubscribed from ClueXP transactional SMS. Reply HELP for support."
    elif from_number and body == "START":
        await store.clear_sms_opt_out(from_number)
        response = "ClueXP transactional SMS is enabled again."
    else:
        response = "ClueXP sends service notifications only. Reply STOP to opt out."
    return Response(content=f"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>{response}</Message></Response>", media_type="application/xml")


def _sms_body(purpose: str, *, provider_name: str | None, tracking_url: str | None) -> str:
    name = provider_name or "Your service provider"
    link = f" Track: {tracking_url}" if tracking_url else ""
    messages = {
        "intake_confirmation": f"{name} received your service request.{link}",
        "technician_assigned": f"{name} assigned a technician to your request.{link}",
        "technician_en_route": f"{name}: your technician is on the way.{link}",
        "technician_arrived": f"{name}: your technician has arrived.",
        "completion_awaiting_customer_confirmation": f"{name}: service is marked complete. Please confirm in your tracking page.{link}",
        "tracking_link_reminder": f"{name}: here is your secure tracking link.{link}",
        "provider_missed_call_callback_notice": f"{name}: we missed your call and will follow up shortly.",
        "crm_callback_confirmation": f"{name}: your callback request is scheduled. We will contact you as planned. Reply STOP to opt out.",
        "crm_service_follow_up": f"{name}: checking in after your recent service. If you still need help, please call our office. Reply STOP to opt out.",
        "crm_warranty_reminder": f"{name}: your recent service may still be covered by warranty. Please call our office if you need help. Reply STOP to opt out.",
    }
    return messages[purpose]


async def _send_transactional_sms(
    job_id: UUID,
    purpose: str,
    recipient_type: str = "customer",
    *,
    organization_id: str | None = None,
    client_message_id: str | None = None,
) -> dict[str, Any]:
    if purpose not in _SMS_PURPOSES:
        raise HTTPException(status_code=422, detail=f"purpose must be one of {sorted(_SMS_PURPOSES)}")
    if recipient_type not in {"customer", "technician"}:
        raise HTTPException(status_code=422, detail="recipient_type must be customer or technician")
    context = await store.get_job_call_context(job_id)
    if context is None:
        raise HTTPException(status_code=404, detail="Job not found")
    org_id = organization_id or context.get("fulfillment_org_id") or context.get("customer_owner_org_id")
    settings = await store.get_organization_phone_settings(str(org_id)) if org_id else None
    to_number = normalize_e164(context.get("customer_phone") if recipient_type == "customer" else context.get("technician_phone"))
    from_number = normalize_e164((settings or {}).get("twilio_number") or os.environ.get("TWILIO_DEFAULT_FROM_NUMBER"))
    tracking_token = await store.get_tracking_token(job_id)
    base = os.environ.get("CUSTOMER_INTAKE_BASE_URL") or os.environ.get("NEXT_PUBLIC_INTAKE_BASE_URL") or ""
    tracking_url = f"{base.rstrip('/')}/t/{tracking_token}" if base and tracking_token else None
    req_hash = _mutation_request_hash(
        "transactional-sms", str(job_id), purpose, recipient_type,
        tracking_url or "", client_message_id or "",
    )
    org_id_str = str(org_id) if org_id else None
    existing = await store.get_sms_delivery_by_request(
        organization_id=org_id_str,
        job_id=str(job_id),
        recipient_type=recipient_type,
        purpose=purpose,
        request_hash=req_hash,
    )
    if existing:
        return {"sent": bool(existing.get("provider_message_sid")), "delivery": {**existing, "to_number": redact_phone(existing.get("to_number"))}}
    if not to_number or not from_number:
        row = await store.create_sms_delivery(
            organization_id=org_id_str,
            job_id=str(job_id),
            recipient_type=recipient_type,
            to_number=to_number or "missing",
            from_number=from_number,
            purpose=purpose,
            request_hash=req_hash,
            provider=None,
            provider_message_sid=None,
            provider_status="skipped_no_provider",
            metadata={"reason": "missing_sms_number"},
        )
        return {"sent": False, "delivery": {**row, "to_number": redact_phone(row.get("to_number"))}}
    if await store.is_sms_opted_out(to_number):
        row = await store.create_sms_delivery(
            organization_id=org_id_str,
            job_id=str(job_id),
            recipient_type=recipient_type,
            to_number=to_number,
            from_number=from_number,
            purpose=purpose,
            request_hash=req_hash,
            provider=None,
            provider_message_sid=None,
            provider_status="skipped_no_provider",
            metadata={"reason": "recipient_opted_out"},
        )
        return {"sent": False, "delivery": {**row, "to_number": redact_phone(to_number)}}
    if not (settings or {}).get("sms_enabled") or not (settings or {}).get("a2p_registered"):
        row = await store.create_sms_delivery(
            organization_id=org_id_str,
            job_id=str(job_id),
            recipient_type=recipient_type,
            to_number=to_number,
            from_number=from_number,
            purpose=purpose,
            request_hash=req_hash,
            provider=None,
            provider_message_sid=None,
            provider_status="skipped_no_provider",
            metadata={"reason": "sms_disabled_or_a2p_unregistered"},
        )
        return {"sent": False, "delivery": {**row, "to_number": redact_phone(to_number)}}
    result = await run_in_threadpool(
        get_communications_provider().send_sms,
        to_number=to_number,
        from_number=from_number,
        body=_sms_body(purpose, provider_name=context.get("organization_name"), tracking_url=tracking_url),
        status_callback_url=_twilio_status_callback_url("/api/twilio/sms/status"),
    )
    row = await store.create_sms_delivery(
        organization_id=org_id_str,
        job_id=str(job_id),
        recipient_type=recipient_type,
        to_number=to_number,
        from_number=from_number,
        purpose=purpose,
        request_hash=req_hash,
        provider=result.provider,
        provider_message_sid=result.provider_message_sid,
        provider_status=result.provider_status,
        error_code=result.error_code,
        metadata=result.metadata or {},
    )
    if result.sent and recipient_type == "customer" and org_id_str and context.get("customer_id"):
        await store.update_provider_crm_customer(
            org_id_str,
            UUID(str(context["customer_id"])),
            {"last_contacted_at": datetime.now(timezone.utc)},
        )
    return {"sent": result.sent, "delivery": {**row, "to_number": redact_phone(to_number)}}


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
    # Optimistic-concurrency precondition, checked BEFORE idempotency so a stale
    # client view never reserves a key or does work. (expected_version is a
    # precondition, not part of the mutation identity, so it stays out of the
    # idempotency hash — PR #60 replay/conflict semantics are unchanged.)
    current_version = _job_version(
        job_id, lifecycle.get("status"), lifecycle.get("lifecycle_version"))
    if payload.expected_version is not None and payload.expected_version != current_version:
        raise HTTPException(status_code=409, detail={
            "code": "version_conflict",
            "current_version": current_version,
        })
    cmid = _validated_client_mutation_id(payload.client_mutation_id)
    if cmid:
        req_hash = _mutation_request_hash("report-issue", str(job_id), kind, reason)
        rec = await store.begin_or_get_technician_mutation(UUID(tech["id"]), cmid, req_hash)
        if rec["state"] == "done":  # exact retry -> replay the recorded result
            return rec["response"]
        if rec["state"] == "conflict":  # same key, materially different request
            raise HTTPException(status_code=409, detail={
                "code": "idempotency_key_reuse",
                "message": "This client_mutation_id was already used with a different request.",
            })
        if rec["state"] == "pending":  # reserved but not finished (concurrent retry)
            raise HTTPException(status_code=409, detail={
                "code": "idempotency_in_progress",
                "message": "A mutation with this client_mutation_id is still being processed.",
            })
    await store.log_event_raw(job_id, f"tech_issue:{kind}:by={tech['id']}:{reason}")
    if kind == "unsafe":
        org_id = lifecycle.get("fulfillment_org_id") or lifecycle.get("customer_owner_org_id")
        if org_id:
            try:
                await store.create_alert(
                    str(org_id), alert_type="safety_flag", severity="critical", job_id=job_id,
                    payload={"kind": kind},
                )
            except Exception:
                logger.exception("alert_safety_flag_failed", extra={"job_id": str(job_id)})
    result = {"reported": True, "kind": kind}
    if cmid:
        await store.complete_technician_mutation(
            UUID(tech["id"]), cmid, status_code=200, response=result)
    return result


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
    current_version = _job_version(
        job_id, lifecycle.get("status"), lifecycle.get("lifecycle_version"))
    if payload.expected_version is not None and payload.expected_version != current_version:
        raise HTTPException(status_code=409, detail={
            "code": "version_conflict",
            "current_version": current_version,
        })
    closeout, method = await _build_closeout_report(job_id=job_id, payload=payload, lifecycle=lifecycle)
    payment_amount = round(float(closeout["total_cents"]) / 100, 2)
    cmid = _validated_client_mutation_id(payload.client_mutation_id)
    if cmid:
        req_hash = _mutation_request_hash(
            "report-collection",
            str(job_id),
            {
                "currency": closeout["currency"],
                "method": method,
                "line_items": closeout["line_items"],
                "subtotal_cents": closeout["subtotal_cents"],
                "taxable_subtotal_cents": closeout["taxable_subtotal_cents"],
                "tax_rate_basis_points": closeout["tax_rate_basis_points"],
                "tax_cents": closeout["tax_cents"],
                "tip_cents": closeout["tip_cents"],
                "card_fee_basis_points": closeout["card_fee_basis_points"],
                "card_fee_fixed_cents": closeout["card_fee_fixed_cents"],
                "card_fee_cents": closeout["card_fee_cents"],
                "total_cents": closeout["total_cents"],
                "no_tax_reason": closeout["no_tax_reason"],
            },
        )
        rec = await store.begin_or_get_technician_mutation(UUID(tech["id"]), cmid, req_hash)
        if rec["state"] == "done":
            return rec["response"]
        if rec["state"] == "conflict":
            raise HTTPException(status_code=409, detail={
                "code": "idempotency_key_reuse",
                "message": "This client_mutation_id was already used with a different request.",
            })
        if rec["state"] == "pending":
            raise HTTPException(status_code=409, detail={
                "code": "idempotency_in_progress",
                "message": "A mutation with this client_mutation_id is still being processed.",
            })
    saved_closeout = await store.record_job_closeout(closeout)
    report = await store.record_payment_report(
        job_id=job_id,
        reported_by="technician",
        amount=payment_amount,
        method=method,
        currency="USD",
    )
    result = {"status": "recorded", "payment": report, "closeout": saved_closeout}
    if cmid:
        await store.complete_technician_mutation(
            UUID(tech["id"]), cmid, status_code=200, response=result)
    return result


@app.get("/jobs/{job_id}/messages")
async def technician_list_job_messages(
    job_id: UUID,
    channel: str = "operations",
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Assigned technician reads a job-scoped communication thread for their
    active assignment. Customer messaging is template-only in this slice."""
    channel = _message_channel(channel)
    lifecycle = await _require_technician_message_job(job_id, session)
    tech = session["technician"]
    rows = await store.list_job_messages(job_id, channel=channel)
    unread = await store.count_unread_job_messages(
        job_id,
        channel=channel,
        recipient_type="technician",
        recipient_user_id=str(session.get("user", {}).get("id") or tech["id"]),
        recipient_technician_id=str(lifecycle.get("fulfillment_technician_id") or tech["id"]),
    )
    return _message_read_result(rows, unread)


@app.post("/jobs/{job_id}/messages/read")
async def technician_mark_job_messages_read(
    job_id: UUID,
    channel: str = "operations",
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    channel = _message_channel(channel)
    lifecycle = await _require_technician_message_job(job_id, session)
    tech = session["technician"]
    return await store.mark_job_messages_read(
        job_id,
        channel=channel,
        recipient_type="technician",
        recipient_user_id=str(session.get("user", {}).get("id") or tech["id"]),
        recipient_technician_id=str(lifecycle.get("fulfillment_technician_id") or tech["id"]),
    )


@app.post("/jobs/{job_id}/messages")
async def technician_send_job_message(
    job_id: UUID,
    payload: JobMessageRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Assigned technician sends a job-scoped message. Operations accepts free
    text; customer is template-only for this slice. Idempotent for native
    offline replay."""
    channel = _message_channel(payload.channel)
    await _require_technician_message_job(job_id, session)
    tech = session["technician"]
    cmid = _validated_client_message_id(payload.client_message_id)
    body, template_code, template_params = _message_content(payload, channel=channel)
    req_hash = _mutation_request_hash(
        "job-message", str(job_id), channel, "technician", body, template_code, template_params)
    row = await store.create_job_message(
        job_id,
        channel=channel,
        sender_type="technician",
        sender_user_id=str(session.get("user", {}).get("id") or tech["id"]),
        sender_technician_id=str(tech["id"]),
        body=body,
        template_code=template_code,
        template_params=template_params,
        client_message_id=cmid,
        request_hash=req_hash,
    )
    if row.get("error_code") == "idempotency_key_reuse":
        raise HTTPException(status_code=409, detail={
            "code": "idempotency_key_reuse",
            "message": "This client_message_id was already used with a different message.",
        })
    await _notify_technician_message(job_id, row)
    return {"message": _public_message(row)}


@app.post("/jobs/{job_id}/calls/{callee_type}")
async def technician_start_job_call(
    job_id: UUID,
    callee_type: str,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    if callee_type not in {"customer", "operations"}:
        raise HTTPException(status_code=404, detail="Not found")
    lifecycle = await _require_technician_message_job(job_id, session)
    tech = session["technician"]
    return await _start_masked_call(
        job_id,
        caller_type="technician",
        caller_user_id=str(session.get("user", {}).get("id") or tech["id"]),
        caller_technician_id=str(tech["id"]),
        callee_type=callee_type,
        callee_organization_id=lifecycle.get("fulfillment_org_id") if callee_type == "operations" else None,
    )


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


@app.get("/technician/settlements")
async def technician_settlements(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """The signed-in technician's settlement estimates and provider-approved
    settlement period rows. This is technician-scoped and does not expose other
    technicians or company-retained amounts beyond the technician's own rows."""
    require_any_role(session, {"technician"})
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    return await store.list_technician_settlements(UUID(tech["id"]))


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


# --- alerts (0054): dispatcher/provider_admin escalation inbox ---

@app.get("/provider/alerts")
async def provider_list_alerts(
    status: str | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """The company's own alert inbox, optionally filtered by status. Scoped to
    session.active_organization_id — no cross-tenant leak vector by construction."""
    org_id = _require_dispatch_org(session)
    if status is not None and status not in {"open", "acknowledged", "resolved"}:
        raise HTTPException(status_code=422, detail="status must be one of open, acknowledged, resolved")
    return {"alerts": await store.list_alerts(org_id, status=status)}


async def _require_org_alert(org_id: str, alert_id: UUID) -> dict[str, Any]:
    """Matches _require_org_job precedent: 404 (not 403) on a foreign or
    missing alert, no cross-tenant existence leak."""
    alert = await store.get_alert(alert_id)
    if alert is None or str(alert.get("organization_id")) != str(org_id):
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@app.post("/provider/alerts/{alert_id}/ack")
async def provider_ack_alert(
    alert_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    await _require_org_alert(org_id, alert_id)
    actor_id = session.get("user", {}).get("id")
    updated = await store.acknowledge_alert(alert_id, actor_id)
    return {"alert": updated}


@app.post("/provider/alerts/{alert_id}/resolve")
async def provider_resolve_alert(
    alert_id: UUID, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    await _require_org_alert(org_id, alert_id)
    updated = await store.resolve_alert(alert_id)
    return {"alert": updated}


@app.get("/admin/alerts")
async def admin_list_alerts(
    status: str | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Platform ops: read-only view of alerts across every organization. No
    ack/resolve capability here — ops observes, the owning company's own
    dispatcher/provider_admin acts on their alerts."""
    require_any_role(session, {"platform_admin"})
    if status is not None and status not in {"open", "acknowledged", "resolved"}:
        raise HTTPException(status_code=422, detail="status must be one of open, acknowledged, resolved")
    return {"alerts": await store.list_all_alerts(status=status)}


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


@app.get("/provider/crm/customers")
async def provider_crm_customers(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """Customer relationships derived from this organization's jobs, enriched with
    organization-private follow-up, warranty, consent, and notes fields."""
    org_id = _require_dispatch_org(session)
    return await store.list_provider_crm_customers(org_id)


@app.patch("/provider/crm/customers/{customer_id}")
async def provider_crm_customer_update(
    customer_id: UUID,
    payload: ProviderCrmCustomerUpdate,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    data = payload.model_dump(exclude_unset=True)
    customer = await store.update_provider_crm_customer(
        org_id,
        customer_id,
        data,
        updated_by=session.get("user", {}).get("id"),
    )
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found in your organization")
    return customer


def _csv_escape(value: Any) -> str:
    text = "" if value is None else str(value)
    if any(ch in text for ch in [",", "\"", "\n", "\r"]):
        return "\"" + text.replace("\"", "\"\"") + "\""
    return text


def _parse_report_date(value: str | None, field: str) -> str | None:
    if not value:
        return None
    from datetime import date
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} must be a YYYY-MM-DD date")


def _report_period(period_start: str | None, period_end: str | None) -> tuple[str | None, str | None]:
    start = _parse_report_date(period_start, "period_start")
    end = _parse_report_date(period_end, "period_end")
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="Period start must be before period end.")
    return start, end


@app.get("/provider/settlements", response_model=None)
async def provider_settlements(
    format: str | None = None,
    technician_id: UUID | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]] | Response:
    """Provider settlement rows derived from technician closeouts and the
    provider-tech agreement. Parts/items are excluded from commission and
    tech-provided reimbursable items are separated for settlement. Optional
    technician/date filters power the per-technician financial report."""
    org_id = _require_dispatch_org(session)
    start, end = _report_period(period_start, period_end)
    rows = await store.list_provider_settlements(
        org_id, technician_id=str(technician_id) if technician_id else None,
        period_start=start, period_end=end,
    )
    if format == "csv":
        return Response(content=_settlement_csv(rows), media_type="text/csv")
    return rows


@app.get("/provider/settlements/by-technician")
async def provider_settlements_by_technician(
    period_start: str | None = None,
    period_end: str | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """One aggregate row per technician (affiliated or not) over the period:
    volumes, cuts, reviews, and the signed settlement balance (positive =
    company owes tech, negative = tech collected and owes the company).
    Each row also carries `balance`: the ALL-TIME payment-ledger position for
    the pair -- the period filter scopes the report, never the ledger."""
    org_id = _require_dispatch_org(session)
    start, end = _report_period(period_start, period_end)
    rows = await store.list_provider_settlements(org_id, period_start=start, period_end=end, limit=1000)
    groups = aggregate_settlements_by_technician(rows)
    all_time_groups = groups if not (start or end) else aggregate_settlements_by_technician(
        await store.list_provider_settlements(org_id, limit=1000)
    )
    all_time_by_tech = {g["technician_id"]: g for g in all_time_groups}
    payments_by_tech: dict[str, list[dict[str, Any]]] = {}
    for payment in await store.list_settlement_payments(org_id, limit=2000):
        payments_by_tech.setdefault(str(payment["technician_id"]), []).append(payment)
    for group in groups:
        tid = group["technician_id"]
        group["balance"] = compute_settlement_payment_balance(
            all_time_by_tech.get(tid), payments_by_tech.get(tid, [])
        )
    return groups


@app.get("/provider/financial-overview")
async def provider_financial_overview(
    period_start: str | None = None,
    period_end: str | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Aggregated Financial Overview dashboard. Unlike /provider/settlements and
    /provider/settlements/by-technician (both capped report endpoints), this
    walks the organization's COMPLETE settlement/payment/period history with no
    row-count cap -- see store.get_provider_financial_overview. The response is
    aggregates only; it never ships a raw, unbounded ledger to the browser."""
    org_id = _require_dispatch_org(session)
    start, end = _report_period(period_start, period_end)
    return await store.get_provider_financial_overview(org_id, period_start=start, period_end=end)


_SETTLEMENT_PAYMENT_STATUSES = {"pending", "confirmed", "rejected", "voided"}
_SETTLEMENT_PAYMENT_DIRECTIONS = {"company_to_technician", "technician_to_company"}


def _validate_settlement_payment_fields(
    amount_cents: int, payment_method: str, paid_on: str | None
) -> tuple[int, str, str]:
    """Shared validation for provider- and technician-created ledger entries.
    Returns (amount_cents, method, paid_on) or raises 422."""
    if amount_cents <= 0:
        raise HTTPException(status_code=422, detail="Amount must be greater than zero")
    if amount_cents > 100_000_000:
        raise HTTPException(status_code=422, detail="Amount is implausibly large")
    method = normalize_settlement_payment_method(payment_method)
    if method is None:
        raise HTTPException(status_code=422, detail="Unknown payment method")
    from datetime import date
    paid = _parse_report_date(paid_on, "paid_on") or date.today().isoformat()
    return amount_cents, method, paid


async def _require_org_technician_relationship(org_id: str, technician_id: UUID) -> None:
    agreement, _, _ = await store.get_provider_technician_agreement_for_reporting(
        UUID(str(org_id)), technician_id
    )
    if agreement is None:
        raise HTTPException(status_code=404, detail="Technician has no relationship with this company")


@app.get("/provider/settlement-payments", response_model=None)
async def provider_settlement_payments(
    technician_id: UUID | None = None,
    status: str | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
    format: str | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]] | Response:
    """The company<->technician payment ledger: what actually moved, as opposed
    to settlement periods (what was approved). Date filters apply to paid_on."""
    org_id = _require_dispatch_org(session)
    start, end = _report_period(period_start, period_end)
    if status and status not in _SETTLEMENT_PAYMENT_STATUSES:
        raise HTTPException(status_code=422, detail="Unknown payment status")
    rows = await store.list_settlement_payments(
        org_id, technician_id=str(technician_id) if technician_id else None,
        status=status, period_start=start, period_end=end,
    )
    if format == "csv":
        columns = [
            "id", "paid_on", "technician_id", "technician_display_name", "direction",
            "amount_cents", "payment_method", "reference_number", "status",
            "submitted_by_role", "note", "settlement_period_id", "created_at",
            "confirmed_at", "rejected_reason", "void_reason",
        ]
        body = "\n".join(
            [",".join(columns)]
            + [",".join(_csv_escape(row.get(col)) for col in columns) for row in rows]
        )
        return Response(content=body + "\n", media_type="text/csv")
    return rows


@app.post("/provider/settlement-payments")
async def create_provider_settlement_payment(
    payload: SettlementPaymentCreateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Provider-logged payment: confirmed immediately, reduces the outstanding
    balance. Either direction. The wrong entry is voided later, never edited."""
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    if payload.direction not in _SETTLEMENT_PAYMENT_DIRECTIONS:
        raise HTTPException(status_code=422, detail="Unknown payment direction")
    amount, method, paid_on = _validate_settlement_payment_fields(
        payload.amount_cents, payload.payment_method, payload.paid_on
    )
    await _require_org_technician_relationship(org_id, payload.technician_id)
    source_start, source_end = _report_period(payload.source_period_start, payload.source_period_end)
    return await store.create_settlement_payment(
        org_id,
        {
            "technician_id": str(payload.technician_id),
            "direction": payload.direction,
            "amount_cents": amount,
            "payment_method": method,
            "paid_on": paid_on,
            "reference_number": (payload.reference_number or "").strip()[:120] or None,
            "note": (payload.note or "").strip()[:280] or None,
            "settlement_period_id": str(payload.settlement_period_id) if payload.settlement_period_id else None,
            "source_period_start": source_start,
            "source_period_end": source_end,
        },
        submitted_by=session.get("user", {}).get("id"),
        submitted_by_role="provider",
        status="confirmed",
    )


@app.post("/provider/settlement-payments/{payment_id}/confirm")
async def confirm_provider_settlement_payment(
    payment_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    try:
        payment = await store.confirm_settlement_payment(
            org_id, payment_id, actor_id=session.get("user", {}).get("id")
        )
    except ValueError:
        raise HTTPException(status_code=409, detail="Only pending payments can be confirmed.")
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


@app.post("/provider/settlement-payments/{payment_id}/reject")
async def reject_provider_settlement_payment(
    payment_id: UUID,
    payload: SettlementPaymentReasonRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A rejection reason is required.")
    try:
        payment = await store.reject_settlement_payment(
            org_id, payment_id, actor_id=session.get("user", {}).get("id"), reason=reason[:280]
        )
    except ValueError:
        raise HTTPException(status_code=409, detail="Only pending payments can be rejected.")
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


@app.post("/provider/settlement-payments/{payment_id}/void")
async def void_provider_settlement_payment(
    payment_id: UUID,
    payload: SettlementPaymentReasonRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A void reason is required.")
    try:
        payment = await store.void_settlement_payment(
            org_id, payment_id, actor_id=session.get("user", {}).get("id"), reason=reason[:280]
        )
    except ValueError:
        raise HTTPException(status_code=409, detail="Only confirmed payments can be voided; reject pending ones instead.")
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


@app.get("/technician/payments")
async def technician_payments(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    """The signed-in technician's settlement payment history across all their
    provider relationships, both directions, all statuses."""
    require_any_role(session, {"technician"})
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    return await store.list_technician_settlement_payments(UUID(tech["id"]))


@app.post("/technician/payments")
async def create_technician_payment(
    payload: TechnicianPaymentCreateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Technician-submitted remittance (always technician_to_company). Created
    PENDING -- it does not reduce the outstanding balance until a provider
    admin confirms it."""
    require_any_role(session, {"technician"})
    tech = session.get("technician")
    if not tech:
        raise HTTPException(status_code=409, detail="Technician profile is required")
    amount, method, paid_on = _validate_settlement_payment_fields(
        payload.amount_cents, payload.payment_method, payload.paid_on
    )
    await _require_org_technician_relationship(str(payload.organization_id), UUID(tech["id"]))
    return await store.create_settlement_payment(
        str(payload.organization_id),
        {
            "technician_id": tech["id"],
            "direction": "technician_to_company",
            "amount_cents": amount,
            "payment_method": method,
            "paid_on": paid_on,
            "reference_number": (payload.reference_number or "").strip()[:120] or None,
            "note": (payload.note or "").strip()[:280] or None,
            "settlement_period_id": None,
            "source_period_start": None,
            "source_period_end": None,
        },
        submitted_by=session.get("user", {}).get("id"),
        submitted_by_role="technician",
        status="pending",
    )


def _settlement_csv(rows: list[dict[str, Any]]) -> str:
    columns = [
        "job_id", "technician_id", "technician_display_name", "status", "finished_at",
        "agreement_status", "cut_basis_points", "customer_total_cents", "tax_cents",
        "card_fee_cents", "tip_cents", "commissionable_cents",
        "company_provided_items_cents", "tech_reimbursement_cents",
        "tech_service_payout_cents", "tech_tip_cents", "tech_payout_cents",
        "company_retained_cents", "payment_method", "settlement_value_cents",
    ]
    return "\n".join(
        [",".join(columns)]
        + [",".join(_csv_escape(row.get(col)) for col in columns) for row in rows]
    ) + "\n"


@app.post("/provider/settlement-periods")
async def create_provider_settlement_period(
    payload: SettlementPeriodCreateRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    data = payload.model_dump(mode="json")
    if data.get("period_start") and data.get("period_end") and data["period_start"] > data["period_end"]:
        raise HTTPException(status_code=422, detail="Period start must be before period end.")
    return await store.create_provider_settlement_period(
        org_id, data, created_by=session.get("user", {}).get("id")
    )


@app.get("/provider/settlement-periods")
async def list_provider_settlement_periods(
    session: dict[str, Any] = Depends(require_session),
) -> list[dict[str, Any]]:
    org_id = _require_dispatch_org(session)
    return await store.list_provider_settlement_periods(org_id)


@app.get("/provider/settlement-periods/{period_id}", response_model=None)
async def get_provider_settlement_period(
    period_id: UUID,
    format: str | None = None,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any] | Response:
    org_id = _require_dispatch_org(session)
    period = await store.get_provider_settlement_period(org_id, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Settlement period not found")
    if format == "csv":
        return Response(content=_settlement_csv(period.get("rows", [])), media_type="text/csv")
    return period


@app.post("/provider/settlement-periods/{period_id}/lock")
async def lock_provider_settlement_period(
    period_id: UUID,
    payload: SettlementActionRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    try:
        period = await store.lock_provider_settlement_period(
            org_id, period_id, actor_id=session.get("user", {}).get("id"), note=payload.note
        )
    except ValueError:
        raise HTTPException(status_code=409, detail="Only draft settlement periods can be locked.")
    if period is None:
        raise HTTPException(status_code=404, detail="Settlement period not found")
    return period


@app.post("/provider/settlement-periods/{period_id}/paid")
async def mark_provider_settlement_period_paid(
    period_id: UUID,
    payload: SettlementActionRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    org_id = _require_dispatch_org(session)
    try:
        period = await store.mark_provider_settlement_period_paid(
            org_id, period_id, actor_id=session.get("user", {}).get("id"), note=payload.note
        )
    except ValueError:
        raise HTTPException(status_code=409, detail="Only locked settlement periods can be marked paid.")
    if period is None:
        raise HTTPException(status_code=404, detail="Settlement period not found")
    return period


@app.post("/provider/settlement-periods/{period_id}/adjustments")
async def add_provider_settlement_adjustment(
    period_id: UUID,
    payload: SettlementAdjustmentRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    require_any_role(session, {"provider_admin"})
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="Adjustment reason is required.")
    org_id = _require_dispatch_org(session)
    try:
        period = await store.add_provider_settlement_adjustment(
            org_id,
            period_id,
            {"amount_cents": payload.amount_cents, "reason": reason[:280]},
            actor_id=session.get("user", {}).get("id"),
        )
    except ValueError:
        raise HTTPException(status_code=409, detail="Adjustments can only be added to draft settlement periods.")
    if period is None:
        raise HTTPException(status_code=404, detail="Settlement period not found")
    return period


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
        expected_statuses=[
            STATUS_SCHEDULED_REQUESTED,
            STATUS_SCHEDULED_CONFIRMED,
            STATUS_PARTNER_REQUESTED,
            STATUS_PENDING_DISPATCH,
            *_ASSIGNED_LADDER,
        ],
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


@app.post("/provider/jobs/{job_id}/completion/confirm")
async def provider_confirm_completion(
    job_id: UUID, payload: RecoveryRequest, session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Owning provider confirms customer receipt by phone for call-center jobs
    that have no practical customer tracking-page confirmation path. Tenant-scoped
    and reason-required; customer-facing web jobs must use /t/{token}/confirm."""
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, job_id)
    reason = (payload.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A phone confirmation note is required.")
    lifecycle = await store.get_job_lifecycle(job_id)
    if lifecycle is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if lifecycle["status"] != STATUS_COMPLETED_PENDING:
        raise HTTPException(status_code=409, detail="Job is not awaiting customer confirmation")
    ticket = await require_ticket(job_id)
    ticket_channel = getattr(ticket.channel, "value", str(ticket.channel))
    if ticket_channel != "voice":
        raise HTTPException(status_code=409, detail="Provider receipt confirmation is only available for call-center intake jobs.")
    updated = await store.set_job_status(
        job_id, STATUS_COMPLETED_CONFIRMED,
        expected_current=STATUS_COMPLETED_PENDING, extra_timestamps=["closed_at"],
    )
    if updated is None:
        raise HTTPException(status_code=409, detail="Status changed concurrently")
    actor_id = session.get("user", {}).get("id", "unknown")
    await store.log_event_raw(
        job_id, f"completion:provider_receipt_confirmed:by={actor_id}:org={org_id}:reason={reason[:140]}"
    )
    return {"status": updated["status"]}


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


@app.get("/provider/jobs/{job_id}/messages")
async def provider_list_job_messages(
    job_id: UUID,
    channel: str = "operations",
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Owning/fulfilling company reads a job-scoped communication thread.
    Provider internal notes stay separate and are never surfaced here."""
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, job_id)
    channel = _message_channel(channel)
    rows = await store.list_job_messages(job_id, channel=channel)
    roles = set(session.get("roles", []))
    recipient_type = "provider_admin" if "provider_admin" in roles else "dispatcher"
    unread = await store.count_unread_job_messages(
        job_id,
        channel=channel,
        recipient_type=recipient_type,
        recipient_user_id=session.get("user", {}).get("id"),
        recipient_organization_id=org_id,
    )
    return _message_read_result(rows, unread)


@app.post("/provider/jobs/{job_id}/messages/read")
async def provider_mark_job_messages_read(
    job_id: UUID,
    channel: str = "operations",
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, job_id)
    channel = _message_channel(channel)
    roles = set(session.get("roles", []))
    recipient_type = "provider_admin" if "provider_admin" in roles else "dispatcher"
    return await store.mark_job_messages_read(
        job_id,
        channel=channel,
        recipient_type=recipient_type,
        recipient_user_id=session.get("user", {}).get("id"),
        recipient_organization_id=org_id,
    )


@app.post("/provider/jobs/{job_id}/messages")
async def provider_send_job_message(
    job_id: UUID,
    payload: JobMessageRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    """Dispatcher/provider admin replies in a job-scoped thread for one of
    their tenant-scoped jobs. Customer-visible sends are template-only."""
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, job_id)
    channel = _message_channel(payload.channel)
    cmid = _validated_client_message_id(payload.client_message_id)
    body, template_code, template_params = _message_content(payload, channel=channel)
    roles = set(session.get("roles", []))
    sender_type = "provider_admin" if "provider_admin" in roles else "dispatcher"
    req_hash = _mutation_request_hash(
        "job-message", str(job_id), channel, sender_type, body, template_code, template_params)
    row = await store.create_job_message(
        job_id,
        channel=channel,
        sender_type=sender_type,
        sender_user_id=session.get("user", {}).get("id"),
        sender_organization_id=org_id,
        body=body,
        template_code=template_code,
        template_params=template_params,
        client_message_id=cmid,
        request_hash=req_hash,
    )
    if row.get("error_code") == "idempotency_key_reuse":
        raise HTTPException(status_code=409, detail={
            "code": "idempotency_key_reuse",
            "message": "This client_message_id was already used with a different message.",
        })
    await _notify_technician_message(job_id, row)
    return {"message": _public_message(row)}


@app.post("/provider/jobs/{job_id}/calls/technician")
async def provider_start_technician_call(
    job_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    lifecycle = await _require_org_job(org_id, job_id)
    roles = set(session.get("roles", []))
    caller_type = "provider_admin" if "provider_admin" in roles else "dispatcher"
    return await _start_masked_call(
        job_id,
        caller_type=caller_type,
        caller_user_id=session.get("user", {}).get("id"),
        caller_organization_id=org_id,
        callee_type="technician",
        callee_technician_id=lifecycle.get("fulfillment_technician_id"),
    )


@app.post("/provider/jobs/{job_id}/calls/customer")
async def provider_start_customer_call(
    job_id: UUID,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, job_id)
    roles = set(session.get("roles", []))
    caller_type = "provider_admin" if "provider_admin" in roles else "dispatcher"
    result = await _start_masked_call(
        job_id,
        caller_type=caller_type,
        caller_user_id=session.get("user", {}).get("id"),
        caller_organization_id=org_id,
        callee_type="customer",
        allowed_statuses=_PROVIDER_CUSTOMER_CALL_ALLOWED_STATUSES,
    )
    if result.get("available"):
        context = await store.get_job_call_context(job_id)
        if context and context.get("customer_id"):
            await store.update_provider_crm_customer(
                org_id,
                UUID(str(context["customer_id"])),
                {"last_contacted_at": datetime.now(timezone.utc)},
                updated_by=session.get("user", {}).get("id"),
            )
    return result


@app.get("/provider/calls")
async def provider_call_history(
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    rows = await store.list_provider_call_sessions(org_id, limit=100)
    calls = []
    for row in rows:
        public = _public_call_session(row)
        meta = row.get("metadata") or {}
        public.update({
            "direction": meta.get("direction") or row.get("direction"),
            "caller_redacted": meta.get("caller_redacted"),
            "callee_redacted": meta.get("callee_redacted"),
            "duration_seconds": row.get("duration_seconds"),
            "associated_job_id": row.get("job_id"),
        })
        calls.append(public)
    return {"calls": calls}


@app.post("/provider/communications/sms")
async def provider_send_transactional_sms(
    payload: TransactionalSmsRequest,
    session: dict[str, Any] = Depends(require_session),
) -> dict[str, Any]:
    org_id = _require_dispatch_org(session)
    await _require_org_job(org_id, payload.job_id)
    client_message_id = _validated_client_message_id(payload.client_message_id)
    return await _send_transactional_sms(
        payload.job_id,
        payload.purpose,
        payload.recipient_type,
        organization_id=org_id,
        client_message_id=client_message_id,
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
async def handoff(
    ticket_id: UUID, request: Request, payload: dict[str, Any] | None = None
) -> TicketEnvelope:
    await latency()
    ticket = await require_intake_ticket(ticket_id, request)
    ticket.status = TicketStatus.FALLBACK_TO_HUMAN
    await save(ticket)
    await log_transition(ticket, f"handoff:{(payload or {}).get('reason', 'explicit')}")
    return await envelope(ticket)
