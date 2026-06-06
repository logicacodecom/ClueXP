"""Dispatch engine v1 — deterministic, rule-based candidate ranking.

Pure functions (no I/O) so they are trivially testable. The store supplies the
job and the available technicians; this module scores and ranks them.

Selection rule (adr/0004 + EXECUTION-PLAN §2B acceptance): an eligible candidate
must be **available**, **skilled** for the job's access type, and have the job
**within their service area**. Eligible candidates are ranked nearest-first,
then by rating. Nothing here mutates state or reveals identity to the customer.
"""
from __future__ import annotations

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
    j_lat, j_lng = job.get("lat"), job.get("lng")
    candidates: list[dict[str, Any]] = []
    for tech in technicians:
        if not tech.get("is_available"):
            continue
        if access not in (tech.get("skills") or []):
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


# --- dispatch policy (maps the stored fulfillment_policy column to semantics) ---
POLICY_PRIVATE = "private_owner_only"        # column value: "private"
POLICY_OWNER_FIRST = "owner_first_then_network"  # column value: "network_overflow"
POLICY_NETWORK_OPEN = "network_open"         # column value: "network_open"

_POLICY_BY_COLUMN = {
    "private": POLICY_PRIVATE,
    "network_overflow": POLICY_OWNER_FIRST,
    "network_open": POLICY_NETWORK_OPEN,
}


def normalize_policy(fulfillment_policy: str | None, owner_org_id: str | None) -> str:
    """Resolve the effective dispatch policy. A job with no customer-owner org is
    always network_open (nothing to keep private to). Unknown values default to
    owner-first when an owner exists."""
    if not owner_org_id:
        return POLICY_NETWORK_OPEN
    return _POLICY_BY_COLUMN.get(fulfillment_policy or "", POLICY_OWNER_FIRST)


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
