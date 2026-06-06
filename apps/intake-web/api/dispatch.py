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
