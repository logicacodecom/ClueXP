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


async def diagnose(address: str) -> dict:
    """TEMP diagnostic — surfaces why geocode returns None without leaking the key.
    Remove after live verification."""
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    info: dict = {"key_present": bool(key), "key_len": len(key) if key else 0}
    if not key:
        return info
    return await asyncio.to_thread(_diagnose_sync, address.strip(), key, info)


def _diagnose_sync(address: str, key: str, info: dict) -> dict:
    query = urllib.parse.urlencode({"address": address, "key": key})
    try:
        with urllib.request.urlopen(f"{GEOCODE_URL}?{query}", timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception as exc:  # noqa: BLE001
        info["exception"] = f"{type(exc).__name__}: {exc}"
        return info
    info["google_status"] = data.get("status")
    info["error_message"] = data.get("error_message")
    info["result_count"] = len(data.get("results", []))
    return info


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
