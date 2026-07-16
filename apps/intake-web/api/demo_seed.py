"""Repeatable demo seed/reset for provider companies (Tampa "Florida Locksmith").

This is the single source of truth for the demo data shaped by the demo brief:

- **Seed** the Tampa-based provider **Florida Locksmith** (slug ``florida-locksmith``):
  the company, its branded intake channel, a dispatcher login, and 2-3 verified,
  available technicians.
- **Clean** the demo data left behind by the older **Metro Key** provider in an
  FK-safe, controlled way (its jobs + the offers/tracking/notes/reviews/payments
  hanging off them, and the demo customers those jobs created). The Metro Key
  *company and its technicians are preserved* — only stale demo jobs are removed.
- **Seed** a handful of clean Florida Locksmith demo jobs so the dispatch flow has
  something to show.

Everything here operates on a psycopg ``AsyncConnection`` and is **idempotent**:

- The startup seeder (:func:`api.store.PostgresStore._seed_demo_auth`) calls
  :func:`seed_florida_locksmith` so the company is always present in a fresh demo DB.
- The standalone runner ``scripts/reset_demo_providers.py`` calls :func:`reset_demo`
  to clean Metro Key and (re)seed Florida Locksmith + demo jobs on demand.

Skill vocabulary note: the dispatch engine (``api.dispatch.rank_candidates``) gates a
candidate by ``skill_needed == job.access_type`` where the access-type value is the
``AccessType`` *value* — ``"vehicle"``, not ``"car"`` (see ``AccessType.CAR = "vehicle"``).
All technician skills and job access types here go through :func:`normalize_skill`
so the old ``car`` vs ``vehicle`` mismatch can never be reintroduced.
"""
from __future__ import annotations

import secrets
from typing import Any

from api.schema import AccessType, Situation, Ticket, TicketStatus, Urgency
from api.service_catalog import normalize_skill_code

# ─────────────────────────────────────────────────────────────────────────────
# Canonical vocabulary — one place, derived from the schema enums
# ─────────────────────────────────────────────────────────────────────────────

# The dispatchable access types that map 1:1 to a technician skill. "other" is a
# no-skill-gate access type (see rank_candidates) so it is intentionally excluded.
VALID_ACCESS_TYPES: frozenset[str] = frozenset(
    {AccessType.HOME.value, AccessType.BUSINESS.value, AccessType.CAR.value}
)

VALID_SKILLS: frozenset[str] = frozenset(
    {
        "locksmith.residential_lockout",
        "locksmith.commercial_lockout",
        "locksmith.vehicle_lockout",
        "locksmith.broken_key",
        "locksmith.rekey",
        "locksmith.smart_lock",
        "locksmith.vehicle_key_programming",
    }
)

# Aliases that have historically been confused with the canonical tokens. The
# `car`/`auto` -> `vehicle` mapping is the specific bug guard called out in the brief.
_SKILL_ALIASES: dict[str, str] = {
    "car": AccessType.CAR.value,        # "vehicle"
    "auto": AccessType.CAR.value,
    "automotive": AccessType.CAR.value,
    "vehicle": AccessType.CAR.value,
    "home": AccessType.HOME.value,
    "house": AccessType.HOME.value,
    "residential": AccessType.HOME.value,
    "business": AccessType.BUSINESS.value,
    "commercial": AccessType.BUSINESS.value,
}


def normalize_skill(token: str) -> str:
    """Map a technician skill token to the canonical service-catalog leaf code.

    Raises on an unknown token rather than silently storing a value dispatch will
    never match.
    """
    key = normalize_skill_code(token)
    if key in VALID_SKILLS:
        return key
    raise ValueError(
        f"Unknown skill/access token {token!r}; expected one of {sorted(VALID_SKILLS)} "
        f"or a known alias ({sorted(_SKILL_ALIASES)})."
    )


def normalize_access_type(token: str) -> str:
    key = (token or "").strip().lower()
    if key in VALID_ACCESS_TYPES:
        return key
    if key in _SKILL_ALIASES:
        return _SKILL_ALIASES[key]
    raise ValueError(
        f"Unknown access token {token!r}; expected one of {sorted(VALID_ACCESS_TYPES)} "
        f"or a known alias ({sorted(_SKILL_ALIASES)})."
    )


def normalize_skills(tokens: list[str]) -> list[str]:
    """Normalize + de-duplicate a skill list, preserving first-seen order."""
    out: list[str] = []
    for tok in tokens:
        canon = normalize_skill(tok)
        if canon not in out:
            out.append(canon)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Demo data definitions — stable slugs/emails so reseeding upserts (no duplicates)
# ─────────────────────────────────────────────────────────────────────────────

FLORIDA_SLUG = "florida-locksmith"
FLORIDA_DISPLAY_NAME = "Florida Locksmith"
FLORIDA_LEGAL_NAME = "Florida Locksmith LLC"
FLORIDA_OPS_EMAIL = "ops@florida-locksmith.demo"
FLORIDA_DISPATCH_EMAIL = "dispatch@florida-locksmith.demo"
FLORIDA_PHONE = "+18135550147"
FLORIDA_TEAM_NAME = "Tampa Response"

# Tampa, FL — service-area center (downtown) + radius covering the listed areas
# (Downtown Tampa, Ybor City, Westshore, Brandon, Temple Terrace, Carrollwood).
TAMPA_LAT = 27.9506
TAMPA_LNG = -82.4572
TAMPA_RADIUS_KM = 45.0
FLORIDA_SERVICE_AREAS = [
    "Tampa",
    "Downtown Tampa",
    "Ybor City",
    "Westshore",
    "Brandon",
    "Temple Terrace",
    "Carrollwood",
]

METRO_SLUG = "metro-key"

# Demo-safe technicians. Skills are normalized at insert time → canonical vocab.
FLORIDA_TECHNICIANS: list[dict[str, Any]] = [
    {
        "email": "carlos.rivera@florida-locksmith.demo",
        "name": "Carlos Rivera",
        "phone": "+18135550141",
        "skills": ["home", "business", "vehicle"],
        "lat": 27.9506,
        "lng": -82.4572,
        "rating": 4.9,
    },
    {
        "email": "maya.thompson@florida-locksmith.demo",
        "name": "Maya Thompson",
        "phone": "+18135550142",
        "skills": ["home", "business"],
        "lat": 27.9605,
        "lng": -82.4382,
        "rating": 4.8,
    },
    {
        "email": "andre.wilson@florida-locksmith.demo",
        "name": "Andre Wilson",
        "phone": "+18135550143",
        # Intentionally given as the alias "car" to prove normalize_skill maps it
        # to "vehicle" — no dispatch mismatch.
        "skills": ["car", "home"],
        "lat": 27.9555,
        "lng": -82.5240,
        "rating": 4.7,
    },
]

# Demo jobs. `ref` is the stable idempotency marker stored at detail->>'demo_seed_ref'.
FLORIDA_DEMO_JOBS: list[dict[str, Any]] = [
    {
        "ref": "florida-job-1",
        "access_type": "home",
        "situation": Situation.LOCKED_OUT.value,
        "urgency": Urgency.URGENT.value,
        "address": "401 E Jackson St, Tampa, FL 33602",
        "lat": 27.9477,
        "lng": -82.4569,
        "note": "Customer locked out of apartment. Demo job.",
        "customer": {"name": "Demo Customer — Jackson St", "phone": "+18135550181"},
        "estimate_min": 89.0,
        "estimate_max": 149.0,
    },
    {
        "ref": "florida-job-2",
        # "car" alias on purpose → normalized to "vehicle".
        "access_type": "car",
        "situation": Situation.LOST_KEY.value,
        "urgency": Urgency.URGENT.value,
        "address": "2223 N Westshore Blvd, Tampa, FL 33607",
        "lat": 27.9555,
        "lng": -82.5240,
        "note": "Demo vehicle key programming request.",
        "customer": {"name": "Demo Customer — Westshore", "phone": "+18135550182"},
        "estimate_min": 180.0,
        "estimate_max": 320.0,
    },
    {
        "ref": "florida-job-3",
        "access_type": "business",
        "situation": Situation.REKEY.value,
        "urgency": Urgency.STANDARD.value,
        "address": "1600 E 8th Ave, Tampa, FL 33605",
        "lat": 27.9605,
        "lng": -82.4382,
        "note": "Demo commercial rekey request.",
        "customer": {"name": "Demo Customer — Ybor", "phone": "+18135550183"},
        "estimate_min": 140.0,
        "estimate_max": 260.0,
    },
]

# Job operational status the demo jobs land in: in the dispatcher queue, unassigned.
DEMO_JOB_STATUS = "pending_dispatch"


# ─────────────────────────────────────────────────────────────────────────────
# Payload construction (pure — no DB; unit-testable)
# ─────────────────────────────────────────────────────────────────────────────

def build_demo_ticket(job: dict[str, Any]) -> Ticket:
    """Build a valid :class:`~api.schema.Ticket` for a demo job.

    Returns a fully-validated Ticket so what we persist into ``jobs.detail`` always
    rehydrates (``Ticket.model_validate``) — the same contract live intake writes.
    The access type is normalized so e.g. the "car" alias becomes ``"vehicle"``.
    """
    access = normalize_access_type(job["access_type"])  # canonical, e.g. "vehicle"
    payload: dict[str, Any] = {
        "status": TicketStatus.PARTIAL.value,
        "trust_state": "intake",
        "access_type": access,
        "situation": job["situation"],
        "urgency": job["urgency"],
        "location": {
            "raw_text": job["address"],
            "lat": job["lat"],
            "lng": job["lng"],
            "geocode_confidence": "high",
        },
        "customer_name": job["customer"]["name"],
        "customer_phone": job["customer"]["phone"],
        "additional_details": job["note"],
        "price_quote": {
            "currency": "USD",
            "estimate_min": job["estimate_min"],
            "estimate_max": job["estimate_max"],
            "accepted_by_customer": True,
        },
    }
    return Ticket.model_validate(payload)


def _pg_array(values: list[str]) -> str:
    """Render a Postgres text[] literal from a closed vocabulary list."""
    return "{" + ",".join(values) + "}"


# ─────────────────────────────────────────────────────────────────────────────
# Seeding — Florida Locksmith company, channel, dispatcher, technicians
# ─────────────────────────────────────────────────────────────────────────────

async def _ensure_user(
    conn,
    *,
    email: str,
    display_name: str,
    roles: list[str],
    password_hash: str,
    org_id=None,
    phone: str | None = None,
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
            "insert into user_roles (user_id, role) values (%s, %s) on conflict do nothing",
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


async def seed_florida_locksmith(conn, *, password_hash: str) -> dict[str, Any]:
    """Idempotently upsert the Florida Locksmith company, its intake channel, a
    dispatcher login, and its verified/available technicians. Safe to call on every
    boot and on every reset — lookups are by slug/email so nothing duplicates.
    """
    cur = await conn.execute(
        "insert into organizations"
        " (display_name, legal_name, slug, organization_type, status,"
        "  subscription_status, email, phone,"
        "  service_area_center_lat, service_area_center_lng, service_area_radius_km)"
        # status must satisfy ck_org_status (migration 0019): one of
        # pending_review|active|suspended|rejected|closed. 'active' = operational.
        " values (%s, %s, %s, 'company', 'active', 'active', %s, %s, %s, %s, %s)"
        " on conflict (slug) do update set"
        "  display_name = excluded.display_name,"
        "  legal_name = excluded.legal_name,"
        "  status = excluded.status,"
        "  subscription_status = excluded.subscription_status,"
        "  email = excluded.email,"
        "  phone = excluded.phone,"
        "  service_area_center_lat = excluded.service_area_center_lat,"
        "  service_area_center_lng = excluded.service_area_center_lng,"
        "  service_area_radius_km = excluded.service_area_radius_km,"
        "  updated_at = now()"
        " returning id",
        (
            FLORIDA_DISPLAY_NAME,
            FLORIDA_LEGAL_NAME,
            FLORIDA_SLUG,
            FLORIDA_OPS_EMAIL,
            FLORIDA_PHONE,
            TAMPA_LAT,
            TAMPA_LNG,
            TAMPA_RADIUS_KM,
        ),
    )
    org_id = (await cur.fetchone())[0]

    # Branded intake channel (resolved server-side to this org). Cutover ON so the
    # demo exercises the real offer -> accept dispatch loop.
    cur = await conn.execute(
        "insert into intake_channels"
        " (organization_id, slug, channel_type, display_name, fulfillment_policy,"
        "  active, dispatch_cutover_enabled)"
        " values (%s, %s, 'web', %s, 'private', true, true)"
        " on conflict (slug) do update set"
        "  organization_id = excluded.organization_id,"
        "  display_name = excluded.display_name,"
        "  fulfillment_policy = excluded.fulfillment_policy,"
        "  active = true,"
        "  dispatch_cutover_enabled = excluded.dispatch_cutover_enabled"
        " returning id",
        (org_id, FLORIDA_SLUG, FLORIDA_DISPLAY_NAME),
    )
    channel_id = (await cur.fetchone())[0]

    await _ensure_user(
        conn,
        email=FLORIDA_DISPATCH_EMAIL,
        display_name="Tampa Dispatch",
        roles=["provider_admin", "dispatcher"],
        password_hash=password_hash,
        org_id=org_id,
        phone=FLORIDA_PHONE,
    )

    # Primary team for the roster.
    cur = await conn.execute(
        "insert into organization_teams"
        " (organization_id, name, description, team_type, status)"
        " values (%s, %s, 'Tampa urgent-response roster', 'department', 'active')"
        " on conflict do nothing returning id",
        (org_id, FLORIDA_TEAM_NAME),
    )
    team_row = await cur.fetchone()
    if not team_row:
        cur = await conn.execute(
            "select id from organization_teams"
            " where organization_id = %s and name = %s limit 1",
            (org_id, FLORIDA_TEAM_NAME),
        )
        team_row = await cur.fetchone()
    team_id = team_row[0] if team_row else None

    technician_ids: list[str] = []
    for tech in FLORIDA_TECHNICIANS:
        skills = normalize_skills(tech["skills"])
        technician_id = await _ensure_user(
            conn,
            email=tech["email"],
            display_name=tech["name"],
            roles=["technician"],
            password_hash=password_hash,
            org_id=org_id,
            phone=tech["phone"],
            membership_role="technician",
        )
        if not technician_id:
            continue
        technician_ids.append(str(technician_id))
        await conn.execute(
            "insert into technicians"
            " (id, display_name, email, phone, status, vetting_status, skills,"
            "  service_area_center_lat, service_area_center_lng, service_area_radius_km,"
            "  current_lat, current_lng, location_updated_at, rating, is_available,"
            "  provider_type, primary_organization_id)"
            " values (%s, %s, %s, %s, 'active', 'verified', %s,"
            "  %s, %s, %s, %s, %s, now(), %s, true, 'affiliate', %s)"
            " on conflict (id) do update set"
            "  status = 'active', vetting_status = 'verified', skills = excluded.skills,"
            "  service_area_center_lat = excluded.service_area_center_lat,"
            "  service_area_center_lng = excluded.service_area_center_lng,"
            "  service_area_radius_km = excluded.service_area_radius_km,"
            "  is_available = true, current_lat = excluded.current_lat,"
            "  current_lng = excluded.current_lng, location_updated_at = now(),"
            "  rating = excluded.rating, provider_type = 'affiliate',"
            "  primary_organization_id = excluded.primary_organization_id",
            (
                technician_id,
                tech["name"],
                tech["email"],
                tech["phone"],
                _pg_array(skills),
                tech["lat"],
                tech["lng"],
                TAMPA_RADIUS_KM,
                tech["lat"],
                tech["lng"],
                tech["rating"],
                org_id,
            ),
        )
        await conn.execute(
            "insert into organization_technicians"
            " (organization_id, technician_id, role, status, activated_at)"
            " values (%s, %s, 'affiliate_technician', 'active', now())"
            " on conflict (organization_id, technician_id) where ended_at is null"
            " do update set status = 'active'",
            (org_id, technician_id),
        )
        if team_id:
            await conn.execute(
                "insert into organization_team_technicians (team_id, technician_id)"
                " values (%s, %s) on conflict do nothing",
                (team_id, technician_id),
            )

    return {
        "org_id": str(org_id),
        "channel_id": str(channel_id),
        "technician_ids": technician_ids,
        "technician_count": len(technician_ids),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Cleanup — FK-safe deletion of jobs + their dependent records
# ─────────────────────────────────────────────────────────────────────────────

# job_notes / job_reviews / job_payment_reports / arrival_verifications all declare
# ON DELETE CASCADE; dispatch_offers and events do not. We delete every child
# explicitly anyway (children-first, as the brief requires) and to count them.
_JOB_CHILD_TABLES = (
    "job_payment_reports",
    "job_notes",
    "job_reviews",
    "arrival_verifications",
    "dispatch_offers",
    "events",
)


async def _safe_execute(conn, sql: str, params: tuple) -> int:
    """Execute a statement, returning affected rows; tolerate a missing table
    (autocommit connection → a failed statement is isolated). Returns -1 if the
    statement could not run (table absent / behind on migrations)."""
    try:
        cur = await conn.execute(sql, params)
        return cur.rowcount if cur.rowcount is not None else 0
    except Exception:
        return -1


async def _delete_jobs(conn, job_ids: list[str]) -> dict[str, int]:
    """Delete the given jobs and all their dependent records (children first).
    Returns per-table counts (dispatch_offers + arrival_verifications are reported
    together as ``offers_tracking_cleaned``)."""
    counts = {"jobs": 0, "offers_tracking_cleaned": 0, "child_rows": 0}
    if not job_ids:
        return counts
    for table in _JOB_CHILD_TABLES:
        n = await _safe_execute(
            conn, f"delete from {table} where job_id = any(%s)", (job_ids,)
        )
        if n > 0:
            counts["child_rows"] += n
            if table in ("dispatch_offers", "arrival_verifications"):
                counts["offers_tracking_cleaned"] += n
    cur = await conn.execute("delete from jobs where id = any(%s)", (job_ids,))
    counts["jobs"] = cur.rowcount or 0
    return counts


async def _delete_orphan_customers(conn, customer_ids: list[str]) -> int:
    """Delete the given customers only if no remaining job references them."""
    candidates = [cid for cid in customer_ids if cid]
    if not candidates:
        return 0
    cur = await conn.execute(
        "delete from customers c where c.id = any(%s)"
        " and not exists (select 1 from jobs j where j.customer_id = c.id)",
        (candidates,),
    )
    return cur.rowcount or 0


async def clean_metro_key_demo(conn) -> dict[str, Any]:
    """Remove the Metro Key provider's demo jobs (and dependent offers/tracking/
    notes/reviews/payments + the demo customers those jobs created) in an FK-safe
    way. The Metro Key **company and technicians are preserved**.

    A "Metro Key job" = any job whose origin / customer-owner / fulfillment org is
    Metro Key, or that carries an offer to (or owned by) Metro Key.
    """
    cur = await conn.execute("select id from organizations where slug = %s", (METRO_SLUG,))
    row = await cur.fetchone()
    if not row:
        return {"metro_org_found": False, "jobs_cleaned": 0,
                "offers_tracking_cleaned": 0, "customers_cleaned": 0}
    metro_id = row[0]

    cur = await conn.execute(
        "select distinct j.id, j.customer_id"
        " from jobs j"
        " left join dispatch_offers o on o.job_id = j.id"
        " left join technicians t on t.id = o.technician_id"
        " where j.origin_org_id = %s"
        "    or j.customer_owner_org_id = %s"
        "    or j.fulfillment_org_id = %s"
        "    or o.organization_id = %s"
        "    or t.primary_organization_id = %s",
        (metro_id, metro_id, metro_id, metro_id, metro_id),
    )
    rows = await cur.fetchall()
    job_ids = [str(r[0]) for r in rows]
    customer_ids = [str(r[1]) for r in rows if r[1]]

    deleted = await _delete_jobs(conn, job_ids)
    customers_cleaned = await _delete_orphan_customers(conn, customer_ids)

    return {
        "metro_org_found": True,
        "metro_org_id": str(metro_id),
        "jobs_cleaned": deleted["jobs"],
        "offers_tracking_cleaned": deleted["offers_tracking_cleaned"],
        "child_rows_cleaned": deleted["child_rows"],
        "customers_cleaned": customers_cleaned,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Seeding — Florida Locksmith demo jobs
# ─────────────────────────────────────────────────────────────────────────────

async def seed_florida_demo_jobs(conn, *, org_id: str, channel_id: str) -> dict[str, Any]:
    """(Re)create the Florida Locksmith demo jobs idempotently.

    Prior runs are identified by the stable ``detail->>'demo_seed_ref'`` marker and
    fully removed (with their children) before fresh jobs are inserted, so reseeding
    never duplicates jobs and never collides on the unique tracking token.
    """
    from psycopg.types.json import Jsonb  # local import: only needed when running

    # Remove previously-seeded Florida demo jobs (by marker), FK-safe.
    cur = await conn.execute(
        "select id from jobs"
        " where customer_owner_org_id = %s and detail->>'demo_seed_ref' like 'florida-%%'",
        (org_id,),
    )
    prior_ids = [str(r[0]) for r in await cur.fetchall()]
    await _delete_jobs(conn, prior_ids)

    created: list[str] = []
    for job in FLORIDA_DEMO_JOBS:
        # Demo customer (upsert by phone — customers.phone is unique).
        cur = await conn.execute(
            "insert into customers (phone, name) values (%s, %s)"
            " on conflict (phone) do update set name = excluded.name"
            " returning id",
            (job["customer"]["phone"], job["customer"]["name"]),
        )
        customer_id = (await cur.fetchone())[0]

        ticket = build_demo_ticket(job)
        payload = ticket.model_dump(mode="json")
        payload["demo_seed_ref"] = job["ref"]  # idempotency marker
        access = normalize_access_type(job["access_type"])
        token = secrets.token_urlsafe(24)

        await conn.execute(
            "insert into jobs ("
            "  customer_id, fulfillment_technician_id, fulfillment_org_id,"
            "  origin_org_id, customer_owner_org_id, intake_channel_id,"
            "  trust_state, status, access_type, situation, urgency,"
            "  lat, lng, address, detail, price_quote, tracking_token,"
            "  dispatch_attempts, fulfillment_policy, created_at, updated_at"
            ") values ("
            "  %s, null, null, %s, %s, %s,"
            "  'intake', %s, %s, %s, %s,"
            "  %s, %s, %s, %s, %s, %s,"
            "  0, 'private', now(), now())",
            (
                customer_id,
                org_id,
                org_id,
                channel_id,
                DEMO_JOB_STATUS,
                access,
                job["situation"],
                job["urgency"],
                job["lat"],
                job["lng"],
                job["address"],
                Jsonb(payload),
                Jsonb(payload["price_quote"]),
                token,
            ),
        )
        created.append(job["ref"])

    return {"jobs_created": len(created), "refs": created}


# ─────────────────────────────────────────────────────────────────────────────
# Validation — consistency checks reported by the runner
# ─────────────────────────────────────────────────────────────────────────────

async def validate_demo(conn, *, org_id: str) -> dict[str, Any]:
    """Post-change consistency checks. Returns counts + a list of any violations."""
    issues: list[str] = []

    cur = await conn.execute("select count(*) from organizations where slug = %s", (FLORIDA_SLUG,))
    org_count = (await cur.fetchone())[0]
    if org_count != 1:
        issues.append(f"expected exactly 1 '{FLORIDA_SLUG}' org, found {org_count}")

    cur = await conn.execute(
        "select count(*) from organization_technicians ot"
        " join technicians t on t.id = ot.technician_id"
        " where ot.organization_id = %s and ot.status = 'active' and t.is_available",
        (org_id,),
    )
    tech_count = (await cur.fetchone())[0]

    cur = await conn.execute(
        "select count(*) from jobs"
        " where customer_owner_org_id = %s and detail->>'demo_seed_ref' like 'florida-%%'",
        (org_id,),
    )
    demo_job_count = (await cur.fetchone())[0]

    # No accepted job may carry more than one accepted offer.
    cur = await conn.execute(
        "select count(*) from ("
        "  select job_id from dispatch_offers where status = 'accepted'"
        "  group by job_id having count(*) > 1) x"
    )
    multi_accept = (await cur.fetchone())[0]
    if multi_accept:
        issues.append(f"{multi_accept} job(s) have multiple accepted offers")

    # No active job may point to a non-existent provider or technician.
    cur = await conn.execute(
        "select count(*) from jobs j"
        " where j.status not in"
        "   ('completed_confirmed','completed_auto_closed','cancelled','no_show')"
        "   and ("
        "     (j.fulfillment_technician_id is not null and not exists"
        "        (select 1 from technicians t where t.id = j.fulfillment_technician_id))"
        "  or (j.customer_owner_org_id is not null and not exists"
        "        (select 1 from organizations o where o.id = j.customer_owner_org_id))"
        "  or (j.fulfillment_org_id is not null and not exists"
        "        (select 1 from organizations o where o.id = j.fulfillment_org_id)))"
    )
    dangling = (await cur.fetchone())[0]
    if dangling:
        issues.append(f"{dangling} active job(s) reference a deleted provider/technician")

    # No active Metro Key demo job should remain.
    cur = await conn.execute("select id from organizations where slug = %s", (METRO_SLUG,))
    metro_row = await cur.fetchone()
    metro_active_jobs = 0
    if metro_row:
        cur = await conn.execute(
            "select count(*) from jobs"
            " where (origin_org_id = %s or customer_owner_org_id = %s or fulfillment_org_id = %s)"
            "   and status not in"
            "     ('completed_confirmed','completed_auto_closed','cancelled','no_show')",
            (metro_row[0], metro_row[0], metro_row[0]),
        )
        metro_active_jobs = (await cur.fetchone())[0]
        if metro_active_jobs:
            issues.append(f"{metro_active_jobs} active Metro Key job(s) remain")

    return {
        "florida_org_count": org_count,
        "florida_available_technicians": tech_count,
        "florida_demo_jobs": demo_job_count,
        "metro_active_jobs_remaining": metro_active_jobs,
        "ok": not issues,
        "issues": issues,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Orchestration
# ─────────────────────────────────────────────────────────────────────────────

async def reset_demo(
    conn,
    *,
    password_hash: str,
    clean_metro: bool = True,
    seed_jobs: bool = True,
) -> dict[str, Any]:
    """Full demo reset: ensure Florida Locksmith, clean Metro Key demo data, and
    (re)seed Florida demo jobs. Idempotent; safe to run repeatedly.
    """
    seeded = await seed_florida_locksmith(conn, password_hash=password_hash)
    metro = await clean_metro_key_demo(conn) if clean_metro else {"skipped": True}
    jobs = (
        await seed_florida_demo_jobs(
            conn, org_id=seeded["org_id"], channel_id=seeded["channel_id"]
        )
        if seed_jobs
        else {"skipped": True}
    )
    validation = await validate_demo(conn, org_id=seeded["org_id"])
    return {"florida": seeded, "metro": metro, "jobs": jobs, "validation": validation}
