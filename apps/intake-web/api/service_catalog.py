from __future__ import annotations

from copy import deepcopy


DEFAULT_SERVICE_CATALOG: list[dict] = [
    {
        "code": "locksmith",
        "label": "Locksmith",
        "status": "active",
        "sort_order": 10,
        "skills": [
            {
                "code": "locksmith.vehicle_lockout",
                "label": "Vehicle lockout",
                "status": "active",
                "requires_verification": False,
                "sort_order": 10,
            },
            {
                "code": "locksmith.residential_lockout",
                "label": "Residential lockout",
                "status": "active",
                "requires_verification": False,
                "sort_order": 20,
            },
            {
                "code": "locksmith.commercial_lockout",
                "label": "Commercial lockout",
                "status": "active",
                "requires_verification": False,
                "sort_order": 30,
            },
            {
                "code": "locksmith.broken_key",
                "label": "Broken key extraction",
                "status": "active",
                "requires_verification": True,
                "sort_order": 40,
            },
            {
                "code": "locksmith.rekey",
                "label": "Rekey",
                "status": "active",
                "requires_verification": False,
                "sort_order": 50,
            },
            {
                "code": "locksmith.smart_lock",
                "label": "Smart lock",
                "status": "active",
                "requires_verification": True,
                "sort_order": 60,
            },
            {
                "code": "locksmith.vehicle_key_programming",
                "label": "Vehicle key programming",
                "status": "active",
                "requires_verification": True,
                "sort_order": 70,
            },
        ],
    },
    {"code": "hvac", "label": "HVAC", "status": "draft", "sort_order": 20, "skills": []},
    {"code": "towing", "label": "Towing & Roadside", "status": "draft", "sort_order": 30, "skills": []},
]


LEGACY_SKILL_ALIASES = {
    "vehicle": "locksmith.vehicle_lockout",
    "car": "locksmith.vehicle_lockout",
    "auto": "locksmith.vehicle_lockout",
    "home": "locksmith.residential_lockout",
    "residential": "locksmith.residential_lockout",
    "business": "locksmith.commercial_lockout",
    "commercial": "locksmith.commercial_lockout",
    "broken_key": "locksmith.broken_key",
    "rekey": "locksmith.rekey",
    "smart_lock": "locksmith.smart_lock",
    "key_programming": "locksmith.vehicle_key_programming",
}


def default_service_catalog() -> list[dict]:
    return deepcopy(DEFAULT_SERVICE_CATALOG)


def active_skill_codes(catalog: list[dict] | None = None) -> set[str]:
    rows = catalog if catalog is not None else DEFAULT_SERVICE_CATALOG
    return {
        skill["code"]
        for category in rows
        if category.get("status") == "active"
        for skill in category.get("skills", [])
        if skill.get("status") == "active"
    }


def normalize_skill_code(value: str) -> str:
    raw = value.strip().lower()
    return LEGACY_SKILL_ALIASES.get(raw, raw)
