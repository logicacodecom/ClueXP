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


def _int_range(lo: int, hi: int) -> Callable[[Any], bool]:
    """Build a validator accepting ints in [lo, hi]. Rejects bools (a subclass of int)."""

    def _validate(v: Any) -> bool:
        return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi

    return _validate


def _is_bool(v: Any) -> bool:
    return isinstance(v, bool)


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
