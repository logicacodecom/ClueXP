"""Dispatch engine v1 — deterministic, rule-based candidate ranking.

Pure functions (no I/O) so they are trivially testable. The store supplies the
job and the available technicians; this module scores and ranks them.

Selection rule (adr/0004 + EXECUTION-PLAN §2B acceptance): an eligible candidate
must be **available**, **skilled** for the job's access type, and have the job
**within their service area**. Eligible candidates are ranked nearest-first,
then by rating. Nothing here mutates state or reveals identity to the customer.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import acos, cos, radians, sin
from typing import Any

EARTH_RADIUS_KM = 6371.0


def haversine_km(
    lat1: float | None, lng1: float | None, lat2: float | None, lng2: float | None
) -> float:
    """Great-circle distance in km; inf if any coordinate is missing."""
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return float("inf")
    inner = (
        sin(radians(lat1)) * sin(radians(lat2))
        + cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
    )
    inner = max(-1.0, min(1.0, inner))
    return EARTH_RADIUS_KM * acos(inner)


def rank_candidates(
    job: dict[str, Any], technicians: list[dict[str, Any]], top_n: int = 3
) -> list[dict[str, Any]]:
    """Return the top-N eligible technicians for a job, ranked by rule.

    Eligible = available AND skill matches ``job['access_type']`` AND the job is
    within the technician's ``service_area_radius_km``. Ranked by distance asc,
    then rating desc (deterministic, no randomness). Each returned dict is the
    technician dict plus ``dist_km``.
    """
    access = job.get("access_type")
    # null / "other" access_type → no skill gate (any available tech is eligible).
    skill_needed = access if access and access != "other" else None
    j_lat, j_lng = job.get("lat"), job.get("lng")
    candidates: list[dict[str, Any]] = []
    for tech in technicians:
        if not tech.get("is_available"):
            continue
        if skill_needed is not None and skill_needed not in (tech.get("skills") or []):
            continue
        dist = haversine_km(
            j_lat, j_lng,
            tech.get("service_area_center_lat"), tech.get("service_area_center_lng"),
        )
        radius = tech.get("service_area_radius_km") or 0.0
        if not radius or dist > radius:
            continue
        rating = float(tech.get("rating") or 0.0)
        candidates.append({**tech, "dist_km": round(dist, 2), "rating": rating})
    candidates.sort(key=lambda c: (c["dist_km"], -c["rating"]))
    return candidates[:top_n]


# --- dispatch policy: ONE canonical mapping between the stored DB vocabulary and
# dispatch semantics. The DB column `fulfillment_policy` keeps its existing values
# (`private` / `network_overflow` / `network_open`); all dispatch logic works in the
# semantic constants below via `normalize_policy`. Never compare policy strings
# ad-hoc — go through these helpers.
POLICY_PRIVATE = "private_owner_only"             # DB value: "private"
POLICY_OWNER_FIRST = "owner_first_then_network"   # DB value: "network_overflow"
POLICY_NETWORK_OPEN = "network_open"              # DB value: "network_open"

_DB_TO_SEMANTIC = {
    "private": POLICY_PRIVATE,
    "network_overflow": POLICY_OWNER_FIRST,
    "network_open": POLICY_NETWORK_OPEN,
}
_SEMANTIC_TO_DB = {v: k for k, v in _DB_TO_SEMANTIC.items()}


def normalize_policy(stored_policy: str | None, owner_org_id: str | None) -> str:
    """Resolve the stored `fulfillment_policy` (DB value, or None) to the effective
    dispatch policy.

    - No customer-owner org → `network_open` (a ClueXP-public job has nothing to keep
      private to).
    - Recognized DB value → its semantic policy.
    - **Unknown/invalid value WITH a customer-owner org → fail CLOSED to
      `private_owner_only`** so a company-owned job never leaks to the network on a
      misconfiguration.
    """
    if not owner_org_id:
        return POLICY_NETWORK_OPEN
    return _DB_TO_SEMANTIC.get(stored_policy or "", POLICY_PRIVATE)


def to_db_policy(value: str | None) -> str | None:
    """Canonical storage form. Accepts either a DB value or a semantic name and
    returns the **DB value**; returns None if the input is not a recognized policy
    (callers reject or fall back to the safe default)."""
    if value in _DB_TO_SEMANTIC:
        return value
    if value in _SEMANTIC_TO_DB:
        return _SEMANTIC_TO_DB[value]
    return None


def _in_owner_pool(tech: dict[str, Any], owner_org_id: str | None) -> bool:
    return owner_org_id is not None and owner_org_id in (tech.get("org_ids") or [])


def select_candidates(
    job: dict[str, Any],
    technicians: list[dict[str, Any]],
    *,
    policy: str,
    owner_org_id: str | None,
    round_index: int = 0,
    top_n: int = 3,
) -> list[dict[str, Any]]:
    """Policy-aware candidate selection (then ranked by `rank_candidates`).

    - private_owner_only: only the customer-owner's own/affiliated technicians.
    - owner_first_then_network: owner pool on the first round, then widen to the
      whole verified network on later rounds.
    - network_open (or no owner org): the whole verified network.
    The owner pool = technicians whose `org_ids` include `owner_org_id`
    (primary org + active affiliations), provided by the store.
    """
    if policy == POLICY_NETWORK_OPEN or not owner_org_id:
        pool = technicians
    elif policy == POLICY_PRIVATE:
        pool = [t for t in technicians if _in_owner_pool(t, owner_org_id)]
    else:  # owner_first_then_network
        owner_pool = [t for t in technicians if _in_owner_pool(t, owner_org_id)]
        pool = owner_pool if round_index <= 0 else technicians
    return rank_candidates(job, pool, top_n=top_n)


# --- customer-facing tracking state machine (pure) ---
def resolve_dispatch_state(
    *,
    matched: bool,
    active_offers: int,
    total_offers: int,
    attempts: int,
    max_attempts: int,
    timed_out: bool,
) -> str:
    """Resolve the customer-safe tracking state from relational facts. Pure +
    deterministic so it is unit-tested without a database.

    Returns one of: matched | waiting | expired_retry | no_eligible | (error is
    raised at the I/O boundary, not here).
    """
    if matched:
        return "matched"
    if active_offers > 0:
        return "waiting"
    if timed_out or attempts >= max_attempts:
        return "no_eligible"  # terminal: exhausted the window/rounds
    if attempts == 0:
        return "waiting"  # not dispatched yet (first dispatch happens at intake)
    if total_offers > 0:
        return "expired_retry"  # had offers, all expired/superseded → sweep re-dispatches
    return "no_eligible"  # a round ran but found no eligible tech (sweep may retry)


def is_terminal(state: str, *, attempts: int, max_attempts: int, timed_out: bool) -> bool:
    """A tracking state is terminal when no further automatic progress will happen."""
    if state == "matched":
        return True
    if state == "no_eligible" and (timed_out or attempts >= max_attempts):
        return True
    return False


# --- operational fulfillment lifecycle (cutover, Sprint 3) ---
# `job.status` operational lifecycle. Orthogonal to `trust_state` (privacy gate).
# The domain is app-enforced (no DB check) so legacy intake-status values keep
# working; only cutover jobs walk this ladder. Compare via the helpers below —
# never string-match status ad-hoc.
STATUS_PENDING_DISPATCH = "pending_dispatch"
STATUS_ASSIGNED = "assigned"
STATUS_EN_ROUTE = "en_route"
STATUS_ARRIVED = "arrived"
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED_PENDING = "completed_pending_customer"
STATUS_COMPLETED_CONFIRMED = "completed_confirmed"
STATUS_COMPLETED_AUTO_CLOSED = "completed_auto_closed"
STATUS_DISPUTED = "disputed"
STATUS_CANCELLED = "cancelled"
STATUS_NO_SHOW = "no_show"

# Forward progression ladder (dispatch -> on-site -> completion-pending).
_FULFILLMENT_ORDER = [
    STATUS_PENDING_DISPATCH,
    STATUS_ASSIGNED,
    STATUS_EN_ROUTE,
    STATUS_ARRIVED,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED_PENDING,
]
# Status values the assigned technician may set (hard rule: NOT completed_confirmed).
TECHNICIAN_SETTABLE = frozenset(
    {STATUS_EN_ROUTE, STATUS_ARRIVED, STATUS_IN_PROGRESS, STATUS_COMPLETED_PENDING}
)
# Live (FULFILLMENT) statuses — the technician is on the move / on site. Only while
# the job is in one of these may the customer see the technician's live location.
LIVE_TRACKING_STATUSES = frozenset({STATUS_EN_ROUTE, STATUS_ARRIVED, STATUS_IN_PROGRESS})


def may_show_live_tracking(status: str | None) -> bool:
    """True if it is safe to expose the assigned technician's live location to the
    customer for a job in ``status`` (FULFILLMENT only — en_route/arrived/in_progress)."""
    return status in LIVE_TRACKING_STATUSES


def location_is_fresh(
    location_updated_at: Any, *, now: datetime, threshold_minutes: int
) -> bool:
    """True only if ``location_updated_at`` exists and is within ``threshold_minutes``
    of ``now``. A missing or stale timestamp is NOT fresh — this prevents presenting a
    technician's last-known point as a *live* location after their app goes quiet.
    Accepts a ``datetime`` or an ISO-8601 string; naive timestamps are read as UTC."""
    if not location_updated_at:
        return False
    ts = location_updated_at
    if not isinstance(ts, datetime):
        try:
            ts = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except ValueError:
            return False
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (now - ts) <= timedelta(minutes=threshold_minutes)
# Terminal operational states (no further automatic progress / closed to the customer).
TERMINAL_STATUSES = frozenset(
    {
        STATUS_COMPLETED_CONFIRMED,
        STATUS_COMPLETED_AUTO_CLOSED,
        STATUS_CANCELLED,
        STATUS_NO_SHOW,
    }
)
# Statuses shown in the finished-job history (provider "Completed" + technician
# "Activity"). Includes `completed_pending_customer` so a job the technician just
# finished appears immediately — before the customer confirms — alongside the truly
# terminal states. `disputed` stays in the live recovery workspace, not history.
HISTORY_STATUSES = frozenset(TERMINAL_STATUSES | {STATUS_COMPLETED_PENDING})
# Technician history excludes `no_show`: provider recovery clears the job's
# `fulfillment_technician_id` on a no-show, so the technician/job link is no longer
# reliable — a no-show is not a job the technician fulfilled. The provider history
# (org-scoped) still includes it.
TECHNICIAN_HISTORY_STATUSES = frozenset(HISTORY_STATUSES - {STATUS_NO_SHOW})
# nullable lifecycle timestamp column written when a status is reached.
STATUS_TIMESTAMP_COLUMN = {
    STATUS_ASSIGNED: "assigned_at",
    STATUS_EN_ROUTE: "en_route_at",
    STATUS_ARRIVED: "arrived_at",
    STATUS_IN_PROGRESS: "in_progress_at",
    STATUS_COMPLETED_PENDING: "completed_pending_at",
    STATUS_COMPLETED_CONFIRMED: "confirmed_at",
    STATUS_DISPUTED: "disputed_at",
    STATUS_CANCELLED: "cancelled_at",
    # completed_auto_closed sets closed_at (handled by the caller).
}


def can_technician_transition(current: str | None, target: str) -> bool:
    """True if the assigned technician may move a job from ``current`` to
    ``target``. Transitions must advance exactly one step so a technician cannot
    skip arrival or service milestones. ``completed_confirmed`` is never
    technician-settable."""
    if target not in TECHNICIAN_SETTABLE:
        return False
    if current not in _FULFILLMENT_ORDER or target not in _FULFILLMENT_ORDER:
        return False
    cur_i, tgt_i = _FULFILLMENT_ORDER.index(current), _FULFILLMENT_ORDER.index(target)
    return cur_i >= _FULFILLMENT_ORDER.index(STATUS_ASSIGNED) and tgt_i == cur_i + 1


def can_customer_cancel(status: str | None) -> bool:
    """True if the customer may cancel the job.
    Allowed from pending_dispatch through en_route; blocked from arrived onward."""
    if status is None:
        return False
    return status in {
        STATUS_PENDING_DISPATCH,
        STATUS_ASSIGNED,
        STATUS_EN_ROUTE,
    }


def customer_actions(status: str | None) -> dict[str, bool]:
    """Customer-safe affordances for the token link, derived from operational
    status. Confirm/dispute only while completion is pending; review is allowed
    through the closed grace window; cancel allowed during search (pending_dispatch through en_route)."""
    return {
        "can_cancel": can_customer_cancel(status),
        "can_confirm": status == STATUS_COMPLETED_PENDING,
        "can_dispute": status == STATUS_COMPLETED_PENDING,
        "can_review": status
        in {
            STATUS_COMPLETED_PENDING,
            STATUS_COMPLETED_CONFIRMED,
            STATUS_COMPLETED_AUTO_CLOSED,
        },
    }


# --- payment reconciliation (job history) ---
# Methods a technician may collect by / a customer may pay with. Stored as a stable
# snake_case token; the UI maps to a display label. "other" is the catch-all so the
# set never blocks a legitimate report.
PAYMENT_METHODS = frozenset(
    {
        "credit_card",
        "debit_card",
        "cash",
        "check",
        "zelle",
        "cash_app",
        "apple_pay",
        "google_pay",
        "venmo",
        "paypal",
        "other",
    }
)


def normalize_payment_method(value: str | None) -> str | None:
    """Canonicalize a payment-method token (case/spacing/hyphen-insensitive).
    Returns None for an unknown method so the caller can 422 — never guesses."""
    if not value:
        return None
    token = value.strip().lower().replace(" ", "_").replace("-", "_")
    return token if token in PAYMENT_METHODS else None


def can_report_collection(status: str | None) -> bool:
    """True if the assigned technician may report what they collected — only once
    service is underway or completion is pending (not before arrival)."""
    return status in {STATUS_IN_PROGRESS, STATUS_COMPLETED_PENDING}


def eta_range_from_km(dist_km: float | None) -> tuple[int | None, int | None]:
    """Coarse, honest ETA estimate from straight-line distance (no live routing).
    ~8 min base + travel at ~30 km/h, widened to a range. None if distance unknown."""
    if dist_km is None or dist_km == float("inf"):
        return (None, None)
    travel_min = (dist_km / 30.0) * 60.0
    mid = 8.0 + travel_min
    low = max(10, int(mid * 0.8))
    high = int(mid * 1.3) + 5
    return (low, high)
