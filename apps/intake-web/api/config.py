"""Dispatch tunables + secrets, centralized so they can be tuned via env without
touching logic. All have safe defaults for local/demo."""
from __future__ import annotations

import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


# How long a targeted dispatcher offer lives before it expires and the job
# returns to pending_dispatch for the dispatcher to re-assign.
OFFER_TTL_SECONDS = _int("DISPATCH_OFFER_TTL_SECONDS", 90)

# How long since a technician's last location ping before they are considered
# "offline" in the ops candidates view.
LOCATION_ONLINE_THRESHOLD_MINUTES = _int("LOCATION_ONLINE_THRESHOLD_MINUTES", 15)

# --- auto-dispatch model remnants (ops-controlled model, Sprint 3.4) ---
# These values are no longer used to drive dispatch decisions. They are sentinel
# large numbers so the "timed_out" / "max_rounds" branches in get_dispatch_status
# never fire: jobs stay pending_dispatch until a dispatcher assigns them.
MAX_REDISPATCH_ROUNDS = _int("DISPATCH_MAX_ROUNDS", 9999)
TOTAL_TIMEOUT_SECONDS = _int("DISPATCH_TOTAL_TIMEOUT_SECONDS", 99_999_999)
TOP_N_OFFERS = _int("DISPATCH_TOP_N", 1)

# Shared secret for the scheduled sweep endpoint. Scheduler-agnostic: Vercel Cron
# sends `Authorization: Bearer ${CRON_SECRET}`; Supabase pg_cron/pg_net or any
# external caller sends the same header. If unset, the sweep endpoint is disabled.
CRON_SECRET = os.environ.get("CRON_SECRET", "")

# --- fulfillment cutover (Sprint 3) ---
# How long a `completed_pending_customer` job waits for the customer to confirm
# before the sweep auto-closes it. Default 72h.
AUTO_CLOSE_WINDOW_SECONDS = _int("AUTO_CLOSE_WINDOW_SECONDS", 259200)
# Emergency kill-switch: force every channel back to the legacy stub regardless of
# its per-channel `dispatch_cutover_enabled` flag, without per-row DB edits.
DISPATCH_CUTOVER_GLOBAL_OFF = (
    os.environ.get("DISPATCH_CUTOVER_GLOBAL_OFF", "false").strip().lower() == "true"
)
# DEPRECATED / DISABLED: public channelless dispatch. ClueXP is a SaaS platform and
# does not dispatch — every dispatchable request must belong to a provider company via
# a branded intake channel. This flag is no longer read by the intake path; kept only
# to avoid breaking any environment that still defines it.
DISPATCH_CUTOVER_PUBLIC = (
    os.environ.get("DISPATCH_CUTOVER_PUBLIC", "false").strip().lower() == "true"
)

# --- arrival verification (Gate 2) ---
# Secure customer-held PIN the technician must enter to move en_route -> arrived.
# Only a hash is stored; the PIN expires, is single-use, and attempt-limited.
ARRIVAL_PIN_TTL_SECONDS = _int("ARRIVAL_PIN_TTL_SECONDS", 900)
ARRIVAL_PIN_MAX_ATTEMPTS = _int("ARRIVAL_PIN_MAX_ATTEMPTS", 5)
# Server-side key for the keyed PIN hash (HMAC). Stable per deployment so the
# stored hash can be recomputed for comparison; protects PINs if the DB leaks.
# Fail secure: production MUST set ARRIVAL_PIN_SECRET explicitly. We never silently
# fall back to a public default in production — startup fails instead.
IS_PRODUCTION = (
    os.environ.get("VERCEL_ENV", "").strip().lower() == "production"
    or os.environ.get("APP_ENV", os.environ.get("ENVIRONMENT", "")).strip().lower() in {"production", "prod"}
)
_arrival_pin_secret = os.environ.get("ARRIVAL_PIN_SECRET")
if not _arrival_pin_secret:
    if IS_PRODUCTION:
        raise RuntimeError(
            "ARRIVAL_PIN_SECRET must be set in production. Refusing to start with an "
            "insecure default — set a high-entropy secret (e.g. `openssl rand -hex 32`)."
        )
    _arrival_pin_secret = "dev-arrival-pin-secret"
ARRIVAL_PIN_SECRET = _arrival_pin_secret

# --- tracking-token mutation rate limit (Gate 4) ---
# Per-token sliding window guarding the customer capability-link mutations
# (confirm / review / dispute / cancel / arrival-pin). Generous enough for normal
# use; blocks abuse of a leaked link. In-process (per-instance) — a first layer.
TOKEN_ACTION_MAX = _int("TOKEN_ACTION_MAX", 30)
TOKEN_ACTION_WINDOW_SECONDS = _int("TOKEN_ACTION_WINDOW_SECONDS", 60)

# --- auth hardening ---
LOGIN_MAX_FAILURES = _int("LOGIN_MAX_FAILURES", 8)
LOGIN_WINDOW_SECONDS = _int("LOGIN_WINDOW_SECONDS", 900)
DEMO_SEED = os.environ.get("DEMO_SEED", "true").strip().lower() != "false"
