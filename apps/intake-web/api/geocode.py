"""Server-side geocoding via Google Maps Platform.

Uses GOOGLE_MAPS_API_KEY (server credential — never the NEXT_PUBLIC browser key).
Returns lat/lng + a coarse confidence mapped to the schema's
Location.geocode_confidence ("high" | "low" | "none"). Stdlib HTTP run in a
thread so it doesn't block the event loop; no extra dependency.
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.parse
import urllib.request

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACES_AC_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json"

# Google location_type -> our confidence bucket.
_CONFIDENCE = {
    "ROOFTOP": "high",
    "RANGE_INTERPOLATED": "high",
    "GEOMETRIC_CENTER": "low",
    "APPROXIMATE": "low",
}


async def geocode(address: str | None) -> dict | None:
    """Resolve an address to coordinates, or None if unconfigured/unresolved."""
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key or not address or not address.strip():
        return None
    return await asyncio.to_thread(_geocode_sync, address.strip(), key)


async def reverse_geocode(lat: float | None, lng: float | None) -> dict | None:
    """Resolve browser GPS coordinates to a formatted address when possible."""
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key or lat is None or lng is None:
        return None
    return await asyncio.to_thread(_reverse_geocode_sync, lat, lng, key)


async def places_autocomplete(input_text: str) -> list[dict]:
    """Return address suggestions from Google Places Autocomplete.

    Requires Places API (New) enabled on GOOGLE_MAPS_API_KEY.
    Returns [{"description": str, "place_id": str}, ...], empty list on failure.
    """
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key or not input_text or not input_text.strip():
        return []
    return await asyncio.to_thread(_places_ac_sync, input_text.strip(), key)


def _places_ac_sync(input_text: str, key: str) -> list[dict]:
    query = urllib.parse.urlencode({"input": input_text, "types": "address", "key": key})
    req = urllib.request.Request(f"{PLACES_AC_URL}?{query}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return []
    if data.get("status") not in ("OK", "ZERO_RESULTS"):
        return []
    return [
        {"description": p["description"], "place_id": p["place_id"]}
        for p in data.get("predictions", [])
    ]


def _geocode_sync(address: str, key: str) -> dict | None:
    query = urllib.parse.urlencode({"address": address, "key": key})
    req = urllib.request.Request(f"{GEOCODE_URL}?{query}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return None
    if data.get("status") != "OK" or not data.get("results"):
        return None
    top = data["results"][0]
    loc = top["geometry"]["location"]
    location_type = top["geometry"].get("location_type", "")
    return {
        "lat": loc["lat"],
        "lng": loc["lng"],
        "formatted_address": top.get("formatted_address"),
        "geocode_confidence": _CONFIDENCE.get(location_type, "low"),
    }


def _reverse_geocode_sync(lat: float, lng: float, key: str) -> dict | None:
    query = urllib.parse.urlencode({"latlng": f"{lat},{lng}", "key": key})
    req = urllib.request.Request(f"{GEOCODE_URL}?{query}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return None
    if data.get("status") != "OK" or not data.get("results"):
        return None
    top = data["results"][0]
    location_type = top.get("geometry", {}).get("location_type", "")
    return {
        "formatted_address": top.get("formatted_address"),
        "geocode_confidence": _CONFIDENCE.get(location_type, "low"),
    }
