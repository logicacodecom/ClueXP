"""Dispatch tunables + secrets, centralized so they can be tuned via env without
touching logic. All have safe defaults for local/demo."""
from __future__ import annotations

import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


# Offer lifetime before it expires and the sweep may re-dispatch.
OFFER_TTL_SECONDS = _int("DISPATCH_OFFER_TTL_SECONDS", 90)
# Target cadence for the sweep (informational; actual cadence is set by the scheduler).
SWEEP_INTERVAL_SECONDS = _int("DISPATCH_SWEEP_INTERVAL_SECONDS", 60)
# Max re-dispatch rounds before a job is considered un-fillable (terminal no_eligible).
MAX_REDISPATCH_ROUNDS = _int("DISPATCH_MAX_ROUNDS", 3)
# Total customer-facing dispatch window; after this we stop and hand off to humans.
TOTAL_TIMEOUT_SECONDS = _int("DISPATCH_TOTAL_TIMEOUT_SECONDS", 480)  # ~8 min
# How many offers to create per round.
TOP_N_OFFERS = _int("DISPATCH_TOP_N", 3)

# Shared secret for the scheduled sweep endpoint. Scheduler-agnostic: Vercel Cron
# sends `Authorization: Bearer ${CRON_SECRET}`; Supabase pg_cron/pg_net or any
# external caller sends the same header. If unset, the sweep endpoint is disabled.
CRON_SECRET = os.environ.get("CRON_SECRET", "")

# --- auth hardening ---
LOGIN_MAX_FAILURES = _int("LOGIN_MAX_FAILURES", 8)
LOGIN_WINDOW_SECONDS = _int("LOGIN_WINDOW_SECONDS", 900)
DEMO_SEED = os.environ.get("DEMO_SEED", "true").strip().lower() != "false"
