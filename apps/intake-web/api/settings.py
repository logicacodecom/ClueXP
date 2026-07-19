"""Runtime operational settings — DB-backed with env fallback.

`global_settings` is the **primary** store for runtime-tunable operational/product
settings. It is NOT a secret store and NOT deployment/infrastructure config — those
stay in env/Vercel/secret manager (a `CHECK (is_secret = false)` enforces this at
the DB level too).

Every supported key is declared in `SETTINGS` with strict per-key validation. The
`value jsonb` column is flexible but never free-form: a value that fails its key's
contract is rejected (→ 422 at the admin API, ignored-with-fallback at read time).

Resolution is **request-time only** (never at import — `config.py` stays DB-free)
and tolerant: DB → env → hardcoded default. A small in-process cache (~30s) avoids
a DB round-trip on every offer; stale reads are acceptable because settings change
rarely and only affect newly-created offers (existing `expires_at` is already
stamped).
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Callable

logger = logging.getLogger("cluexp.settings")

VALUE_TYPES = ("integer", "boolean", "string", "object", "array")


class SettingValidationError(ValueError):
    """A value failed its per-key contract (unknown key, wrong type, or out of range)."""


@dataclass(frozen=True)
class SettingSpec:
    key: str
    value_type: str
    description: str
    env: str | None
    fallback: Any
    validate: Callable[[Any], bool]
    is_secret: bool = False
    is_runtime_editable: bool = True
    # True for settings a provider may override for its own organization
    # (organization_settings, 0025) on top of the platform-wide default below.
    org_overridable: bool = False


def _int_range(lo: int, hi: int) -> Callable[[Any], bool]:
    """Build a validator accepting ints in [lo, hi]. Rejects bools (a subclass of int)."""

    def _validate(v: Any) -> bool:
        return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi

    return _validate


def _is_bool(v: Any) -> bool:
    return isinstance(v, bool)


def _one_of(*allowed: str) -> Callable[[Any], bool]:
    allowed_values = set(allowed)

    def _validate(v: Any) -> bool:
        return isinstance(v, str) and v in allowed_values

    return _validate


# --- allowlist registry: the single source of truth for validation -----------
SETTINGS: dict[str, SettingSpec] = {
    "dispatch_offer_ttl_seconds": SettingSpec(
        key="dispatch_offer_ttl_seconds",
        value_type="integer",
        description="Seconds before a provider-created dispatch offer expires.",
        env="DISPATCH_OFFER_TTL_SECONDS",
        fallback=300,
        validate=_int_range(60, 900),
    ),
    # --- emergency kill-switch: force every channel back to the legacy stub ---
    "dispatch_cutover_global_off": SettingSpec(
        key="dispatch_cutover_global_off",
        value_type="boolean",
        description="Force every channel back to the legacy dispatch stub, "
        "regardless of its per-channel dispatch_cutover_enabled flag.",
        env="DISPATCH_CUTOVER_GLOBAL_OFF",
        fallback=False,
        validate=_is_bool,
    ),
    # --- tracking-token mutation rate limit (Gate 4) ---
    "token_action_max": SettingSpec(
        key="token_action_max",
        value_type="integer",
        description="Max customer capability-link mutations per token per window.",
        env="TOKEN_ACTION_MAX",
        fallback=30,
        validate=_int_range(1, 10_000),
    ),
    "token_action_window_seconds": SettingSpec(
        key="token_action_window_seconds",
        value_type="integer",
        description="Sliding-window length (seconds) for the per-token mutation limit.",
        env="TOKEN_ACTION_WINDOW_SECONDS",
        fallback=60,
        validate=_int_range(1, 3_600),
    ),
    # --- auth hardening: login throttle ---
    "login_max_failures": SettingSpec(
        key="login_max_failures",
        value_type="integer",
        description="Failed logins allowed per window before throttling.",
        env="LOGIN_MAX_FAILURES",
        fallback=8,
        validate=_int_range(1, 1_000),
    ),
    "login_window_seconds": SettingSpec(
        key="login_window_seconds",
        value_type="integer",
        description="Sliding-window length (seconds) for the login-failure throttle.",
        env="LOGIN_WINDOW_SECONDS",
        fallback=900,
        validate=_int_range(1, 86_400),
    ),
    # --- per-provider-overridable dispatch queue thresholds (0025) ---
    "dispatch_ack_sla_minutes": SettingSpec(
        key="dispatch_ack_sla_minutes",
        value_type="integer",
        description="Minutes before an unacknowledged (no offer sent) job breaches "
        "the dispatcher acknowledgement SLA.",
        env="DISPATCH_ACK_SLA_MINUTES",
        fallback=5,
        validate=_int_range(1, 120),
        org_overridable=True,
    ),
    "dispatch_stalled_minutes": SettingSpec(
        key="dispatch_stalled_minutes",
        value_type="integer",
        description="Minutes before an unassigned job is flagged stalled in the "
        "dispatch queue.",
        env="DISPATCH_STALLED_MINUTES",
        fallback=15,
        validate=_int_range(1, 1440),
        org_overridable=True,
    ),
    "dispatch_distance_unit": SettingSpec(
        key="dispatch_distance_unit",
        value_type="string",
        description="Distance unit shown in provider dispatch screens.",
        env="DISPATCH_DISTANCE_UNIT",
        fallback="mi",
        validate=_one_of("mi", "km"),
        org_overridable=True,
    ),
    "intake_show_estimate": SettingSpec(
        key="intake_show_estimate",
        value_type="boolean",
        description="Whether branded customer intake shows and requires the upfront estimate step.",
        env="INTAKE_SHOW_ESTIMATE",
        fallback=True,
        validate=_is_bool,
        org_overridable=True,
    ),
    # --- per-org tenant caps, console-overridable (0026) ---
    "max_users_per_org": SettingSpec(
        key="max_users_per_org",
        value_type="integer",
        description="Max member accounts (admins + dispatchers) per organization.",
        env="MAX_USERS_PER_ORG",
        fallback=5,
        validate=_int_range(1, 500),
        org_overridable=True,
    ),
    "max_technicians_per_org": SettingSpec(
        key="max_technicians_per_org",
        value_type="integer",
        description="Max affiliated technicians (active + pending invites) per "
        "organization.",
        env="MAX_TECHNICIANS_PER_ORG",
        fallback=5,
        validate=_int_range(1, 500),
        org_overridable=True,
    ),
    # --- per-provider financial closeout defaults (0031) ---
    "closeout_max_line_items": SettingSpec(
        key="closeout_max_line_items",
        value_type="integer",
        description="Max line items a technician may add to a job closeout.",
        env="CLOSEOUT_MAX_LINE_ITEMS",
        fallback=20,
        validate=_int_range(1, 100),
        org_overridable=True,
    ),
    "closeout_default_tax_rate_basis_points": SettingSpec(
        key="closeout_default_tax_rate_basis_points",
        value_type="integer",
        description="Default provider tax rate for closeout calculations, stored "
        "in basis points (725 = 7.25%).",
        env="CLOSEOUT_DEFAULT_TAX_RATE_BASIS_POINTS",
        fallback=0,
        validate=_int_range(0, 2500),
        org_overridable=True,
    ),
    "closeout_card_fee_basis_points": SettingSpec(
        key="closeout_card_fee_basis_points",
        value_type="integer",
        description="Default card processing fee percentage for closeout "
        "calculations, stored in basis points.",
        env="CLOSEOUT_CARD_FEE_BASIS_POINTS",
        fallback=0,
        validate=_int_range(0, 2500),
        org_overridable=True,
    ),
    "closeout_card_fee_fixed_cents": SettingSpec(
        key="closeout_card_fee_fixed_cents",
        value_type="integer",
        description="Default fixed card processing fee in cents for closeout "
        "calculations.",
        env="CLOSEOUT_CARD_FEE_FIXED_CENTS",
        fallback=0,
        validate=_int_range(0, 10_000),
        org_overridable=True,
    ),
}


def is_known_key(key: str) -> bool:
    return key in SETTINGS


def coerce_and_validate(key: str, value: Any) -> Any:
    """Validate a value for a known, runtime-editable, non-secret key.

    Raises ``SettingValidationError`` (caller maps to 422) on any contract breach.
    """
    spec = SETTINGS.get(key)
    if spec is None:
        raise SettingValidationError(f"Unknown setting key '{key}'")
    if spec.is_secret:
        raise SettingValidationError("Secret settings cannot be stored in global_settings")
    if not spec.is_runtime_editable:
        raise SettingValidationError(f"Setting '{key}' is not runtime-editable")
    if spec.value_type == "integer" and (isinstance(value, bool) or not isinstance(value, int)):
        raise SettingValidationError(f"{key} must be an integer")
    if spec.value_type == "boolean" and not isinstance(value, bool):
        raise SettingValidationError(f"{key} must be a boolean")
    if not spec.validate(value):
        raise SettingValidationError(f"{key} failed validation for its allowed range")
    return value


# --- tiny in-process cache (per warm instance), ~30s, stale acceptable --------
_CACHE_TTL_SECONDS = 30.0
_cache: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str) -> Any | None:
    hit = _cache.get(key)
    if hit is not None and (time.monotonic() - hit[0]) < _CACHE_TTL_SECONDS:
        return hit[1]
    return None


def _remember(key: str, value: Any) -> Any:
    _cache[key] = (time.monotonic(), value)
    return value


def clear_cache() -> None:
    """Drop the in-process cache. Called after an admin update so a change is
    visible immediately rather than after the ~30s TTL; also used by tests."""
    _cache.clear()


def _parse_env(spec: SettingSpec, raw: str) -> Any:
    """Coerce a raw env string into the spec's type. Returns ``None`` if uncoercible."""
    if spec.value_type == "integer":
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
    if spec.value_type == "boolean":
        return raw.strip().lower() == "true"
    return raw


async def resolve(store: Any, key: str) -> Any:
    """Resolve one runtime setting: DB → env → hardcoded fallback.

    Tolerant by design — a missing/invalid DB row, an unreadable DB, or a bad env
    value never raises; resolution degrades to the next source and ultimately the
    hardcoded ``fallback``. Values are cached per warm instance for ~30s.
    """
    spec = SETTINGS[key]
    cached = _cache_get(key)
    if cached is not None:
        return cached

    # 1) DB (global_settings) — tolerant of a missing/invalid row or read failure.
    try:
        row = await store.get_global_setting(key)
    except Exception:  # pragma: no cover - defensive: a DB hiccup must never break callers
        logger.warning("global_settings read failed for %s; using env/default", key)
        row = None
    if row is not None:
        value = row.get("value")
        if spec.validate(value):
            return _remember(key, value)
        logger.warning("global_settings[%s]=%r invalid; using env/default", key, value)

    # 2) env var (read fresh, so it stays testable and independent of import-time config)
    if spec.env:
        raw = os.environ.get(spec.env)
        if raw is not None:
            env_value = _parse_env(spec, raw)
            if env_value is not None and spec.validate(env_value):
                return _remember(key, env_value)

    # 3) hardcoded fallback
    return _remember(key, spec.fallback)


async def resolve_offer_ttl_seconds(store: Any) -> int:
    """Resolve the dispatch-offer TTL at offer-creation time.

    Order: ``global_settings.dispatch_offer_ttl_seconds`` → ``DISPATCH_OFFER_TTL_SECONDS``
    env → hardcoded ``300``. Safe under DB failure (falls back; never raises).
    """
    return await resolve(store, "dispatch_offer_ttl_seconds")


async def resolve_org(store: Any, organization_id: str, key: str) -> Any:
    """Resolve an org-overridable setting: this org's override (organization_settings)
    → the platform-wide default (``resolve``, itself DB → env → hardcoded).

    Not cached (org overrides are read far less often than the hot offer-creation
    path) and just as tolerant of a DB hiccup — a failed override read silently
    falls through to the platform default rather than raising.
    """
    spec = SETTINGS[key]
    if not spec.org_overridable:
        raise SettingValidationError(f"'{key}' does not support per-organization overrides")
    try:
        row = await store.get_organization_setting(organization_id, key)
    except Exception:  # pragma: no cover - defensive, mirrors resolve()
        logger.warning("organization_settings read failed for org=%s key=%s; using platform default", organization_id, key)
        row = None
    if row is not None and spec.validate(row.get("value")):
        return row["value"]
    return await resolve(store, key)
