from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urlparse


PARSER_VERSION = "deterministic-2026-07-26"
MAX_INPUT_LENGTH = 8000

US_STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA",
    "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
    "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}
STATE_PATTERN = "|".join(sorted([*US_STATES.keys(), *US_STATES.values()], key=len, reverse=True))
STREET_SUFFIX = r"(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pkwy|Parkway)"
VEHICLE_MAKES = [
    "Mercedes-Benz", "Land Rover", "Alfa Romeo", "Aston Martin", "BMW", "Dodge", "Ford", "Toyota",
    "Honda", "Chevrolet", "Chevy", "Nissan", "Hyundai", "Kia", "Jeep", "Lexus", "Volkswagen", "Audi",
    "Subaru", "Mazda", "GMC", "Ram", "Chrysler", "Buick", "Cadillac", "Infiniti", "Acura", "Volvo",
]

# Every quantifier that can consume a space is bounded. Unbounded lazy classes
# (`[^,\n]+?\s+`) backtrack catastrophically on a long comma-free near-match:
# one 8KB paste took 32s and blocked the event loop for the whole worker.
ADDRESS_RE = re.compile(
    rf"((?:\d+\s+)?(?:N|S|E|W|NE|NW|SE|SW)?\s*[^,\n]{{1,60}}?\s+{STREET_SUFFIX})[,]?\s+"
    rf"([A-Za-z .'-]{{1,40}}?)[,\s]+({STATE_PATTERN})[,]?\s+(\d{{5}})",
    re.I,
)
CITY_STATE_ZIP_RE = re.compile(rf"\b([A-Za-z .'-]{{1,40}}?)\s+({STATE_PATTERN})\s+(\d{{5}})\b", re.I)
STREET_TAIL_RE = re.compile(
    rf"((?:\d+\s+)?(?:(?:N|S|E|W|NE|NW|SE|SW)\s+)?[A-Za-z0-9.'-]+\s+{STREET_SUFFIX})$", re.I
)
LABELED_NAME_RE = re.compile(
    r"(?:name|customer|customer name|client|contact)\s*:\s*([A-Z][A-Za-z' -]{0,60}?)"
    r"(?=\s*(?:\(|\d|phone|mobile|cell|location|address|service|confirm|description|$))",
    re.I,
)

SERVICE_ALIASES = {
    ("vehicle", "locked_out"): [
        "car lockout", "auto lockout", "vehicle lockout", "locked out of car",
        "keys locked in car", "keys locked inside vehicle", "locked out of a",
    ],
    ("vehicle", "lost_key"): ["car key replacement", "lost car key", "replacement car key", "new car key"],
    ("vehicle", "malfunction"): ["key programming", "program car key", "program key fob", "key fob programming", "ignition repair", "ignition replacement", "key stuck in ignition"],
    ("home", "locked_out"): ["house lockout", "home lockout", "apartment lockout", "locked out of house"],
    ("home", "rekey"): ["rekey", "re-key", "change key"],
    ("business", "locked_out"): ["commercial lockout", "business lockout", "office lockout"],
    ("business", "rekey"): ["commercial rekey", "office rekey", "business rekey"],
}


def field(value: Any, confidence: str, source: str, raw: str | None = None) -> dict[str, Any]:
    out = {"value": value, "confidence": confidence, "source": source}
    if raw:
        out["rawMatch"] = raw
    return out


def warning(field_name: str, code: str, message: str) -> dict[str, str]:
    return {"field": field_name, "code": code, "message": message}


def normalize_text(text: str) -> str:
    replacements = {
        "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
        "\u2013": "-", "\u2014": "-", "\xa0": " ",
    }
    normalized = text
    for src, dest in replacements.items():
        normalized = normalized.replace(src, dest)
    normalized = re.sub(r"[\u200b-\u200f\ufeff]", "", normalized)
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\s*\n\s*", "\n", normalized)
    return normalized.strip()


def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"+1{digits}"
    return None


def normalize_state(raw: str) -> str:
    lowered = raw.strip().lower()
    return US_STATES.get(lowered, raw.strip().upper())


class DeterministicJobTextParser:
    def parse(self, input_text: str) -> dict[str, Any]:
        started = time.perf_counter()
        raw_text = input_text
        normalized = normalize_text(input_text)
        result: dict[str, Any] = {
            "rawText": raw_text,
            "normalizedText": normalized,
            "sourceType": "partner_paste",
            "detectedSource": "unknown",
            "customer": {},
            "location": {"isComplete": False},
            "service": {},
            "warnings": [],
            "conflicts": [],
            "parserVersion": PARSER_VERSION,
        }
        self._extract_url(normalized, result)
        self._extract_references(normalized, result)
        self._extract_phone(normalized, result)
        self._extract_customer_name(normalized, result)
        self._extract_address(normalized, result)
        self._classify_service(normalized, result)
        self._extract_vehicle(normalized, result)
        self._extract_description(normalized, result)
        result["processingDurationMs"] = round((time.perf_counter() - started) * 1000, 2)
        return result

    def _extract_url(self, text: str, result: dict[str, Any]) -> None:
        if re.search(r"\b(?:javascript|data|file):", text, re.I):
            result["warnings"].append(warning("externalUrl", "unsafe_url_rejected", "An unsafe confirmation URL was detected and ignored."))
        match = re.search(r"https?://[^\s)>\]]+", text, re.I)
        if not match:
            return
        raw = match.group(0).rstrip(".,;:")
        result["externalUrl"] = field(raw, "high", "regex", match.group(0))
        hostname = urlparse(raw).hostname
        if hostname and "workiz.com" in hostname.lower():
            result["detectedSource"] = "workiz"

    def _extract_references(self, text: str, result: dict[str, Any]) -> None:
        labels = r"(?:new job|job id|job|ticket|order|workiz job)"
        primary = [m.group(1) for m in re.finditer(labels + r"\s*#?\s*(\d{4,10})", text, re.I)]
        if primary:
            result["externalJobId"] = field(primary[0], "high", "label", primary[0])
            if len(set(primary)) > 1:
                result["conflicts"].append({"field": "externalJobId", "code": "multiple_primary_references", "candidates": sorted(set(primary))})
        refs = [m.group(1) for m in re.finditer(r"#\s*(\d{3,10})", text)]
        secondaries = [ref for ref in refs if ref != result.get("externalJobId", {}).get("value")]
        if secondaries:
            result["secondaryReference"] = field(secondaries[0], "low", "regex", f"#{secondaries[0]}")
            result["warnings"].append(warning("secondaryReference", "ambiguous_reference", f"Reference #{secondaries[0]} was detected, but its meaning could not be determined."))

    def _extract_phone(self, text: str, result: dict[str, Any]) -> None:
        candidates = []
        for match in re.finditer(r"(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b", text):
            normalized = normalize_phone(match.group(0))
            if normalized:
                candidates.append((normalized, match.group(0)))
        unique = []
        for item in candidates:
            if item[0] not in [u[0] for u in unique]:
                unique.append(item)
        if unique:
            result["customer"]["phone"] = field(unique[0][0], "high", "regex", unique[0][1])
        if len(unique) > 1:
            result["conflicts"].append({"field": "customer.phone", "code": "multiple_phone_numbers", "candidates": [u[0] for u in unique]})

    def _extract_customer_name(self, text: str, result: dict[str, Any]) -> None:
        labeled = LABELED_NAME_RE.search(text)
        if labeled:
            cleaned = re.sub(r"<[^>]*>", "", labeled.group(1)).strip(" -,:")
            if cleaned:
                result["customer"]["name"] = field(cleaned, "high", "label", labeled.group(0))
                return
        phone_raw = result.get("customer", {}).get("phone", {}).get("rawMatch")
        if phone_raw:
            before = text.split(phone_raw, 1)[0]
            match = re.search(r"([A-Z][A-Za-z']+\s+[A-Z][A-Za-z']+)\s*$", before.strip())
            if match:
                result["customer"]["name"] = field(match.group(1), "medium", "inference", match.group(1))

    def _extract_address(self, text: str, result: dict[str, Any]) -> None:
        match = ADDRESS_RE.search(text)
        if not match:
            zip_only = CITY_STATE_ZIP_RE.search(text)
            if zip_only:
                result["location"].update({
                    "city": field(zip_only.group(1).strip(" ,"), "medium", "regex"),
                    "state": field(normalize_state(zip_only.group(2)), "high", "dictionary"),
                    "postalCode": field(zip_only.group(3), "high", "regex"),
                    "isComplete": False,
                })
                result["warnings"].append(warning("location.addressLine1", "missing_street_details", "Street details are missing. Confirm the complete service address before dispatch."))
            return
        street = re.sub(r"\s+", " ", match.group(1)).strip(" ,")
        street_tail = STREET_TAIL_RE.search(street)
        if street_tail:
            street = street_tail.group(1)
        result["location"].update({
            "addressLine1": field(street, "medium", "regex", match.group(1)),
            "city": field(match.group(2).strip(" ,"), "medium", "regex"),
            "state": field(normalize_state(match.group(3)), "high", "dictionary", match.group(3)),
            "postalCode": field(match.group(4), "high", "regex", match.group(4)),
            "isComplete": bool(re.match(r"^\d+\b", street)),
        })
        if not result["location"]["isComplete"]:
            result["warnings"].append(warning("location.addressLine1", "missing_street_number", "The street number is missing. Confirm the complete service address before dispatch."))

    def _classify_service(self, text: str, result: dict[str, Any]) -> None:
        lower = text.lower()
        matches = []
        for (access_type, situation), aliases in SERVICE_ALIASES.items():
            for alias in aliases:
                if alias in lower:
                    matches.append((len(alias), access_type, situation, alias))
        if not matches:
            result["warnings"].append(warning("service.type", "unknown_service", "No supported service type was recognized. Choose a service before dispatch."))
            return
        matches.sort(reverse=True)
        _, access_type, situation, alias = matches[0]
        result["service"]["category"] = field(access_type, "high", "dictionary", alias)
        result["service"]["type"] = field(situation, "high", "dictionary", alias)
        competing = {(m[1], m[2]) for m in matches if matches[0][0] - m[0] <= 3}
        if len(competing) > 1:
            result["conflicts"].append({"field": "service.type", "code": "multiple_service_matches", "candidates": [f"{a}:{s}" for a, s in competing]})

    def _extract_vehicle(self, text: str, result: dict[str, Any]) -> None:
        makes = "|".join(re.escape(make) for make in sorted(VEHICLE_MAKES, key=len, reverse=True))
        match = re.search(rf"\b((?:19|20)\d{{2}})\s+({makes})\s+([A-Za-z0-9][A-Za-z0-9 -]{{0,40}})", text, re.I)
        if not match:
            return
        year = int(match.group(1))
        if year < 1980 or year > 2035:
            return
        make = next((m for m in VEHICLE_MAKES if m.lower() == match.group(2).lower()), match.group(2).title())
        model = re.split(r"\b(?:confirm|description|location|job|ticket|phone|customer)\b|[,.]", match.group(3), flags=re.I)[0].strip()
        result["vehicle"] = {
            "year": field(year, "high", "regex", match.group(1)),
            "make": field(make, "high", "dictionary", match.group(2)),
        }
        if model:
            result["vehicle"]["model"] = field(model.title(), "medium", "inference", model)
        else:
            result["warnings"].append(warning("vehicle.model", "uncertain_vehicle_model", "Vehicle year and make were detected, but the model was not clear."))

    def _extract_description(self, text: str, result: dict[str, Any]) -> None:
        match = re.search(r"(?:description|details|problem|issue|request)\s*:\s*(.+)$", text, re.I)
        if match:
            result["description"] = field(match.group(1).strip(), "high", "label", match.group(0))


def parse_job_text(text: str) -> dict[str, Any]:
    return DeterministicJobTextParser().parse(text)
